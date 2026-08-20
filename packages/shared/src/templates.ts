import type { OrganizationSettings } from './schemas/catalog.js';

/**
 * Plantillas de alta por tipo de negocio.
 *
 * La primera hora de uso es donde se pierde a la gente: una organización recién
 * creada está vacía, y hay que inventarse servicios, recursos y horarios antes
 * de poder probar nada. Con una plantilla, el negocio ve su propia agenda
 * funcionando en el primer minuto y solo tiene que corregir lo que no encaje.
 *
 * Están aquí, en el paquete compartido, porque el panel enseña la lista y el
 * backend la aplica: si viviera solo en el servidor habría que pedirla por API
 * para poder pintar cuatro nombres, y si viviera solo en el navegador el alta
 * por API se quedaría sin ellas.
 *
 * Los nombres van en los tres idiomas. Un servicio se guarda con su nombre
 * traducido, así que una plantilla en castellano dentro de una organización en
 * inglés dejaría el catálogo a medias.
 */

export interface TemplateText {
  es: string;
  gl: string;
  en: string;
}

export interface TemplateService {
  name: TemplateText;
  durationMinutes: number;
  priceCents: number;
  capacity?: number;
  /** Duración ajustable entre un mínimo y un máximo, como el alquiler de pistas. */
  flexible?: { min: number; max: number; step: number };
}

export interface TemplateResource {
  name: TemplateText;
  type: 'staff' | 'room' | 'court' | 'seat' | 'equipment' | 'table';
  capacity?: number;
}

export interface TemplateSchedule {
  /** 1 = lunes ... 7 = domingo. */
  weekdays: number[];
  /** Franjas en minutos desde medianoche. */
  ranges: [number, number][];
}

export interface TemplateCreditPack {
  name: TemplateText;
  credits: number;
  priceCents: number;
  validityDays: number;
}

export interface TemplateConsent {
  name: TemplateText;
  text: TemplateText;
}

export interface OrganizationTemplate {
  key: string;
  icon: string;
  label: TemplateText;
  description: TemplateText;
  services: TemplateService[];
  resources: TemplateResource[];
  schedules: TemplateSchedule[];
  settings?: Partial<OrganizationSettings>;
  creditPack?: TemplateCreditPack;
  consent?: TemplateConsent;
}

const MANANA_Y_TARDE: TemplateSchedule[] = [
  { weekdays: [1, 2, 3, 4, 5], ranges: [[9 * 60, 14 * 60], [16 * 60, 20 * 60]] },
  { weekdays: [6], ranges: [[10 * 60, 14 * 60]] },
];

export const ORGANIZATION_TEMPLATES: OrganizationTemplate[] = [
  {
    key: 'hairdresser',
    icon: 'scissors',
    label: { es: 'Peluquería', gl: 'Perrucaría', en: 'Hair salon' },
    description: {
      es: 'Servicios por profesional, con cita y horario partido.',
      gl: 'Servizos por profesional, con cita e horario partido.',
      en: 'Services per professional, by appointment, split opening hours.',
    },
    services: [
      {
        name: { es: 'Corte de pelo', gl: 'Corte de pelo', en: 'Haircut' },
        durationMinutes: 30,
        priceCents: 1500,
      },
      {
        name: { es: 'Corte y barba', gl: 'Corte e barba', en: 'Cut and beard' },
        durationMinutes: 45,
        priceCents: 2200,
      },
      {
        name: { es: 'Tinte', gl: 'Tinte', en: 'Colouring' },
        durationMinutes: 90,
        priceCents: 4500,
      },
      {
        name: { es: 'Peinado', gl: 'Peiteado', en: 'Styling' },
        durationMinutes: 45,
        priceCents: 2500,
      },
    ],
    resources: [
      { name: { es: 'Profesional 1', gl: 'Profesional 1', en: 'Stylist 1' }, type: 'staff' },
      { name: { es: 'Profesional 2', gl: 'Profesional 2', en: 'Stylist 2' }, type: 'staff' },
    ],
    schedules: MANANA_Y_TARDE,
  },

  {
    key: 'barbershop',
    icon: 'scissors',
    label: { es: 'Barbería sin cita', gl: 'Barbaría sen cita', en: 'Walk-in barbershop' },
    description: {
      es: 'Por orden de llegada, con cola de turnos y pantalla de sala.',
      gl: 'Por orde de chegada, con cola de quendas e pantalla de sala.',
      en: 'First come first served, with a ticket queue and a waiting-room screen.',
    },
    services: [
      {
        name: { es: 'Corte', gl: 'Corte', en: 'Cut' },
        durationMinutes: 25,
        priceCents: 1300,
      },
      {
        name: { es: 'Arreglo de barba', gl: 'Arranxo de barba', en: 'Beard trim' },
        durationMinutes: 15,
        priceCents: 900,
      },
    ],
    resources: [
      { name: { es: 'Silla 1', gl: 'Cadeira 1', en: 'Chair 1' }, type: 'seat' },
      { name: { es: 'Silla 2', gl: 'Cadeira 2', en: 'Chair 2' }, type: 'seat' },
    ],
    schedules: [
      { weekdays: [2, 3, 4, 5, 6], ranges: [[10 * 60, 20 * 60]] },
    ],
    settings: { walkInQueueEnabled: true, walkInPublicJoin: true, walkInDefaultMinutes: 20 },
  },

  {
    key: 'gym',
    icon: 'dumbbell',
    label: { es: 'Gimnasio o centro deportivo', gl: 'Ximnasio ou centro deportivo', en: 'Gym' },
    description: {
      es: 'Clases con aforo y bonos de sesiones prepagadas.',
      gl: 'Clases con aforo e bonos de sesións prepagadas.',
      en: 'Classes with capacity and prepaid session passes.',
    },
    services: [
      {
        name: { es: 'Yoga', gl: 'Ioga', en: 'Yoga' },
        durationMinutes: 60,
        priceCents: 900,
        capacity: 12,
      },
      {
        name: { es: 'Ciclo indoor', gl: 'Ciclo indoor', en: 'Indoor cycling' },
        durationMinutes: 45,
        priceCents: 900,
        capacity: 15,
      },
      {
        name: { es: 'Entrenamiento personal', gl: 'Adestramento persoal', en: 'Personal training' },
        durationMinutes: 60,
        priceCents: 3500,
      },
    ],
    resources: [
      { name: { es: 'Sala de clases', gl: 'Sala de clases', en: 'Studio' }, type: 'room', capacity: 15 },
      { name: { es: 'Entrenador', gl: 'Adestrador', en: 'Trainer' }, type: 'staff' },
    ],
    schedules: [
      { weekdays: [1, 2, 3, 4, 5], ranges: [[7 * 60, 22 * 60]] },
      { weekdays: [6], ranges: [[9 * 60, 14 * 60]] },
    ],
    creditPack: {
      name: { es: 'Bono de 10 sesiones', gl: 'Bono de 10 sesións', en: '10-session pass' },
      credits: 10,
      priceCents: 7500,
      validityDays: 365,
    },
  },

  {
    key: 'clinic',
    icon: 'stethoscope',
    label: { es: 'Clínica o consulta', gl: 'Clínica ou consulta', en: 'Clinic' },
    description: {
      es: 'Consultas por profesional, con consentimiento informado al reservar.',
      gl: 'Consultas por profesional, con consentimento informado ao reservar.',
      en: 'Consultations per professional, with an informed consent at booking.',
    },
    services: [
      {
        name: { es: 'Primera consulta', gl: 'Primeira consulta', en: 'First consultation' },
        durationMinutes: 45,
        priceCents: 5000,
      },
      {
        name: { es: 'Revisión', gl: 'Revisión', en: 'Follow-up' },
        durationMinutes: 30,
        priceCents: 3500,
      },
      {
        name: { es: 'Tratamiento', gl: 'Tratamento', en: 'Treatment' },
        durationMinutes: 60,
        priceCents: 6000,
      },
    ],
    resources: [
      { name: { es: 'Consulta 1', gl: 'Consulta 1', en: 'Room 1' }, type: 'room' },
      { name: { es: 'Consulta 2', gl: 'Consulta 2', en: 'Room 2' }, type: 'room' },
    ],
    schedules: MANANA_Y_TARDE,
    settings: { requireVerifiedEmail: true },
    consent: {
      name: {
        es: 'Consentimiento informado',
        gl: 'Consentimento informado',
        en: 'Informed consent',
      },
      text: {
        es: 'Autorizo la realización del tratamiento y el tratamiento de mis datos de salud para esta finalidad. Puedo revocar esta autorización en cualquier momento.\n\n**Revisa este texto con tu asesoría antes de usarlo.**',
        gl: 'Autorizo a realización do tratamento e o tratamento dos meus datos de saúde para esta finalidade. Podo revogar esta autorización en calquera momento.\n\n**Revisa este texto coa túa asesoría antes de usalo.**',
        en: 'I authorise the treatment and the processing of my health data for this purpose. I may withdraw this authorisation at any time.\n\n**Have this text reviewed by your legal advisor before using it.**',
      },
    },
  },

  {
    key: 'courts',
    icon: 'land-plot',
    label: { es: 'Pistas o instalaciones', gl: 'Pistas ou instalacións', en: 'Courts and facilities' },
    description: {
      es: 'Alquiler por horas, con duración ajustable y elección de pista.',
      gl: 'Alugueiro por horas, con duración axustable e elección de pista.',
      en: 'Hourly rental, adjustable duration, the customer picks the court.',
    },
    services: [
      {
        name: { es: 'Alquiler de pista', gl: 'Alugueiro de pista', en: 'Court rental' },
        durationMinutes: 60,
        priceCents: 1200,
        flexible: { min: 60, max: 120, step: 30 },
      },
    ],
    resources: [
      { name: { es: 'Pista 1', gl: 'Pista 1', en: 'Court 1' }, type: 'court' },
      { name: { es: 'Pista 2', gl: 'Pista 2', en: 'Court 2' }, type: 'court' },
      { name: { es: 'Pista 3', gl: 'Pista 3', en: 'Court 3' }, type: 'court' },
    ],
    schedules: [
      { weekdays: [1, 2, 3, 4, 5, 6, 7], ranges: [[8 * 60, 22 * 60]] },
    ],
    settings: { showResourceNames: true },
  },
];

export function findTemplate(key: string): OrganizationTemplate | undefined {
  return ORGANIZATION_TEMPLATES.find((template) => template.key === key);
}

/** El texto en el idioma de la organización, con el castellano de respaldo. */
export function templateText(text: TemplateText, locale: string): string {
  return text[locale.slice(0, 2) as keyof TemplateText] ?? text.es;
}
