# Informes

**Panel → Informes**, con el permiso `report:read`. Todo se calcula sobre
`local_date`, la fecha local que lleva desnormalizada cada cita: agrupando por
el instante UTC, una cita de las 00:30 en Madrid caería en el día anterior.

## Qué hay

| Informe | Qué responde |
| --- | --- |
| Resumen | Citas, ingresos, tasa de cancelación y de faltas, con el periodo anterior al lado. |
| Días | Citas e ingresos de cada día del rango. |
| Servicios | Qué se vende más y cuánto deja. |
| Recursos | Ocupación: minutos reservados frente a minutos de agenda abierta. |
| Reparto por profesional | Lo que factura cada agenda y la comisión que le corresponde. |
| Horas | A qué horas se concentran las citas. |

## La comparativa

El resumen trae el **mismo número de días inmediatamente anterior**. Un número
suelto no dice nada: "1.200 euros" se lee distinto si el periodo anterior
fueron 900 o fueron 1.500.

Se compara con el mismo número de días y no con el mes natural anterior porque
el rango lo elige quien mira, y puede ser de once días. Si en el periodo
anterior no hubo nada, no se pinta variación: un "+100 %" desde cero no informa.

## Comisiones

La comisión se configura **en el recurso** (Panel → Recursos, en los de tipo
personal), en porcentaje y con decimales, porque el 12,5 % es un reparto
perfectamente normal.

Cuelga del recurso y no de la persona porque es la agenda la que factura: las
citas se apuntan a un recurso, hay recursos que no son personas (una sala, una
pista) y hay personas que atienden en dos sitios.

**La comisión se calcula sobre lo cobrado, no sobre lo agendado.** Repartir
dinero que todavía no ha entrado es firmar un pagaré. En el informe van las dos
cifras al lado, facturado y cobrado, para que se vea lo que falta por cobrar.

## Exportar

Cada informe se descarga en CSV desde los botones de arriba, o por API:

```
GET /organizations/:id/reports/export?type=staff&from=2026-03-01&to=2026-03-31
```

`type` admite `daily`, `services`, `resources`, `staff` y `hours`.

El fichero sale pensado para abrirse en Excel con la configuración regional
española: **separador punto y coma**, **decimales con coma** y **marca de orden
de bytes** al principio. Con comas de separador, un importe de "1.234,50"
partiría la fila en dos columnas; sin la marca, los acentos salen rotos.

Los importes se exportan en euros, no en céntimos: es lo que se va a sumar en
la hoja.

## API

```
GET /organizations/:id/reports/summary     Resumen con comparativa
GET /organizations/:id/reports/daily       Serie por día
GET /organizations/:id/reports/services    Servicios más solicitados
GET /organizations/:id/reports/resources   Ocupación por recurso
GET /organizations/:id/reports/staff       Reparto y comisiones
GET /organizations/:id/reports/hours       Distribución por hora
GET /organizations/:id/reports/export      Descarga en CSV
GET /organizations/:id/reports/today       Panel del día
```

Todos aceptan `from`, `to` y `locationId`. Sin rango, los últimos 30 días.
