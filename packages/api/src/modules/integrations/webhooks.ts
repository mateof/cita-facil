import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { newId, randomToken } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';

/**
 * Webhooks salientes.
 *
 * Cada entrega se firma con HMAC-SHA256 sobre `<timestamp>.<cuerpo>` y viaja en
 * la cabecera `X-CitaFacil-Signature`. Incluir la marca de tiempo dentro de lo
 * firmado es lo que impide reenviar una petición interceptada más tarde: el
 * receptor rechaza las firmas con más de unos minutos.
 */

/** Espera creciente entre reintentos, en minutos. */
const RETRY_DELAYS = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = 5;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Verificación que puede reutilizar quien reciba nuestros webhooks. */
export function verifyPayload(params: {
  secret: string;
  header: string;
  body: string;
  toleranceSeconds?: number;
}): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]+)$/.exec(params.header);
  if (!match) return false;

  const timestamp = Number(match[1]);
  const provided = Buffer.from(match[2]!, 'hex');
  const tolerance = params.toleranceSeconds ?? 300;

  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return false;

  const expected = Buffer.from(signPayload(params.secret, timestamp, params.body), 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Encola una entrega para cada endpoint suscrito al evento. */
export async function dispatchWebhook(
  organizationId: string,
  event: string,
  payload: unknown,
): Promise<number> {
  if (!env.WEBHOOKS_ENABLED) return 0;

  const endpoints = await db()
    .selectFrom('webhook_endpoints')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('active', '=', 1)
    .execute();

  let queued = 0;
  for (const endpoint of endpoints) {
    const events = JSON.parse(endpoint.events_json) as string[];
    const subscribed = events.includes('*') || events.includes(event);
    if (!subscribed) continue;

    await db()
      .insertInto('webhook_deliveries')
      .values({
        id: newId(),
        endpoint_id: endpoint.id,
        event,
        payload_json: JSON.stringify({ event, sentAt: isoNow(), data: payload }),
        status: 'pending',
        response_code: null,
        attempts: 0,
        last_error: null,
        next_attempt_at: isoNow(),
        delivered_at: null,
        created_at: isoNow(),
      })
      .execute();
    queued += 1;
  }
  return queued;
}

/** Procesa la cola de entregas. Lo llama el planificador. */
export async function deliverPendingWebhooks(limit = 25): Promise<number> {
  if (!env.WEBHOOKS_ENABLED) return 0;

  const pending = await db()
    .selectFrom('webhook_deliveries')
    .innerJoin('webhook_endpoints', 'webhook_endpoints.id', 'webhook_deliveries.endpoint_id')
    .select([
      'webhook_deliveries.id',
      'webhook_deliveries.event',
      'webhook_deliveries.payload_json',
      'webhook_deliveries.attempts',
      'webhook_endpoints.id as endpoint_id',
      'webhook_endpoints.url',
      'webhook_endpoints.secret',
    ])
    .where('webhook_deliveries.status', '=', 'pending')
    .where('webhook_deliveries.next_attempt_at', '<=', isoNow())
    .where('webhook_endpoints.active', '=', 1)
    .orderBy('webhook_deliveries.next_attempt_at')
    .limit(limit)
    .execute();

  let delivered = 0;
  for (const item of pending) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=${signPayload(item.secret, timestamp, item.payload_json)}`;
    const attempts = item.attempts + 1;

    try {
      const response = await fetch(item.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-citafacil-signature': signature,
          'x-citafacil-event': item.event,
          'user-agent': `${env.APP_NAME}-webhooks/1.0`,
        },
        body: item.payload_json,
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        await db()
          .updateTable('webhook_deliveries')
          .set({
            status: 'delivered',
            response_code: response.status,
            attempts,
            delivered_at: isoNow(),
          })
          .where('id', '=', item.id)
          .execute();
        await db()
          .updateTable('webhook_endpoints')
          .set({ failure_count: 0 })
          .where('id', '=', item.endpoint_id)
          .execute();
        delivered += 1;
        continue;
      }

      await failDelivery(item.id, item.endpoint_id, attempts, `HTTP ${response.status}`, response.status);
    } catch (error) {
      await failDelivery(
        item.id,
        item.endpoint_id,
        attempts,
        error instanceof Error ? error.message : String(error),
        null,
      );
    }
  }
  return delivered;
}

async function failDelivery(
  deliveryId: string,
  endpointId: string,
  attempts: number,
  message: string,
  responseCode: number | null,
): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const delay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]!;

  await db()
    .updateTable('webhook_deliveries')
    .set({
      status: exhausted ? 'failed' : 'pending',
      attempts,
      response_code: responseCode,
      last_error: message.slice(0, 1000),
      next_attempt_at: exhausted ? null : new Date(Date.now() + delay * 60_000).toISOString(),
    })
    .where('id', '=', deliveryId)
    .execute();

  await db()
    .updateTable('webhook_endpoints')
    .set((eb) => ({ failure_count: eb('failure_count', '+', 1) }))
    .where('id', '=', endpointId)
    .execute();

  // Un endpoint que falla de forma sostenida se desactiva para no seguir
  // reintentando indefinidamente contra un servidor que ya no existe.
  const endpoint = await db()
    .selectFrom('webhook_endpoints')
    .select(['failure_count'])
    .where('id', '=', endpointId)
    .executeTakeFirst();

  if (endpoint && endpoint.failure_count >= 50) {
    await db()
      .updateTable('webhook_endpoints')
      .set({ active: 0 })
      .where('id', '=', endpointId)
      .execute();
    logger.warn({ endpointId }, 'Endpoint de webhook desactivado por fallos repetidos');
  }
}

export async function createWebhookEndpoint(params: {
  organizationId: string;
  url: string;
  events: string[];
}): Promise<{ id: string; secret: string }> {
  const id = newId();
  const secret = randomToken(32);
  await db()
    .insertInto('webhook_endpoints')
    .values({
      id,
      organization_id: params.organizationId,
      url: params.url,
      secret,
      events_json: JSON.stringify(params.events),
      active: 1,
      failure_count: 0,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .execute();
  return { id, secret };
}

/** Eventos que se pueden suscribir. */
export const WEBHOOK_EVENTS = [
  'appointment.created',
  'appointment.confirmed',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.checked_in',
  'appointment.completed',
  'appointment.no_show',
  'access.granted',
  'access.denied',
  'payment.succeeded',
  'payment.refunded',
  'waitlist.matched',
] as const;
