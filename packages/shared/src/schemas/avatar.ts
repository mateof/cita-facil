import { z } from 'zod';
import { ICON_NAME_RE } from '../avatar.js';
import { colorSchema } from './common.js';

/**
 * Campos de imagen, icono y color que comparten todas las entidades que se
 * enseñan en una lista.
 *
 * Van juntos porque el orden de precedencia es común (imagen, icono,
 * iniciales) y separarlos llevaría a que cada entidad admitiera unos cuantos
 * y no otros.
 */

/**
 * Una imagen nuestra (`/api/v1/uploads/...`) o una dirección externa.
 *
 * No vale `z.string().url()` a secas: las imágenes subidas se guardan como ruta
 * relativa para que sigan funcionando si el negocio cambia de dominio.
 */
export const imageUrlSchema = z
  .string()
  .max(500)
  .refine(
    (value) => value.startsWith('/api/v1/uploads/') || /^https?:\/\//.test(value),
    'La imagen tiene que ser una subida a la aplicación o una dirección http(s)',
  );

/** Nombre del icono en la librería, en kebab-case. */
export const iconNameSchema = z
  .string()
  .max(64)
  .regex(ICON_NAME_RE, 'Nombre de icono no válido');

export const avatarFieldsSchema = z.object({
  imageUrl: imageUrlSchema.nullish(),
  icon: iconNameSchema.nullish(),
  color: colorSchema.nullish(),
});
export type AvatarFields = z.infer<typeof avatarFieldsSchema>;
