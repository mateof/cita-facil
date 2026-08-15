import { z } from 'zod';
import { MAX_CUSTOM_CSS, THEME_TOKENS } from '../theme.js';
import { colorSchema, idSchema } from './common.js';

/**
 * Validación de un tema.
 *
 * Cada ajuste se valida según su tipo, así que un color mal escrito o una
 * longitud con una unidad inventada no llegan a la base de datos y no pueden
 * dejar la página del negocio en blanco.
 */

/** `12px`, `1.5rem`, `0`, `9999px`, `0.5em`, `100%`. */
const longitudSchema = z
  .string()
  .max(24)
  .regex(/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?$/, 'Longitud no válida (por ejemplo, 12px o 1rem)');

const numeroSchema = z.string().max(8).regex(/^\d+$/, 'Tiene que ser un número');

/** Un ajuste por su tipo, construido a partir del catálogo. */
function esquemaDe(token: (typeof THEME_TOKENS)[number]): z.ZodTypeAny {
  switch (token.kind) {
    case 'color':
      return colorSchema;
    case 'length':
      return longitudSchema;
    case 'number':
      return numeroSchema;
    case 'select':
      return z.enum(token.options as unknown as [string, ...string[]]);
    default:
      return z.string().max(120);
  }
}

export const themeTokensSchema = z
  .object(Object.fromEntries(THEME_TOKENS.map((token) => [token.key, esquemaDe(token).optional()])))
  .strict();

export const themeHeaderSchema = z.object({
  longName: z.string().max(60).nullish(),
  shortName: z.string().max(20).nullish(),
  color: colorSchema.nullish(),
  fontSize: longitudSchema.nullish(),
  weight: numeroSchema.nullish(),
  fontFamily: z.enum(['system', 'serif', 'mono', 'rounded']).nullish(),
  useImage: z.boolean().optional(),
});

export const createThemeSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  description: z.string().max(300).nullish(),
  tokens: themeTokensSchema.default({}),
  /** Hoja propia. Se guarda ya saneada. */
  customCss: z.string().max(MAX_CUSTOM_CSS).nullish(),
  header: themeHeaderSchema.nullish(),
});
export type CreateThemeInput = z.infer<typeof createThemeSchema>;

export const updateThemeSchema = createThemeSchema.partial();
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>;

export const themeSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  tokens: z.record(z.string(), z.string()),
  customCss: z.string().nullable(),
  header: themeHeaderSchema.nullable(),
  /** El que está en uso en la página pública de la organización. */
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});
export type Theme = z.infer<typeof themeSchema>;

/**
 * Fichero de intercambio.
 *
 * Lleva versión porque un tema exportado hoy tiene que poder importarse cuando
 * el catálogo haya crecido; los ajustes que no se reconozcan se descartan al
 * importar en lugar de rechazar el fichero entero.
 */
export const THEME_FILE_VERSION = 1;

export const themeFileSchema = z.object({
  format: z.literal('cita-facil-theme'),
  version: z.number().int().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(300).nullish(),
  tokens: z.record(z.string(), z.string()),
  customCss: z.string().max(MAX_CUSTOM_CSS).nullish(),
  header: themeHeaderSchema.nullish(),
});
export type ThemeFile = z.infer<typeof themeFileSchema>;
