# Turnos (cola sin cita previa)

Hay negocios que trabajan por orden de llegada: barberías, talleres,
ventanillas. Para ellos el problema no es la agenda, es la cola: quién ha
llegado antes, cuánto le queda y a quién le toca ahora.

Se activa en **Panel → Ajustes → Reservas → Cola sin cita previa**, y se
gestiona en **Panel → Turnos**.

## Un turno no es una cita

Es la decisión de fondo, y explica todo lo demás. Una cita ocupa un hueco
concreto y bloquea disponibilidad; un turno no ocupa nada hasta que alguien lo
llama. Guardarlos en la misma tabla habría obligado a inventar una hora falsa
para cada llegada y a que el motor de disponibilidad la contara como ocupada.

Cuando el turno se atiende sí se puede dejar constancia como cita, para que el
histórico del cliente y los informes sigan saliendo de un solo sitio.

## El número de turno

Es un contador que empieza en 1 cada día y por sede. Ordenar por la hora de
llegada habría bastado para saber a quién le toca, pero el número es lo que se
canta en la sala y lo que la gente compara entre sí, así que tiene que existir
de verdad y no calcularse en cada pantalla.

Dos personas apuntadas en el mismo segundo podrían llevarse el mismo número. Se
acepta a propósito: la alternativa (una tabla de contadores con su bloqueo) es
mucha máquina para una cola de mostrador, y un número repetido se resuelve
llamando por el nombre.

## La espera estimada

Los minutos que dura lo que vienen a hacer los que están delante, repartidos
entre los profesionales activos de la sede. Si no se sabe a qué viene alguien,
se usan los minutos por turno de los ajustes (20 por defecto).

No promete una hora, orienta. Es lo que permite decirle a alguien "vuelve en
media hora" en lugar de tenerlo de pie en la puerta.

## Cómo se usa

| Acción | Dónde |
| --- | --- |
| Apuntar a quien llega | Panel → Turnos → Apuntar a alguien |
| Llamar al siguiente | Botón "Llamar al siguiente"; avisa a quien dejó contacto |
| Marcar que se está atendiendo | Botón en el turno llamado |
| Cerrar el turno | "Terminado", o "Se ha ido" si no apareció |
| Pantalla de sala | Panel → Turnos → Pantalla de sala, o `/<slug>/turnos` |

**El cliente puede coger turno desde la web** si el negocio lo activa. Ve su
número y cuánto le queda, y el navegador recuerda su turno, así que puede cerrar
la página y volver más tarde.

Una misma persona con cuenta no puede tener dos turnos abiertos: apuntarse dos
veces no adelanta el sitio de nadie y descuadra la espera de los demás.

## El aviso

Al llamar a alguien se le manda el evento `queue.called` por sus canales
habituales. Es la mitad del valor de la cola: la gente se va a dar una vuelta y
vuelve cuando le avisan. Quien no dejó contacto no recibe nada y se le canta el
número en la sala.

## La pantalla de sala

`/<slug>/turnos`, sin sesión y sin menús: está pensada para una televisión
colgada en la pared y mirada desde cuatro metros. Enseña a quién se está
llamando y los cinco siguientes.

**Solo el número y el nombre de pila.** Una pantalla en la pared la ve todo el
mundo, incluido quien pasa por la calle.

## API

```
GET   /organizations/:id/queue            Cola del día
POST  /organizations/:id/queue            Apuntar a alguien
POST  /organizations/:id/queue/next       Llamar al siguiente
PATCH /organizations/:id/queue/:id        Cambiar el estado de un turno

POST  /public/organizations/:id/queue             Coger turno desde la web
GET   /public/organizations/:id/queue/:entryId    Consultar el propio turno
GET   /public/organizations/:id/queue-display     Pantalla de sala
```
