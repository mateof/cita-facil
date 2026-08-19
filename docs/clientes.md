# Clientes

La pantalla del mostrador: quién viene, qué ha reservado, qué ha gastado,
cuántas veces ha faltado y qué se anotó sobre esa persona. Está en
**Panel → Clientes** y la ve quien tenga el permiso `customer:read`.

## Quién es cliente

No hay una tabla de clientes. Lo es quien cumple alguna de estas tres cosas en
la organización:

- ha reservado alguna vez,
- tiene un bono, emitido o comprado,
- alguien del centro le ha puesto una nota o una etiqueta.

**Quien reserva sin cuenta no tiene ficha.** Sus datos viven en la propia cita
(`guest_name`, `guest_email`) y no hay a quién agregarlos: la misma persona
dejando dos veces su nombre son dos citas sueltas, no un historial. Se
encuentran en Panel → Citas.

La lista no sale de la organización. La misma cuenta puede ser clienta de la
peluquería y del gimnasio, y ninguno de los dos ve lo del otro, que es la misma
regla de privacidad que ya rige la búsqueda de personas.

## Qué cifras se enseñan y de dónde salen

Todas se calculan al vuelo sobre las tablas de siempre. No hay contadores que
mantener, así que no pueden desviarse del histórico.

| Cifra | Cómo se calcula |
| --- | --- |
| Citas | Las que ocuparon agenda: pendientes, confirmadas, atendidas, completadas y faltas. Ni bloqueos temporales ni cancelaciones. |
| Completadas | Citas en estado `completed`. |
| Canceladas | Citas en estado `cancelled`. |
| Faltas | Citas en estado `no_show`. |
| Última visita | La cita pasada más reciente a la que no faltó. Una falta no es una visita. |
| Próxima cita | La primera cita futura que sigue en pie. |
| Gasto | Citas con el pago marcado como cobrado, más las compras de bono cobradas, menos las devoluciones. |
| Sesiones | Saldo de los bonos vivos: ni anulados ni caducados. |
| Deuda | Sesiones a deber pendientes de saldar. Ver [bonos](bonos.md). |

El gasto **no cuenta las citas pagadas con bono**. Ese dinero entró al comprar
el bono, y sumarlo en los dos sitios doblaría el gasto de quien compra series de
sesiones.

## Notas y etiquetas

Es lo único que se guarda de verdad en la ficha, y es lo único que no existía en
ninguna otra parte.

- **Notas internas**: texto libre del mostrador. No se le enseñan nunca al
  cliente, ni en su portal ni en los avisos.
- **Etiquetas**: palabras cortas con las que el negocio agrupa gente (`vip`,
  `alergia tinte`, `viene con la niña`). Sirven para filtrar la lista.

Las dos cosas son por organización y hacen falta el permiso `customer:write`
para tocarlas, que en los roles de fábrica tienen responsable, administrador y
propietario. El personal de mostrador las lee pero no las cambia.

## Filtros

| Filtro | Para qué sirve |
| --- | --- |
| Búsqueda | Nombre, correo o teléfono, tolerando acentos y erratas: "pena" encuentra a "Peña". |
| Etiqueta | Solo quien la tenga puesta. |
| Sin venir desde hace | Quien no pisa el negocio desde N días y tampoco tiene cita por delante. Es la lista para recuperar clientela. |
| Orden | Por nombre, por última visita, por número de citas o por gasto. |

Cuando se busca por texto manda el orden por parecido, no el de la lista: quien
escribe "peña" espera ver a Peña arriba.

## Límite de tamaño

La búsqueda aproximada se hace en JavaScript, no en SQL, porque los cinco
motores soportados no comparten función de similitud (ver
[arquitectura](arquitectura.md)). Se traen hasta 2000 clientes de la
organización y se ordenan en memoria. Un negocio con más sigue funcionando: lo
que se pierde es la tolerancia a erratas de los que queden fuera de ese
conjunto, que se siguen encontrando escribiendo bien el nombre.

## API

```
GET   /organizations/:id/customers          Listado con cifras y filtros
GET   /organizations/:id/customer-tags      Etiquetas en uso
GET   /organizations/:id/customers/:userId  Ficha completa
PATCH /organizations/:id/customers/:userId  Notas y etiquetas
```

La ficha comprueba que esa persona es clienta de la organización antes de
responder. Sin esa comprobación sería una forma de leer el nombre y el teléfono
de cualquier cuenta de la instalación probando identificadores.
