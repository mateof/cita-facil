import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';
import authRoutes from './auth.js';
import meRoutes from './me.js';
import organizationRoutes from './organizations.js';
import catalogRoutes from './catalog.js';
import availabilityRoutes from './availability.js';
import appointmentRoutes from './appointments.js';
import accessRoutes from './access.js';
import notificationRoutes from './notifications.js';
import paymentRoutes from './payments.js';
import creditRoutes from './credits.js';
import reportRoutes from './reports.js';
import adminRoutes from './admin.js';
import integrationRoutes from './integrations.js';
import publicRoutes from './public.js';
import uploadRoutes from './uploads.js';
import mcpRoutes from './mcp.js';

/** Registro de todas las rutas bajo `/api/v1`. */
export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(organizationRoutes, { prefix: '/organizations' });
  await app.register(catalogRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(availabilityRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(appointmentRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(accessRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(notificationRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(paymentRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(creditRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(reportRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(integrationRoutes, { prefix: '/organizations/:organizationId' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(publicRoutes, { prefix: '/public' });
  // Sin prefijo: la subida cuelga de la organización y la entrega es pública.
  await app.register(uploadRoutes);

  if (env.MCP_ENABLED) {
    await app.register(mcpRoutes, { prefix: '/mcp' });
  }
};
