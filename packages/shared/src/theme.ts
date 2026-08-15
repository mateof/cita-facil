/**
 * Temas de una organización.
 *
 * Un tema es un puñado de valores con nombre (colores, tipografía, formas) que
 * se traducen a variables CSS, más una hoja CSS propia para lo que el catálogo
 * no cubra. El catálogo vive aquí, en el paquete compartido, porque lo usan los
 * tres: el backend para validar, el editor para pintar los campos y el portal
 * para aplicarlos. Añadir un ajuste nuevo es añadir una entrada a esta lista.
 */

export type ThemeTokenKind = 'color' | 'length' | 'number' | 'text' | 'select';

export interface ThemeTokenDef {
  /** Clave con la que se guarda, en camelCase. */
  key: string;
  /** Variable CSS que acaba en el documento. */
  cssVar: string;
  kind: ThemeTokenKind;
  /** Grupo con el que se agrupa en el editor. */
  group: 'color' | 'text' | 'shape';
  default: string;
  /** Solo en `select`. */
  options?: readonly string[];
}

/**
 * Catálogo de ajustes.
 *
 * Los nombres visibles no están aquí: se traducen en el frontend por su clave
 * (`admin.themes.tokens.<key>`), porque este paquete no sabe de idiomas.
 */
export const THEME_TOKENS: readonly ThemeTokenDef[] = [
  /* ------------------------------------------------------------- colores */
  { key: 'brand', cssVar: '--brand', kind: 'color', group: 'color', default: '#2563eb' },
  { key: 'brandText', cssVar: '--brand-text', kind: 'color', group: 'color', default: '#ffffff' },
  { key: 'background', cssVar: '--tema-fondo', kind: 'color', group: 'color', default: '#f6f7f9' },
  { key: 'surface', cssVar: '--tema-superficie', kind: 'color', group: 'color', default: '#ffffff' },
  { key: 'text', cssVar: '--tema-texto', kind: 'color', group: 'color', default: '#0f172a' },
  { key: 'textMuted', cssVar: '--tema-texto-suave', kind: 'color', group: 'color', default: '#64748b' },
  { key: 'border', cssVar: '--tema-borde', kind: 'color', group: 'color', default: '#e5e7eb' },
  { key: 'success', cssVar: '--tema-exito', kind: 'color', group: 'color', default: '#16a34a' },
  { key: 'warning', cssVar: '--tema-aviso', kind: 'color', group: 'color', default: '#d97706' },
  { key: 'danger', cssVar: '--tema-error', kind: 'color', group: 'color', default: '#dc2626' },
  {
    key: 'headerBackground',
    cssVar: '--tema-cabecera-fondo',
    kind: 'color',
    group: 'color',
    default: '#ffffff',
  },
  {
    key: 'headerText',
    cssVar: '--tema-cabecera-texto',
    kind: 'color',
    group: 'color',
    default: '#0f172a',
  },

  /* ---------------------------------------------------------- tipografía */
  {
    key: 'fontFamily',
    cssVar: '--tema-fuente',
    kind: 'select',
    group: 'text',
    default: 'system',
    options: ['system', 'serif', 'mono', 'rounded'],
  },
  { key: 'fontSizeBase', cssVar: '--tema-tamano-base', kind: 'length', group: 'text', default: '16px' },
  {
    key: 'headingWeight',
    cssVar: '--tema-peso-titulos',
    kind: 'number',
    group: 'text',
    default: '700',
  },
  {
    key: 'letterSpacing',
    cssVar: '--tema-espaciado-letras',
    kind: 'length',
    group: 'text',
    default: '0em',
  },

  /* --------------------------------------------------------------- formas */
  { key: 'radiusCard', cssVar: '--tema-radio-tarjeta', kind: 'length', group: 'shape', default: '1rem' },
  { key: 'radiusButton', cssVar: '--tema-radio-boton', kind: 'length', group: 'shape', default: '0.75rem' },
  { key: 'radiusInput', cssVar: '--tema-radio-campo', kind: 'length', group: 'shape', default: '0.75rem' },
  { key: 'borderWidth', cssVar: '--tema-grosor-borde', kind: 'length', group: 'shape', default: '1px' },
  {
    key: 'shadow',
    cssVar: '--tema-sombra',
    kind: 'select',
    group: 'shape',
    default: 'soft',
    options: ['none', 'soft', 'medium', 'strong'],
  },
  {
    key: 'density',
    cssVar: '--tema-densidad',
    kind: 'select',
    group: 'shape',
    default: 'normal',
    options: ['compact', 'normal', 'comfortable'],
  },
] as const;

export type ThemeTokens = Record<string, string>;

/** Familias tipográficas admitidas, resueltas a una pila real de fuentes. */
export const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
};

const SHADOWS: Record<string, string> = {
  none: 'none',
  soft: '0 1px 2px rgb(15 23 42 / 0.06), 0 1px 3px rgb(15 23 42 / 0.1)',
  medium: '0 4px 6px -1px rgb(15 23 42 / 0.1), 0 2px 4px -2px rgb(15 23 42 / 0.1)',
  strong: '0 10px 15px -3px rgb(15 23 42 / 0.15), 0 4px 6px -4px rgb(15 23 42 / 0.1)',
};

const DENSITIES: Record<string, string> = {
  compact: '0.8',
  normal: '1',
  comfortable: '1.15',
};

/** Los valores por defecto, que son también el tema base. */
export function defaultThemeTokens(): ThemeTokens {
  return Object.fromEntries(THEME_TOKENS.map((token) => [token.key, token.default]));
}

/**
 * Traduce el tema a variables CSS listas para poner en el documento.
 *
 * Los ajustes de tipo `select` no se guardan como valor CSS sino como nombre
 * (`serif`, `soft`), y es aquí donde se convierten: así el valor guardado sigue
 * siendo legible y se puede cambiar la pila de fuentes sin migrar los temas.
 */
export function themeToCssVariables(tokens: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const token of THEME_TOKENS) {
    const valor = tokens[token.key] ?? token.default;
    if (token.key === 'fontFamily') {
      variables[token.cssVar] = FONT_STACKS[valor] ?? FONT_STACKS.system!;
    } else if (token.key === 'shadow') {
      variables[token.cssVar] = SHADOWS[valor] ?? SHADOWS.soft!;
    } else if (token.key === 'density') {
      variables[token.cssVar] = DENSITIES[valor] ?? DENSITIES.normal!;
    } else {
      variables[token.cssVar] = valor;
    }
  }

  return variables;
}

/* -------------------------------------------------------------------------- */
/* Hoja CSS propia                                                             */
/* -------------------------------------------------------------------------- */

export const MAX_CUSTOM_CSS = 20_000;

/**
 * Limpia la hoja CSS que escribe el negocio.
 *
 * No pretende impedir que se estropee su propia página: quien la escribe es la
 * dueña del negocio y puede dejarla como quiera. Lo que sí quita son las dos
 * cosas que afectan a terceros:
 *
 * - **peticiones a servidores ajenos** (`@import`, `url(https://...)`), que
 *   filtrarían a quién visita la página y cuándo, sin que el cliente lo sepa;
 * - **restos de sintaxis peligrosa heredada** (`expression()`, `behavior:`,
 *   `javascript:`), que en navegadores viejos ejecutaban código.
 *
 * Se permiten `url(data:...)` y las imágenes subidas a la propia aplicación,
 * que no salen fuera.
 */
export function sanitizeCustomCss(css: string): string {
  let limpio = css.slice(0, MAX_CUSTOM_CSS);

  // Comentarios fuera: dentro se puede esconder cualquiera de lo anterior.
  limpio = limpio.replace(/\/\*[\s\S]*?\*\//g, '');

  limpio = limpio.replace(/@import[^;]*;?/gi, '');
  limpio = limpio.replace(/@charset[^;]*;?/gi, '');
  limpio = limpio.replace(/expression\s*\(/gi, '(');
  limpio = limpio.replace(/behavior\s*:/gi, '');
  limpio = limpio.replace(/-moz-binding\s*:/gi, '');

  // `url(...)`: solo se dejan pasar las de datos y las propias.
  limpio = limpio.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (entero, _comilla, destino) => {
    const valor = String(destino).trim();
    if (valor.startsWith('data:image/')) return entero;
    if (valor.startsWith('/api/v1/uploads/')) return entero;
    return 'none';
  });

  return limpio.trim();
}

/* -------------------------------------------------------------------------- */
/* Marca de la cabecera                                                        */
/* -------------------------------------------------------------------------- */

export type ThemeFontFamily = 'system' | 'serif' | 'mono' | 'rounded';

export interface ThemeHeader {
  /** Lo que se lee en escritorio. Vacío = el nombre de la organización. */
  longName?: string | null;
  /** Lo que se lee en móvil, donde no cabe el largo. */
  shortName?: string | null;
  color?: string | null;
  /** Tamaño en la cabecera, en unidades CSS. */
  fontSize?: string | null;
  weight?: string | null;
  /** Familia del catálogo. */
  fontFamily?: ThemeFontFamily | null;
  /** Se enseña la imagen del negocio en vez del texto. */
  useImage?: boolean;
}

/** Qué se lee en la cabecera según el ancho, con los respaldos aplicados. */
export function headerLabels(
  header: ThemeHeader | null | undefined,
  organizationName: string,
): { long: string; short: string } {
  const largo = header?.longName?.trim() || organizationName;
  const corto = header?.shortName?.trim() || acortar(largo);
  return { long: largo, short: corto };
}

/** Primera palabra, o las iniciales si son varias y largas. */
function acortar(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/);
  if (palabras.length === 1) return palabras[0]!.slice(0, 12);
  const primera = palabras[0]!;
  return primera.length <= 12 ? primera : primera.slice(0, 12);
}
