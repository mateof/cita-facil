import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

let transporter: Transporter | null = null;

/**
 * Transporte de correo. En desarrollo, `MAIL_TRANSPORT=json` no envía nada:
 * escribe el mensaje en el log. Así se puede probar todo el flujo de avisos
 * (incluidos los enlaces de verificación) sin configurar un SMTP.
 */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (env.MAIL_TRANSPORT === 'smtp') {
    if (!env.SMTP_HOST) throw new Error('Falta SMTP_HOST para el transporte de correo');
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      pool: true,
      maxConnections: 3,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Cabeceras para agrupar hilos y permitir la baja en un clic. */
  headers?: Record<string, string>;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.MAIL_ENABLED || env.MAIL_TRANSPORT === 'none') {
    logger.debug({ to: message.to, subject: message.subject }, 'Correo desactivado; no se envía');
    return;
  }

  const info = await getTransporter().sendMail({
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? textToHtml(message.text),
    attachments: message.attachments,
    headers: message.headers,
  });

  if (env.MAIL_TRANSPORT === 'json') {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'Correo simulado (MAIL_TRANSPORT=json)',
    );
  } else {
    logger.debug({ to: message.to, messageId: info.messageId }, 'Correo enviado');
  }
}

/**
 * Envoltura HTML sobria. Se genera desde el texto plano para que la plantilla
 * que edita el administrador siga siendo texto y no tenga que escribir HTML.
 */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb">$1</a>',
  );

  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;line-height:1.6">
${paragraphs}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
<p style="margin:0;font-size:12px;color:#666">${env.APP_NAME}</p>
</div></body></html>`;
}

export async function verifyEmailTransport(): Promise<boolean> {
  if (env.MAIL_TRANSPORT !== 'smtp') return true;
  try {
    await getTransporter().verify();
    return true;
  } catch (error) {
    logger.error({ err: error }, 'No se pudo verificar el servidor SMTP');
    return false;
  }
}

export function resetEmailTransport(): void {
  transporter = null;
}
