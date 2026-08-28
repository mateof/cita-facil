import { useSyncExternalStore } from 'react';
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
 *
 * Encima del almacenamiento hay una suscripción porque quien lo lee es la
 * cabecera, que no se vuelve a pintar por sí sola: escribir en `sessionStorage`
 * no avisa a nadie, y sin este aviso la marca del negocio se quedaba una
 * navegación por detrás de lo que decía el resto de la pantalla.
 */

const CLAVE = 'cita-facil:organizacion';

type Aviso = () => void;
const suscriptores = new Set<Aviso>();

function leerDelAlmacen(): string | null {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    // Modo privado o almacenamiento lleno: se sigue sin recordar nada.
    return null;
  }
}

let actual: string | null = leerDelAlmacen();

function anunciar(): void {
  for (const aviso of suscriptores) aviso();
}

export function rememberOrganization(slug: string): void {
  if (!slug || isReservedSlug(slug) || slug === actual) return;
  actual = slug;
  try {
    sessionStorage.setItem(CLAVE, slug);
  } catch {
    // Se recuerda solo mientras dure esta carga de la página.
  }
  anunciar();
}

export function rememberedOrganization(): string | null {
  return actual;
}

/** Se olvida al volver a la portada común, que es de la instalación. */
export function forgetOrganization(): void {
  if (actual === null) return;
  actual = null;
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que hacer: si no se puede escribir, tampoco se pudo guardar.
  }
  anunciar();
}

function suscribir(aviso: Aviso): () => void {
  suscriptores.add(aviso);
  return () => {
    suscriptores.delete(aviso);
  };
}

/** La organización recordada, ya como estado que vuelve a pintar. */
export function useRememberedOrganization(): string | null {
  return useSyncExternalStore(suscribir, rememberedOrganization, () => null);
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

/** Lo mismo, pero como hook: se repinta cuando el negocio recordado cambia. */
export function useOrganizationSlug(pathname: string): string | null {
  const recordada = useRememberedOrganization();
  const primerTramo = pathname.split('/')[1] ?? '';
  if (primerTramo && !isReservedSlug(primerTramo)) return primerTramo;
  return recordada;
}

/**
 * Dónde lleva "Reservar".
 *
 * A la página del negocio en curso, no a la portada de la instalación: la
 * portada es el directorio de todos los establecimientos, y pasar por ella
 * borraba el negocio, así que ir a "Mis citas", volver a "Reservar" y entrar
 * otra vez en "Mis citas" dejaba al cliente con el aspecto genérico.
 */
export function useBookingPath(pathname: string): string {
  const slug = useOrganizationSlug(pathname);
  return slug ? `/${slug}` : '/';
}
