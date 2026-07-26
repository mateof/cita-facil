import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Convierte a HTML seguro el contenido que escribe el establecimiento.
 *
 * El saneado no es opcional. El token de sesión vive en memoria del navegador,
 * así que un `<script>` colado en la página de contacto de una organización se
 * llevaría la sesión de cualquiera que la visite, incluida la de un cliente de
 * otra organización de la misma instalación. Por eso se limpia siempre, aunque
 * el contenido lo haya escrito personal del propio negocio.
 *
 * Se usa DOMPurify en lugar de una limpieza a mano a propósito: escribir un
 * saneador de HTML correcto es de las cosas que casi nadie acierta, y las
 * formas de evadirlo se descubren cada año.
 */

/** Etiquetas admitidas: lo que hace falta para una página de contacto o de presentación. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'small', 'sub', 'sup',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'span', 'div', 'section', 'article', 'figure', 'figcaption',
];

const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'width', 'height', 'colspan', 'rowspan', 'lang'];

let hookInstalled = false;

/**
 * Los enlaces salen en una pestaña nueva y sin acceso al `window` de origen.
 * Sin `noopener`, la página de destino puede redirigir la nuestra.
 */
function installHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hookInstalled = true;
}

export function renderRichText(body: string, format: 'markdown' | 'html'): string {
  if (!body.trim()) return '';
  installHook();

  const html = format === 'markdown' ? (marked.parse(body, { async: false }) as string) : body;

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Nada de `javascript:` ni `data:` en enlaces o imágenes.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|geo:|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  });
}
