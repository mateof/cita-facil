import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.ts';
import gl from './locales/gl.ts';
import en from './locales/en.ts';

/**
 * Internacionalización.
 *
 * El español es a la vez el idioma por defecto y el de respaldo: si falta una
 * clave en gallego o en inglés se muestra la española en lugar de la clave en
 * crudo, que es lo peor que le puede pasar a una interfaz.
 */
export const SUPPORTED_LOCALES = ['es', 'gl', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<AppLocale, string> = {
  es: 'Español',
  gl: 'Galego',
  en: 'English',
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      gl: { translation: gl },
      en: { translation: en },
    },
    fallbackLng: 'es',
    supportedLngs: [...SUPPORTED_LOCALES],
    // `es-ES` y `es-AR` comparten diccionario; solo importa el idioma base.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'cf_locale',
      caches: ['localStorage'],
    },
  });

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

/** Etiqueta BCP-47 para `Intl`, que necesita región para formatear bien. */
export function intlLocale(locale: string): string {
  switch (locale.slice(0, 2)) {
    case 'gl':
      return 'gl-ES';
    case 'en':
      return 'en-GB';
    default:
      return 'es-ES';
  }
}

export default i18n;
