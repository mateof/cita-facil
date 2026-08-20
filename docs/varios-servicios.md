# Varios servicios en una misma cita

Corte y color, o revisión y limpieza: una sola visita que ocupa la suma de los
dos, la atiende la misma persona y se paga junta. Hasta ahora había que reservar
dos veces seguidas y confiar en que la agenda dejara las horas pegadas.

## Cómo se reserva

Al elegir el día y la hora aparece **"¿Algo más en la misma visita?"** con el
resto de servicios. Lo que se marque se suma antes de calcular los huecos, así
que **solo se ofrecen las horas donde cabe la visita entera**. Ofrecer un hueco
donde solo cabe el primero es peor que no ofrecer ninguno: la siguiente cita se
pisaría.

Desde el API, en la reserva y en la consulta de disponibilidad:

```
GET  /public/organizations/:id/availability?serviceId=A&additionalServiceIds=B&additionalServiceIds=C
POST /organizations/:id/appointments   { "serviceId": "A", "additionalServiceIds": ["B"] }
```

Hasta cinco servicios añadidos.

## Qué no se puede combinar

| No se combina | Por qué |
| --- | --- |
| Servicios de **duración ajustable** | Dos duraciones que el cliente elige no dan una duración única para la visita. |
| Servicios que **exigen bono** | Descuentan una sesión suya; en una cita combinada, una sola visita consumiría saldo de varios sitios. |

Los dos casos se rechazan al consultar la disponibilidad, no al confirmar: es
mejor no ofrecerlo que dejar llegar hasta el final y fallar.

## Quién la atiende

Una sola persona, de principio a fin. Con servicios añadidos, los recursos
candidatos son **los que saben hacerlos todos**: la intersección de los
profesionales asignados a cada servicio. Si nadie los hace todos, ese día sale
cerrado para esa combinación.

## Cómo se guarda

La cita conserva su `service_id`, que sigue siendo el principal, y los añadidos
van en `appointment_services`.

Podría haberse normalizado del todo, moviendo también el primero, pero eso
obligaría a reescribir todas las consultas que hoy hacen `join` con `services`
(agenda, informes, avisos, ficha de cliente, exportaciones) y a mantener dos
formas de leer lo mismo mientras durase la migración. Con el principal donde
estaba, lo que ya funcionaba sigue funcionando y lo nuevo se lee solo cuando
hace falta.

De cada añadido se guardan **su duración y su precio congelados**: el servicio
puede cambiar de tarifa después, y esta cita ya se acordó con estos números.

El detalle de la cita trae siempre `services`, con el principal el primero,
tenga uno o cuatro. Así quien lo lee no tiene que mirar en dos sitios.

## Márgenes

Los márgenes previo y posterior son los del **servicio principal** y se aplican
a la visita entera, no los de cada uno sumados: el tiempo de preparar la sala se
gasta una vez.
