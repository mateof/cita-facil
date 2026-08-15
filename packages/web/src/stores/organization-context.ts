import { isReservedSlug } from '@cita-facil/shared';

/**
 * Desde qué negocio se está navegando.
 *
 * El portal de cliente comparte pantallas entre todas las organizaciones: "Mis
 * citas", "Mis bonos" y "Perfil" no llevan el negocio en la dirección. Sin
 * recordarlo, quien entra por `citafacil.com/peluqueria` y pulsa "Mis citas"
 * pierde de golpe el aspecto y el nombre del sitio en el que creía estar.
 *
 * Se guarda en `sessionStorage` y no en el estado de React porque tiene que
 * sobrevivir a una recarga (volver de la pasarela de pago, abrir un enlace del
 * correo), pero no a cerrar la pestaña: en la siguiente visita el contexto lo
 * marca la dirección por la que se entre.
 */

const CLAVE = 'cita-facil:organizacion';

export function rememberOrganization(slug: string): void {
  if (!slug || isReservedSlug(slug)) return;
  try {
    sessionStorage.setItem(CLAVE, slug);
  } catch {
    // Modo privado o almacenamiento lleno: se sigue sin recordar nada.
  }
}

export function rememberedOrganization(): string | null {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

/** Se olvida al volver a la portada común, que es de la instalación. */
export function forgetOrganization(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que hacer: si no se puede escribir, tampoco se pudo guardar.
  }
}

/**
 * Organización a la que pertenece la pantalla actual.
 *
 * Si la dirección lleva el negocio por delante, manda esa; si no (las pantallas
 * comunes del portal), la última por la que se entró.
 */
export function organizationFromPath(pathname: string): string | null {
  const primerTramo = pathname.split('/')[1] ?? '';
  if (primerTramo && !isReservedSlug(primerTramo)) return primerTramo;
  return rememberedOrganization();
}
