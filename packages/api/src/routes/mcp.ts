import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';
import { MCP_TOOL_NAMES, handleMcpRequest } from '../modules/integrations/mcp.js';

/**
 * Endpoint del servidor MCP, uno por organización:
 *
 *   POST /api/v1/mcp/<organizationId>
 *
 * El cliente MCP se autentica con el mismo token de sesión o clave de API que
 * el resto de la aplicación, así que las citas que cree quedan a nombre del
 * usuario real y con sus permisos, no con una identidad de servicio anónima.
 */
const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/',
    { schema: { tags: ['integraciones'], summary: 'Información del servidor MCP' } },
    async () => ({
      name: `${env.APP_NAME} MCP`,
      transport: 'http',
      endpoint: `${env.APP_URL}/api/v1/mcp/{organizationId}`,
      tools: MCP_TOOL_NAMES,
      authentication: 'Authorization: Bearer <token> o cabecera x-api-key',
    }),
  );

  app.post(
    '/:organizationId',
    {
      schema: {
        tags: ['integraciones'],
        summary: 'Canal JSON-RPC del servidor MCP',
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        params: z.object({ organizationId: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      const organizationId = request.params.organizationId;

      if (request.auth.type === 'anonymous') {
        throw new UnauthorizedError(
          'El servidor MCP necesita autenticación',
          'authentication_required',
        );
      }

      // Se comprueba el acceso a la organización, pero no se exige ser staff:
      // un cliente puede usar MCP para gestionar sus propias citas.
      const isStaff = request.auth.organizations.has(organizationId);

      const response = await handleMcpRequest(
        {
          organizationId,
          userId: request.auth.userId,
          isStaff,
          locale: request.locale,
        },
        request.body as never,
      );

      // Las notificaciones JSON-RPC no llevan cuerpo de respuesta.
      if (response === null) return reply.status(202).send();
      return reply.send(response);
    },
  );
};

export default mcpRoutes;
