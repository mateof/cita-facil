import { z } from 'zod';
import { LOCALES } from '../enums.js';
import { isValidTimezone } from '../time.js';

export const idSchema = z.string().min(1).max(64);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: YYYY-MM-DD');

export const isoInstantSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, 'Zona horaria IANA no reconocida');

export const localeSchema = z.enum(LOCALES);

/** Minutos desde medianoche. 1440 se admite como fin de jornada. */
export const minuteOfDaySchema = z.number().int().min(0).max(1440);

export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Código ISO 4217 en mayúsculas')
  .default('EUR');

export const moneySchema = z.number().int().min(0).max(100_000_000);

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

/**
 * Nombres que no puede tener una organización.
 *
 * Cada organización vive en la raíz (`/peluqueria`, `/gimnasio`), así que su
 * dirección compite con las pantallas de la aplicación y con lo que sirve el
 * servidor. Una organización llamada "admin" dejaría el panel inaccesible.
 *
 * Aquí solo están las de primer nivel: `/citas/:id` reserva `citas`, pero
 * `/peluqueria/contacto` no choca con nada porque cuelga del propio slug.
 */
export const RESERVED_SLUGS = [
  // Pantallas de la aplicación.
  'activar',
  'admin',
  'citas',
  'consultar',
  'entrar',
  // `invitacion` y `pago` todavía no tienen pantalla, pero el API ya manda esas
  // direcciones por correo y como retorno de la pasarela.
  'invitacion',
  'mis-bonos',
  'mis-citas',
  'nueva-contrasena',
  'pago',
  'perfil',
  'recuperar',
  'registro',
  'reservar',
  'verificar-correo',
  // Servidor y ficheros estáticos.
  'api',
  'assets',
  'docs',
  'health',
  'favicon',
  'manifest',
  'robots',
  'sw',
  'workbox',
] as const;

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase());
}

/** Slug de organización: además del formato, no puede ser un nombre reservado. */
export const organizationSlugSchema = slugSchema.refine((value) => !isReservedSlug(value), {
  message: 'Esa dirección está reservada por la aplicación. Elige otra.',
});

export const emailSchema = z.string().email().max(255).toLowerCase().trim();

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]{6,24}$/, 'Teléfono no válido')
  .transform((value) => value.replace(/[^\d+]/g, ''));

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color hexadecimal esperado');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function pagedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });
}

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });

/** Texto multiidioma opcional: `{ es: '...', gl: '...', en: '...' }`. */
export const i18nTextSchema = z.record(localeSchema, z.string().max(2000));
export type I18nText = z.infer<typeof i18nTextSchema>;

/** Devuelve el texto en el idioma pedido con degradación a español y luego a cualquiera. */
export function pickI18n(
  text: I18nText | null | undefined,
  locale: string,
  fallback = '',
): string {
  if (!text) return fallback;
  const record = text as Record<string, string | undefined>;
  return record[locale] ?? record.es ?? Object.values(record).find(Boolean) ?? fallback;
}
