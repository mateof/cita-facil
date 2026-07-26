import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

/**
 * Telegram vía Bot API. El usuario vincula su cuenta enviando al bot un código
 * de un solo uso que obtiene en el perfil; a partir de ahí se guarda su
 * `chat_id` y se le puede escribir. No hace falta que el usuario comparta su
 * número de teléfono.
 */

const API_BASE = 'https://api.telegram.org';

function botUrl(method: string): string {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN');
  return `${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

async function call<T>(method: string, payload: unknown): Promise<T> {
  const response = await fetch(botUrl(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram: ${data.description ?? response.status}`);
  }
  return data.result as T;
}

export interface TelegramMessage {
  chatId: string;
  text: string;
  /** Botones que abren una URL, por ejemplo para cancelar la cita. */
  buttons?: { text: string; url: string }[];
}

export async function sendTelegram(message: TelegramMessage): Promise<void> {
  if (!env.TELEGRAM_ENABLED) {
    logger.debug({ chatId: message.chatId }, 'Telegram desactivado; no se envía');
    return;
  }

  await call('sendMessage', {
    chat_id: message.chatId,
    text: message.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: message.buttons?.length
      ? { inline_keyboard: [message.buttons.map((b) => ({ text: b.text, url: b.url }))] }
      : undefined,
  });
}

/** Configura el webhook del bot para recibir los mensajes de vinculación. */
export async function setTelegramWebhook(publicUrl: string): Promise<void> {
  if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_BOT_TOKEN) return;
  await call('setWebhook', {
    url: `${publicUrl.replace(/\/$/, '')}/api/v1/integrations/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message'],
  });
  logger.info('Webhook de Telegram configurado');
}

export async function deleteTelegramWebhook(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await call('deleteWebhook', {});
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}
