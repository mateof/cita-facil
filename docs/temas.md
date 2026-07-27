# Temas y aspecto de la página pública

Cada organización decide cómo se ve su página de reservas: colores, tipografía,
formas y, si hace falta, una hoja CSS propia. También qué se lee arriba a la
izquierda, en la cabecera.

Se gestiona en **Panel → Temas**. Hace falta el permiso `settings:write`, que es
el de quien configura el negocio.

## La tabla

Cada fila es un tema de la organización, con una muestra de sus colores y la
fecha del último cambio. El buscador filtra por nombre y descripción, con la
misma búsqueda aproximada que el resto de la aplicación.

Solo hay **un tema en uso** a la vez. Activar otro desactiva el anterior; el que
deja de usarse no se borra, así que volver atrás es un clic. "Volver al aspecto
de serie" deja la página como venía de fábrica sin borrar nada.

Acciones de cada fila: usar, editar, duplicar, exportar y borrar.

## Qué se puede cambiar

| Grupo | Ajustes |
| --- | --- |
| Colores | marca, texto sobre la marca, fondo de la página, fondo de las tarjetas, texto, texto secundario, bordes, éxito, aviso, error, fondo y texto de la cabecera |
| Tipografía | familia (del sistema, con remates, monoespaciada, redondeada), tamaño base, grosor de los títulos, espaciado entre letras |
| Formas | redondeo de tarjetas, botones y campos; grosor de los bordes; sombra; densidad |

Todos se validan: un color mal escrito o una longitud con una unidad inventada
no se guardan, así que un tema no puede dejar la página en blanco.

El catálogo vive en `packages/shared/src/theme.ts`. Añadir un ajuste nuevo es
añadir una entrada a esa lista: el editor lo pinta solo y la validación lo
recoge sola.

## Temas de ejemplo

La aplicación trae seis: **Clásico azul**, **Noche**, **Bosque**, **Coral**,
**Papel** y **Alto contraste**. No se editan en el sitio: se copian con "Partir
de un ejemplo" y se retoca la copia. Así siempre queda un punto de partida
conocido al que volver.

## CSS propio

Para lo que el catálogo no cubra. Se aplica **solo en la página pública** de esa
organización, nunca en el panel: lo que se administra no debería depender del
CSS que el propio negocio haya escrito para su escaparate.

Antes de guardarlo se limpia:

- se quitan `@import` y `@charset`,
- se quitan las `url()` que apunten a **otros servidores**, porque delatarían a
  quién visita la página y cuándo; se permiten `data:` y las imágenes subidas a
  la propia aplicación,
- se quitan `expression()`, `behavior:` y `-moz-binding`, que en navegadores
  viejos ejecutaban código,
- se descartan los comentarios, donde se podía esconder cualquiera de lo
  anterior.

Lo que **no** hace la limpieza es impedir que el negocio se estropee su propia
página: quien escribe el CSS es su responsable y puede ocultar lo que quiera de
su escaparate. Es una decisión consciente al elegir esta opción.

Máximo 20 000 caracteres.

## Marca de la cabecera

Sustituye el nombre de la aplicación en la página pública del negocio:

| Campo | Para qué |
| --- | --- |
| Nombre largo | Lo que se lee en escritorio. En blanco, el nombre de la organización. |
| Nombre corto | Lo que se lee en móvil, donde no cabe el largo. En blanco, la primera palabra del largo. |
| Color, tamaño, grosor, tipografía | El estilo del texto. |
| Enseñar también el logotipo | Añade delante la imagen o el icono de la organización (ver [imágenes e iconos](imagenes.md)). |

Los dos nombres van en el marcado y se enseña uno u otro según el ancho, así que
no parpadea al cargar ni depende de JavaScript.

En la **portada común** (varias organizaciones) y en las pantallas de acceso se
sigue leyendo el nombre de la aplicación: no hay ninguna organización a la que
pertenezcan.

## Compartir un tema

**Exportar** descarga un fichero JSON con el tema. **Importar** admite ese mismo
fichero, venga de esta instalación o de otra.

Los ajustes que no estén en el catálogo de la versión que importa **se
descartan**, en vez de rechazar el fichero entero: un tema exportado por una
versión más nueva sigue sirviendo, con lo que se reconozca.

## Cómo se aplica

El servidor manda el tema ya resuelto en la respuesta pública de la
organización: las variables CSS calculadas, la hoja propia ya limpia y la marca
de la cabecera. El navegador solo tiene que ponerlas en el documento, así que no
necesita saber nada del catálogo.

Mientras hay un tema puesto, el elemento raíz lleva `data-tema`, que enciende
unas reglas puente en `index.css`. La interfaz está escrita con las utilidades
de Tailwind (`bg-white`, `text-slate-900`), que son colores fijos; esas reglas
los reasignan a los del tema solo dentro de las pantallas públicas. Es lo que
evita tener que repasar cada clase de cada pantalla y que la siguiente que se
escriba se olvide del tema.

Al salir de la página pública se quitan las variables, el atributo y la hoja, de
modo que el tema de un negocio no se queda pegado al navegar a otro ni al volver
al panel.

## Endpoints

Todos cuelgan de `/api/v1/organizations/:organizationId`.

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET /themes` | `settings:read` | Temas de la organización. |
| `POST /themes` | `settings:write` | Crear uno. |
| `GET /themes/:id` | `settings:read` | Uno concreto. |
| `PATCH /themes/:id` | `settings:write` | Modificarlo. |
| `DELETE /themes/:id` | `settings:write` | Borrarlo. |
| `POST /themes/:id/activate` | `settings:write` | Ponerlo en uso. |
| `POST /themes/deactivate` | `settings:write` | Volver al aspecto de serie. |
| `GET /themes/:id/export` | `settings:read` | Fichero de intercambio. |
| `POST /themes/import` | `settings:write` | Crear uno desde un fichero. |
| `POST /themes/presets/:preset` | `settings:write` | Copiar un ejemplo. |

El tema en uso viaja además en `GET /api/v1/public/organizations/:slug`, que es
de donde lo lee la página pública.
