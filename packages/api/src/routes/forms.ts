import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createFormSchema,
  formResponseSchema,
  formSchema,
  pendingFormSchema,
  serviceFormSchema,
  submitFormResponseSchema,
  updateFormSchema,
} from '@cita-facil/shared';
import {
  createForm,
  deleteForm,
  formsOfService,
  getForm,
  listForms,
  listResponses,
  saveFormResponse,
  setServiceForms,
  updateForm,
} from '../modules/catalog/forms.js';
import { requireAppointmentDetail } from '../modules/appointments/queries.js';
import { NotFoundError } from '../lib/errors.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Formularios y consentimientos.
 *
 * Son configuración del catálogo, así que piden el mismo permiso que los
 * servicios: quien puede decidir qué se vende puede decidir qué hay que
 * responder antes.
 */
const formRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Formularios de la organización',
        params: organizationParams,
        querystring: z.object({ onlyActive: z.coerce.boolean().optional() }),
        response: { 200: z.array(formSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      return listForms(orgId(request), request.query);
    },
  );

  app.post(
    '/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Crear un formulario o un consentimiento',
        params: organizationParams,
        body: createFormSchema,
        response: { 201: formSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'service:write');
      const form = await createForm(orgId(request), request.body);
      return reply.status(201).send(form);
    },
  );

  app.patch(
    '/forms/:id',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Cambiar un formulario',
        params: organizationAndIdParams,
        body: updateFormSchema,
        response: { 200: formSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:write');
      return updateForm(orgId(request), request.params.id, request.body);
    },
  );

  app.delete(
    '/forms/:id',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Eliminar un formulario',
        description: 'Si ya tiene respuestas no se borra: se desactiva y lo firmado se conserva.',
        params: organizationAndIdParams,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'service:write');
      await deleteForm(orgId(request), request.params.id);
      return reply.status(204).send();
    },
  );

  /* ------------------------------------------------ Enganche con el servicio */

  app.get(
    '/services/:serviceId/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Formularios que pide un servicio',
        params: z.object({ organizationId: z.string().min(1), serviceId: z.string().min(1) }),
        response: { 200: z.array(pendingFormSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      return formsOfService(orgId(request), request.params.serviceId);
    },
  );

  app.put(
    '/services/:serviceId/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Decidir qué formularios pide un servicio',
        params: z.object({ organizationId: z.string().min(1), serviceId: z.string().min(1) }),
        body: z.object({ forms: z.array(serviceFormSchema).max(20) }),
        response: { 200: z.array(pendingFormSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:write');
      return setServiceForms(orgId(request), request.params.serviceId, request.body.forms);
    },
  );

  /* ------------------------------------------------------------- Respuestas */

  app.get(
    '/form-responses',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Respuestas recibidas',
        params: organizationParams,
        querystring: z.object({
          appointmentId: z.string().optional(),
          customerId: z.string().optional(),
          formId: z.string().optional(),
        }),
        response: { 200: z.array(formResponseSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:read');
      return listResponses(orgId(request), request.query);
    },
  );

  app.post(
    '/appointments/:id/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Responder un formulario de una cita',
        description:
          'Lo usa el cliente cuando lo deja para después y el mostrador cuando se rellena en persona.',
        params: organizationAndIdParams,
        body: submitFormResponseSchema,
        response: { 201: formResponseSchema },
      },
    },
    async (request, reply) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      if (appointment.organizationId !== orgId(request)) {
        throw new NotFoundError('La cita no existe');
      }

      // Responde el propio cliente o el personal del negocio; nadie más.
      const esSuya = appointment.customerId && appointment.customerId === request.auth.userId;
      if (!esSuya) request.requirePermission(orgId(request), 'appointment:write');

      const respuesta = await saveFormResponse(orgId(request), request.body, {
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        guestName: appointment.customerId ? null : appointment.customerName,
        ip: request.ip,
      });
      return reply.status(201).send(respuesta);
    },
  );

  app.get(
    '/appointments/:id/forms',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Respuestas de una cita',
        params: organizationAndIdParams,
        response: { 200: z.array(formResponseSchema) },
      },
    },
    async (request) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      if (appointment.organizationId !== orgId(request)) {
        throw new NotFoundError('La cita no existe');
      }

      const esSuya = appointment.customerId && appointment.customerId === request.auth.userId;
      if (!esSuya) request.requirePermission(orgId(request), 'customer:read');

      return listResponses(orgId(request), { appointmentId: appointment.id });
    },
  );

  /** Se comprueba que existe antes de nada, para no filtrar identificadores. */
  app.get(
    '/forms/:id',
    {
      schema: {
        tags: ['formularios'],
        summary: 'Un formulario',
        params: organizationAndIdParams,
        response: { 200: formSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      return getForm(orgId(request), request.params.id);
    },
  );
};

export default formRoutes;
