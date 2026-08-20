import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db } from '../db/index.js';

/**
 * Widget de reserva para la web del negocio.
 *
 * Muchos establecimientos ya tienen su página y no van a mandar a su clientela
 * a otro dominio. El widget es un `iframe` a la propia pantalla de reserva, con
 * un script de cuatro líneas que lo coloca y le ajusta el alto.
 *
 * Se sirve **sin prefijo de API**: la etiqueta `<script>` la escribe alguien a
 * mano en el gestor de contenidos de su web, y `/widget.js` se copia bien y
 * `/api/v1/widget.js` no.
 *
 * El iframe apunta a `/embed/<slug>`, que es la misma aplicación de siempre sin
 * cabecera ni menús. Reutilizar la pantalla de reserva y no escribir otra es lo
 * que evita que el widget se quede atrás en cada cambio.
 */
const widgetRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/widget.js',
    { schema: { hide: true } },
    async (request, reply) => {
      const { slug = '', selector = '', height = '700' } = request.query as Record<string, string>;

      const script = `(function () {
  'use strict';

  // El script se puede incluir con parámetros en la URL o con atributos data-*
  // en la propia etiqueta: la primera forma es la que se copia y pega, la
  // segunda la que usa quien ya sabe lo que hace.
  var actual = document.currentScript;
  var datos = actual ? actual.dataset : {};
  var slug = datos.slug || ${JSON.stringify(slug)};
  var selector = datos.selector || ${JSON.stringify(selector)};
  var alto = parseInt(datos.height || ${JSON.stringify(height)}, 10) || 700;

  if (!slug) return;

  var destino = selector ? document.querySelector(selector) : null;
  var marco = document.createElement('iframe');
  marco.src = ${JSON.stringify(env.APP_URL)} + '/embed/' + encodeURIComponent(slug);
  marco.title = 'Reserva de cita';
  marco.loading = 'lazy';
  marco.style.width = '100%';
  marco.style.border = '0';
  marco.style.height = alto + 'px';
  marco.setAttribute('allowtransparency', 'true');

  if (destino) {
    destino.appendChild(marco);
  } else if (actual && actual.parentNode) {
    actual.parentNode.insertBefore(marco, actual);
  } else {
    document.body.appendChild(marco);
  }

  // La reserva cambia de alto en cada paso; sin esto, el marco se queda con
  // scroll propio dentro de la página, que es lo que hace que un widget se note.
  window.addEventListener('message', function (evento) {
    if (evento.source !== marco.contentWindow) return;
    var dato = evento.data;
    if (!dato || dato.type !== 'citafacil:height') return;
    var altura = parseInt(dato.height, 10);
    if (altura > 0) marco.style.height = altura + 'px';
  });
})();
`;

      return reply
        .header('content-type', 'application/javascript; charset=utf-8')
        .header('cache-control', 'public, max-age=600')
        .send(script);
    },
  );

  /**
   * Dominios donde el negocio permite empotrar su reserva.
   *
   * Se sirve aparte para que el hook de cabeceras no tenga que conocer el
   * catálogo: le basta con preguntar aquí.
   */
  app.get(
    '/widget/:slug/origins',
    {
      schema: {
        hide: true,
        params: z.object({ slug: z.string().min(1) }),
      },
    },
    async (request) => ({ origins: await embedOrigins((request.params as { slug: string }).slug) }),
  );
};

/** Orígenes permitidos de una organización. Vacío significa cualquiera. */
export async function embedOrigins(slug: string): Promise<string[]> {
  const row = await db()
    .selectFrom('organizations')
    .select(['settings_json'])
    .where('slug', '=', slug.toLowerCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row?.settings_json) return [];

  try {
    const settings = JSON.parse(row.settings_json) as { embedOrigins?: string[] };
    return settings.embedOrigins ?? [];
  } catch {
    return [];
  }
}

export default widgetRoutes;
