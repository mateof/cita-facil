/**
 * Representación visual de una entidad: imagen, icono o iniciales.
 *
 * Lo usan las organizaciones, las sedes, los servicios, los recursos, las
 * categorías, los tipos de bono y las personas. La regla es la misma en todas
 * y está aquí para que no se implemente distinto en cada pantalla:
 *
 * 1. si hay **imagen**, se enseña la imagen;
 * 2. si no, el **icono** elegido sobre el color;
 * 3. y si tampoco, las **iniciales** del nombre sobre el color.
 *
 * Las iniciales no se guardan en ninguna parte: se calculan del nombre. El
 * color, cuando no se elige, también sale del nombre, así que dos entidades
 * distintas se ven distintas sin que nadie configure nada.
 */

export interface Avatar {
  /** Ruta servida por el propio API (`/api/v1/uploads/...`), no una URL externa. */
  imageUrl?: string | null;
  /** Nombre del icono en la librería, en kebab-case: `scissors`, `dumbbell`. */
  icon?: string | null;
  /** Color de fondo en `#rrggbb`. Sin él se calcula a partir del nombre. */
  color?: string | null;
}

/**
 * Paleta de respaldo.
 *
 * Colores oscuros a propósito: el texto y el icono van siempre en blanco
 * encima, y así el contraste no depende de cuál toque.
 */
export const AVATAR_COLORS = [
  '#1f6feb',
  '#8250df',
  '#bf3989',
  '#cf222e',
  '#bc4c00',
  '#9a6700',
  '#1a7f37',
  '#0f766e',
  '#0969da',
  '#553098',
] as const;

/**
 * Iniciales de un nombre, como máximo dos.
 *
 * "Peluquería Ejemplo" da "PE", "Corte de pelo" da "CP" (las preposiciones no
 * cuentan) y "Sede" da "SE", porque una sola letra en un círculo se lee peor
 * que dos.
 */
export function initialsOf(name: string): string {
  const palabras = name
    .trim()
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0 && !CONECTORES.has(palabra.toLowerCase()));

  if (palabras.length === 0) return '?';
  if (palabras.length === 1) {
    const palabra = palabras[0]!;
    return palabra.slice(0, 2).toUpperCase();
  }
  return (palabras[0]![0]! + palabras[1]![0]!).toUpperCase();
}

/** Palabras que no aportan nada a unas iniciales. */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'da', 'do', 'of', 'the']);

/**
 * Color estable para un nombre: el mismo texto da siempre el mismo color, en
 * el servidor y en el navegador, hoy y dentro de un año.
 */
export function colorFor(name: string): string {
  let acumulado = 0;
  for (let i = 0; i < name.length; i += 1) {
    acumulado = (acumulado * 31 + name.charCodeAt(i)) % 1_000_003;
  }
  return AVATAR_COLORS[acumulado % AVATAR_COLORS.length]!;
}

/** Qué hay que pintar para esta entidad, ya resuelto. */
export type AvatarRendering =
  | { kind: 'image'; url: string }
  | { kind: 'icon'; icon: string; color: string }
  | { kind: 'initials'; initials: string; color: string };

export function resolveAvatar(name: string, avatar: Avatar | null | undefined): AvatarRendering {
  const color = avatar?.color || colorFor(name);
  if (avatar?.imageUrl) return { kind: 'image', url: avatar.imageUrl };
  if (avatar?.icon) return { kind: 'icon', icon: avatar.icon, color };
  return { kind: 'initials', initials: initialsOf(name), color };
}

/**
 * Nombre de icono admitido: minúsculas, números y guiones.
 *
 * No se comprueba contra la lista de la librería porque el catálogo cambia con
 * cada versión y un icono que desaparezca no debe impedir guardar el resto de
 * la entidad; al pintarlo, si no existe se cae a las iniciales.
 */
export const ICON_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
