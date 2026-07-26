import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';

/**
 * Registro de auditoría. Guarda quién hizo qué sobre qué entidad. Es lo que
 * permite responder a "¿quién canceló esta cita?" seis meses después, que en un
 * sistema con varios responsables es la primera pregunta cuando algo falla.
 *
 * Escribir en la traza nunca debe tumbar la operación que se estaba haciendo,
 * así que los errores se registran y se ignoran.
 */

export interface AuditEntry {
  organizationId?: string | null;
  actorId?: string | null;
  actorType?: 'user' | 'staff' | 'customer' | 'system' | 'apikey';
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db()
      .insertInto('audit_logs')
      .values({
        id: newId(),
        organization_id: entry.organizationId ?? null,
        actor_id: entry.actorId ?? null,
        actor_type: entry.actorType ?? 'user',
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        changes_json: entry.changes === undefined ? null : JSON.stringify(entry.changes),
        ip: entry.ip ?? null,
        user_agent: entry.userAgent?.slice(0, 400) ?? null,
        created_at: isoNow(),
      })
      .execute();
  } catch (error) {
    logger.warn({ err: error, action: entry.action }, 'No se pudo escribir la traza de auditoría');
  }
}

export interface AuditQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function listAudit(query: AuditQuery) {
  let base = db().selectFrom('audit_logs').where('organization_id', '=', query.organizationId);
  if (query.entityType) base = base.where('entity_type', '=', query.entityType);
  if (query.entityId) base = base.where('entity_id', '=', query.entityId);
  if (query.actorId) base = base.where('actor_id', '=', query.actorId);
  if (query.action) base = base.where('action', '=', query.action);
  if (query.from) base = base.where('created_at', '>=', query.from);
  if (query.to) base = base.where('created_at', '<=', query.to);

  const totalRow = await base
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .executeTakeFirst();

  const rows = await base
    .leftJoin('users', 'users.id', 'audit_logs.actor_id')
    .select([
      'audit_logs.id',
      'audit_logs.actor_id',
      'audit_logs.actor_type',
      'audit_logs.action',
      'audit_logs.entity_type',
      'audit_logs.entity_id',
      'audit_logs.changes_json',
      'audit_logs.ip',
      'audit_logs.created_at',
      'users.name as actor_name',
    ])
    .orderBy('audit_logs.created_at', 'desc')
    .orderBy('audit_logs.id', 'desc')
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .execute();

  const total = Number(totalRow?.total ?? 0);
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorType: row.actor_type,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      changes: row.changes_json ? JSON.parse(row.changes_json) : null,
      ip: row.ip,
      createdAt: row.created_at,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** Poda la traza para que no crezca sin control. */
export async function purgeAudit(days = 365): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = await db()
    .deleteFrom('audit_logs')
    .where('created_at', '<', cutoff)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
