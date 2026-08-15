import { createEvents, type EventAttributes } from 'ics';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { env } from '../../config/env.js';
import { DateTime, formatForHumans } from '../../lib/dates.js';
import { signedAccessCode } from './access.js';
import type { AppointmentDetail } from './queries.js';

/**
 * Documentos de la cita: el resguardo en PDF con su QR, el fichero .ics para
 * añadirla al calendario del móvil y el propio QR suelto para mostrarlo en
 * pantalla al pasar por el control de acceso.
 */

/* -------------------------------------------------------------------------- */
/* Calendario                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Genera un evento iCalendar. Las horas se dan en UTC (`startInputType: 'utc'`)
 * para que el calendario del destinatario las muestre en su zona sin depender
 * de que entienda la nuestra.
 */
export function buildIcs(appointment: AppointmentDetail): string {
  const start = DateTime.fromISO(appointment.startsAt, { zone: 'utc' });
  const end = DateTime.fromISO(appointment.endsAt, { zone: 'utc' });

  const event: EventAttributes = {
    start: [start.year, start.month, start.day, start.hour, start.minute],
    end: [end.year, end.month, end.day, end.hour, end.minute],
    startInputType: 'utc',
    endInputType: 'utc',
    title: `${appointment.serviceName} - ${appointment.organizationName}`,
    description: [
      `Servicio: ${appointment.serviceName}`,
      appointment.resourceName ? `Profesional: ${appointment.resourceName}` : null,
      `Código de acceso: ${appointment.accessCode}`,
      `Gestionar: ${env.APP_URL}/citas/${appointment.id}`,
    ]
      .filter(Boolean)
      .join('\n'),
    location: [appointment.locationName, appointment.locationAddress].filter(Boolean).join(', '),
    url: `${env.APP_URL}/citas/${appointment.id}`,
    status: appointment.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    uid: `${appointment.id}@cita-facil`,
    productId: env.APP_NAME,
    // Recordatorio propio del calendario, además de los que envía la aplicación.
    alarms: [{ action: 'display', trigger: { hours: 1, before: true } }],
  };

  const { error, value } = createEvents([event]);
  if (error || !value) {
    throw error ?? new Error('No se pudo generar el evento de calendario');
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Código QR                                                                   */
/* -------------------------------------------------------------------------- */

/** Contenido del QR: código firmado, para que no se pueda falsificar. */
export function qrPayload(appointment: AppointmentDetail): string {
  return signedAccessCode(appointment.accessCode);
}

export async function buildQrPng(appointment: AppointmentDetail): Promise<Buffer> {
  return QRCode.toBuffer(qrPayload(appointment), {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

/* -------------------------------------------------------------------------- */
/* Resguardo en PDF                                                            */
/* -------------------------------------------------------------------------- */

const LABELS: Record<string, Record<string, string>> = {
  es: {
    receipt: 'Resguardo de cita',
    service: 'Servicio',
    date: 'Fecha y hora',
    duration: 'Duración',
    location: 'Sede',
    staff: 'Profesional',
    customer: 'Cliente',
    price: 'Importe',
    code: 'Código de acceso',
    minutes: 'minutos',
    footer: 'Presenta este resguardo o el código QR al llegar.',
    people: 'Personas',
  },
  gl: {
    receipt: 'Resgardo de cita',
    service: 'Servizo',
    date: 'Data e hora',
    duration: 'Duración',
    location: 'Sede',
    staff: 'Profesional',
    customer: 'Cliente',
    price: 'Importe',
    code: 'Código de acceso',
    minutes: 'minutos',
    footer: 'Presenta este resgardo ou o código QR ao chegar.',
    people: 'Persoas',
  },
  en: {
    receipt: 'Booking receipt',
    service: 'Service',
    date: 'Date and time',
    duration: 'Duration',
    location: 'Location',
    staff: 'Staff',
    customer: 'Customer',
    price: 'Amount',
    code: 'Access code',
    minutes: 'minutes',
    footer: 'Show this receipt or the QR code on arrival.',
    people: 'People',
  },
};

export async function buildReceiptPdf(
  appointment: AppointmentDetail,
  locale = 'es',
): Promise<Buffer> {
  const labels = LABELS[locale] ?? LABELS.es!;
  const qr = await QRCode.toBuffer(qrPayload(appointment), {
    type: 'png',
    width: 320,
    margin: 1,
  });

  const document = new PDFDocument({ size: 'A4', margin: 50, info: { Title: labels.receipt } });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<Buffer>((resolve) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });

  document.fontSize(22).text(appointment.organizationName, { align: 'left' });
  document.moveDown(0.2);
  document.fontSize(14).fillColor('#555').text(labels.receipt!);
  document.moveDown(1);
  document.fillColor('#000');

  const rows: [string, string][] = [
    [labels.service!, appointment.serviceName],
    [labels.date!, formatForHumans(appointment.startsAt, appointment.timezone, locale, 'full')],
    [labels.duration!, `${appointment.durationMinutes} ${labels.minutes}`],
    [
      labels.location!,
      [appointment.locationName, appointment.locationAddress].filter(Boolean).join(' - '),
    ],
  ];
  if (appointment.resourceName) rows.push([labels.staff!, appointment.resourceName]);
  rows.push([labels.customer!, appointment.customerName]);
  if (appointment.partySize > 1) rows.push([labels.people!, String(appointment.partySize)]);
  if (appointment.priceCents > 0) {
    rows.push([
      labels.price!,
      new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'es-ES', {
        style: 'currency',
        currency: appointment.currency,
      }).format(appointment.priceCents / 100),
    ]);
  }

  document.fontSize(11);
  for (const [label, value] of rows) {
    document.fillColor('#666').text(label, { continued: false });
    document.fillColor('#000').fontSize(13).text(value);
    document.fontSize(11).moveDown(0.6);
  }

  document.moveDown(1);
  document.fillColor('#666').fontSize(11).text(labels.code!);
  document.fillColor('#000').fontSize(20).text(appointment.accessCode);

  document.image(qr, document.page.width - 200, 120, { width: 140 });

  document.moveDown(2);
  document.fontSize(9).fillColor('#888').text(labels.footer!, 50, document.page.height - 90, {
    width: document.page.width - 100,
    align: 'center',
  });

  document.end();
  return finished;
}
