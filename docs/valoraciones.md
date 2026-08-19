# Valoraciones

Tras completar una cita, la aplicación le pide al cliente que valore la visita
del 1 al 5 con un comentario opcional. Este documento explica qué se hace con
eso: cómo se modera y cómo llega a la página pública del negocio.

## Los dos ajustes que lo gobiernan

Están en **Panel → Ajustes → Reservas**, y los dos son decisiones del negocio,
no de la instalación.

| Ajuste | De fábrica | Qué hace |
| --- | --- | --- |
| Pedir valoración tras la cita | Activado | Manda el aviso `appointment.followup` unas horas después de la visita. |
| Enseñar las valoraciones en la página pública | **Desactivado** | Publica la nota media y las reseñas en `/<slug>`. |
| Aprobar antes de publicar | **Activado** | Las valoraciones nuevas esperan a que alguien las apruebe. |

Publicar está apagado de fábrica a propósito: sacar los comentarios de la
clientela a la calle es una decisión comercial y no puede pasar solo porque se
actualice la aplicación. Mientras esté apagado, el endpoint público devuelve
vacío aunque haya cientos de valoraciones recogidas.

Aprobar está encendido por lo contrario: una reseña es texto escrito por un
tercero que acaba en la página del negocio, y que pase por delante de alguien
antes es lo prudente. Quien prefiera publicar sin filtro lo desactiva.

## Moderar

**Panel → Citas → Valoraciones**, con el permiso `review:moderate`, que en los
roles de fábrica tienen responsable, administrador y propietario.

Cada valoración se publica u oculta por separado, no en bloque: lo que se
publica lleva el nombre del negocio al lado. **Ocultar no borra nada**: la
valoración se sigue contando en el panel y aparece en la
[ficha del cliente](clientes.md), simplemente no sale fuera.

También se puede **responder**. La respuesta aparece debajo de la reseña en la
página pública, que es lo que convierte una queja en una conversación.

## Cómo se ven en público

En `/<slug>`, mientras se elige servicio:

- la **nota media** del negocio con el número de valoraciones,
- las **últimas diez reseñas** publicadas, con su respuesta si la tiene,
- y la **nota de cada servicio** junto a su nombre en la lista.

No se pinta nada si no hay ninguna valoración publicada. Una sección que dice
"todavía no hay opiniones" resta más de lo que informa.

### Cómo se firma una reseña

Con el **nombre de pila y la inicial del primer apellido**: "Lucía P.". Ni el
nombre completo, que en un pueblo señala a una persona concreta, ni "Anónimo",
que le quita todo el valor a la reseña. El recorte lo hace el servidor, así que
el navegador nunca llega a recibir el nombre entero.

## API

```
GET   /public/organizations/:id/reviews     Nota media, reparto y reseñas publicadas
GET   /organizations/:id/reviews            Todas, incluidas las que faltan por aprobar
PATCH /organizations/:id/reviews/:id        Publicar, ocultar o responder
POST  /organizations/:id/appointments/:id/review   Valorar una cita completada
```

El endpoint público admite `serviceId` y `resourceId` para filtrar, que es lo
que permite enseñar la nota de un profesional concreto en su ficha.
