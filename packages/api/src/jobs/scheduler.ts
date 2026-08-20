import { Cron } from 'croner';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { dispatchDue, notify, purgeOldNotifications } from '../modules/notifications/service.js';
import {
  autoMarkNoShows,
  expireHolds,
  requestPendingReviews,
} from '../modules/appointments/service.js';
import { expireWaitlistOffers } from '../modules/appointments/waitlist.js';
import { runAllSchedules } from '../modules/appointments/schedules.js';
import { deliverPendingWebhooks } from '../modules/integrations/webhooks.js';
import { syncAllCalendars } from '../modules/integrations/calendar.js';
import { purgeExpiredSessions } from '../modules/auth/tokens.js';
import { purgeAudit } from '../modules/audit/service.js';
import { createBackup } from '../modules/backups/service.js';
import { db } from '../db/index.js';

/**
 * Planificador de tareas.
 *
 * Se usa `croner` en proceso en lugar de un sistema de colas externo porque el
 * objetivo del proyecto es que una instalación funcione con un solo contenedor
 * y sin Redis. Cada tarea se protege contra solapes (`protect: true`), de forma
 * que si un despacho tarda más de un minuto no se lanza otro encima.
 *
 * Con varias instancias del API contra la misma base de datos habría que
 * desactivar el planificador en todas menos una (`SCHEDULER_ENABLED=false`).
 * Ver docs/despliegue.md.
 */

const jobs: Cron[] = [];

function schedule(name: string, pattern: string, task: () => Promise<unknown>): void {
  const job = new Cron(pattern, { name, protect: true, catch: true }, async () => {
    const started = Date.now();
    try {
      const result = await task();
      const elapsed = Date.now() - started;
      if (typeof result === 'number' && result > 0) {
        logger.info({ job: name, processed: result, ms: elapsed }, 'Tarea completada');
      } else {
        logger.trace({ job: name, ms: elapsed }, 'Tarea completada');
      }
    } catch (error) {
      logger.error({ err: error, job: name }, 'Tarea fallida');
    }
  });
  jobs.push(job);
}

export function startScheduler(): void {
  if (jobs.length > 0) return;

  /* Cola de avisos: es lo que hace que los recordatorios salgan a su hora. */
  schedule('notificaciones', env.NOTIFICATION_DISPATCH_CRON, () => dispatchDue());

  /* Bloqueos temporales de hueco caducados. */
  schedule('holds', '* * * * *', () => expireHolds());

  /*
   * Ocupación de los calendarios personales. Cada cuarto de hora es suficiente:
   * lo que se importa son compromisos de agenda, no minutos sueltos, y pedir
   * más a menudo carga los servidores de terceros sin ganar nada.
   */
  schedule('calendarios', '*/15 * * * *', () => syncAllCalendars());

  /* Entregas de webhooks pendientes y reintentos. */
  if (env.WEBHOOKS_ENABLED) {
    schedule('webhooks', '* * * * *', () => deliverPendingWebhooks());
  }

  /* Ofertas de lista de espera no atendidas. */
  schedule('lista-espera', '*/5 * * * *', () => expireWaitlistOffers());

  /* Citas de las programaciones semanales, dentro de su horizonte. */
  schedule('programaciones', '7 3 * * *', () => runAllSchedules());

  /* Faltas sin avisar. */
  schedule('no-show', '*/10 * * * *', () => autoMarkNoShows());

  /* Petición de valoración tras la visita. */
  schedule('valoraciones', '17 * * * *', () => requestPendingReviews());

  /* Limpieza diaria de sesiones, retos y tokens caducados. */
  schedule('limpieza-sesiones', '13 4 * * *', () => purgeExpiredSessions());

  /* Poda del historial. */
  schedule('poda-historial', '31 4 * * 0', async () => {
    const notifications = await purgeOldNotifications(180);
    const audit = await purgeAudit(365);
    return notifications + audit;
  });

  /* Copias de seguridad automáticas. */
  if (env.BACKUP_ENABLED) {
    schedule('backup', env.BACKUP_CRON, async () => {
      try {
        const record = await createBackup({ trigger: 'scheduled' });
        return record.sizeBytes;
      } catch (error) {
        await notifyBackupFailure(error);
        throw error;
      }
    });
  }

  logger.info({ jobs: jobs.map((job) => job.name) }, 'Planificador iniciado');
}

export function stopScheduler(): void {
  for (const job of jobs) job.stop();
  jobs.length = 0;
}

/** Avisa a los administradores de la plataforma si falla una copia programada. */
async function notifyBackupFailure(error: unknown): Promise<void> {
  const admins = await db()
    .selectFrom('users')
    .select(['id', 'locale'])
    .where('platform_role', '=', 'superadmin')
    .where('status', '=', 'active')
    .execute();

  for (const admin of admins) {
    await notify({
      event: 'backup.failed',
      userId: admin.id,
      locale: admin.locale as never,
      vars: {
        fechaHora: new Date().toLocaleString('es-ES'),
        motivo: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
  }
}

/** Estado de las tareas, para mostrarlo en el panel de administración. */
export function schedulerStatus(): {
  name: string;
  pattern: string | null;
  nextRun: string | null;
  isRunning: boolean;
}[] {
  return jobs.map((job) => ({
    name: job.name ?? 'sin-nombre',
    pattern: job.getPattern() ?? null,
    nextRun: job.nextRun()?.toISOString() ?? null,
    isRunning: job.isBusy(),
  }));
}
