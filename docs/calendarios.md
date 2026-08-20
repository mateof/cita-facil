# Calendario del profesional

La agenda del negocio y la vida de quien atiende no viven en el mismo sitio, y
por eso se pisan. Esto conecta las dos, en los dos sentidos, desde
**Panel → Recursos**, en la ficha de cada agenda.

No se usa OAuth con Google ni con Microsoft a propósito. Una dirección `.ics` la
da cualquier calendario (Google, Outlook, Apple, Nextcloud) sin registrar una
aplicación, sin secretos que rotar y sin depender de que el negocio tenga cuenta
en ningún sitio concreto.

## Hacia fuera: ver la agenda en el móvil

Se crea una dirección `.ics` suscribible con las citas de esa agenda, para
verlas en el calendario del teléfono junto a todo lo demás.

**El secreto va en la propia dirección.** Los clientes de calendario no saben
iniciar sesión: piden la URL y ya está. Por eso:

- quien tenga la dirección ve las citas de esa agenda, así que se comparte con
  cuidado;
- **cambiarla es lo único que anula la anterior**. No hay sesión que cerrar.

Publica las citas de los últimos siete días y los próximos noventa. Las citas
pendientes de aprobar salen como tentativas, que es lo que hace que el
calendario las pinte distinto.

## Hacia dentro: no reservar donde ya hay algo

Se pega la dirección `.ics` del calendario personal del profesional y su
ocupación se importa como ausencias. El hueco en el que esa persona tiene el
médico deja de ofrecerse, que es la causa número uno de doble reserva.

- Se importa cada **quince minutos**, y hay un botón para hacerlo al momento.
- Se guardan **noventa días** hacia adelante.
- **El asunto del evento no se guarda**: en la agenda del negocio no pinta nada
  que alguien vaya al dentista. La ausencia se anota como "Calendario personal".
- Lo importado se reemplaza entero en cada pasada y **no toca las ausencias que
  puso alguien a mano**.
- Quitar la dirección borra lo importado: dejar bloqueos de un calendario que ya
  no se consulta significa perder huecos por un motivo que nadie puede revisar.

### Qué se entiende del calendario

Lo que hace falta para saber cuándo está ocupada una persona, no el formato
entero:

| Sí | No |
| --- | --- |
| Eventos con hora, en UTC o con zona horaria | Repeticiones mensuales o anuales |
| Eventos de día completo | Excepciones a una repetición (`EXDATE`) |
| Repeticiones diarias y semanales, con intervalo, fin y días de la semana | Cambios sobre una repetición concreta |
| Eventos marcados como "disponible", que **no** bloquean | Zonas horarias definidas dentro del propio fichero |
| Eventos cancelados, que tampoco bloquean | |

Una cita suelta y una reunión semanal, que es el 95 % de un calendario personal,
entran bien.

## Seguridad de la dirección externa

El servidor va a pedir esa dirección, así que un `http://localhost:6379` o un
`http://169.254.169.254` la convertirían en una ventana a la red interna. Se
admite solo `http` y `https` (y `webcal://`, que se trata como `https`) y se
rechazan los nombres que apuntan a la propia máquina o a rangos privados.

No cubre un DNS que resuelva a una dirección interna: eso hay que atajarlo en la
capa de red. Es la misma línea que ya se traza al validar el certificado de
Alexa, comprobar lo que se puede comprobar sin montar un proxy.

La descarga tiene un tope de dos megas y quince segundos.

## API

```
GET  /public/calendar/:token.ics                          Agenda suscribible
POST /organizations/:id/resources/:rid/calendar-token     Crear o rotar la dirección
PUT  /organizations/:id/resources/:rid/calendar           Guardar (o quitar) el calendario externo
POST /organizations/:id/resources/:rid/calendar/sync      Importar ahora
```

Los tres últimos piden `resource:write`.
