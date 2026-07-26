import { logger } from '../../lib/logger.js';
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
 * Webhook para Google.
 *
 * Se implementa el formato de Dialogflow CX, que es el que usan hoy tanto las
 * integraciones de Google Assistant como los agentes conversacionales de
 * Google Cloud, y se acepta también el formato clásico de Dialogflow ES para
 * no dejar fuera a quien tenga un agente antiguo. La autenticación se hace por
 * el token de sesión que el agente reenvía en la cabecera `Authorization`,
 * igual que cualquier otro cliente del API.
 */

interface DialogflowCxRequest {
  detectIntentResponseId?: string;
  languageCode?: string;
  fulfillmentInfo?: { tag: string };
  sessionInfo?: { parameters?: Record<string, unknown> };
  intentInfo?: { displayName?: string; parameters?: Record<string, { resolvedValue?: unknown }> };
}

interface DialogflowEsRequest {
  queryResult?: {
    intent?: { displayName?: string };
    parameters?: Record<string, unknown>;
    languageCode?: string;
  };
}

export type GoogleWebhookRequest = DialogflowCxRequest & DialogflowEsRequest;

function textResponse(text: string) {
  return {
    // Formato CX.
    fulfillment_response: {
      messages: [{ text: { text: [text] } }],
    },
    // Formato ES, para agentes antiguos. Google ignora el que no le sirve.
    fulfillmentText: text,
  };
}

function readIntent(body: GoogleWebhookRequest): string {
  return (
    body.fulfillmentInfo?.tag ??
    body.intentInfo?.displayName ??
    body.queryResult?.intent?.displayName ??
    ''
  );
}

function readParameters(body: GoogleWebhookRequest): Record<string, unknown> {
  if (body.intentInfo?.parameters) {
    return Object.fromEntries(
      Object.entries(body.intentInfo.parameters).map(([key, value]) => [key, value.resolvedValue]),
    );
  }
  return body.sessionInfo?.parameters ?? body.queryResult?.parameters ?? {};
}

async function resolveUser(authorization?: string): Promise<string | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const claims = await verifyAccessToken(authorization.slice(7).trim());
    const user = await findUserById(claims.sub);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function handleGoogleWebhook(params: {
  organizationId: string;
  body: GoogleWebhookRequest;
  authorization?: string;
}): Promise<unknown> {
  const locale = (
    params.body.languageCode ??
    params.body.queryResult?.languageCode ??
    'es'
  ).slice(0, 2);

  const userId = await resolveUser(params.authorization);
  const context: AssistantContext = { organizationId: params.organizationId, userId, locale };
  const intent = readIntent(params.body);
  const parameters = readParameters(params.body);

  try {
    switch (intent) {
      case 'listar_servicios':
      case 'ListarServicios': {
        const reply = await listBookableServices(context);
        return textResponse(reply.speech);
      }

      case 'proximo_hueco':
      case 'ProximoHueco': {
        const reply = await findNextSlot(context, {
          serviceName: asString(parameters.servicio),
          fromDate: asString(parameters.fecha),
        });
        return textResponse(reply.speech);
      }

      case 'reservar':
      case 'Reservar': {
        const next = await findNextSlot(context, {
          serviceName: asString(parameters.servicio),
          fromDate: asString(parameters.fecha),
        });
        const slot = next.slot as { startsAt?: string } | undefined;
        if (!slot?.startsAt || !next.serviceId) return textResponse(next.speech);

        const booked = await bookSlot(context, {
          serviceId: next.serviceId,
          startsAt: slot.startsAt,
        });
        return textResponse(booked.speech);
      }

      case 'mis_citas':
      case 'MisCitas': {
        const reply = await listMyAppointments(context);
        return textResponse(reply.speech);
      }

      case 'cancelar_cita':
      case 'CancelarCita': {
        const reply = await cancelNextAppointment(context, asString(parameters.citaId));
        return textResponse(reply.speech);
      }

      default:
        return textResponse(
          'Puedo consultar los servicios, buscar hueco, reservar o cancelar una cita.',
        );
    }
  } catch (error) {
    logger.error({ err: error, intent }, 'Error atendiendo el webhook de Google');
    return textResponse('Ha habido un problema al procesar la petición.');
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}
