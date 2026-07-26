import { z } from 'zod';
import { i18nTextSchema, idSchema } from './common.js';

/**
 * Páginas de contenido de la organización: contacto, sobre nosotros y las que
 * se añadan después.
 *
 * El contenido se escribe en Markdown o en HTML y se guarda tal cual. La
 * conversión y, sobre todo, la limpieza del HTML se hacen al pintarlo: guardar
 * el original permite seguir editándolo y cambiar de criterio de saneado sin
 * perder lo escrito.
 */

export const PAGE_KEYS = ['contact', 'about'] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export const PAGE_FORMATS = ['markdown', 'html'] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

export const organizationPageSchema = z.object({
  /** Nulo mientras la página no se ha guardado nunca. */
  id: idSchema.nullable(),
  key: z.enum(PAGE_KEYS),
  format: z.enum(PAGE_FORMATS),
  /** Título por idioma. Si falta, la interfaz usa el nombre por defecto. */
  title: i18nTextSchema.nullable(),
  /** Contenido por idioma, en el formato indicado. */
  body: i18nTextSchema.nullable(),
  /** Publicada: enlazada desde el pie de la página pública. */
  published: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.string().nullable(),
});
export type OrganizationPage = z.infer<typeof organizationPageSchema>;

export const updateOrganizationPageSchema = z.object({
  format: z.enum(PAGE_FORMATS).optional(),
  title: i18nTextSchema.nullable().optional(),
  body: i18nTextSchema.nullable().optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type UpdateOrganizationPageInput = z.infer<typeof updateOrganizationPageSchema>;

/** Lo que ve el público: la página ya resuelta al idioma pedido. */
export const publicPageSchema = z.object({
  key: z.enum(PAGE_KEYS),
  format: z.enum(PAGE_FORMATS),
  title: z.string(),
  body: z.string(),
});
export type PublicPage = z.infer<typeof publicPageSchema>;

/** Entrada del pie de la página pública. */
export const publicPageLinkSchema = z.object({
  key: z.enum(PAGE_KEYS),
  title: z.string(),
});
