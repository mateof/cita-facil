import { defaultThemeTokens, type ThemeTokens } from './theme.js';

/**
 * Temas de ejemplo que trae la aplicación.
 *
 * No son de nadie: cualquier organización los ve en su lista y puede copiarlos
 * para retocarlos. No se pueden editar en el sitio a propósito, porque son el
 * punto de partida conocido al que volver cuando un tema propio se ha ido de
 * las manos.
 *
 * Cada uno cambia solo lo que le distingue; el resto sale de los valores por
 * defecto, así que añadir un ajuste nuevo al catálogo no obliga a tocarlos.
 */

export interface ThemePreset {
  key: string;
  /** Nombre visible. Se traduce en el frontend por `admin.themes.presets.<key>`. */
  name: string;
  tokens: ThemeTokens;
}

function preset(key: string, name: string, cambios: ThemeTokens): ThemePreset {
  return { key, name, tokens: { ...defaultThemeTokens(), ...cambios } };
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  preset('classic', 'Clásico azul', {}),

  preset('night', 'Noche', {
    brand: '#60a5fa',
    brandText: '#0b1220',
    background: '#0b1220',
    surface: '#131c31',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    border: '#1e293b',
    headerBackground: '#131c31',
    headerText: '#e2e8f0',
    shadow: 'strong',
  }),

  preset('forest', 'Bosque', {
    brand: '#15803d',
    background: '#f2f7f3',
    surface: '#ffffff',
    text: '#14261a',
    textMuted: '#4b6a56',
    border: '#d5e6da',
    headerBackground: '#14261a',
    headerText: '#f2f7f3',
    radiusCard: '0.5rem',
    radiusButton: '0.375rem',
    radiusInput: '0.375rem',
  }),

  preset('coral', 'Coral', {
    brand: '#e11d48',
    background: '#fff7f6',
    surface: '#ffffff',
    text: '#3f1d24',
    textMuted: '#8b5f68',
    border: '#f7d9dd',
    headerBackground: '#ffffff',
    headerText: '#e11d48',
    radiusCard: '1.5rem',
    radiusButton: '9999px',
    radiusInput: '9999px',
    fontFamily: 'rounded',
    shadow: 'medium',
  }),

  preset('paper', 'Papel', {
    brand: '#1f2937',
    background: '#faf7f0',
    surface: '#fffdf8',
    text: '#1c1917',
    textMuted: '#6b6560',
    border: '#e7ded0',
    headerBackground: '#faf7f0',
    headerText: '#1c1917',
    fontFamily: 'serif',
    radiusCard: '0.25rem',
    radiusButton: '0.25rem',
    radiusInput: '0.25rem',
    shadow: 'none',
    borderWidth: '1px',
  }),

  preset('contrast', 'Alto contraste', {
    brand: '#0000ee',
    background: '#ffffff',
    surface: '#ffffff',
    text: '#000000',
    textMuted: '#1f1f1f',
    border: '#000000',
    headerBackground: '#000000',
    headerText: '#ffffff',
    borderWidth: '2px',
    shadow: 'none',
    fontSizeBase: '17px',
    density: 'comfortable',
  }),
] as const;

export function presetByKey(key: string): ThemePreset | undefined {
  return THEME_PRESETS.find((tema) => tema.key === key);
}
