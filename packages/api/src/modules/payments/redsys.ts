import { createCipheriv, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Redsys (TPV virtual de la banca española).
 *
 * El protocolo es el de "firma HMAC SHA-256 v1", que funciona así:
 *
 *   1. Los datos de la operación van en un JSON codificado en base64
 *      (`Ds_MerchantParameters`).
 *   2. Se deriva una clave por operación cifrando el número de pedido con la
 *      clave del comercio mediante 3DES-CBC con vector de inicialización a
 *      cero. Ese paso, que parece arbitrario, es lo que hace que la firma sea
 *      distinta para cada pedido aunque la clave del comercio sea siempre la
 *      misma.
 *   3. La firma es el HMAC-SHA256 del base64 anterior con esa clave derivada.
 *
 * No hay SDK oficial mantenido para Node, así que se implementa aquí: son
 * cuarenta líneas sobre `node:crypto` y evita depender de un paquete de
 * terceros en el camino del dinero.
 */

const ENDPOINTS = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  live: 'https://sis.redsys.es/sis/realizarPago',
} as const;

export interface RedsysConfig {
  merchantCode: string;
  terminal: string;
  secretKey: string;
  environment: 'test' | 'live';
}

export interface RedsysOrderInput {
  /** Entre 4 y 12 caracteres; los 4 primeros han de ser numéricos. */
  order: string;
  amountCents: number;
  currency: string;
  description: string;
  urlOk: string;
  urlKo: string;
  urlNotification: string;
  /** Idioma de la pasarela: 001 español, 002 inglés, 012 gallego. */
  consumerLanguage?: string;
}

/** Códigos numéricos de moneda ISO 4217 admitidos por Redsys. */
const CURRENCY_CODES: Record<string, string> = {
  EUR: '978',
  USD: '840',
  GBP: '826',
};

const LANGUAGE_CODES: Record<string, string> = {
  es: '001',
  en: '002',
  gl: '012',
};

export function languageCode(locale: string): string {
  return LANGUAGE_CODES[locale] ?? '001';
}

function deriveKey(secretKeyBase64: string, order: string): Buffer {
  const key = Buffer.from(secretKeyBase64, 'base64');
  const cipher = createCipheriv('des-ede3-cbc', key, Buffer.alloc(8));
  cipher.setAutoPadding(false);

  // 3DES-CBC exige bloques de 8 bytes: el número de pedido se rellena con ceros.
  const padded = Buffer.alloc(Math.ceil(order.length / 8) * 8, 0);
  padded.write(order, 'utf8');

  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function sign(secretKeyBase64: string, order: string, parameters: string): string {
  return createHmac('sha256', deriveKey(secretKeyBase64, order))
    .update(parameters)
    .digest('base64');
}

export interface RedsysForm {
  action: string;
  fields: Record<string, string>;
}

/** Construye el formulario autoenviado que redirige al TPV. */
export function buildRedsysForm(config: RedsysConfig, input: RedsysOrderInput): RedsysForm {
  const parameters = {
    DS_MERCHANT_AMOUNT: String(input.amountCents),
    DS_MERCHANT_ORDER: input.order,
    DS_MERCHANT_MERCHANTCODE: config.merchantCode,
    DS_MERCHANT_CURRENCY: CURRENCY_CODES[input.currency] ?? '978',
    // 0 = autorización estándar.
    DS_MERCHANT_TRANSACTIONTYPE: '0',
    DS_MERCHANT_TERMINAL: config.terminal,
    DS_MERCHANT_MERCHANTURL: input.urlNotification,
    DS_MERCHANT_URLOK: input.urlOk,
    DS_MERCHANT_URLKO: input.urlKo,
    DS_MERCHANT_PRODUCTDESCRIPTION: input.description.slice(0, 125),
    DS_MERCHANT_CONSUMERLANGUAGE: input.consumerLanguage ?? '001',
  };

  const encoded = Buffer.from(JSON.stringify(parameters), 'utf8').toString('base64');

  return {
    action: ENDPOINTS[config.environment],
    fields: {
      Ds_SignatureVersion: 'HMAC_SHA256_V1',
      Ds_MerchantParameters: encoded,
      Ds_Signature: sign(config.secretKey, input.order, encoded),
    },
  };
}

export interface RedsysNotification {
  order: string;
  responseCode: number;
  authorisationCode: string | null;
  amountCents: number;
  currency: string;
  /** `true` si el código de respuesta indica operación autorizada. */
  authorised: boolean;
  raw: Record<string, string>;
}

/**
 * Verifica y decodifica la notificación del TPV. Devuelve `null` si la firma no
 * cuadra: una notificación sin firma válida no se puede distinguir de un
 * intento de marcar como pagada una cita que nadie ha pagado.
 */
export function parseRedsysNotification(
  config: RedsysConfig,
  body: { Ds_MerchantParameters?: string; Ds_Signature?: string; Ds_SignatureVersion?: string },
): RedsysNotification | null {
  if (!body.Ds_MerchantParameters || !body.Ds_Signature) return null;

  const decoded = JSON.parse(
    Buffer.from(body.Ds_MerchantParameters, 'base64').toString('utf8'),
  ) as Record<string, string>;

  const order = decoded.Ds_Order ?? '';
  const expected = sign(config.secretKey, order, body.Ds_MerchantParameters);

  // La firma que llega viene en base64 con alfabeto seguro para URL.
  const received = body.Ds_Signature.replace(/-/g, '+').replace(/_/g, '/');
  const expectedBuffer = Buffer.from(expected, 'base64');
  const receivedBuffer = Buffer.from(received, 'base64');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }

  const responseCode = Number(decoded.Ds_Response ?? '9999');

  return {
    order,
    responseCode,
    authorisationCode: decoded.Ds_AuthorisationCode ?? null,
    amountCents: Number(decoded.Ds_Amount ?? '0'),
    currency: decoded.Ds_Currency ?? '978',
    // Los códigos de 0 a 99 son autorizaciones; el resto, denegaciones.
    authorised: responseCode >= 0 && responseCode <= 99,
    raw: decoded,
  };
}

/**
 * Número de pedido válido para Redsys: 12 caracteres, los cuatro primeros
 * numéricos. Se construye con la marca de tiempo en base 36 para que sea único
 * y ordenable.
 */
export function buildOrderNumber(): string {
  const stamp = String(Date.now()).slice(-8);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${stamp}${random}`.slice(0, 12);
}
