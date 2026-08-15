import { X509Certificate, createVerify } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { findUserById } from '../users/repository.js';
import { verifyAccessToken } from '../auth/tokens.js';
import {
  bookSlot,
  cancelNextAppointment,
  findNextSlot,
  listBookableServices,
  listMyAppointments,
  type AssistantContext,
} from './assistant.js';

/**
 * Skill de Alexa.
 *
 * Amazon exige verificar que cada petición viene de verdad de Alexa antes de
 * atenderla: certificado descargado de una URL con formato estricto, cadena
 * válida, nombre alternativo `echo-api.amazon.com` y firma RSA-SHA1 del cuerpo
 * en bruto. Sin esa comprobación, cualquiera podría reservar citas haciendo
 * peticiones al endpoint.
 */

interface AlexaRequestBody {
  version: string;
  session?: {
    new: boolean;
    sessionId: string;
    application: { applicationId: string };
    user: { userId: string; accessToken?: string };
  };
  context?: {
    System: {
      application: { applicationId: string };
      user: { userId: string; accessToken?: string };
    };
  };
  request: {
    type: string;
    requestId: string;
    locale?: string;
    intent?: {
      name: string;
      slots?: Record<string, { name: string; value?: string }>;
    };
  };
}

const certCache = new Map<string, { certificate: X509Certificate; loadedAt: number }>();

/** La URL del certificado tiene un formato fijo; comprobarlo evita un SSRF. */
function isValidCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 's3.amazonaws.com' &&
      (parsed.port === '' || parsed.port === '443') &&
      parsed.pathname.startsWith('/echo.api/')
    );
  } catch {
    return false;
  }
}

async function loadCertificate(url: string): Promise<X509Certificate> {
  const cached = certCache.get(url);
  if (cached && Date.now() - cached.loadedAt < 24 * 3_600_000) return cached.certificate;

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new UnauthorizedError('No se pudo descargar el certificado de Alexa');

  const pem = await response.text();
  const certificate = new X509Certificate(pem);

  const now = new Date();
  if (new Date(certificate.validFrom) > now || new Date(certificate.validTo) < now) {
    throw new UnauthorizedError('Certificado de Alexa fuera de vigencia', 'alexa_cert_expired');
  }
  if (!(certificate.subjectAltName ?? '').includes('echo-api.amazon.com')) {
    throw new UnauthorizedError('Certificado de Alexa no válido', 'alexa_cert_invalid');
  }

  certCache.set(url, { certificate, loadedAt: Date.now() });
  return certificate;
}

export async function verifyAlexaRequest(params: {
  rawBody: string;
  signatureCertChainUrl?: string;
  signature?: string;
  body: AlexaRequestBody;
}): Promise<void> {
  if (!params.signatureCertChainUrl || !params.signature) {
    throw new UnauthorizedError('Faltan las cabeceras de firma de Alexa', 'alexa_signature_missing');
  }
  if (!isValidCertUrl(params.signatureCertChainUrl)) {
    throw new UnauthorizedError('URL de certificado no admitida', 'alexa_cert_url_invalid');
  }

  const certificate = await loadCertificate(params.signatureCertChainUrl);
  const verifier = createVerify('RSA-SHA1');
  verifier.update(params.rawBody, 'utf8');

  if (!verifier.verify(certificate.publicKey, params.signature, 'base64')) {
    throw new UnauthorizedError('Firma de Alexa incorrecta', 'alexa_signature_invalid');
  }

  const applicationId =
    params.body.context?.System.application.applicationId ??
    params.body.session?.application.applicationId;
  if (env.ALEXA_SKILL_ID && applicationId !== env.ALEXA_SKILL_ID) {
    throw new UnauthorizedError('La skill no es la esperada', 'alexa_skill_mismatch');
  }
}

/* -------------------------------------------------------------------------- */
/* Respuestas                                                                  */
/* -------------------------------------------------------------------------- */

function speak(text: string, endSession = true, sessionAttributes?: Record<string, unknown>) {
  return {
    version: '1.0',
    sessionAttributes: sessionAttributes ?? {},
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: endSession,
    },
  };
}

function linkAccount(text: string) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      card: { type: 'LinkAccount' },
      shouldEndSession: true,
    },
  };
}

/**
 * Resuelve el usuario a partir del `accessToken` de vinculación de cuentas.
 * Alexa entrega ahí el token que emitió nuestro propio OAuth, que en esta
 * aplicación es el token de sesión.
 */
async function resolveUser(body: AlexaRequestBody): Promise<string | null> {
  const token = body.context?.System.user.accessToken ?? body.session?.user.accessToken;
  if (!token) return null;
  try {
    const claims = await verifyAccessToken(token);
    const user = await findUserById(claims.sub);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function handleAlexaRequest(
  organizationId: string,
  body: AlexaRequestBody,
): Promise<unknown> {
  const locale = (body.request.locale ?? 'es-ES').slice(0, 2);
  const userId = await resolveUser(body);
  const context: AssistantContext = { organizationId, userId, locale };

  if (body.request.type === 'LaunchRequest') {
    const reply = await listBookableServices(context);
    return speak(reply.speech, false);
  }

  if (body.request.type === 'SessionEndedRequest') {
    return speak('', true);
  }

  const intent = body.request.intent?.name ?? '';
  const slots = body.request.intent?.slots ?? {};
  const slotValue = (name: string) => slots[name]?.value;

  try {
    switch (intent) {
      case 'AMAZON.HelpIntent':
        return speak(
          'Puedes pedirme que reserve una cita, que te diga cuándo hay hueco o qué citas tienes.',
          false,
        );

      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return speak('Hasta luego.');

      case 'ListarServiciosIntent': {
        const reply = await listBookableServices(context);
        return speak(reply.speech);
      }

      case 'ProximoHuecoIntent': {
        const reply = await findNextSlot(context, {
          serviceName: slotValue('servicio'),
          fromDate: slotValue('fecha'),
        });
        return speak(reply.speech, !reply.expectsAnswer, {
          pendingSlot: reply.slot,
          pendingServiceId: reply.serviceId,
        });
      }

      case 'ReservarIntent': {
        if (!userId) return linkAccount('Vincula tu cuenta para poder reservar.');

        const next = await findNextSlot(context, {
          serviceName: slotValue('servicio'),
          fromDate: slotValue('fecha'),
        });
        const slot = next.slot as { startsAt?: string } | undefined;
        if (!slot?.startsAt || !next.serviceId) return speak(next.speech);

        const booked = await bookSlot(context, {
          serviceId: next.serviceId,
          startsAt: slot.startsAt,
        });
        return speak(booked.speech);
      }

      case 'AMAZON.YesIntent': {
        // Confirmación del hueco propuesto en el turno anterior.
        const attributes = (body as unknown as { session?: { attributes?: Record<string, any> } })
          .session?.attributes;
        const slot = attributes?.pendingSlot as { startsAt?: string } | undefined;
        const serviceId = attributes?.pendingServiceId as string | undefined;
        if (!slot?.startsAt || !serviceId) return speak('No tengo ninguna cita pendiente de confirmar.');
        const booked = await bookSlot(context, { serviceId, startsAt: slot.startsAt });
        return speak(booked.speech);
      }

      case 'MisCitasIntent': {
        const reply = await listMyAppointments(context);
        return speak(reply.speech);
      }

      case 'CancelarCitaIntent': {
        const reply = await cancelNextAppointment(context);
        return speak(reply.speech);
      }

      default:
        return speak('No he entendido lo que necesitas. Puedes pedirme una cita o consultar las que tienes.', false);
    }
  } catch (error) {
    logger.error({ err: error, intent }, 'Error atendiendo una petición de Alexa');
    return speak('Ha habido un problema al procesar tu petición. Inténtalo de nuevo.');
  }
}

export type { AlexaRequestBody };
