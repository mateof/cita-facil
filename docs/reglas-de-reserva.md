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

## A qué horas puede empezar cada servicio

La rejilla de inicios (`slotGranularityMinutes`) es de la organización, y una
sola no llega: en el mismo negocio conviven la consulta que se da a cualquier
hora libre, el tratamiento que solo empieza en punto y la clase que es martes y
jueves a las 12:00. Con una rejilla única hay que poner la más fina y confiar en
que nadie reserve a deshora.

Cada servicio elige su modo en **Servicios → Cuándo empieza la cita**:

| Modo | Qué ofrece | Para qué |
| --- | --- | --- |
| **A cualquier hora libre** | La rejilla de la organización | Lo de siempre; es lo que traen los servicios que ya existían |
| **Cada X minutos** | Rejilla propia pegada al reloj, con desfase opcional | "En punto" es 60; "en punto y y media", 30; "a y cuarto y menos cuarto", 30 con desfase 15 |
| **Encadenadas** | La primera al abrir y cada siguiente cuando acaba la anterior | Sesiones cuya duración no cuadra con el reloj |
| **Solo a horas fijas** | Únicamente las horas de la lista, por día de la semana | Clases y grupos: martes y jueves a las 12:00 y a las 16:00 |

Tres cosas que conviene tener claras:

- **La rejilla se ancla a medianoche, no a la apertura.** Es lo que hace que "en
  punto" salga en punto aunque la sede abra a las 9:30. El modo *encadenadas* es
  la excepción a propósito: ahí el ancla es la apertura de cada tramo.
- **Una hora fija no abre nada por su cuenta.** Solo elige entre lo que ya está
  abierto: si la sede cierra a las 14:00, una hora fija a las 16:00 no aparece.
  Para abrir la tarde hay que darle horario al servicio o a la sede.
- **La hora que se alinea es la de la cita, no la del bloque.** Si el servicio
  tiene margen previo, ese margen queda por delante de la hora que ve el
  cliente. Antes se alineaba el bloque, así que un servicio con diez minutos de
  margen ofrecía las 9:10 en vez de las 9:00.

El modo del servicio decide **lo que se ofrece**, no lo que se puede guardar. El
personal sigue pudiendo mover una cita a cualquier minuto libre desde el panel:
`isSlotFree` pide la disponibilidad con granularidad de un minuto, y una rejilla
pedida a mano manda sobre el modo del servicio. Si no, un servicio de horas
fijas no dejaría correr una cita cinco minutos.

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

## Confirmación de asistencia

**Panel → Ajustes → Reservas → Pedir confirmación de asistencia.** Con el ajuste
activo, el recordatorio lleva dos enlaces: *Confirmo que voy* y *No puedo ir*.
Los dos funcionan sin cuenta, porque van con el código de acceso de la cita, que
es el mismo que abre la puerta y que sirve para consultarla.

- **Confirmar** no cambia el estado de la cita: una cita confirmada ya lo
  estaba. Lo que hace es dejar anotado que la persona dijo que iba a venir, y el
  panel lo enseña en la lista de citas. Es lo que ahorra la llamada de
  comprobación de la mañana.
- **Avisar** cancela la cita y libera el hueco, que se ofrece a la lista de
  espera igual que cualquier otra cancelación.

**Avisar se admite siempre, incluso fuera del plazo de cancelación.** Cerrar esa
puerta solo consigue que la gente no avise, y una silla vacía sin aviso es peor
para el negocio que una cancelación tardía: al menos con el aviso hay una
oportunidad de recolocar el hueco. Lo que decide el plazo no es si se admite el
aviso, sino si se cobra.

El enlace del correo abre la pantalla de consulta con la cita ya cargada, pero
**no responde solo**: hay que pulsar el botón. Un cliente de correo que precarga
enlaces cancelaría citas sin que nadie hubiera hecho nada.

## Cargo por falta

Lo que el negocio anota a quien no aparece o avisa fuera de plazo.

| Dónde | Qué significa |
| --- | --- |
| Ajustes de la organización | El cargo general del negocio. Cero, no se cobra nada. |
| Formulario del servicio | En blanco hereda el de la organización; cero es no cobrar faltas en ese servicio aunque la organización sí. |

Se aplica en dos momentos: al marcar la cita como falta (a mano o con el
automatismo de `autoNoShowAfterMinutes`) y al recibir un aviso fuera de plazo.

Dos casos en los que **no** se cobra:

- **La cita ya estaba pagada.** La señal cobrada por adelantado es justamente lo
  que cubre la falta; sumar un cargo encima cobraría dos veces el mismo hueco.
- **La sesión salía de un bono.** Ahí ya rige la norma de los bonos: faltar
  consume la sesión igual que venir. Ver [bonos](bonos.md).

**El cargo se anota, no se cobra solo.** La aplicación no guarda tarjetas, así
que no hay forma de cobrar sin nadie delante. Lo que queda es un importe
pendiente en la cita, visible en el panel y en la [ficha del cliente](clientes.md),
y un aviso a quien faltó. El cobro se hace en la siguiente visita o mandando un
enlace de pago.

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

Y dos endpoints públicos, sin autenticación, que son los de los enlaces del
recordatorio:

| Método y ruta | Qué hace |
| --- | --- |
| `POST /public/appointments/confirm` | Confirma la asistencia a partir del código. |
| `POST /public/appointments/decline` | Avisa de que no se puede ir. Cancela y, fuera de plazo, aplica el cargo. |

Las programaciones cuelgan de `/recurring` y no de `/schedules` porque esa
dirección ya la usan los horarios de apertura, que son otra cosa.
