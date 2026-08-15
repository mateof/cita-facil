import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PERMISSIONS } from '@cita-facil/shared';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { newId, randomToken, shortCode } from '../lib/ids.js';
import { hashToken } from '../lib/crypto.js';
import { isoNow } from '../lib/dates.js';
import { BadRequestError, ForbiddenError } from '../lib/errors.js';
import { WEBHOOK_EVENTS, createWebhookEndpoint } from '../modules/integrations/webhooks.js';
import { handleAlexaRequest, verifyAlexaRequest } from '../modules/integrations/alexa.js';
import { handleGoogleWebhook } from '../modules/integrations/google.js';
import { setTelegramWebhook } from '../modules/notifications/channels/telegram.js';
import { consumeChallenge, peekChallenge } from '../modules/auth/challenges.js';
import { recordAudit } from '../modules/audit/service.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Integraciones de la organización: claves de API para máquinas, webhooks
 * salientes y los puntos de entrada de Alexa, Google y Telegram.
 */
const integrationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* --------------------------------------------------------- Claves API */

  app.get(
    '/api-keys',
    { schema: { tags: ['integraciones'], summary: 'Claves de API', params: organizationParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'apikey:read');
      const rows = await db()
        .selectFrom('api_keys')
        .select([
          'id',
          'name',
          'prefix',
          'scopes_json',
          'ip_allowlist_json',
          'last_used_at',
          'expires_at',
          'revoked_at',
          'created_at',
        ])
        .where('organization_id', '=', orgId(request))
        .orderBy('created_at', 'desc')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        // Solo se muestra el prefijo: el secreto no se puede recuperar.
        prefix: `cf_${row.prefix}_…`,
        scopes: JSON.parse(row.scopes_json) as string[],
        ipAllowlist: row.ip_allowlist_json ? (JSON.parse(row.ip_allowlist_json) as string[]) : [],
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      }));
    },
  );

  app.post(
    '/api-keys',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Crear una clave de API',
        description:
          'La clave completa se muestra una única vez en la respuesta. Después solo se guarda su hash.',
        params: organizationParams,
        body: z.object({
          name: z.string().min(2).max(120),
          scopes: z.array(z.enum(PERMISSIONS)).min(1).max(40),
          ipAllowlist: z.array(z.string().max(45)).max(20).optional(),
          expiresInDays: z.number().int().min(1).max(3650).optional(),
        }),
      },
    },
    async (request, reply) => {
      const access = request.requirePermission(orgId(request), 'apikey:write');

      // Una clave no puede tener más permisos que quien la crea.
      const excessive = request.body.scopes.filter((scope) => !access.permissions.has(scope));
      if (excessive.length > 0) {
        throw new ForbiddenError(
          `No puedes conceder permisos que no tienes: ${excessive.join(', ')}`,
          'scope_escalation',
        );
      }

      const prefix = shortCode(8).toLowerCase();
      const secret = randomToken(32);
      const fullKey = `cf_${prefix}_${secret}`;
      const id = newId();

      await db()
        .insertInto('api_keys')
        .values({
          id,
          organization_id: orgId(request),
          name: request.body.name,
          prefix,
          key_hash: hashToken(fullKey, 'apikey'),
          scopes_json: JSON.stringify(request.body.scopes),
          ip_allowlist_json: request.body.ipAllowlist
            ? JSON.stringify(request.body.ipAllowlist)
            : null,
          last_used_at: null,
          expires_at: request.body.expiresInDays
            ? new Date(Date.now() + request.body.expiresInDays * 86_400_000).toISOString()
            : null,
          revoked_at: null,
          created_by: request.auth.userId,
          created_at: isoNow(),
        })
        .execute();

      await recordAudit({
        organizationId: orgId(request),
        actorId: request.auth.userId,
        action: 'apikey.create',
        entityType: 'api_key',
        entityId: id,
        changes: { name: request.body.name, scopes: request.body.scopes },
        ip: request.ip,
      });

      return reply.status(201).send({ id, key: fullKey, prefix });
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Revocar una clave de API',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'apikey:write');
      await db()
        .updateTable('api_keys')
        .set({ revoked_at: isoNow() })
        .where('id', '=', request.params.id)
        .where('organization_id', '=', orgId(request))
        .execute();
      return { ok: true };
    },
  );

  /* ----------------------------------------------------------- Webhooks */

  app.get(
    '/webhooks',
    { schema: { tags: ['integraciones'], summary: 'Webhooks salientes', params: organizationParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'integration:read');
      const rows = await db()
        .selectFrom('webhook_endpoints')
        .select(['id', 'url', 'events_json', 'active', 'failure_count', 'created_at'])
        .where('organization_id', '=', orgId(request))
        .execute();

      return {
        availableEvents: WEBHOOK_EVENTS,
        endpoints: rows.map((row) => ({
          id: row.id,
          url: row.url,
          events: JSON.parse(row.events_json) as string[],
          active: row.active === 1,
          failureCount: row.failure_count,
          createdAt: row.created_at,
        })),
      };
    },
  );

  app.post(
    '/webhooks',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Registrar un webhook',
        description:
          'Cada entrega se firma con HMAC-SHA256 en la cabecera X-CitaFacil-Signature con formato `t=<epoch>,v1=<hex>`. El secreto solo se muestra al crearlo.',
        params: organizationParams,
        body: z.object({
          url: z.string().url().max(500),
          events: z.array(z.string().max(60)).min(1).max(40),
        }),
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'integration:write');
      const result = await createWebhookEndpoint({
        organizationId: orgId(request),
        url: request.body.url,
        events: request.body.events,
      });
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/webhooks/:id',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Eliminar un webhook',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'integration:write');
      await db()
        .deleteFrom('webhook_endpoints')
        .where('id', '=', request.params.id)
        .where('organization_id', '=', orgId(request))
        .execute();
      return { ok: true };
    },
  );

  app.get(
    '/webhooks/:id/deliveries',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Últimas entregas de un webhook',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'integration:read');
      return db()
        .selectFrom('webhook_deliveries')
        .select([
          'id',
          'event',
          'status',
          'response_code',
          'attempts',
          'last_error',
          'delivered_at',
          'created_at',
        ])
        .where('endpoint_id', '=', request.params.id)
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute();
    },
  );

  /* -------------------------------------------------------------- Alexa */

  app.post(
    '/integrations/alexa',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        tags: ['integraciones'],
        summary: 'Punto de entrada de la skill de Alexa',
        description:
          'Verifica la firma de Amazon antes de atender la petición. Configura esta URL como endpoint HTTPS de la skill.',
        params: organizationParams,
      },
    },
    async (request, reply) => {
      if (!env.ALEXA_ENABLED) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Alexa no está activo' } });
      }

      const body = request.body as never;
      await verifyAlexaRequest({
        rawBody: JSON.stringify(request.body),
        signatureCertChainUrl: request.headers['signaturecertchainurl'] as string | undefined,
        signature: request.headers['signature'] as string | undefined,
        body,
      });

      return handleAlexaRequest(orgId(request), body);
    },
  );

  /* ------------------------------------------------------------- Google */

  app.post(
    '/integrations/google',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Webhook de Google (Dialogflow CX y ES)',
        params: organizationParams,
      },
    },
    async (request, reply) => {
      if (!env.GOOGLE_ASSISTANT_ENABLED) {
        return reply
          .status(404)
          .send({ error: { code: 'not_found', message: 'La integración con Google no está activa' } });
      }
      return handleGoogleWebhook({
        organizationId: orgId(request),
        body: request.body as never,
        authorization: request.headers.authorization,
      });
    },
  );

  /* ----------------------------------------------------------- Telegram */

  app.post(
    '/integrations/telegram/webhook',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      schema: {
        tags: ['integraciones'],
        summary: 'Recepción de mensajes del bot de Telegram',
        description:
          'Vincula la cuenta cuando el usuario envía al bot el código de un solo uso que obtiene en su perfil.',
        params: organizationParams,
      },
    },
    async (request, reply) => {
      const secret = request.headers['x-telegram-bot-api-secret-token'];
      if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.status(401).send({ ok: false });
      }

      const update = request.body as {
        message?: { chat: { id: number; username?: string }; text?: string };
      };
      const text = update.message?.text?.trim();
      const chatId = update.message?.chat.id;
      if (!text || !chatId) return { ok: true };

      const code = text.replace(/^\/start\s*/i, '').trim().toUpperCase();
      if (code.length < 6) return { ok: true };

      const pending = await db()
        .selectFrom('auth_challenges')
        .select(['id', 'user_id'])
        .where('kind', '=', 'messaging_link')
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', isoNow())
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute();

      for (const candidate of pending) {
        try {
          await peekChallenge(candidate.id, 'messaging_link');
          const consumed = await consumeChallenge(candidate.id, 'messaging_link', code);
          if (!consumed.userId) continue;

          await db()
            .insertInto('messaging_links')
            .values({
              id: newId(),
              user_id: consumed.userId,
              channel: 'telegram',
              external_id: String(chatId),
              username: update.message?.chat.username ?? null,
              verified: 1,
              opt_out: 0,
              created_at: isoNow(),
            })
            .execute();

          return { ok: true, linked: true };
        } catch {
          // El código no coincide con este reto; se prueba con el siguiente.
        }
      }

      return { ok: true, linked: false };
    },
  );

  app.post(
    '/integrations/telegram/register',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Registrar el webhook del bot en Telegram',
        params: organizationParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'integration:write');
      if (!env.TELEGRAM_BOT_TOKEN) {
        throw new BadRequestError('Falta TELEGRAM_BOT_TOKEN', 'telegram_not_configured');
      }
      await setTelegramWebhook(env.APP_URL);
      return { ok: true };
    },
  );

  /* --------------------------------------------------------- WhatsApp */

  app.get(
    '/integrations/whatsapp/webhook',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Verificación del webhook de WhatsApp',
        params: organizationParams,
        querystring: z.object({
          'hub.mode': z.string().optional(),
          'hub.verify_token': z.string().optional(),
          'hub.challenge': z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      if (
        query['hub.mode'] === 'subscribe' &&
        env.WHATSAPP_VERIFY_TOKEN &&
        query['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN
      ) {
        return reply.type('text/plain').send(query['hub.challenge'] ?? '');
      }
      return reply.status(403).send({ ok: false });
    },
  );

  app.post(
    '/integrations/whatsapp/webhook',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Recepción de mensajes de WhatsApp',
        params: organizationParams,
      },
    },
    async (request) => {
      // Meta exige responder 200 rápido; los mensajes entrantes se registran
      // para poder abrir la ventana de 24 horas de conversación.
      const body = request.body as {
        entry?: { changes?: { value?: { messages?: { from: string; text?: { body: string } }[] } }[] }[];
      };

      const messages = body.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
      for (const message of messages) {
        const existing = await db()
          .selectFrom('messaging_links')
          .select(['id'])
          .where('channel', '=', 'whatsapp')
          .where('external_id', '=', message.from)
          .executeTakeFirst();
        if (existing) {
          await db()
            .updateTable('messaging_links')
            .set({ verified: 1, opt_out: 0 })
            .where('id', '=', existing.id)
            .execute();
        }
      }
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------- Resumen */

  app.get(
    '/integrations',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Estado de las integraciones',
        params: organizationParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'integration:read');
      const base = `${env.APP_URL}/api/v1/organizations/${orgId(request)}`;

      return {
        alexa: {
          enabled: env.ALEXA_ENABLED,
          endpoint: `${base}/integrations/alexa`,
          skillId: env.ALEXA_SKILL_ID ?? null,
        },
        google: {
          enabled: env.GOOGLE_ASSISTANT_ENABLED,
          endpoint: `${base}/integrations/google`,
        },
        telegram: {
          enabled: env.TELEGRAM_ENABLED,
          bot: env.TELEGRAM_BOT_USERNAME ?? null,
          webhook: `${base}/integrations/telegram/webhook`,
        },
        whatsapp: {
          enabled: env.WHATSAPP_ENABLED,
          webhook: `${base}/integrations/whatsapp/webhook`,
        },
        mcp: {
          enabled: env.MCP_ENABLED,
          endpoint: `${env.APP_URL}/api/v1/mcp/${orgId(request)}`,
        },
        webhooksOut: { enabled: env.WEBHOOKS_ENABLED, events: WEBHOOK_EVENTS },
      };
    },
  );
};

export default integrationRoutes;
