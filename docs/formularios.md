# Formularios y consentimientos

Dos cosas con la misma forma y distinta intención:

- Un **formulario** pregunta lo que el negocio necesita saber antes de atender:
  alergias, medicación, talla, matrícula del coche.
- Un **consentimiento** enseña un texto y pide una aceptación explícita, con su
  fecha y su firma escrita. Es requisito de entrada en el sector clínico y
  estético.

Se gestionan en **Panel → Servicios → Formularios**, y se enganchan a los
servicios que los piden.

## Son de la organización, no del servicio

La misma hoja de alergias vale para cinco tratamientos. Guardarla dentro de cada
servicio acabaría con cinco versiones distintas de la misma pregunta y con nadie
sabiendo cuál es la buena.

Por eso el formulario se crea una vez y luego se **engancha** a los servicios
que lo exigen, cada uno con sus condiciones:

| Opción | Qué hace |
| --- | --- |
| Obligatorio para reservar | Sin él no se puede reservar por la web. |
| Solo la primera vez | Se pide una vez por persona y no en cada cita. Es lo normal en un consentimiento. |

## Cuándo se pide

**Antes de confirmar la reserva, no después.** Una cita creada a la que le falta
el papel que exige la ley es peor que una reserva que no llega a hacerse, porque
nadie la mira hasta que la persona está en la puerta.

**El mostrador puede saltárselo.** En un centro real el consentimiento se firma
al llegar, con el papel delante; bloquear el alta por teléfono obligaría a
inventarse una aceptación que nadie ha dado. Por eso la comprobación solo aplica
a las reservas que hace el propio cliente.

Quien reserva **sin cuenta** responde siempre, aunque el formulario esté marcado
como "solo la primera vez": no hay a quién atribuirle lo de la vez anterior.

## Qué se guarda

Las respuestas viven en su propia tabla, no dentro de la cita, porque
sobreviven a la cita que las originó: un consentimiento firmado sigue siendo
válido aunque esa cita se cancele, y es justo eso lo que evita volver a pedirlo.

De un consentimiento se guarda **cuándo se aceptó**, **con qué nombre se firmó**
y **desde qué dirección**. Las tres cosas son parte de la prueba.

Todo aparece en la [ficha del cliente](clientes.md), junto a su historial.

**Borrar un formulario que ya tiene respuestas no lo borra: lo desactiva.** Lo
que alguien firmó no puede desaparecer porque el negocio deje de usar esa hoja.
Es la misma norma que rige los tipos de bono.

## Tipos de campo

`Texto`, `Texto largo`, `Número`, `Fecha`, `Lista de opciones` y `Sí o no`. Cada
campo tiene una clave interna que **no debe cambiarse una vez hay respuestas**:
es lo que las relaciona con la pregunta.

El texto de un consentimiento admite Markdown y **se pinta saneado**, como todo
lo que escribe el negocio: un `<script>` en esa caja robaría la sesión de quien
lo lea. Ver [arquitectura](arquitectura.md).

## API

```
GET    /organizations/:id/forms                    Formularios de la organización
POST   /organizations/:id/forms                    Crear
PATCH  /organizations/:id/forms/:id                Cambiar
DELETE /organizations/:id/forms/:id                Borrar (o desactivar si hay respuestas)
GET    /organizations/:id/services/:sid/forms      Qué pide un servicio
PUT    /organizations/:id/services/:sid/forms      Decidir qué pide
GET    /organizations/:id/form-responses           Respuestas recibidas
POST   /organizations/:id/appointments/:id/forms   Responder después
GET    /public/organizations/:id/services/:sid/forms   Lo que hay que responder para reservar
```

Al reservar, las respuestas viajan dentro de `POST /appointments` en el campo
`formResponses`.
