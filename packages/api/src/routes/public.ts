import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  PAGE_KEYS,
  availabilityQuerySchema,
  isoDateSchema,
  pickI18n,
  publicPageSchema,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { NotFoundError } from '../lib/errors.js';
import { computeAvailability } from '../modules/availability/engine.js';
import {
  getOrganizationBySlug,
  listLocations,
  listResources,
  listServices,
  listCategories,
} from '../modules/catalog/service.js';
import { publishedPage, publishedPages } from '../modules/catalog/pages.js';
import { findByAccessCode } from '../modules/appointments/queries.js';
import { getAuthSettings } from '../modules/settings/access-policy.js';

/**
 * Endpoints sin autenticación para la página pública de reservas.
 *
 * Devuelven solo lo que un visitante puede ver: servicios marcados como
 * públicos, sedes activas y, si la organización lo permite, los nombres de los
 * profesionales. Nunca datos de otros clientes.
 */
const publicRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/config',
    { schema: { tags: ['publico'], summary: 'Configuración pública de la instalación' } },
    async () => ({
      appName: env.APP_NAME,
      defaultLocale: env.DEFAULT_LOCALE,
      locales: ['es', 'gl', 'en'],
      defaultTimezone: env.DEFAULT_TIMEZONE,
      authMethods: env.AUTH_METHODS,
      registrationOpen: env.AUTH_METHODS.includes('password'),
      paymentsEnabled: env.PAYMENTS_ENABLED,
      pushEnabled: env.PUSH_ENABLED,
    }),
  );

  app.get(
    '/organizations',
    {
      schema: {
        tags: ['publico'],
        summary: 'Establecimientos con reserva online activa',
        description:
          'En una instalación de un solo negocio devuelve una única entrada, y la interfaz salta directamente a su página de reservas.',
      },
    },
    async () => {
      const rows = await db()
        .selectFrom('organizations')
        .select(['id', 'slug', 'name', 'settings_json', 'timezone'])
        .where('status', '=', 'active')
        .where('deleted_at', 'is', null)
        .orderBy('name')
        .limit(200)
        .execute();

      return rows
        .filter((row) => {
          if (!row.settings_json) return true;
          try {
            return (JSON.parse(row.settings_json) as { publicBookingEnabled?: boolean })
              .publicBookingEnabled !== false;
          } catch {
            return true;
          }
        })
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          timezone: row.timezone,
        }));
    },
  );

  app.get(
    '/organizations/:slug/pages/:key',
    {
      schema: {
        tags: ['publico'],
        summary: 'Página de contenido de un establecimiento',
        description: 'Contacto o sobre nosotros, ya resuelta al idioma pedido.',
        params: z.object({ slug: z.string().min(1), key: z.enum(PAGE_KEYS) }),
        querystring: z.object({ locale: z.string().max(5).optional() }),
        response: { 200: publicPageSchema },
      },
    },
    async (request) => {
      const organization = await getOrganizationBySlug(request.params.slug);
      if (!organization || organization.status !== 'active') {
        throw new NotFoundError('Establecimiento no encontrado');
      }
      return publishedPage(
        organization.id,
        request.params.key,
        request.query.locale ?? request.locale,
      );
    },
  );

  app.get(
    '/organizations/:slug',
    {
      schema: {
        tags: ['publico'],
        summary: 'Página pública de un establecimiento',
        params: z.object({ slug: z.string().min(1) }),
        querystring: z.object({ locale: z.string().max(5).optional() }),
      },
    },
    async (request) => {
      const organization = await getOrganizationBySlug(request.params.slug);
      if (!organization || organization.status !== 'active') {
        throw new NotFoundError('Establecimiento no encontrado');
      }

      const settings = organization.settings as Record<string, unknown>;
      if (settings.publicBookingEnabled === false) {
        throw new NotFoundError('Este establecimiento no admite reserva online');
      }

      const locale = request.query.locale ?? request.locale;
      const [locations, services, categories, pages] = await Promise.all([
        listLocations(organization.id, { onlyActive: true }),
        listServices(organization.id, { onlyActive: true, onlyPublic: true }),
        listCategories(organization.id),
        publishedPages(organization.id, locale),
      ]);

      // La reserva sin cuenta necesita el visto bueno de la instalación y el de
      // la organización; se resuelve aquí para que la interfaz no ofrezca algo
      // que el backend va a rechazar después.
      const platform = await getAuthSettings();
      const allowGuestBooking = platform.allowAnonymousBooking && settings.allowGuestBooking === true;

      const showResources = settings.showResourceNames !== false;
      const resources = showResources
        ? await listResources(organization.id, { onlyActive: true })
        : [];

      return {
        organization: {
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          timezone: organization.timezone,
          locale: organization.locale,
          currency: organization.currency,
          phone: organization.phone,
          email: organization.email,
          branding: {
            brandColor: settings.brandColor ?? '#2563eb',
            logoUrl: settings.logoUrl ?? null,
            termsUrl: settings.termsUrl ?? null,
            privacyUrl: settings.privacyUrl ?? null,
          },
          allowGuestBooking,
          waitlistEnabled: settings.waitlistEnabled !== false,
        },
        // Solo los títulos: el contenido se pide al abrir la página, que es
        // texto largo y no hace falta en cada visita a la reserva.
        pages: pages.map((page) => ({ key: page.key, title: page.title })),
        locations: locations.map((location) => ({
          id: location.id,
          name: location.name,
          addressLine: location.addressLine,
          city: location.city,
          postalCode: location.postalCode,
          latitude: location.latitude,
          longitude: location.longitude,
          phone: location.phone,
          timezone: location.timezone,
          description: pickI18n(location.description, locale),
        })),
        categories,
        services: services.map((service) => ({
          id: service.id,
          locationId: service.locationId,
          categoryId: service.categoryId,
          name: pickI18n(service.nameI18n, locale, service.name),
          description: pickI18n(service.description, locale),
          color: service.color,
          imageUrl: service.imageUrl,
          durationMode: service.durationMode,
          durationMinutes: service.durationMinutes,
          minDurationMinutes: service.minDurationMinutes,
          maxDurationMinutes: service.maxDurationMinutes,
          durationStepMinutes: service.durationStepMinutes,
          priceMode: service.priceMode,
          priceCents: service.priceCents,
          pricePerMinuteCents: service.pricePerMinuteCents,
          currency: service.currency,
          depositCents: service.depositCents,
          capacity: service.capacity,
          requiresApproval: service.requiresApproval,
          requiresCreditPack: service.requiresCreditPack,
          allowResourceSelection: service.allowResourceSelection && showResources,
          resourceIds: service.resourceIds,
          maxAdvanceDays: service.maxAdvanceDays,
          minAdvanceMinutes: service.minAdvanceMinutes,
          cancellationCutoffMinutes: service.cancellationCutoffMinutes,
        })),
        resources: resources
          .filter((resource) => resource.bookableDirectly)
          .map((resource) => ({
            id: resource.id,
            locationId: resource.locationId,
            name: resource.name,
            type: resource.type,
            color: resource.color,
            imageUrl: resource.imageUrl,
            capacity: resource.capacity,
          })),
      };
    },
  );

  app.get(
    '/organizations/:organizationId/availability',
    {
      schema: {
        tags: ['publico'],
        summary: 'Disponibilidad pública de un servicio',
        params: z.object({ organizationId: z.string().min(1) }),
        querystring: availabilityQuerySchema,
      },
    },
    async (request) => {
      const service = await db()
        .selectFrom('services')
        .select(['publicly_bookable', 'staff_only'])
        .where('id', '=', request.query.serviceId)
        .where('organization_id', '=', request.params.organizationId)
        .executeTakeFirst();

      if (!service || service.publicly_bookable !== 1 || service.staff_only === 1) {
        throw new NotFoundError('El servicio no está disponible para reserva online');
      }

      return computeAvailability({
        organizationId: request.params.organizationId,
        serviceId: request.query.serviceId,
        locationId: request.query.locationId,
        resourceId: request.query.resourceId,
        from: request.query.from,
        to: request.query.to ?? request.query.from,
        durationMinutes: request.query.durationMinutes,
        partySize: request.query.partySize,
      });
    },
  );

  app.get(
    '/organizations/:organizationId/calendar',
    {
      schema: {
        tags: ['publico'],
        summary: 'Días con hueco en un mes',
        description: 'Pensado para pintar el calendario con los días disponibles resaltados.',
        params: z.object({ organizationId: z.string().min(1) }),
        querystring: z.object({
          serviceId: z.string().min(1),
          from: isoDateSchema,
          to: isoDateSchema,
          durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
          locationId: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const availability = await computeAvailability({
        organizationId: request.params.organizationId,
        serviceId: request.query.serviceId,
        locationId: request.query.locationId,
        from: request.query.from,
        to: request.query.to,
        durationMinutes: request.query.durationMinutes,
      });

      return {
        timezone: availability.timezone,
        days: availability.days.map((day) => ({
          date: day.date,
          available: day.slots.length > 0,
          slots: day.slots.length,
          firstSlot: day.slots[0]?.startsAt ?? null,
        })),
      };
    },
  );

  /**
   * Consulta de una cita con su código de acceso, sin necesidad de cuenta. Es
   * lo que permite que quien reservó como invitado pueda ver, descargar o
   * cancelar su cita desde el enlace del correo.
   */
  app.get(
    '/appointments/lookup',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['publico'],
        summary: 'Consultar una cita por su código',
        querystring: z.object({ code: z.string().min(4).max(120) }),
      },
    },
    async (request) => {
      const appointment = await findByAccessCode(request.query.code);
      if (!appointment) throw new NotFoundError('No hay ninguna cita con ese código');

      return {
        id: appointment.id,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        timezone: appointment.timezone,
        status: appointment.status,
        serviceName: appointment.serviceName,
        organizationName: appointment.organizationName,
        locationName: appointment.locationName,
        locationAddress: appointment.locationAddress,
        resourceName: appointment.resourceName,
        customerName: appointment.customerName,
        partySize: appointment.partySize,
        priceCents: appointment.priceCents,
        currency: appointment.currency,
        paymentStatus: appointment.paymentStatus,
        accessCode: appointment.accessCode,
      };
    },
  );
};

export default publicRoutes;
