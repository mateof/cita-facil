import { db } from '../../db/index.js';
import { addDays, formatForHumans, todayIn } from '../../lib/dates.js';
import { computeAvailability } from '../availability/engine.js';
import { createAppointment } from '../appointments/service.js';
import { cancelAppointment } from '../appointments/service.js';
import { listCustomerAppointments } from '../appointments/queries.js';
import { listServices, getOrganization } from '../catalog/service.js';

/**
 * Lógica común a los asistentes de voz y a las IA.
 *
 * Alexa, Google y el servidor MCP hablan protocolos distintos pero preguntan
 * las mismas cuatro cosas: qué servicios hay, cuándo hay hueco, resérvame, y
 * qué citas tengo. Estas funciones devuelven datos y una frase ya redactada,
 * de forma que cada adaptador solo tiene que envolverla en su formato.
 */

export interface AssistantContext {
  organizationId: string;
  userId: string | null;
  locale: string;
}

export interface AssistantReply {
  /** Frase para leer en voz alta o mostrar como respuesta. */
  speech: string;
  /** Datos estructurados, para clientes que sepan usarlos. */
  data?: unknown;
  /** `true` si la conversación debe seguir esperando respuesta del usuario. */
  expectsAnswer?: boolean;
}

const PHRASES = {
  es: {
    noServices: 'Ahora mismo no hay servicios disponibles para reservar.',
    services: (names: string[]) => `Puedes reservar: ${listToText(names, 'y')}.`,
    serviceNotFound: (name: string) => `No encuentro ningún servicio que se llame ${name}.`,
    noSlots: 'No he encontrado ningún hueco libre en las próximas semanas.',
    nextSlot: (service: string, when: string) =>
      `El primer hueco para ${service} es el ${when}. ¿Quieres que lo reserve?`,
    booked: (service: string, when: string) => `Listo. Tu cita de ${service} queda el ${when}.`,
    bookingFailed: 'No he podido reservar ese hueco. Puede que lo hayan cogido hace un momento.',
    noAppointments: 'No tienes ninguna cita próxima.',
    appointments: (items: string[]) => `Tienes ${items.length === 1 ? 'una cita' : `${items.length} citas`}: ${listToText(items, 'y')}.`,
    cancelled: (when: string) => `He cancelado tu cita del ${when}.`,
    needAccount: 'Para esto necesitas vincular tu cuenta primero.',
  },
  gl: {
    noServices: 'Agora mesmo non hai servizos dispoñibles para reservar.',
    services: (names: string[]) => `Podes reservar: ${listToText(names, 'e')}.`,
    serviceNotFound: (name: string) => `Non atopo ningún servizo chamado ${name}.`,
    noSlots: 'Non atopei ningún oco libre nas próximas semanas.',
    nextSlot: (service: string, when: string) =>
      `O primeiro oco para ${service} é o ${when}. Queres que o reserve?`,
    booked: (service: string, when: string) => `Feito. A túa cita de ${service} queda o ${when}.`,
    bookingFailed: 'Non puiden reservar ese oco. Pode que o collesen hai un intre.',
    noAppointments: 'Non tes ningunha cita próxima.',
    appointments: (items: string[]) => `Tes ${items.length === 1 ? 'unha cita' : `${items.length} citas`}: ${listToText(items, 'e')}.`,
    cancelled: (when: string) => `Cancelei a túa cita do ${when}.`,
    needAccount: 'Para isto precisas vincular a túa conta primeiro.',
  },
  en: {
    noServices: 'There are no bookable services right now.',
    services: (names: string[]) => `You can book: ${listToText(names, 'and')}.`,
    serviceNotFound: (name: string) => `I cannot find a service called ${name}.`,
    noSlots: 'I could not find any free slot in the coming weeks.',
    nextSlot: (service: string, when: string) =>
      `The first slot for ${service} is on ${when}. Shall I book it?`,
    booked: (service: string, when: string) => `Done. Your ${service} appointment is on ${when}.`,
    bookingFailed: 'I could not book that slot. Someone may have taken it just now.',
    noAppointments: 'You have no upcoming appointments.',
    appointments: (items: string[]) => `You have ${items.length} appointment${items.length === 1 ? '' : 's'}: ${listToText(items, 'and')}.`,
    cancelled: (when: string) => `I cancelled your appointment on ${when}.`,
    needAccount: 'You need to link your account first.',
  },
} as const;

function phrases(locale: string) {
  return PHRASES[locale as keyof typeof PHRASES] ?? PHRASES.es;
}

function listToText(items: string[], conjunction: string): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/* -------------------------------------------------------------------------- */

export async function listBookableServices(context: AssistantContext): Promise<AssistantReply> {
  const text = phrases(context.locale);
  const services = await listServices(context.organizationId, {
    onlyActive: true,
    onlyPublic: true,
  });

  if (services.length === 0) return { speech: text.noServices };

  return {
    speech: text.services(services.slice(0, 8).map((service) => service.name)),
    data: services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents,
      currency: service.currency,
      durationMode: service.durationMode,
    })),
  };
}

/** Busca un servicio por nombre aproximado, como lo diría alguien en voz alta. */
export async function findServiceByName(
  organizationId: string,
  spoken: string,
): Promise<{ id: string; name: string } | null> {
  const services = await listServices(organizationId, { onlyActive: true, onlyPublic: true });
  const needle = normalize(spoken);

  const exact = services.find((service) => normalize(service.name) === needle);
  if (exact) return { id: exact.id, name: exact.name };

  const partial = services.find(
    (service) => normalize(service.name).includes(needle) || needle.includes(normalize(service.name)),
  );
  return partial ? { id: partial.id, name: partial.name } : null;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export async function findNextSlot(
  context: AssistantContext,
  params: { serviceName?: string; serviceId?: string; fromDate?: string; searchDays?: number },
): Promise<AssistantReply & { slot?: unknown; serviceId?: string }> {
  const text = phrases(context.locale);

  let serviceId = params.serviceId;
  let serviceName = params.serviceName ?? '';

  if (!serviceId && params.serviceName) {
    const found = await findServiceByName(context.organizationId, params.serviceName);
    if (!found) return { speech: text.serviceNotFound(params.serviceName) };
    serviceId = found.id;
    serviceName = found.name;
  }
  if (!serviceId) return listBookableServices(context);

  const organization = await getOrganization(context.organizationId);
  const timezone = organization?.timezone ?? 'Europe/Madrid';
  const start = params.fromDate ?? todayIn(timezone);
  const searchDays = params.searchDays ?? 30;

  for (let offset = 0; offset < searchDays; offset += 7) {
    const availability = await computeAvailability({
      organizationId: context.organizationId,
      serviceId,
      from: addDays(start, offset),
      to: addDays(start, Math.min(offset + 6, searchDays - 1)),
    });

    for (const day of availability.days) {
      const slot = day.slots[0];
      if (!slot) continue;
      const when = formatForHumans(slot.startsAt, availability.timezone, context.locale, 'full');
      return {
        speech: text.nextSlot(serviceName, when),
        expectsAnswer: true,
        slot,
        serviceId,
        data: { slot, serviceId, timezone: availability.timezone },
      };
    }
  }

  return { speech: text.noSlots, serviceId };
}

export async function bookSlot(
  context: AssistantContext,
  params: { serviceId: string; startsAt: string; durationMinutes?: number; notes?: string },
): Promise<AssistantReply> {
  const text = phrases(context.locale);
  if (!context.userId) return { speech: text.needAccount };

  try {
    const { appointment } = await createAppointment(
      context.organizationId,
      {
        serviceId: params.serviceId,
        startsAt: params.startsAt,
        durationMinutes: params.durationMinutes,
        partySize: 1,
        notes: params.notes,
        source: 'alexa',
      },
      { userId: context.userId, isStaff: false, source: 'alexa', locale: context.locale },
    );

    return {
      speech: text.booked(
        appointment.serviceName,
        formatForHumans(appointment.startsAt, appointment.timezone, context.locale, 'full'),
      ),
      data: { appointmentId: appointment.id, startsAt: appointment.startsAt },
    };
  } catch {
    return { speech: text.bookingFailed };
  }
}

export async function listMyAppointments(context: AssistantContext): Promise<AssistantReply> {
  const text = phrases(context.locale);
  if (!context.userId) return { speech: text.needAccount };

  const result = await listCustomerAppointments({
    customerId: context.userId,
    upcoming: true,
    page: 1,
    pageSize: 5,
  });

  const mine = result.items.filter(
    (appointment) => appointment.organizationId === context.organizationId,
  );
  if (mine.length === 0) return { speech: text.noAppointments };

  return {
    speech: text.appointments(
      mine.map(
        (appointment) =>
          `${appointment.serviceName} el ${formatForHumans(appointment.startsAt, appointment.timezone, context.locale, 'short')}`,
      ),
    ),
    data: mine.map((appointment) => ({
      id: appointment.id,
      serviceName: appointment.serviceName,
      startsAt: appointment.startsAt,
      status: appointment.status,
    })),
  };
}

export async function cancelNextAppointment(
  context: AssistantContext,
  appointmentId?: string,
): Promise<AssistantReply> {
  const text = phrases(context.locale);
  if (!context.userId) return { speech: text.needAccount };

  let target = appointmentId;
  if (!target) {
    const row = await db()
      .selectFrom('appointments')
      .select(['id'])
      .where('organization_id', '=', context.organizationId)
      .where('customer_id', '=', context.userId)
      .where('starts_at', '>=', new Date().toISOString())
      .where('status', 'in', ['pending', 'confirmed'])
      .orderBy('starts_at')
      .executeTakeFirst();
    if (!row) return { speech: text.noAppointments };
    target = row.id;
  }

  const cancelled = await cancelAppointment(target, {
    reason: 'Cancelada por el asistente de voz',
    actor: { userId: context.userId, isStaff: false, source: 'alexa' },
  });

  return {
    speech: text.cancelled(
      formatForHumans(cancelled.startsAt, cancelled.timezone, context.locale, 'short'),
    ),
    data: { appointmentId: cancelled.id },
  };
}
