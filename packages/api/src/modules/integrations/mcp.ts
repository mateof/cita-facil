import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { computeAvailability } from '../availability/engine.js';
import { createAppointment, cancelAppointment } from '../appointments/service.js';
import { listCustomerAppointments, requireAppointmentDetail } from '../appointments/queries.js';
import { listLocations, listServices } from '../catalog/service.js';
import { findNextSlot } from './assistant.js';

/**
 * Servidor MCP (Model Context Protocol).
 *
 * Permite que un asistente de IA (Claude, o cualquier cliente MCP) consulte
 * disponibilidad y gestione citas en nombre del usuario.
 *
 * Se implementa el protocolo JSON-RPC directamente sobre HTTP en lugar de usar
 * el SDK oficial porque el SDK asume el control del servidor HTTP de Node, y
 * aquí las rutas las gobierna Fastify: montarlo por debajo obligaría a
 * envolver el ciclo de petición y respuesta con adaptadores frágiles. El
 * subconjunto que hace falta (`initialize`, `tools/list`, `tools/call`) son
 * tres métodos con formato bien definido.
 */

const PROTOCOL_VERSION = '2024-11-05';

export interface McpContext {
  organizationId: string;
  userId: string | null;
  isStaff: boolean;
  locale: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (context: McpContext, args: Record<string, any>) => Promise<unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'listar_servicios',
    description:
      'Lista los servicios que se pueden reservar, con su duración, precio y si admiten duración ajustable por el cliente.',
    inputSchema: {
      type: 'object',
      properties: {
        sedeId: { type: 'string', description: 'Filtrar por sede (opcional)' },
      },
    },
    handler: async (context, args) => {
      const services = await listServices(context.organizationId, {
        locationId: args.sedeId,
        onlyActive: true,
        onlyPublic: !context.isStaff,
      });
      return services.map((service) => ({
        id: service.id,
        nombre: service.name,
        duracionMinutos: service.durationMinutes,
        duracionAjustable: service.durationMode === 'flexible',
        duracionMinima: service.minDurationMinutes,
        duracionMaxima: service.maxDurationMinutes,
        tramoMinutos: service.durationStepMinutes,
        precioCentimos: service.priceCents,
        moneda: service.currency,
        aforo: service.capacity,
        requiereAprobacion: service.requiresApproval,
      }));
    },
  },

  {
    name: 'listar_sedes',
    description: 'Lista las sedes del establecimiento con su dirección y zona horaria.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (context) => {
      const locations = await listLocations(context.organizationId, { onlyActive: true });
      return locations.map((location) => ({
        id: location.id,
        nombre: location.name,
        direccion: location.addressLine,
        ciudad: location.city,
        zonaHoraria: location.timezone,
        telefono: location.phone,
      }));
    },
  },

  {
    name: 'consultar_disponibilidad',
    description:
      'Devuelve los huecos libres de un servicio entre dos fechas. Las fechas van en formato YYYY-MM-DD.',
    inputSchema: {
      type: 'object',
      required: ['servicioId', 'desde'],
      properties: {
        servicioId: { type: 'string' },
        desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
        hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (opcional)' },
        sedeId: { type: 'string' },
        recursoId: { type: 'string' },
        duracionMinutos: {
          type: 'number',
          description: 'Solo para servicios de duración ajustable',
        },
        personas: { type: 'number', default: 1 },
      },
    },
    handler: async (context, args) => {
      const availability = await computeAvailability({
        organizationId: context.organizationId,
        serviceId: args.servicioId,
        locationId: args.sedeId,
        resourceId: args.recursoId,
        from: args.desde,
        to: args.hasta ?? args.desde,
        durationMinutes: args.duracionMinutos,
        partySize: args.personas ?? 1,
      });

      return {
        zonaHoraria: availability.timezone,
        duracionMinutos: availability.durationMinutes,
        dias: availability.days.map((day) => ({
          fecha: day.date,
          cerrado: day.closed,
          huecos: day.slots.map((slot) => ({
            inicio: slot.startsAt,
            fin: slot.endsAt,
            plazasLibres: slot.remainingCapacity,
            precioCentimos: slot.priceCents,
          })),
        })),
      };
    },
  },

  {
    name: 'proximo_hueco',
    description:
      'Busca el primer hueco libre de un servicio a partir de hoy. Acepta el nombre del servicio tal cual lo diría una persona.',
    inputSchema: {
      type: 'object',
      properties: {
        servicioId: { type: 'string' },
        servicio: { type: 'string', description: 'Nombre aproximado del servicio' },
        desde: { type: 'string' },
      },
    },
    handler: async (context, args) => {
      const reply = await findNextSlot(context, {
        serviceId: args.servicioId,
        serviceName: args.servicio,
        fromDate: args.desde,
      });
      return { mensaje: reply.speech, hueco: reply.slot ?? null, servicioId: reply.serviceId };
    },
  },

  {
    name: 'reservar_cita',
    description:
      'Reserva una cita para el usuario autenticado. Devuelve el identificador y el código de acceso.',
    inputSchema: {
      type: 'object',
      required: ['servicioId', 'inicio'],
      properties: {
        servicioId: { type: 'string' },
        inicio: { type: 'string', description: 'Instante ISO-8601 del inicio' },
        sedeId: { type: 'string' },
        recursoId: { type: 'string' },
        duracionMinutos: { type: 'number' },
        personas: { type: 'number', default: 1 },
        notas: { type: 'string' },
      },
    },
    handler: async (context, args) => {
      if (!context.userId) {
        throw new Error('Hace falta un usuario autenticado para reservar');
      }
      const { appointment } = await createAppointment(
        context.organizationId,
        {
          serviceId: args.servicioId,
          locationId: args.sedeId,
          resourceId: args.recursoId,
          startsAt: args.inicio,
          durationMinutes: args.duracionMinutos,
          partySize: args.personas ?? 1,
          notes: args.notas,
          source: 'mcp',
        },
        { userId: context.userId, isStaff: context.isStaff, source: 'mcp', locale: context.locale },
      );

      return {
        id: appointment.id,
        estado: appointment.status,
        servicio: appointment.serviceName,
        inicio: appointment.startsAt,
        fin: appointment.endsAt,
        sede: appointment.locationName,
        profesional: appointment.resourceName,
        codigoAcceso: appointment.accessCode,
        enlace: `${env.APP_URL}/citas/${appointment.id}`,
      };
    },
  },

  {
    name: 'mis_citas',
    description: 'Lista las citas del usuario autenticado.',
    inputSchema: {
      type: 'object',
      properties: {
        filtro: { type: 'string', enum: ['proximas', 'pasadas', 'todas'], default: 'proximas' },
      },
    },
    handler: async (context, args) => {
      if (!context.userId) throw new Error('Hace falta un usuario autenticado');
      const filter = args.filtro ?? 'proximas';
      const result = await listCustomerAppointments({
        customerId: context.userId,
        upcoming: filter === 'todas' ? undefined : filter === 'proximas',
        page: 1,
        pageSize: 25,
      });

      return result.items.map((appointment) => ({
        id: appointment.id,
        servicio: appointment.serviceName,
        inicio: appointment.startsAt,
        fin: appointment.endsAt,
        estado: appointment.status,
        sede: appointment.locationName,
        profesional: appointment.resourceName,
        codigoAcceso: appointment.accessCode,
      }));
    },
  },

  {
    name: 'detalle_cita',
    description: 'Devuelve el detalle completo de una cita.',
    inputSchema: {
      type: 'object',
      required: ['citaId'],
      properties: { citaId: { type: 'string' } },
    },
    handler: async (context, args) => {
      const appointment = await requireAppointmentDetail(args.citaId);
      if (appointment.organizationId !== context.organizationId) {
        throw new Error('La cita no pertenece a esta organización');
      }
      if (!context.isStaff && appointment.customerId !== context.userId) {
        throw new Error('No tienes acceso a esa cita');
      }
      return appointment;
    },
  },

  {
    name: 'cancelar_cita',
    description: 'Cancela una cita del usuario autenticado.',
    inputSchema: {
      type: 'object',
      required: ['citaId'],
      properties: {
        citaId: { type: 'string' },
        motivo: { type: 'string' },
      },
    },
    handler: async (context, args) => {
      const appointment = await requireAppointmentDetail(args.citaId);
      if (!context.isStaff && appointment.customerId !== context.userId) {
        throw new Error('No puedes cancelar esa cita');
      }
      const cancelled = await cancelAppointment(args.citaId, {
        reason: args.motivo,
        actor: { userId: context.userId, isStaff: context.isStaff, source: 'mcp' },
      });
      return { id: cancelled.id, estado: cancelled.status };
    },
  },
];

/* -------------------------------------------------------------------------- */
/* JSON-RPC                                                                    */
/* -------------------------------------------------------------------------- */

function result(id: JsonRpcRequest['id'], value: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result: value };
}

function failure(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

export async function handleMcpRequest(
  context: McpContext,
  payload: JsonRpcRequest | JsonRpcRequest[],
): Promise<unknown> {
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      const response = await handleSingle(context, item);
      if (response) responses.push(response);
    }
    return responses;
  }
  return handleSingle(context, payload);
}

async function handleSingle(
  context: McpContext,
  request: JsonRpcRequest,
): Promise<unknown | null> {
  // Las notificaciones (sin `id`) no llevan respuesta.
  const isNotification = request.id === undefined;

  switch (request.method) {
    case 'initialize':
      return result(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `${env.APP_NAME} MCP`, version: '1.0.0' },
        instructions: [
          'Servidor de gestión de citas.',
          'Consulta primero `listar_servicios` para conocer los identificadores.',
          'Para reservar hace falta que el usuario esté autenticado; en ese caso las citas se crean a su nombre.',
          'Las fechas se expresan en ISO-8601 y los importes en céntimos.',
        ].join(' '),
      });

    case 'notifications/initialized':
      return null;

    case 'ping':
      return result(request.id, {});

    case 'tools/list':
      return result(request.id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case 'tools/call': {
      const name = request.params?.name as string | undefined;
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) return failure(request.id, -32602, `Herramienta desconocida: ${name}`);

      try {
        const value = await tool.handler(context, request.params?.arguments ?? {});
        return result(request.id, {
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          isError: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, tool: name }, 'Fallo ejecutando una herramienta MCP');
        // Los errores de herramienta se devuelven como contenido, no como error
        // de protocolo: así el modelo puede leerlos y reaccionar.
        return result(request.id, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return failure(request.id, -32601, `Método no soportado: ${request.method}`);
  }
}

export const MCP_TOOL_NAMES = TOOLS.map((tool) => tool.name);
