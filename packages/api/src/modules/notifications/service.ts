import type {
  Locale,
  NotificationChannel,
  NotificationEvent,
} from '@cita-facil/shared';
import { DEFAULT_LOCALE } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { builtinTemplate } from './templates.js';
import { sendEmail, type EmailAttachment } from './channels/email.js';
import { sendPush } from './channels/push.js';
import { sendTelegram } from './channels/telegram.js';
import { sendWhatsapp } from './channels/whatsapp.js';
import { sendSms } from './channels/sms.js';

/**
 * Cola de notificaciones.
 *
 * Todo aviso se guarda como fila antes de intentar entregarse. Eso da tres
 * cosas: los recordatorios programados y los envíos inmediatos comparten
 * mecanismo, un fallo de red no pierde el mensaje (se reintenta con espera
 * creciente), y el panel puede mostrar el historial real de lo enviado a cada
 * cliente. El planificador llama a `dispatchDue` cada minuto.
 */

/* -------------------------------------------------------------------------- */
/* Renderizado                                                                 */
/* -------------------------------------------------------------------------- */

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Sustituye `{{variable}}`. Lo que no exista se sustituye por cadena vacía. */
export function render(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
      const value = vars[key];
      return value === null || value === undefined ? '' : String(value);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
}

/**
 * Busca la plantilla más específica: primero la de la organización, luego la
 * integrada. En ambos casos, si falta el idioma pedido se cae al español.
 */
export async function resolveTemplate(
  event: NotificationEvent,
  channel: NotificationChannel,
  locale: Locale,
  organizationId: string | null,
  vars: TemplateVars,
): Promise<RenderedTemplate> {
  if (organizationId) {
    const custom = await db()
      .selectFrom('notification_templates')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('event', '=', event)
      .where('channel', '=', channel)
      .where('locale', 'in', [locale, DEFAULT_LOCALE])
      .where('enabled', '=', 1)
      .execute();

    const preferred = custom.find((row) => row.locale === locale) ?? custom[0];
    if (preferred) {
      return {
        subject: preferred.subject ? render(preferred.subject, vars) : null,
        body: render(preferred.body, vars),
      };
    }
  }

  const builtin = builtinTemplate(event, channel, locale);
  return {
    subject: builtin.subject ? render(builtin.subject, vars) : null,
    body: render(builtin.body, vars),
  };
}

/* -------------------------------------------------------------------------- */
/* Preferencias                                                                */
/* -------------------------------------------------------------------------- */

/** Canales activos por defecto para cada evento cuando nadie ha configurado nada. */
const DEFAULT_CHANNELS: Partial<Record<NotificationEvent, NotificationChannel[]>> = {
  'appointment.created': ['email'],
  'appointment.confirmed': ['email', 'push'],
  'appointment.rescheduled': ['email', 'push'],
  'appointment.cancelled': ['email', 'push'],
  'appointment.reminder': ['email', 'push'],
  'appointment.receipt': ['email'],
  'appointment.followup': ['email'],
  'appointment.no_show': ['email'],
  'appointment.approval_required': ['email'],
  'waitlist.slot_available': ['email', 'push'],
  'payment.succeeded': ['email'],
  'payment.failed': ['email'],
  'payment.refunded': ['email'],
  'auth.verify_email': ['email'],
  'auth.reset_password': ['email'],
  'auth.activate_account': ['email'],
  'auth.mfa_code': ['email'],
  'auth.new_device': ['email'],
  'account.welcome': ['email'],
  'backup.failed': ['email'],
};

/** Eventos que se envían siempre, aunque el usuario haya desactivado avisos. */
const TRANSACTIONAL_EVENTS: readonly NotificationEvent[] = [
  'auth.verify_email',
  'auth.reset_password',
  'auth.activate_account',
  'auth.mfa_code',
  'auth.new_device',
];

/**
 * Resuelve los canales en cascada: valores por defecto, preferencia de la
 * organización y preferencia del usuario. Gana el nivel más específico.
 */
export async function resolveChannels(params: {
  event: NotificationEvent;
  userId?: string | null;
  organizationId?: string | null;
  /** Fuerza estos canales sin consultar preferencias (recordatorios a medida). */
  channels?: NotificationChannel[];
}): Promise<NotificationChannel[]> {
  if (params.channels?.length) return params.channels;

  // Los avisos de seguridad no son opcionales: un código de verificación o el
  // aviso de acceso desde un dispositivo nuevo se envían aunque el usuario haya
  // desactivado todo lo demás.
  if (TRANSACTIONAL_EVENTS.includes(params.event)) {
    return DEFAULT_CHANNELS[params.event] ?? ['email'];
  }

  const enabled = new Map<NotificationChannel, boolean>();
  for (const channel of DEFAULT_CHANNELS[params.event] ?? ['email']) {
    enabled.set(channel, true);
  }

  const rows = await db()
    .selectFrom('notification_preferences')
    .selectAll()
    .where('event', '=', params.event)
    .where((eb) =>
      eb.or([
        params.organizationId
          ? eb('organization_id', '=', params.organizationId)
          : eb('organization_id', 'is', null),
        params.userId ? eb('user_id', '=', params.userId) : eb('user_id', 'is', null),
      ]),
    )
    .execute();

  // Primero las de la organización, después las del usuario, que mandan.
  for (const row of rows.filter((r) => r.organization_id && !r.user_id)) {
    enabled.set(row.channel as NotificationChannel, row.enabled === 1);
  }
  for (const row of rows.filter((r) => r.user_id === params.userId && params.userId)) {
    enabled.set(row.channel as NotificationChannel, row.enabled === 1);
  }

  return [...enabled.entries()].filter(([, on]) => on).map(([channel]) => channel);
}

/* -------------------------------------------------------------------------- */
/* Encolado                                                                    */
/* -------------------------------------------------------------------------- */

export interface NotifyInput {
  event: NotificationEvent;
  /** Destinatario registrado. Si falta, hay que indicar `to`. */
  userId?: string | null;
  organizationId?: string | null;
  appointmentId?: string | null;
  locale?: Locale;
  vars: TemplateVars;
  /** Canales concretos; si se omite se resuelven por preferencias. */
  channels?: NotificationChannel[];
  /** Destino explícito para invitados sin cuenta. */
  to?: { email?: string | null; phone?: string | null };
  /** Momento de envío. Por defecto, ya. */
  scheduledAt?: string;
  /** Agrupa avisos relacionados para poder cancelarlos juntos. */
  groupKey?: string;
  attachments?: EmailAttachment[];
}

export interface QueuedNotification {
  id: string;
  channel: NotificationChannel;
  destination: string;
}

/** Prepara y encola un aviso por todos los canales que correspondan. */
export async function notify(input: NotifyInput): Promise<QueuedNotification[]> {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const channels = await resolveChannels({
    event: input.event,
    userId: input.userId,
    organizationId: input.organizationId,
    channels: input.channels,
  });

  if (channels.length === 0) return [];

  const queued: QueuedNotification[] = [];
  const now = isoNow();

  for (const channel of channels) {
    const destination = await resolveDestination(channel, input);
    if (!destination) continue;

    const template = await resolveTemplate(
      input.event,
      channel,
      locale,
      input.organizationId ?? null,
      input.vars,
    );

    const id = newId();
    await db()
      .insertInto('notifications')
      .values({
        id,
        organization_id: input.organizationId ?? null,
        user_id: input.userId ?? null,
        appointment_id: input.appointmentId ?? null,
        event: input.event,
        channel,
        locale,
        destination,
        subject: template.subject,
        body: template.body,
        payload_json: input.attachments
          ? JSON.stringify({ attachments: input.attachments.map((a) => a.filename) })
          : null,
        status: 'scheduled',
        attempts: 0,
        last_error: null,
        scheduled_at: input.scheduledAt ?? now,
        sent_at: null,
        group_key: input.groupKey ?? null,
        created_at: now,
      })
      .execute();

    queued.push({ id, channel, destination });
  }

  return queued;
}

/**
 * Encola y despacha en el acto. Se usa en los avisos donde esperar al siguiente
 * tic del planificador sería inaceptable, como el código de segundo factor.
 */
export async function notifyNow(input: NotifyInput): Promise<void> {
  const queued = await notify(input);
  for (const item of queued) {
    await deliverById(item.id, input.attachments).catch((error) => {
      logger.error({ err: error, id: item.id }, 'Fallo entregando notificación inmediata');
    });
  }
}

async function resolveDestination(
  channel: NotificationChannel,
  input: NotifyInput,
): Promise<string | null> {
  switch (channel) {
    case 'email': {
      if (input.to?.email) return input.to.email;
      if (!input.userId) return null;
      const user = await db()
        .selectFrom('users')
        .select(['email'])
        .where('id', '=', input.userId)
        .executeTakeFirst();
      return user?.email ?? null;
    }
    case 'push':
    case 'inapp':
      return input.userId ?? null;
    case 'telegram': {
      if (!input.userId) return null;
      const link = await db()
        .selectFrom('messaging_links')
        .select(['external_id'])
        .where('user_id', '=', input.userId)
        .where('channel', '=', 'telegram')
        .where('verified', '=', 1)
        .where('opt_out', '=', 0)
        .executeTakeFirst();
      return link?.external_id ?? null;
    }
    case 'whatsapp':
    case 'sms': {
      if (input.to?.phone) return input.to.phone;
      if (!input.userId) return null;
      const user = await db()
        .selectFrom('users')
        .select(['phone'])
        .where('id', '=', input.userId)
        .executeTakeFirst();
      return user?.phone ?? null;
    }
    case 'webhook':
      return input.organizationId ?? null;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Entrega                                                                     */
/* -------------------------------------------------------------------------- */

/** Espera creciente entre reintentos: 1, 5, 15, 60 y 240 minutos. */
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 240];

export async function dispatchDue(limit = env.NOTIFICATION_BATCH_SIZE): Promise<number> {
  const now = isoNow();
  const pending = await db()
    .selectFrom('notifications')
    .select(['id'])
    .where('status', 'in', ['scheduled', 'queued'])
    .where('scheduled_at', '<=', now)
    .orderBy('scheduled_at')
    .limit(limit)
    .execute();

  let delivered = 0;
  for (const row of pending) {
    const ok = await deliverById(row.id).catch(() => false);
    if (ok) delivered += 1;
  }
  return delivered;
}

export async function deliverById(
  id: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
  const notification = await db()
    .selectFrom('notifications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!notification || notification.status === 'sent' || notification.status === 'cancelled') {
    return false;
  }

  // Marca en curso para que dos procesos no entreguen lo mismo dos veces.
  const claimed = await db()
    .updateTable('notifications')
    .set({ status: 'sending' })
    .where('id', '=', id)
    .where('status', 'in', ['scheduled', 'queued'])
    .executeTakeFirst();
  if (Number(claimed.numUpdatedRows ?? 0) === 0) return false;

  try {
    await deliver(notification, attachments);
    await db()
      .updateTable('notifications')
      .set({ status: 'sent', sent_at: isoNow(), attempts: notification.attempts + 1 })
      .where('id', '=', id)
      .execute();
    return true;
  } catch (error) {
    const attempts = notification.attempts + 1;
    const exhausted = attempts >= env.NOTIFICATION_MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)]!;

    await db()
      .updateTable('notifications')
      .set({
        status: exhausted ? 'failed' : 'scheduled',
        attempts,
        last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        scheduled_at: exhausted
          ? notification.scheduled_at
          : new Date(Date.now() + delay * 60_000).toISOString(),
      })
      .where('id', '=', id)
      .execute();

    logger.warn(
      { err: error, id, channel: notification.channel, attempts, exhausted },
      'Fallo entregando notificación',
    );
    return false;
  }
}

interface NotificationRow {
  channel: string;
  destination: string;
  subject: string | null;
  body: string;
  user_id: string | null;
  organization_id: string | null;
  appointment_id: string | null;
  event: string;
}

async function deliver(
  notification: NotificationRow,
  attachments?: EmailAttachment[],
): Promise<void> {
  switch (notification.channel as NotificationChannel) {
    case 'email':
      await sendEmail({
        to: notification.destination,
        subject: notification.subject ?? env.APP_NAME,
        text: notification.body,
        attachments,
      });
      return;

    case 'push': {
      const sent = await sendPush(notification.destination, {
        title: notification.subject ?? env.APP_NAME,
        body: notification.body,
        data: {
          event: notification.event,
          ...(notification.appointment_id ? { appointmentId: notification.appointment_id } : {}),
        },
        url: notification.appointment_id
          ? `${env.APP_URL}/citas/${notification.appointment_id}`
          : env.APP_URL,
      });
      // Sin dispositivos registrados no es un error: simplemente no hay a quién avisar.
      if (sent === 0) logger.debug({ userId: notification.destination }, 'Sin dispositivos push');
      return;
    }

    case 'telegram':
      await sendTelegram({ chatId: notification.destination, text: notification.body });
      return;

    case 'whatsapp':
      await sendWhatsapp({ to: notification.destination, text: notification.body });
      return;

    case 'sms':
      await sendSms(notification.destination, notification.body);
      return;

    case 'inapp':
      // El aviso en la aplicación es la propia fila: el frontend la consulta.
      return;

    case 'webhook':
      // Los webhooks salientes tienen su propia cola con firma y reintentos.
      return;

    default:
      throw new Error(`Canal no soportado: ${notification.channel}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

/** Cancela los avisos pendientes de un grupo (por ejemplo, al anular una cita). */
export async function cancelGroup(groupKey: string): Promise<number> {
  const result = await db()
    .updateTable('notifications')
    .set({ status: 'cancelled' })
    .where('group_key', '=', groupKey)
    .where('status', 'in', ['scheduled', 'queued'])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

export async function cancelForAppointment(appointmentId: string): Promise<number> {
  const result = await db()
    .updateTable('notifications')
    .set({ status: 'cancelled' })
    .where('appointment_id', '=', appointmentId)
    .where('status', 'in', ['scheduled', 'queued'])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

/** Borra el historial antiguo para que la tabla no crezca sin límite. */
export async function purgeOldNotifications(days = 180): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = await db()
    .deleteFrom('notifications')
    .where('created_at', '<', cutoff)
    .where('status', 'in', ['sent', 'failed', 'cancelled', 'skipped'])
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
