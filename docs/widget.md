# Widget de reserva

Muchos establecimientos ya tienen su página y no van a mandar a su clientela a
otro dominio. El widget mete la pantalla de reserva dentro de la web del
negocio, con dos líneas de HTML.

El código listo para copiar está en **Panel → Integraciones → Reserva en tu web**.

## Cómo se pone

```html
<script src="https://citas.ejemplo.es/widget.js"
        data-slug="peluqueria-ejemplo"
        data-height="720"
        defer></script>
```

El marco aparece donde esté la etiqueta. Con `data-selector="#reservas"` se
coloca dentro del elemento que se indique, que es lo que hace falta en los
gestores de contenido que agrupan los scripts al final de la página.

| Atributo | Para qué |
| --- | --- |
| `data-slug` | La dirección pública del negocio. Obligatorio. |
| `data-height` | Alto inicial en píxeles. Después se ajusta solo. |
| `data-selector` | Dónde colocarlo, si no vale el sitio de la etiqueta. |

**El alto se ajusta solo.** La reserva cambia de tamaño en cada paso, y un marco
de alto fijo acaba con una barra de desplazamiento dentro de la página, que es
justo lo que delata a un widget. La pantalla empotrada le manda su alto a la
página que la contiene y el script cambia el del marco.

## Qué se ve dentro

La misma pantalla de reserva de siempre, en `/embed/<slug>`, sin cabecera, sin
menú y sin pie. Se reutiliza a propósito: una pantalla aparte se quedaría atrás
en cada cambio de la reserva.

Lleva el tema del negocio, así que el widget se ve con sus colores y su
tipografía, no con los de la aplicación. Ver [temas](temas.md).

## Enlace directo

Debajo del código hay un enlace directo, `https://citas.ejemplo.es/<slug>`. Es
lo que se manda por WhatsApp o se pone en el perfil de una red social, donde no
se puede pegar HTML.

## Dominios permitidos

Por defecto **cualquier página puede empotrar la reserva**. Es una decisión
consciente: la página de reservas es pública igualmente, y exigir configurar una
lista solo consigue que el widget salga en blanco y nadie sepa por qué.

Quien quiera restringirlo pone sus dominios en el mismo sitio, separados por
comas. Entonces la respuesta lleva `Content-Security-Policy: frame-ancestors`
con esa lista y ninguna otra página puede meterla en un marco.

Detalle de implementación que conviene conocer: para `/embed/...` se quita la
cabecera `X-Frame-Options`, que es la antigua y no entiende de listas; dejarla
puesta bloquearía el marco por mucho que la política de seguridad de contenidos
lo permita.
