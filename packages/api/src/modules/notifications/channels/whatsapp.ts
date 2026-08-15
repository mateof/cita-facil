import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

/**
 * WhatsApp mediante la Cloud API oficial de Meta.
 *
 * Limitación del canal, no de esta implementación: fuera de la ventana de 24
 * horas desde el último mensaje del usuario, WhatsApp solo permite enviar
 * *plantillas* aprobadas previamente por Meta. Por eso `sendWhatsapp` acepta
 * tanto texto libre (para conversaciones abiertas) como plantilla con
 * parámetros, y los recordatorios usan siempre plantilla.
 */

export interface WhatsappTextMessage {
  to: string;
  text: string;
}

export interface WhatsappTemplateMessage {
  to: string;
  template: string;
  languageCode: string;
  /** Parámetros posicionales del cuerpo de la plantilla. */
  parameters: string[];
}

function apiUrl(): string {
  if (!env.WHATSAPP_PHONE_NUMBER_ID) throw new Error('Falta WHATSAPP_PHONE_NUMBER_ID');
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

async function post(payload: unknown): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN) throw new Error('Falta WHATSAPP_ACCESS_TOKEN');

  const response = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`WhatsApp devolvió ${response.status}: ${await response.text()}`);
  }
}

/** Normaliza a E.164 sin el `+`, que es lo que espera la API de Meta. */
export function normalizePhone(phone: string, defaultCountryCode = '34'): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.slice(1);
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.length === 9) return `${defaultCountryCode}${digits}`;
  return digits;
}

export async function sendWhatsapp(message: WhatsappTextMessage): Promise<void> {
  if (!env.WHATSAPP_ENABLED) {
    logger.debug({ to: message.to }, 'WhatsApp desactivado; no se envía');
    return;
  }
  await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(message.to),
    type: 'text',
    text: { preview_url: true, body: message.text },
  });
}

export async function sendWhatsappTemplate(message: WhatsappTemplateMessage): Promise<void> {
  if (!env.WHATSAPP_ENABLED) return;
  await post({
    messaging_product: 'whatsapp',
    to: normalizePhone(message.to),
    type: 'template',
    template: {
      name: message.template,
      language: { code: message.languageCode },
      components: [
        {
          type: 'body',
          parameters: message.parameters.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  });
}
