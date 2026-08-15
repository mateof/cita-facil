# Reglas de reserva

Tres cosas que decide cada negocio: cuándo se cobra la sesión de un bono, con
cuánta antelación se puede reservar y cancelar, y qué citas se repiten solas
cada semana.

## Cuándo se descuenta el bono

| Modo | Qué hace |
| --- | --- |
| **Al reservar** | La sesión se descuenta en el momento de reservar. Es lo que ha hecho la aplicación desde el principio. |
| **Al completar** | La sesión se cobra cuando la cita se marca como completada. |

Se configura en **Panel → Ajustes → Reservas** para toda la organización, y cada
servicio puede desviarse en su propio formulario o seguir lo que diga la
organización. Encaja con el caso real de un negocio con clases (la plaza se
ocupa al reservar, así que la sesión también) y tratamientos (que a veces no
llegan a hacerse).

Con **al completar**:

- reservar no descuenta nada, pero sí exige que haya saldo (o permiso para
  deber): dejar reservar a quien no va a poder pagar solo aplaza el problema;
- cancelar antes de la cita no descuenta nada;
- **marcar una falta también cobra la sesión**. La plaza se ocupó igual, y no
  presentarse no puede salir más barato que venir. Es la misma norma que ya
  regía las devoluciones.

## Sesiones a deber

Con **Permitir reservar sin saldo**, quien se queda sin sesiones puede seguir
reservando: la sesión queda anotada como deuda y se descuenta sola en cuanto
entra el siguiente bono, sin que nadie tenga que acordarse en el mostrador.

- El tope lo pone la organización (**Sesiones que se pueden deber**). Al
  llegar a él, ya no se puede reservar hasta comprar.
- **Cancelar la cita anula la deuda** sin cobrarla: la sesión no se prestó.
- Al emitir o comprar un bono se saldan las deudas más antiguas primero, y el
  descuento va condicionado a que quede saldo, así que dos bonos emitidos a la
  vez no pueden pagar la misma deuda.

Lo que se debe se consulta en `GET /credit-debts`.

## Antelación para reservar y plazo para cancelar

Los dos se eligen de una lista legible (una hora, doce horas, un día, dos
días, una semana), no escribiendo minutos.

| Dónde | Qué significa |
| --- | --- |
| Ajustes de la organización | La norma general del negocio. |
| Formulario del servicio | Su propio plazo, o **lo que diga la organización**. |

Hay tres valores distintos y conviene no confundirlos:

- **Heredar**: sigue a la organización.
- **Sin límite** (cero): este servicio no pide antelación, aunque su
  organización sí. Es una decisión explícita y se respeta.
- **Un plazo concreto**: manda sobre el de la organización.

Los servicios que ya existían tenían cero por defecto, no por decisión, así que
la migración los pasó a "heredar". Quien quiera de verdad "sin límite" ahora lo
elige a mano.

Por dentro, "heredar" se guarda como `-1` y no como `NULL`, porque las columnas
nacieron obligatorias y SQLite no permite cambiar eso sin recrear la tabla
entera. La traducción ocurre en los bordes: el API y el panel hablan de `null`.

## Programaciones semanales

**Panel → Programaciones.** Una programación dice "esta persona, este servicio,
los martes a las 19:00" y el sistema va creando la cita de cada semana con
antelación (siete días por defecto) hasta que alguien la para.

No se crean todas las citas de golpe a propósito: una serie cerrada de un año
ocupa la agenda entera, impide que nadie más reserve esas horas y hay que
rehacerla al cambiar cualquier cosa.

**Cancelar un día suelto no lo repone.** Cada fecha procesada queda anotada, así
que si alguien anula la cita del 18, esa fecha ya está registrada y el generador
no vuelve a mirarla.

Si esa semana no hay hueco, el negocio elige qué hacer, por programación:

| Opción | Qué hace |
| --- | --- |
| Saltar esa semana y avisar | No reserva nada y lo deja anotado con su motivo. |
| Reservar el hueco más cercano del día | Prueba la misma hora y, si no, el hueco libre más próximo. |
| Reservar igualmente | Crea la cita aunque no quepa. Rompe la garantía de aforo a propósito: el negocio lo pidió y tendrá que cuadrarlo a mano. |

**Parar** una programación conserva las citas ya creadas y deja de generar las
siguientes. Sobre una ya parada, la acción la quita de la lista.

La generación la ejecuta el planificador cada noche; en el panel hay un botón
para generarla al momento después de cambiar algo.

## Endpoints

Todos cuelgan de `/api/v1/organizations/:organizationId`.

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET /recurring` | `appointment:read` | Programaciones semanales. |
| `POST /recurring` | `appointment:write` | Crear una. Crea ya la cita de esta semana. |
| `GET /recurring/:id` | `appointment:read` | Una, con las últimas fechas procesadas. |
| `DELETE /recurring/:id` | `appointment:write` | La para; sobre una parada, la quita. |
| `POST /recurring/:id/run` | `appointment:write` | Generar ahora lo que falte. |
| `GET /credit-debts` | `credit:read` | Sesiones que se deben. |
| `POST /appointments/:id/cancel-check` | cualquiera | Si todavía se puede cancelar y cuánto queda. |

Las programaciones cuelgan de `/recurring` y no de `/schedules` porque esa
dirección ya la usan los horarios de apertura, que son otra cosa.
