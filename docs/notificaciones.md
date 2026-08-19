# Notificaciones y recordatorios

## Cómo funciona

Todo aviso se guarda como fila en `notifications` antes de intentar entregarse,
con su canal, su destinatario y su momento de envío. El planificador despacha
cada minuto lo que toque.

Eso da tres cosas: los recordatorios programados y los envíos inmediatos
comparten mecanismo, un fallo de red no pierde el mensaje (se reintenta a 1, 5,
15, 60 y 240 minutos) y el panel muestra el historial real de lo enviado a cada
cliente.

## Canales

| Canal | Configuración | Notas |
| --- | --- | --- |
| Correo | `MAIL_TRANSPORT=smtp` y credenciales SMTP | En desarrollo, `json` escribe el mensaje en el log sin enviar nada. |
| Push móvil | `FCM_SERVICE_ACCOUNT_FILE` o `_JSON` | Firebase Cloud Messaging, API HTTP v1. |
| Push web | `WEBPUSH_PUBLIC_KEY` y `WEBPUSH_PRIVATE_KEY` | Para la PWA. Genera el par con `npx web-push generate-vapid-keys`. |
| Telegram | `TELEGRAM_BOT_TOKEN` | El usuario vincula su cuenta enviando un código al bot. |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN` | API oficial de Meta. |
| SMS | Twilio | Opcional y de pago. |

### Telegram

1. Crea un bot con [@BotFather](https://t.me/BotFather) y copia el token.
2. Pon `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_BOT_USERNAME`.
3. Registra el webhook: Panel → Integraciones → Telegram, o
   `POST /organizations/:id/integrations/telegram/register`.
4. El usuario, desde su perfil, pide un código y lo envía al bot. Su chat queda
   vinculado sin necesidad de compartir el teléfono.

### WhatsApp

Limitación del canal, no de esta implementación: fuera de la ventana de 24 horas
desde el último mensaje del usuario, WhatsApp solo permite enviar plantillas
aprobadas previamente por Meta. Los recordatorios deberían usar una plantilla
registrada.

## Recordatorios

Una regla de recordatorio es un desfase en minutos antes del inicio de la cita y
una lista de canales. Así, "cuando el usuario quiera" no necesita ningún caso
especial:

| Desfase | Significado |
| --- | --- |
| `1440` | Un día antes |
| `60` | Una hora antes |
| `15` | Quince minutos antes |
| `10080` | Una semana antes |

Se resuelven en cascada:

1. Reglas del **usuario** (Perfil → Notificaciones).
2. Si no tiene, reglas de la **organización** (Panel → Avisos → Recordatorios).
3. Si tampoco, las de fábrica: un día antes por correo, una hora antes por
   correo y push.

Los recordatorios que caerían en el pasado se descartan: si alguien reserva para
dentro de media hora, no se le manda el aviso "de un día antes".

Al cancelar o mover una cita, los recordatorios pendientes se anulan y, si
procede, se reprograman.

En el recordatorio hay una variable más, `{{acciones}}`: los enlaces de
*Confirmo que voy* y *No puedo ir*. Llega vacía si la organización no pide
confirmación de asistencia, de forma que el aviso no invita a nada que el
negocio no haya activado. Ver [reglas de reserva](reglas-de-reserva.md).

## Eventos

| Evento | Cuándo |
| --- | --- |
| `appointment.created` | Cita creada pendiente de aprobación |
| `appointment.confirmed` | Cita confirmada |
| `appointment.rescheduled` | Cambio de fecha u hora |
| `appointment.cancelled` | Cancelación |
| `appointment.reminder` | Recordatorio programado |
| `appointment.receipt` | Resguardo de cita |
| `appointment.followup` | Petición de valoración tras la visita |
| `appointment.no_show` | Falta sin avisar |
| `appointment.fee_charged` | Cargo por falta o por avisar fuera de plazo |
| `appointment.approval_required` | Aviso al personal de una cita por aprobar |
| `waitlist.slot_available` | Se ha liberado un hueco de la lista de espera |
| `payment.succeeded` / `failed` / `refunded` | Cobros |
| `auth.verify_email`, `auth.reset_password`, `auth.mfa_code`, `auth.new_device` | Seguridad |
| `account.welcome` | Alta de cuenta |
| `backup.failed` | Fallo de copia automática |

Los cuatro eventos de seguridad se envían siempre, aunque el usuario haya
desactivado el resto de avisos: un código de verificación no es opcional.

## Plantillas

Vienen integradas en español, gallego e inglés, y se pueden sobrescribir por
organización desde Panel → Avisos → Plantillas.

Variables disponibles, entre dobles llaves:

```
{{usuario}} {{cliente}} {{organizacion}} {{servicio}} {{sede}} {{profesional}}
{{fecha}} {{hora}} {{fechaHora}} {{duracion}} {{precio}}
{{codigo}} {{enlace}} {{motivo}}
```

Ejemplo:

```
Hola {{usuario}}:

Te recordamos tu cita en {{organizacion}}.

Servicio: {{servicio}}
Fecha: {{fechaHora}}
Sede: {{sede}}

Código de acceso: {{codigo}}

Si no puedes acudir, cancélala aquí: {{enlace}}
```

Las plantillas son texto plano. El correo se envuelve en un HTML sobrio
automáticamente, con los enlaces detectados, para que quien edita no tenga que
escribir HTML. Los canales cortos (push, Telegram, WhatsApp, SMS) usan una
variante breve.

Desde el panel se puede enviar una prueba a uno mismo por cualquier canal, y
volver a la plantilla original de un clic.

## Preferencias

Tres niveles, de menor a mayor prioridad:

1. Valores por defecto del sistema.
2. Ajustes de la organización (Panel → Avisos → Preferencias).
3. Ajustes del usuario (Perfil → Notificaciones).

El usuario puede además definir una franja de "no molestar" para los avisos no
urgentes.

## Resguardo y calendario

Cada cita genera:

- Un **PDF** con los datos, el código de acceso y el QR (`/appointments/:id/receipt`).
- Un fichero **`.ics`** para añadirla al calendario del móvil, con recordatorio
  propio una hora antes (`/appointments/:id/ics`).
- Un **QR** suelto para enseñar en la entrada (`/appointments/:id/qr`).

## Comunicados

Panel → Avisos → Comunicado permite un envío puntual a un conjunto de clientes
(todos, los que tienen cita próxima, los de una sede o los de un servicio).
