import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Permission } from '@cita-facil/shared';
import { BadRequestError } from '../lib/errors.js';
import { MAX_UPLOAD_BYTES, readUpload, saveUpload } from '../modules/uploads/service.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Subida y entrega de imágenes de las entidades.
 *
 * La subida va por organización y pide el permiso de aquello que se va a
 * ilustrar: quien puede editar servicios sube la imagen de un servicio, y no
 * se le abre por eso la puerta a cambiar el logotipo del negocio.
 *
 * La entrega es pública sin más comprobación, y es deliberado: son logotipos y
 * fotos de servicios que se enseñan en la página de reservas, a la que se llega
 * sin identificarse. El nombre del fichero es aleatorio, así que no se puede
 * adivinar el de otra organización.
 */

/** Qué permiso hace falta según lo que se vaya a ilustrar. */
const PERMISO_POR_DESTINO: Record<string, Permission> = {
  organization: 'org:update',
  location: 'location:write',
  service: 'service:write',
  resource: 'resource:write',
  category: 'service:write',
  credit_pack: 'credit:write',
};

const uploadResponse = z.object({
  url: z.string(),
  bytes: z.number().int(),
  mime: z.string(),
});

const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/organizations/:organizationId/uploads',
    {
      schema: {
        tags: ['imagenes'],
        summary: 'Subir la imagen de una entidad',
        description:
          'Multipart con el campo `file` y el campo `target` (organization, location, service, resource, category o credit_pack). Máximo 2 MB, en PNG, JPEG, WebP o GIF.',
        params: organizationParams,
        response: { 201: uploadResponse },
      },
    },
    async (request, reply) => {
      const parte = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!parte) throw new BadRequestError('Falta el fichero', 'missing_file');

      const destino = (parte.fields as Record<string, { value?: unknown } | undefined>).target
        ?.value;
      const permiso = PERMISO_POR_DESTINO[String(destino ?? '')];
      if (!permiso) {
        throw new BadRequestError('No se sabe para qué es la imagen', 'invalid_target');
      }
      request.requirePermission(orgId(request), permiso);

      const bytes = await parte.toBuffer().catch(() => {
        // `toBuffer` revienta al pasarse del límite en vez de devolver el corte.
        throw new BadRequestError('La imagen no puede pasar de 2 MB', 'file_too_large');
      });

      const guardado = await saveUpload({ scope: orgId(request), bytes });
      return reply.status(201).send({
        url: guardado.url,
        bytes: guardado.bytes,
        mime: guardado.mime,
      });
    },
  );

  app.get(
    '/uploads/:scope/:filename',
    {
      schema: {
        tags: ['imagenes'],
        summary: 'Descargar una imagen',
        params: z.object({ scope: z.string().max(64), filename: z.string().max(80) }),
      },
    },
    async (request, reply) => {
      const { bytes, mime, etag } = await readUpload(
        `${request.params.scope}/${request.params.filename}`,
      );

      // El contenido de una dirección no cambia nunca: el nombre se genera al
      // subir y reemplazar la imagen crea otro fichero.
      return reply
        .header('content-type', mime)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('etag', `"${etag}"`)
        .send(bytes);
    },
  );
};

export default uploadRoutes;
