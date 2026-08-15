import { X509Certificate } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { parseCrl } from '../../lib/der.js';
import { UnauthorizedError } from '../../lib/errors.js';

/**
 * Autenticación con DNI electrónico y con certificado de la FNMT.
 *
 * El apretón de manos TLS con petición de certificado de cliente lo hace el
 * proxy inverso (nginx, Traefik o Apache), que reenvía el certificado en una
 * cabecera. Esta capa hace lo que el proxy no hace: comprobar que la cadena
 * sube hasta una CA de confianza propia, que el certificado está en vigor, que
 * no está revocado y, sobre todo, extraer la identidad (NIF y nombre) del
 * sujeto, que es lo que da valor a este método frente a un login normal.
 *
 * Ver docs/autenticacion.md para la configuración del proxy.
 */

export interface CertificateIdentity {
  /** DNI o NIE normalizado. */
  nif: string;
  name: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  /** Huella SHA-256 del certificado, para trazas y para detectar renovaciones. */
  fingerprint: string;
}

interface TrustStore {
  certificates: X509Certificate[];
  loadedAt: number;
}

let trustStore: TrustStore | null = null;
const crlCache = new Map<string, { serials: Set<string>; loadedAt: number }>();

/** Carga los certificados raíz e intermedios de confianza desde disco. */
export async function loadTrustStore(force = false): Promise<X509Certificate[]> {
  if (trustStore && !force && Date.now() - trustStore.loadedAt < 300_000) {
    return trustStore.certificates;
  }

  const dir = resolve(env.CERT_TRUST_DIR);
  const certificates: X509Certificate[] = [];
  const entries = await readdir(dir).catch(() => [] as string[]);

  for (const entry of entries) {
    if (!/\.(pem|crt|cer)$/i.test(entry)) continue;
    try {
      const content = await readFile(join(dir, entry));
      for (const pem of splitPemBundle(content.toString('utf8'))) {
        certificates.push(new X509Certificate(pem));
      }
    } catch (error) {
      logger.warn({ err: error, file: entry }, 'No se pudo cargar un certificado de confianza');
    }
  }

  if (certificates.length === 0) {
    logger.warn(
      { dir },
      'No hay certificados de confianza cargados: la autenticación por certificado rechazará todo',
    );
  }

  trustStore = { certificates, loadedAt: Date.now() };
  return certificates;
}

function splitPemBundle(content: string): string[] {
  const matches = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return matches ?? [];
}

/**
 * Normaliza lo que llega en la cabecera. Nginx envía el PEM con los saltos de
 * línea sustituidos por tabuladores o codificado en URL según la directiva
 * usada; Apache lo manda en una sola línea.
 */
export function normalizeCertificateHeader(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('%')) value = decodeURIComponent(value);
  value = value.replace(/\s*\t\s*/g, '\n').replace(/\\n/g, '\n');
  if (!value.includes('-----BEGIN CERTIFICATE-----')) {
    // Algunos proxies mandan solo el base64 del DER.
    const body = value.replace(/\s+/g, '');
    value = `-----BEGIN CERTIFICATE-----\n${body.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
  }
  if (!value.includes('\n')) {
    value = value
      .replace('-----BEGIN CERTIFICATE-----', '-----BEGIN CERTIFICATE-----\n')
      .replace('-----END CERTIFICATE-----', '\n-----END CERTIFICATE-----');
  }
  return value;
}

/** Convierte el DN que devuelve Node (`clave=valor` por línea) en un mapa. */
function parseDistinguishedName(dn: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of dn.split('\n')) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim().toUpperCase();
    const value = line.slice(index + 1).trim();
    if (value) result[key] = value;
  }
  return result;
}

const NIF_PATTERN = /\b([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])\b/;

/**
 * Extrae el NIF. Los emisores españoles lo colocan en sitios distintos:
 * la FNMT usa `serialNumber` y también `CN=... - NIF 12345678Z`; el DNIe pone
 * el número de soporte en `serialNumber` y el NIF en el CN o en un OID propio.
 */
export function extractNif(subject: Record<string, string>): string | null {
  const candidates = [
    subject.SERIALNUMBER,
    subject['2.5.4.5'],
    subject.CN,
    subject.OU,
    subject.UID,
    subject.DNQUALIFIER,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = candidate.replace(/^IDCES-/i, '').toUpperCase();
    const match = NIF_PATTERN.exec(cleaned);
    if (match) return match[1]!;
  }
  return null;
}

export interface VerifyOptions {
  /** Instante de referencia para la comprobación de vigencia. */
  at?: Date;
  checkCrl?: boolean;
}

/**
 * Valida el certificado y devuelve la identidad. Lanza `UnauthorizedError` con
 * un código estable si algo no cuadra, para poder distinguir en el frontend un
 * certificado caducado de uno de una CA desconocida.
 */
export async function verifyClientCertificate(
  pem: string,
  options: VerifyOptions = {},
): Promise<CertificateIdentity> {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(normalizeCertificateHeader(pem));
  } catch {
    throw new UnauthorizedError('El certificado presentado no se pudo leer', 'cert_unreadable');
  }

  const now = options.at ?? new Date();
  if (new Date(certificate.validFrom) > now) {
    throw new UnauthorizedError('El certificado todavía no es válido', 'cert_not_yet_valid');
  }
  if (new Date(certificate.validTo) < now) {
    throw new UnauthorizedError('El certificado ha caducado', 'cert_expired');
  }

  const chain = await buildChain(certificate);
  if (!chain) {
    throw new UnauthorizedError(
      'El certificado no lo emite una autoridad de confianza configurada',
      'cert_untrusted',
    );
  }

  if (options.checkCrl ?? env.CERT_CHECK_CRL) {
    const revoked = await isRevoked(certificate);
    if (revoked) {
      throw new UnauthorizedError('El certificado está revocado', 'cert_revoked');
    }
  }

  const subject = parseDistinguishedName(certificate.subject);
  const nif = extractNif(subject);
  if (!nif) {
    throw new UnauthorizedError(
      'El certificado no contiene un DNI o NIE reconocible',
      'cert_no_nif',
    );
  }

  const givenName = subject.GIVENNAME ?? subject.G ?? null;
  const familyName = subject.SURNAME ?? subject.SN ?? null;
  const name =
    [givenName, familyName].filter(Boolean).join(' ') ||
    cleanCommonName(subject.CN ?? '') ||
    nif;

  return {
    nif,
    name,
    givenName,
    familyName,
    email: extractEmail(certificate, subject),
    issuer: parseDistinguishedName(certificate.issuer).CN ?? certificate.issuer.split('\n')[0] ?? '',
    serialNumber: certificate.serialNumber.toUpperCase(),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    fingerprint: certificate.fingerprint256.replace(/:/g, '').toLowerCase(),
  };
}

/** `NOMBRE APELLIDO1 APELLIDO2 - NIF 12345678Z` -> `NOMBRE APELLIDO1 APELLIDO2`. */
function cleanCommonName(cn: string): string {
  return cn
    .replace(/\s*-\s*(NIF|DNI|NIE)\s*[0-9A-Z]+$/i, '')
    .replace(/\s*\((AUTENTICACIÓN|AUTENTICACION|FIRMA)\)\s*$/i, '')
    .trim();
}

function extractEmail(certificate: X509Certificate, subject: Record<string, string>): string | null {
  const fromSubject = subject.EMAILADDRESS ?? subject.E ?? subject['1.2.840.113549.1.9.1'];
  if (fromSubject) return fromSubject.toLowerCase();
  const san = certificate.subjectAltName ?? '';
  const match = /email:([^,\s]+)/i.exec(san);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Sube por la cadena hasta encontrar una raíz de confianza. Cada eslabón se
 * verifica criptográficamente: no basta con que los nombres encajen.
 */
async function buildChain(leaf: X509Certificate): Promise<X509Certificate[] | null> {
  const trusted = await loadTrustStore();
  const chain: X509Certificate[] = [leaf];
  let current = leaf;

  for (let depth = 0; depth < 8; depth += 1) {
    if (current.subject === current.issuer && current.verify(current.publicKey)) {
      // Raíz autofirmada: solo vale si está en el almacén.
      return trusted.some((candidate) => candidate.fingerprint256 === current.fingerprint256)
        ? chain
        : null;
    }

    const issuer = trusted.find((candidate) => {
      try {
        return current.checkIssued(candidate) && current.verify(candidate.publicKey);
      } catch {
        return false;
      }
    });

    if (!issuer) return null;
    chain.push(issuer);
    if (issuer.subject === issuer.issuer) return chain;
    current = issuer;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Revocación                                                                  */
/* -------------------------------------------------------------------------- */

/** Puntos de distribución de CRL declarados en el propio certificado. */
function crlDistributionPoints(certificate: X509Certificate): string[] {
  const info = (certificate as unknown as { infoAccess?: string }).infoAccess ?? '';
  const urls = new Set<string>();
  for (const match of info.matchAll(/URI:(http[^\s,]+)/gi)) {
    if (match[1] && match[1].toLowerCase().includes('crl')) urls.add(match[1]);
  }
  return [...urls];
}

async function isRevoked(certificate: X509Certificate): Promise<boolean> {
  const serial = certificate.serialNumber.toUpperCase().replace(/^0+(?=.)/, '');
  const sources = crlDistributionPoints(certificate);
  const local = await localCrlFiles();

  if (sources.length === 0 && local.length === 0) {
    logger.warn(
      { subject: certificate.subject.split('\n')[0] },
      'No hay CRL disponible para comprobar la revocación; se acepta el certificado',
    );
    return false;
  }

  for (const file of local) {
    const serials = await loadCrlFromFile(file);
    if (serials.has(serial)) return true;
  }
  for (const url of sources) {
    const serials = await loadCrlFromUrl(url);
    if (serials.has(serial)) return true;
  }
  return false;
}

async function localCrlFiles(): Promise<string[]> {
  const dir = resolve(env.CERT_CRL_DIR);
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries.filter((entry) => /\.crl$/i.test(entry)).map((entry) => join(dir, entry));
}

async function loadCrlFromFile(path: string): Promise<Set<string>> {
  const cached = crlCache.get(path);
  if (cached && Date.now() - cached.loadedAt < env.CERT_CRL_REFRESH_HOURS * 3_600_000) {
    return cached.serials;
  }
  try {
    const content = await readFile(path);
    const der = content.subarray(0, 11).toString('ascii').includes('-----BEGIN')
      ? pemToDer(content.toString('utf8'))
      : content;
    const { revokedSerials } = parseCrl(der);
    crlCache.set(path, { serials: revokedSerials, loadedAt: Date.now() });
    return revokedSerials;
  } catch (error) {
    logger.warn({ err: error, path }, 'CRL local ilegible');
    return new Set();
  }
}

/** Descarga la CRL y la guarda en disco para no depender de la red en cada login. */
async function loadCrlFromUrl(url: string): Promise<Set<string>> {
  const cached = crlCache.get(url);
  if (cached && Date.now() - cached.loadedAt < env.CERT_CRL_REFRESH_HOURS * 3_600_000) {
    return cached.serials;
  }

  const dir = resolve(env.CERT_CRL_DIR);
  await mkdir(dir, { recursive: true });
  const cacheFile = join(dir, `${Buffer.from(url).toString('base64url').slice(0, 60)}.crl`);

  const info = await stat(cacheFile).catch(() => null);
  const fresh = info && Date.now() - info.mtimeMs < env.CERT_CRL_REFRESH_HOURS * 3_600_000;

  if (!fresh) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(cacheFile, Buffer.from(await response.arrayBuffer()));
      logger.info({ url }, 'CRL actualizada');
    } catch (error) {
      logger.warn({ err: error, url }, 'No se pudo descargar la CRL; se usa la copia local');
      if (!info) return new Set();
    }
  }

  return loadCrlFromFile(cacheFile);
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

/** Invalida las cachés. Se usa desde el panel al subir nuevas CA. */
export function resetCertificateCaches(): void {
  trustStore = null;
  crlCache.clear();
}
