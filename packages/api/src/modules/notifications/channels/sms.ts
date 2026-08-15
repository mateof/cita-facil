import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

/**
 * SMS por Twilio. Es un canal opcional y de pago; se deja como extensión con
 * un único proveedor porque el resto de canales cubren el caso de uso normal.
 */
export async function sendSms(to: string, text: string): Promise<void> {
  if (!env.SMS_ENABLED || env.SMS_PROVIDER === 'none') {
    logger.debug({ to }, 'SMS desactivado; no se envía');
    return;
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    throw new Error('Faltan credenciales de Twilio');
  }

  const credentials = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
    'base64',
  );

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Twilio devolvió ${response.status}: ${await response.text()}`);
  }
}
