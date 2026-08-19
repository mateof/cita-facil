import type { Locale, NotificationChannel, NotificationEvent } from '@cita-facil/shared';

/**
 * Plantillas integradas, en español, gallego e inglés.
 *
 * Van en código y no en base de datos por dos motivos: una instalación recién
 * creada tiene que poder enviar correos sin ejecutar semillas, y así añadir un
 * evento nuevo no requiere migrar datos. La organización puede sobrescribir
 * cualquiera desde el panel; esos cambios sí se guardan en
 * `notification_templates` y tienen prioridad.
 *
 * Variables disponibles entre dobles llaves. Las más habituales:
 *   {{usuario}} {{organizacion}} {{servicio}} {{sede}} {{profesional}}
 *   {{fecha}} {{hora}} {{fechaHora}} {{duracion}} {{precio}}
 *   {{enlace}} {{codigo}} {{motivo}}
 */

export interface TemplateDefinition {
  /** Asunto, solo para correo. */
  subject: Record<Locale, string>;
  /** Cuerpo largo, para correo. */
  body: Record<Locale, string>;
  /** Texto breve para push, Telegram, WhatsApp y SMS. */
  short: Record<Locale, string>;
}

const T = (es: string, gl: string, en: string): Record<Locale, string> => ({ es, gl, en });

export const BUILTIN_TEMPLATES: Record<NotificationEvent, TemplateDefinition> = {
  'appointment.created': {
    subject: T(
      'Cita solicitada: {{servicio}}',
      'Cita solicitada: {{servicio}}',
      'Appointment requested: {{servicio}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nHemos recibido tu solicitud de cita en {{organizacion}}.\n\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nDuración: {{duracion}} minutos\nSede: {{sede}}\n\nPuedes consultarla aquí: {{enlace}}',
      'Ola {{usuario}}:\n\nRecibimos a túa solicitude de cita en {{organizacion}}.\n\nServizo: {{servicio}}\nData: {{fechaHora}}\nDuración: {{duracion}} minutos\nSede: {{sede}}\n\nPodes consultala aquí: {{enlace}}',
      'Hi {{usuario}},\n\nWe have received your booking request at {{organizacion}}.\n\nService: {{servicio}}\nDate: {{fechaHora}}\nDuration: {{duracion}} minutes\nLocation: {{sede}}\n\nView it here: {{enlace}}',
    ),
    short: T(
      'Cita solicitada: {{servicio}} el {{fechaHora}}',
      'Cita solicitada: {{servicio}} o {{fechaHora}}',
      'Appointment requested: {{servicio}} on {{fechaHora}}',
    ),
  },

  'appointment.confirmed': {
    subject: T(
      'Cita confirmada: {{servicio}} el {{fecha}}',
      'Cita confirmada: {{servicio}} o {{fecha}}',
      'Appointment confirmed: {{servicio}} on {{fecha}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTu cita en {{organizacion}} está confirmada.\n\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nDuración: {{duracion}} minutos\nSede: {{sede}}\nProfesional: {{profesional}}\nImporte: {{precio}}\n\nCódigo de acceso: {{codigo}}\n\nGestiona tu cita aquí: {{enlace}}',
      'Ola {{usuario}}:\n\nA túa cita en {{organizacion}} está confirmada.\n\nServizo: {{servicio}}\nData: {{fechaHora}}\nDuración: {{duracion}} minutos\nSede: {{sede}}\nProfesional: {{profesional}}\nImporte: {{precio}}\n\nCódigo de acceso: {{codigo}}\n\nXestiona a túa cita aquí: {{enlace}}',
      'Hi {{usuario}},\n\nYour appointment at {{organizacion}} is confirmed.\n\nService: {{servicio}}\nDate: {{fechaHora}}\nDuration: {{duracion}} minutes\nLocation: {{sede}}\nStaff: {{profesional}}\nAmount: {{precio}}\n\nAccess code: {{codigo}}\n\nManage your booking: {{enlace}}',
    ),
    short: T(
      'Cita confirmada: {{servicio}} el {{fechaHora}} en {{sede}}',
      'Cita confirmada: {{servicio}} o {{fechaHora}} en {{sede}}',
      'Appointment confirmed: {{servicio}} on {{fechaHora}} at {{sede}}',
    ),
  },

  'appointment.rescheduled': {
    subject: T(
      'Cita cambiada de fecha: {{servicio}}',
      'Cita cambiada de data: {{servicio}}',
      'Appointment rescheduled: {{servicio}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTu cita de {{servicio}} en {{organizacion}} se ha movido.\n\nNueva fecha: {{fechaHora}}\nSede: {{sede}}\n{{motivo}}\n\nDetalles: {{enlace}}',
      'Ola {{usuario}}:\n\nA túa cita de {{servicio}} en {{organizacion}} moveuse.\n\nNova data: {{fechaHora}}\nSede: {{sede}}\n{{motivo}}\n\nDetalles: {{enlace}}',
      'Hi {{usuario}},\n\nYour {{servicio}} appointment at {{organizacion}} has been moved.\n\nNew date: {{fechaHora}}\nLocation: {{sede}}\n{{motivo}}\n\nDetails: {{enlace}}',
    ),
    short: T(
      'Tu cita de {{servicio}} pasa al {{fechaHora}}',
      'A túa cita de {{servicio}} pasa ao {{fechaHora}}',
      'Your {{servicio}} appointment moves to {{fechaHora}}',
    ),
  },

  'appointment.cancelled': {
    subject: T(
      'Cita cancelada: {{servicio}} el {{fecha}}',
      'Cita cancelada: {{servicio}} o {{fecha}}',
      'Appointment cancelled: {{servicio}} on {{fecha}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTu cita de {{servicio}} en {{organizacion}} del {{fechaHora}} ha sido cancelada.\n{{motivo}}\n\nPuedes reservar de nuevo cuando quieras: {{enlace}}',
      'Ola {{usuario}}:\n\nA túa cita de {{servicio}} en {{organizacion}} do {{fechaHora}} foi cancelada.\n{{motivo}}\n\nPodes reservar de novo cando queiras: {{enlace}}',
      'Hi {{usuario}},\n\nYour {{servicio}} appointment at {{organizacion}} on {{fechaHora}} has been cancelled.\n{{motivo}}\n\nYou can book again any time: {{enlace}}',
    ),
    short: T(
      'Cita cancelada: {{servicio}} el {{fechaHora}}',
      'Cita cancelada: {{servicio}} o {{fechaHora}}',
      'Appointment cancelled: {{servicio}} on {{fechaHora}}',
    ),
  },

  'appointment.reminder': {
    subject: T(
      'Recordatorio: {{servicio}} el {{fecha}} a las {{hora}}',
      'Recordatorio: {{servicio}} o {{fecha}} ás {{hora}}',
      'Reminder: {{servicio}} on {{fecha}} at {{hora}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTe recordamos tu cita en {{organizacion}}.\n\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nSede: {{sede}}\nProfesional: {{profesional}}\n\nCódigo de acceso: {{codigo}}\n\nSi no puedes acudir, cancélala aquí: {{enlace}}\n{{acciones}}',
      'Ola {{usuario}}:\n\nLembrámosche a túa cita en {{organizacion}}.\n\nServizo: {{servicio}}\nData: {{fechaHora}}\nSede: {{sede}}\nProfesional: {{profesional}}\n\nCódigo de acceso: {{codigo}}\n\nSe non podes acudir, cancélaa aquí: {{enlace}}\n{{acciones}}',
      'Hi {{usuario}},\n\nA reminder of your appointment at {{organizacion}}.\n\nService: {{servicio}}\nDate: {{fechaHora}}\nLocation: {{sede}}\nStaff: {{profesional}}\n\nAccess code: {{codigo}}\n\nCan not make it? Cancel here: {{enlace}}\n{{acciones}}',
    ),
    short: T(
      'Recordatorio: {{servicio}} el {{fechaHora}} en {{sede}}',
      'Recordatorio: {{servicio}} o {{fechaHora}} en {{sede}}',
      'Reminder: {{servicio}} on {{fechaHora}} at {{sede}}',
    ),
  },

  'appointment.receipt': {
    subject: T(
      'Resguardo de tu cita en {{organizacion}}',
      'Resgardo da túa cita en {{organizacion}}',
      'Your booking receipt at {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nAdjuntamos el resguardo de tu cita.\n\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nSede: {{sede}}\nCódigo de acceso: {{codigo}}\n\nPresenta este código o el QR adjunto al llegar.',
      'Ola {{usuario}}:\n\nAdxuntamos o resgardo da túa cita.\n\nServizo: {{servicio}}\nData: {{fechaHora}}\nSede: {{sede}}\nCódigo de acceso: {{codigo}}\n\nPresenta este código ou o QR adxunto ao chegar.',
      'Hi {{usuario}},\n\nHere is your booking receipt.\n\nService: {{servicio}}\nDate: {{fechaHora}}\nLocation: {{sede}}\nAccess code: {{codigo}}\n\nShow this code or the attached QR on arrival.',
    ),
    short: T(
      'Resguardo de cita: {{codigo}} ({{fechaHora}})',
      'Resgardo de cita: {{codigo}} ({{fechaHora}})',
      'Booking receipt: {{codigo}} ({{fechaHora}})',
    ),
  },

  'appointment.followup': {
    subject: T(
      '¿Qué tal ha ido? Valora tu visita a {{organizacion}}',
      'Que tal foi? Valora a túa visita a {{organizacion}}',
      'How did it go? Rate your visit to {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nGracias por tu visita del {{fecha}}. Nos ayudaría mucho saber qué te ha parecido: {{enlace}}',
      'Ola {{usuario}}:\n\nGrazas pola túa visita do {{fecha}}. Axudaríanos moito saber que che pareceu: {{enlace}}',
      'Hi {{usuario}},\n\nThanks for your visit on {{fecha}}. We would love to hear how it went: {{enlace}}',
    ),
    short: T(
      'Valora tu visita a {{organizacion}}: {{enlace}}',
      'Valora a túa visita a {{organizacion}}: {{enlace}}',
      'Rate your visit to {{organizacion}}: {{enlace}}',
    ),
  },

  'appointment.fee_charged': {
    subject: T(
      'Cargo por tu cita del {{fecha}} en {{organizacion}}',
      'Cargo pola túa cita do {{fecha}} en {{organizacion}}',
      'Charge for your {{fecha}} appointment at {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTu cita de {{servicio}} del {{fechaHora}} en {{organizacion}} tiene un cargo de {{importe}} porque no se avisó a tiempo de que no ibas a poder acudir.\n\nEl hueco se quedó sin ocupar. Puedes abonarlo en tu próxima visita.',
      'Ola {{usuario}}:\n\nA túa cita de {{servicio}} do {{fechaHora}} en {{organizacion}} ten un cargo de {{importe}} porque non se avisou a tempo de que non ías poder acudir.\n\nO oco quedou sen ocupar. Podes aboalo na túa próxima visita.',
      'Hi {{usuario}},\n\nYour {{servicio}} appointment on {{fechaHora}} at {{organizacion}} has a {{importe}} charge because we were not told in time that you could not make it.\n\nThe slot went unused. You can settle it on your next visit.',
    ),
    short: T(
      'Cargo de {{importe}} por la cita del {{fechaHora}}',
      'Cargo de {{importe}} pola cita do {{fechaHora}}',
      '{{importe}} charge for the {{fechaHora}} appointment',
    ),
  },

  'appointment.no_show': {
    subject: T(
      'No acudiste a tu cita del {{fecha}}',
      'Non acudiches á túa cita do {{fecha}}',
      'You missed your appointment on {{fecha}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nHemos registrado que no acudiste a tu cita de {{servicio}} del {{fechaHora}} en {{organizacion}}.\n\nSi crees que es un error, ponte en contacto con nosotros.',
      'Ola {{usuario}}:\n\nRexistramos que non acudiches á túa cita de {{servicio}} do {{fechaHora}} en {{organizacion}}.\n\nSe cres que é un erro, ponte en contacto connosco.',
      'Hi {{usuario}},\n\nWe recorded that you did not attend your {{servicio}} appointment on {{fechaHora}} at {{organizacion}}.\n\nIf this is a mistake, please get in touch.',
    ),
    short: T(
      'No constas como asistente a la cita del {{fechaHora}}',
      'Non constas como asistente á cita do {{fechaHora}}',
      'You are marked as absent for the {{fechaHora}} appointment',
    ),
  },

  'appointment.approval_required': {
    subject: T(
      'Nueva cita pendiente de aprobar',
      'Nova cita pendente de aprobar',
      'New appointment awaiting approval',
    ),
    body: T(
      'Hay una nueva solicitud de cita en {{organizacion}}.\n\nCliente: {{cliente}}\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nSede: {{sede}}\n\nRevísala aquí: {{enlace}}',
      'Hai unha nova solicitude de cita en {{organizacion}}.\n\nCliente: {{cliente}}\nServizo: {{servicio}}\nData: {{fechaHora}}\nSede: {{sede}}\n\nRevísaa aquí: {{enlace}}',
      'There is a new booking request at {{organizacion}}.\n\nCustomer: {{cliente}}\nService: {{servicio}}\nDate: {{fechaHora}}\nLocation: {{sede}}\n\nReview it here: {{enlace}}',
    ),
    short: T(
      'Cita pendiente de aprobar: {{servicio}} {{fechaHora}}',
      'Cita pendente de aprobar: {{servicio}} {{fechaHora}}',
      'Appointment awaiting approval: {{servicio}} {{fechaHora}}',
    ),
  },

  'queue.called': {
    subject: T(
      'Te toca: turno {{turno}} en {{organizacion}}',
      'Tócache: quenda {{turno}} en {{organizacion}}',
      'You are up: ticket {{turno}} at {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTe toca. Tu turno, el {{turno}}, está siendo llamado en {{organizacion}}.\n\nAcércate al mostrador.',
      'Ola {{usuario}}:\n\nTócache. A túa quenda, a {{turno}}, está sendo chamada en {{organizacion}}.\n\nAchégate ao mostrador.',
      'Hi {{usuario}},\n\nYou are up. Ticket {{turno}} is being called at {{organizacion}}.\n\nPlease come to the desk.',
    ),
    short: T(
      'Turno {{turno}}: te toca en {{organizacion}}',
      'Quenda {{turno}}: tócache en {{organizacion}}',
      'Ticket {{turno}}: you are up at {{organizacion}}',
    ),
  },

  'waitlist.slot_available': {
    subject: T(
      'Se ha liberado un hueco para {{servicio}}',
      'Liberouse un oco para {{servicio}}',
      'A slot opened up for {{servicio}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nSe ha liberado un hueco que encaja con lo que buscabas.\n\nServicio: {{servicio}}\nFecha: {{fechaHora}}\nSede: {{sede}}\n\nReserva antes de que se ocupe: {{enlace}}',
      'Ola {{usuario}}:\n\nLiberouse un oco que encaixa co que buscabas.\n\nServizo: {{servicio}}\nData: {{fechaHora}}\nSede: {{sede}}\n\nReserva antes de que se ocupe: {{enlace}}',
      'Hi {{usuario}},\n\nA slot matching your request just opened up.\n\nService: {{servicio}}\nDate: {{fechaHora}}\nLocation: {{sede}}\n\nBook before it is taken: {{enlace}}',
    ),
    short: T(
      'Hueco libre: {{servicio}} el {{fechaHora}}. Reserva: {{enlace}}',
      'Oco libre: {{servicio}} o {{fechaHora}}. Reserva: {{enlace}}',
      'Slot available: {{servicio}} on {{fechaHora}}. Book: {{enlace}}',
    ),
  },

  'payment.succeeded': {
    subject: T('Pago recibido', 'Pagamento recibido', 'Payment received'),
    body: T(
      'Hola {{usuario}}:\n\nHemos recibido tu pago de {{precio}} correspondiente a {{servicio}} del {{fechaHora}}.\n\nGracias.',
      'Ola {{usuario}}:\n\nRecibimos o teu pagamento de {{precio}} correspondente a {{servicio}} do {{fechaHora}}.\n\nGrazas.',
      'Hi {{usuario}},\n\nWe received your {{precio}} payment for {{servicio}} on {{fechaHora}}.\n\nThank you.',
    ),
    short: T(
      'Pago de {{precio}} recibido',
      'Pagamento de {{precio}} recibido',
      'Payment of {{precio}} received',
    ),
  },

  'payment.failed': {
    subject: T('No se pudo completar el pago', 'Non se puido completar o pagamento', 'Payment failed'),
    body: T(
      'Hola {{usuario}}:\n\nNo hemos podido cobrar {{precio}} de tu cita de {{servicio}} del {{fechaHora}}.\n\nInténtalo de nuevo aquí: {{enlace}}',
      'Ola {{usuario}}:\n\nNon puidemos cobrar {{precio}} da túa cita de {{servicio}} do {{fechaHora}}.\n\nInténtao de novo aquí: {{enlace}}',
      'Hi {{usuario}},\n\nWe could not charge {{precio}} for your {{servicio}} appointment on {{fechaHora}}.\n\nTry again here: {{enlace}}',
    ),
    short: T('Pago rechazado: {{enlace}}', 'Pagamento rexeitado: {{enlace}}', 'Payment declined: {{enlace}}'),
  },

  'payment.refunded': {
    subject: T('Devolución realizada', 'Devolución realizada', 'Refund issued'),
    body: T(
      'Hola {{usuario}}:\n\nHemos devuelto {{precio}} de tu cita de {{servicio}} del {{fechaHora}}. El abono puede tardar unos días en aparecer en tu cuenta.',
      'Ola {{usuario}}:\n\nDevolvemos {{precio}} da túa cita de {{servicio}} do {{fechaHora}}. O aboamento pode tardar uns días en aparecer na túa conta.',
      'Hi {{usuario}},\n\nWe refunded {{precio}} for your {{servicio}} appointment on {{fechaHora}}. It may take a few days to appear on your statement.',
    ),
    short: T('Devolución de {{precio}}', 'Devolución de {{precio}}', 'Refund of {{precio}}'),
  },

  'auth.verify_email': {
    subject: T('Confirma tu correo', 'Confirma o teu correo', 'Confirm your email'),
    body: T(
      'Hola {{usuario}}:\n\nConfirma tu dirección de correo pulsando aquí: {{enlace}}\n\nEl enlace caduca en 24 horas. Si no has sido tú, ignora este mensaje.',
      'Ola {{usuario}}:\n\nConfirma o teu enderezo de correo premendo aquí: {{enlace}}\n\nA ligazón caduca en 24 horas. Se non fuches ti, ignora esta mensaxe.',
      'Hi {{usuario}},\n\nConfirm your email address here: {{enlace}}\n\nThe link expires in 24 hours. If this was not you, ignore this message.',
    ),
    short: T('Confirma tu correo: {{enlace}}', 'Confirma o teu correo: {{enlace}}', 'Confirm your email: {{enlace}}'),
  },

  'auth.activate_account': {
    subject: T(
      'Activa tu cuenta en {{organizacion}}',
      'Activa a túa conta en {{organizacion}}',
      'Activate your account at {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nSe ha creado una cuenta para ti en {{organizacion}}.\n\nElige tu contraseña y termina el alta aquí: {{enlace}}\n\nEl enlace caduca el {{caducidad}}. Si no lo esperabas, ignora este mensaje.',
      'Ola {{usuario}}:\n\nCreouse unha conta para ti en {{organizacion}}.\n\nEscolle o teu contrasinal e remata a alta aquí: {{enlace}}\n\nA ligazón caduca o {{caducidad}}. Se non o agardabas, ignora esta mensaxe.',
      'Hi {{usuario}},\n\nAn account has been created for you at {{organizacion}}.\n\nChoose your password and finish signing up here: {{enlace}}\n\nThe link expires on {{caducidad}}. If you were not expecting this, ignore this message.',
    ),
    short: T(
      'Activa tu cuenta en {{organizacion}}: {{enlace}}',
      'Activa a túa conta en {{organizacion}}: {{enlace}}',
      'Activate your account at {{organizacion}}: {{enlace}}',
    ),
  },

  'auth.reset_password': {
    subject: T('Restablecer contraseña', 'Restablecer contrasinal', 'Reset your password'),
    body: T(
      'Hola {{usuario}}:\n\nPuedes elegir una contraseña nueva aquí: {{enlace}}\n\nEl enlace caduca en una hora. Si no has pedido este cambio, ignora este mensaje: tu contraseña actual sigue siendo válida.',
      'Ola {{usuario}}:\n\nPodes escoller un contrasinal novo aquí: {{enlace}}\n\nA ligazón caduca nunha hora. Se non pediches este cambio, ignora esta mensaxe: o teu contrasinal actual segue a ser válido.',
      'Hi {{usuario}},\n\nChoose a new password here: {{enlace}}\n\nThe link expires in one hour. If you did not request this, ignore this message: your current password still works.',
    ),
    short: T(
      'Restablecer contraseña: {{enlace}}',
      'Restablecer contrasinal: {{enlace}}',
      'Reset password: {{enlace}}',
    ),
  },

  'auth.mfa_code': {
    subject: T('Tu código de verificación', 'O teu código de verificación', 'Your verification code'),
    body: T(
      'Tu código de verificación es {{codigo}}.\n\nCaduca en 10 minutos. No lo compartas con nadie: {{organizacion}} nunca te lo pedirá por teléfono.',
      'O teu código de verificación é {{codigo}}.\n\nCaduca en 10 minutos. Non o compartas con ninguén: {{organizacion}} nunca cho pedirá por teléfono.',
      'Your verification code is {{codigo}}.\n\nIt expires in 10 minutes. Never share it: {{organizacion}} will never ask for it by phone.',
    ),
    short: T(
      'Código de verificación: {{codigo}}',
      'Código de verificación: {{codigo}}',
      'Verification code: {{codigo}}',
    ),
  },

  'auth.new_device': {
    subject: T(
      'Nuevo inicio de sesión en tu cuenta',
      'Novo inicio de sesión na túa conta',
      'New sign-in to your account',
    ),
    body: T(
      'Hola {{usuario}}:\n\nSe ha iniciado sesión en tu cuenta desde un dispositivo nuevo.\n\nFecha: {{fechaHora}}\nDispositivo: {{dispositivo}}\nIP: {{ip}}\n\nSi no has sido tú, cambia la contraseña y revisa tus sesiones: {{enlace}}',
      'Ola {{usuario}}:\n\nIniciouse sesión na túa conta desde un dispositivo novo.\n\nData: {{fechaHora}}\nDispositivo: {{dispositivo}}\nIP: {{ip}}\n\nSe non fuches ti, cambia o contrasinal e revisa as túas sesións: {{enlace}}',
      'Hi {{usuario}},\n\nSomeone signed in to your account from a new device.\n\nDate: {{fechaHora}}\nDevice: {{dispositivo}}\nIP: {{ip}}\n\nIf this was not you, change your password and review your sessions: {{enlace}}',
    ),
    short: T(
      'Nuevo inicio de sesión desde {{dispositivo}}',
      'Novo inicio de sesión desde {{dispositivo}}',
      'New sign-in from {{dispositivo}}',
    ),
  },

  'account.welcome': {
    subject: T(
      'Te damos la bienvenida a {{organizacion}}',
      'Dámosche a benvida a {{organizacion}}',
      'Welcome to {{organizacion}}',
    ),
    body: T(
      'Hola {{usuario}}:\n\nTu cuenta ya está lista. Desde aquí puedes reservar, consultar y gestionar tus citas: {{enlace}}',
      'Ola {{usuario}}:\n\nA túa conta xa está lista. Desde aquí podes reservar, consultar e xestionar as túas citas: {{enlace}}',
      'Hi {{usuario}},\n\nYour account is ready. From here you can book, review and manage your appointments: {{enlace}}',
    ),
    short: T('Bienvenido a {{organizacion}}', 'Benvido a {{organizacion}}', 'Welcome to {{organizacion}}'),
  },

  'credit.granted': {
    subject: T('Tu bono {{bono}} ya está activo', 'O teu bono {{bono}} xa está activo', 'Your {{bono}} pass is active'),
    body: T(
      'Hola {{usuario}}:\n\nYa tienes disponible el bono {{bono}}, con {{sesiones}} sesiones.\n\nCaduca: {{caducidad}}\n\nCada reserva descuenta una sesión y, si cancelas a tiempo, se te devuelve.',
      'Ola {{usuario}}:\n\nXa tes dispoñible o bono {{bono}}, con {{sesiones}} sesións.\n\nCaduca: {{caducidad}}\n\nCada reserva desconta unha sesión e, se cancelas a tempo, devólvese.',
      'Hi {{usuario}},\n\nYour {{bono}} pass is ready, with {{sesiones}} sessions.\n\nExpires: {{caducidad}}\n\nEach booking uses one session and it is returned if you cancel in time.',
    ),
    short: T(
      'Bono {{bono}} activo: {{sesiones}} sesiones',
      'Bono {{bono}} activo: {{sesiones}} sesións',
      '{{bono}} pass active: {{sesiones}} sessions',
    ),
  },

  'backup.failed': {
    subject: T(
      'Ha fallado la copia de seguridad',
      'Fallou a copia de seguridade',
      'Backup failed',
    ),
    body: T(
      'La copia de seguridad automática de {{fechaHora}} ha fallado.\n\nMotivo: {{motivo}}\n\nRevisa la configuración en el panel de administración.',
      'A copia de seguridade automática do {{fechaHora}} fallou.\n\nMotivo: {{motivo}}\n\nRevisa a configuración no panel de administración.',
      'The scheduled backup on {{fechaHora}} failed.\n\nReason: {{motivo}}\n\nCheck the settings in the admin panel.',
    ),
    short: T('Copia de seguridad fallida', 'Copia de seguridade fallida', 'Backup failed'),
  },
};

/** Canales que usan el texto breve en lugar del cuerpo largo. */
const SHORT_CHANNELS: readonly NotificationChannel[] = ['push', 'sms', 'telegram', 'whatsapp'];

export function builtinTemplate(
  event: NotificationEvent,
  channel: NotificationChannel,
  locale: Locale,
): { subject: string | null; body: string } {
  const definition = BUILTIN_TEMPLATES[event];
  const useShort = SHORT_CHANNELS.includes(channel);
  return {
    subject: channel === 'email' ? definition.subject[locale] : definition.subject[locale],
    body: useShort ? definition.short[locale] : definition.body[locale],
  };
}
