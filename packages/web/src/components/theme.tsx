import { useEffect } from 'react';
import type { ThemeHeader } from '@cita-facil/shared';

/**
 * Aplica el tema de una organización mientras se está en su página.
 *
 * Las variables van al elemento raíz y la hoja propia a un `<style>` que se
 * quita al salir: así el tema de un negocio no se queda pegado al navegar a
 * otro ni al volver al panel, que es donde el personal necesita ver la
 * aplicación tal como es.
 *
 * El CSS llega ya saneado del servidor (sin `@import` ni peticiones a
 * servidores ajenos). Aun así se aplica solo aquí, en el portal público, y
 * nunca en el panel: un CSS puede esconder cualquier cosa de la página, y lo
 * que se administra no debería depender de lo que el propio negocio haya
 * escrito.
 */

export interface AppliedTheme {
  variables: Record<string, string>;
  customCss: string | null;
  header: ThemeHeader | null;
}

const ESTILO_ID = 'tema-de-la-organizacion';

export function useOrganizationTheme(theme: AppliedTheme | null | undefined): void {
  const variables = theme?.variables;
  const customCss = theme?.customCss;

  useEffect(() => {
    if (!variables) return;
    const raiz = document.documentElement;
    for (const [nombre, valor] of Object.entries(variables)) {
      raiz.style.setProperty(nombre, valor);
    }
    // El atributo enciende las reglas puente de `index.css`, que reasignan los
    // colores fijos de las pantallas públicas a los del tema. Se pone aquí y no
    // en el layout para que aparezca y desaparezca con el propio tema.
    raiz.dataset.tema = '1';
    return () => {
      for (const nombre of Object.keys(variables)) raiz.style.removeProperty(nombre);
      delete raiz.dataset.tema;
    };
  }, [variables]);

  useEffect(() => {
    if (!customCss) return;
    const estilo = document.createElement('style');
    estilo.id = ESTILO_ID;
    estilo.textContent = customCss;
    document.head.append(estilo);
    return () => estilo.remove();
  }, [customCss]);
}
