import { readFile } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import webpush from 'web-push';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { isoNow } from '../../../lib/dates.js';

/**
 * Notificaciones push por dos vías:
 *
 * - **Firebase Cloud Messaging** (API HTTP v1) para las aplicaciones móviles.
 *   Se habla directamente con la API REST firmando un JWT con la cuenta de
 *   servicio, en lugar de arrastrar el SDK de firebase-admin, que pesa decenas
 *   de megabytes para lo único que se necesita aquí: pedir un token OAuth2 y
 *   hacer un POST.
 * - **Web Push** (VAPID) para el navegador, que es lo que usa la PWA.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let serviceAccount: ServiceAccount | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  if (serviceAccount) return serviceAccount;

  let raw: string | null = null;
  if (env.FCM_SERVICE_ACCOUNT_JSON) {
    raw = env.FCM_SERVICE_ACCOUNT_JSON.trim().startsWith('{')
      ? env.FCM_SERVICE_ACCOUNT_JSON
      : Buffer.from(env.FCM_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
  } else if (env.FCM_SERVICE_ACCOUNT_FILE) {
    raw = await readFile(env.FCM_SERVICE_ACCOUNT_FILE, 'utf8').catch(() => null);
  }
  if (!raw) return null;

  try {
    serviceAccount = JSON.parse(raw) as ServiceAccount;
    return serviceAccount;
  } catch (error) {
    logger.error({ err: error }, 'La cuenta de servicio de Firebase no es un JSON válido');
    return null;
  }
}

/** Token OAuth2 de Google con la aserción JWT de la cuenta de servicio. */
async function fcmAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const account = await loadServiceAccount();
  if (!account) return null;

  const key = createPrivateKey(account.private_key);
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    logger.error({ status: response.status, body: await response.text() }, 'Error pidiendo token a Google');
    return null;
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Datos que recibe la aplicación al pulsar la notificación. */
  data?: Record<string, string>;
  url?: string;
}

/** Envía a todos los dispositivos registrados del usuario. */
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
  if (!env.PUSH_ENABLED) {
    logger.debug({ userId }, 'Push desactivado; no se envía');
    return 0;
  }

  const devices = await db()
    .selectFrom('push_devices')
    .selectAll()
    .where('user_id', '=', userId)
    .where('failure_count', '<', 5)
    .execute();

  if (devices.length === 0) return 0;

  let delivered = 0;
  for (const device of devices) {
    try {
      if (device.provider === 'fcm') {
        await sendFcm(device.token, message);
      } else {
        await sendWebPush(device.token, device.keys_json, message);
      }
      delivered += 1;
      await db()
        .updateTable('push_devices')
        .set({ last_used_at: isoNow(), failure_count: 0 })
        .where('id', '=', device.id)
        .execute();
    } catch (error) {
      const gone = error instanceof PushGoneError;
      logger.warn({ err: error, deviceId: device.id, gone }, 'Fallo enviando push');
      if (gone) {
        // El dispositivo ya no existe: se borra en vez de acumular fallos.
        await db().deleteFrom('push_devices').where('id', '=', device.id).execute();
      } else {
        await db()
          .updateTable('push_devices')
          .set({ failure_count: device.failure_count + 1 })
          .where('id', '=', device.id)
          .execute();
      }
    }
  }
  return delivered;
}

class PushGoneError extends Error {}

async function sendFcm(token: string, message: PushMessage): Promise<void> {
  const account = await loadServiceAccount();
  const accessToken = await fcmAccessToken();
  const projectId = env.FCM_PROJECT_ID ?? account?.project_id;
  if (!accessToken || !projectId) throw new Error('Firebase no está configurado');

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: { ...message.data, ...(message.url ? { url: message.url } : {}) },
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } },
        },
      }),
    },
  );

  if (response.status === 404 || response.status === 403) {
    throw new PushGoneError(`FCM rechazó el token (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`FCM devolvió ${response.status}: ${await response.text()}`);
  }
}

async function sendWebPush(
  endpoint: string,
  keysJson: string | null,
  message: PushMessage,
): Promise<void> {
  if (!env.WEBPUSH_PUBLIC_KEY || !env.WEBPUSH_PRIVATE_KEY) {
    throw new Error('Faltan las claves VAPID para Web Push');
  }
  webpush.setVapidDetails(env.WEBPUSH_SUBJECT, env.WEBPUSH_PUBLIC_KEY, env.WEBPUSH_PRIVATE_KEY);

  const keys = keysJson ? (JSON.parse(keysJson) as { p256dh: string; auth: string }) : null;
  if (!keys) throw new Error('La suscripción Web Push no tiene claves');

  try {
    await webpush.sendNotification(
      { endpoint, keys },
      JSON.stringify({
        title: message.title,
        body: message.body,
        url: message.url,
        data: message.data,
      }),
    );
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      throw new PushGoneError('La suscripción Web Push ya no es válida');
    }
    throw error;
  }
}

/** Clave pública VAPID que necesita el navegador para suscribirse. */
export function webPushPublicKey(): string | null {
  return env.WEBPUSH_PUBLIC_KEY ?? null;
}

/** Genera un par de claves VAPID. Se expone en el panel para facilitar el alta. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
