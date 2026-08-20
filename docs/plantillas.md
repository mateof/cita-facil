# Plantillas de alta

Una organización recién creada está vacía: para probar una reserva hay que
inventarse antes un servicio, un recurso y un horario. La primera hora de uso es
donde se pierde a la gente, así que al crear un negocio se puede elegir el tipo
y quedarse con todo eso ya puesto.

Se elige en el alta, tanto en el primer arranque del panel como en
**Panel → Organizaciones → Nueva**. También se puede aplicar después con
`POST /organizations/:id/apply-template`, **mientras la organización no tenga
servicios**: aplicarla dos veces duplicaría el catálogo, y sobre un negocio en
marcha metería servicios que nadie pidió.

## Las que hay

| Plantilla | Qué deja puesto |
| --- | --- |
| **Peluquería** | Corte, corte y barba, tinte y peinado; dos profesionales; horario partido de lunes a viernes y sábado por la mañana. |
| **Barbería sin cita** | Corte y arreglo de barba; dos sillas; horario continuo de martes a sábado; **cola de turnos encendida**, con la opción de coger turno desde la web. |
| **Gimnasio** | Yoga y ciclo con aforo, entrenamiento personal; sala y entrenador; horario de 7 a 22; **un bono de diez sesiones** a la venta. |
| **Clínica** | Primera consulta, revisión y tratamiento; dos consultas; **un consentimiento informado** enganchado a los tres servicios, que se firma una sola vez por persona. |
| **Pistas** | Alquiler con duración ajustable de 60 a 120 minutos; tres pistas que el cliente elige; abierto todos los días de 8 a 22. |

Y siempre está la opción de **empezar en blanco**, que va la primera: quien ya
sabe lo que quiere no tiene que esquivar cuatro tarjetas.

## Lo que hay que revisar después

Una plantilla es un punto de partida, no una configuración terminada:

- **Los precios son de ejemplo.** Nadie cobra 15 euros por un corte en todas
  partes.
- **El horario es el típico del sector**, no el del negocio.
- **El consentimiento de la clínica lleva un texto de muestra** con un aviso
  dentro: hay que revisarlo con una asesoría antes de usarlo. Un consentimiento
  informado tiene consecuencias legales y no puede salir de una plantilla
  genérica.

## Dónde vive el catálogo

En `packages/shared/src/templates.ts`, no en el backend. El panel enseña la
lista y el servidor la aplica: si viviera solo en el servidor habría que pedirla
por API para pintar cuatro nombres, y si viviera solo en el navegador el alta
por API se quedaría sin ella.

Los nombres van en los tres idiomas y el servicio se crea con su nombre
traducido, porque el catálogo se enseña en el idioma del visitante, no en el de
quien dio de alta el negocio.

Añadir una plantilla es añadir un objeto a esa lista. No hay migración ni
despliegue especial: es contenido.
