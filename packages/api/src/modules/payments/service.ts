import type { Locale, PaymentProvider, PaymentSettings } from '@cita-facil/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../lib/errors.js';
import { getSetting, setSetting } from '../settings/service.js';
import { notify } from '../notifications/service.js';
import { dispatchWebhook } from '../integrations/webhooks.js';
import { requireAppointmentDetail } from '../appointments/queries.js';
import { grantPack } from '../credits/service.js';
import { appointmentVars } from '../appointments/reminders.js';
import {
  buildOrderNumber,
  buildRedsysForm,
  languageCode,
  parseRedsysNotification,
  type RedsysConfig,
} from './redsys.js';
import { createCheckoutSession, createRefund, verifyStripeSignature } from './stripe.js';

/**
 * Cobros.
 *
 * Cada organización configura su propia pasarela: una peluquería puede cobrar
 * con Stripe y el polideportivo de al lado con Redsys, en la misma instalación.
 * Si la organización no tiene configuración propia se usan las variables de
 * entorno globales, que es lo habitual en una instalación de un solo negocio.
 */

const NAMESPACE = 'payments';

export async function getPaymentSettings(organizationId: string): Promise<PaymentSettings> {
  const stored = await getSetting<PaymentSettings | null>(organizationId, NAMESPACE, 'config', null);
  if (stored) return stored;

  return {
    enabled: env.PAYMENTS_ENABLED,
    defaultProvider: env.PAYMENTS_DEFAULT_PROVIDER,
    stripe: {
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    },
    redsys: {
      merchantCode: env.REDSYS_MERCHANT_CODE,
      terminal: env.REDSYS_TERMINAL,
      secretKey: env.REDSYS_SECRET_KEY,
      environment: env.REDSYS_ENVIRONMENT,
    },
  };
}

export async function savePaymentSettings(
  organizationId: string,
  settings: PaymentSettings,
): Promise<void> {
  await setSetting(organizationId, NAMESPACE, 'config', settings, { secret: true });
}

/** Vista sin secretos, para el panel. */
export async function describePaymentSettings(organizationId: string) {
  const settings = await getPaymentSettings(organizationId);
  return {
    enabled: settings.enabled,
    defaultProvider: settings.defaultProvider,
    stripe: {
      configured: Boolean(settings.stripe?.secretKey),
      publishableKey: settings.stripe?.publishableKey ?? null,
      webhookConfigured: Boolean(settings.stripe?.webhookSecret),
    },
    redsys: {
      configured: Boolean(settings.redsys?.secretKey && settings.redsys?.merchantCode),
      merchantCode: settings.redsys?.merchantCode ?? null,
      terminal: settings.redsys?.terminal ?? '001',
      environment: settings.redsys?.environment ?? 'test',
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Inicio del cobro                                                            */
/* -------------------------------------------------------------------------- */

export interface CheckoutResult {
  paymentId: string;
  provider: PaymentProvider;
  amountCents: number;
  currency: string;
  redirectUrl: string | null;
  formPost: { action: string; fields: Record<string, string> } | null;
}

export async function createCheckout(params: {
  organizationId: string;
  appointmentId?: string;
  creditPackId?: string;
  userId: string | null;
  provider?: PaymentProvider;
  locale?: Locale;
  returnUrl?: string;
  cancelUrl?: string;
}): Promise<CheckoutResult> {
  const settings = await getPaymentSettings(params.organizationId);
  if (!settings.enabled) {
    throw new ServiceUnavailableError('Los pagos no están activos', 'payments_disabled');
  }

  const target = await resolveTarget(params);
  const provider = params.provider ?? settings.defaultProvider;
  const reference = buildOrderNumber();
  const paymentId = newId();
  const now = isoNow();

  await db()
    .insertInto('payments')
    .values({
      id: paymentId,
      organization_id: params.organizationId,
      appointment_id: params.appointmentId ?? null,
      credit_pack_id: params.creditPackId ?? null,
      user_id: params.userId,
      provider,
      amount_cents: target.amountCents,
      currency: target.currency,
      status: 'pending',
      external_id: null,
      external_reference: reference,
      refunded_cents: 0,
      metadata_json: JSON.stringify({ description: target.description }),
      paid_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const successUrl =
    params.returnUrl ?? `${env.APP_URL}/pago/ok?ref=${reference}`;
  const cancelUrl = params.cancelUrl ?? `${env.APP_URL}/pago/ko?ref=${reference}`;

  if (provider === 'stripe') {
    if (!settings.stripe?.secretKey) {
      throw new ServiceUnavailableError('Stripe no está configurado', 'stripe_not_configured');
    }
    const session = await createCheckoutSession({
      secretKey: settings.stripe.secretKey,
      amountCents: target.amountCents,
      currency: target.currency,
      description: target.description,
      successUrl,
      cancelUrl,
      customerEmail: target.email,
      reference,
      locale: params.locale,
    });

    await db()
      .updateTable('payments')
      .set({ external_id: session.id, updated_at: isoNow() })
      .where('id', '=', paymentId)
      .execute();

    return {
      paymentId,
      provider,
      amountCents: target.amountCents,
      currency: target.currency,
      redirectUrl: session.url,
      formPost: null,
    };
  }

  if (provider === 'redsys') {
    const config = redsysConfig(settings);
    const form = buildRedsysForm(config, {
      order: reference,
      amountCents: target.amountCents,
      currency: target.currency,
      description: target.description,
      urlOk: successUrl,
      urlKo: cancelUrl,
      urlNotification: `${env.APP_URL}/api/v1/organizations/${params.organizationId}/payments/redsys/notify`,
      consumerLanguage: languageCode(params.locale ?? 'es'),
    });

    return {
      paymentId,
      provider,
      amountCents: target.amountCents,
      currency: target.currency,
      redirectUrl: null,
      formPost: form,
    };
  }

  // Cobro manual: queda registrado como pendiente y lo marca el personal.
  return {
    paymentId,
    provider: 'manual',
    amountCents: target.amountCents,
    currency: target.currency,
    redirectUrl: null,
    formPost: null,
  };
}

function redsysConfig(settings: PaymentSettings): RedsysConfig {
  if (!settings.redsys?.secretKey || !settings.redsys?.merchantCode) {
    throw new ServiceUnavailableError('Redsys no está configurado', 'redsys_not_configured');
  }
  return {
    merchantCode: settings.redsys.merchantCode,
    terminal: settings.redsys.terminal ?? '001',
    secretKey: settings.redsys.secretKey,
    environment: settings.redsys.environment ?? 'test',
  };
}

async function resolveTarget(params: {
  organizationId: string;
  appointmentId?: string;
  creditPackId?: string;
}): Promise<{ amountCents: number; currency: string; description: string; email: string | null }> {
  if (params.appointmentId) {
    const appointment = await requireAppointmentDetail(params.appointmentId);
    if (appointment.organizationId !== params.organizationId) {
      throw new NotFoundError('La cita no existe');
    }

    const service = await db()
      .selectFrom('services')
      .select(['deposit_cents', 'payment_required'])
      .where('id', '=', appointment.serviceId)
      .executeTakeFirst();

    // Si el servicio pide señal, se cobra la señal; si no, el importe completo.
    const amountCents =
      service && service.deposit_cents > 0 ? service.deposit_cents : appointment.priceCents;

    if (amountCents <= 0) {
      throw new BadRequestError('Esta cita no tiene importe que cobrar', 'nothing_to_charge');
    }

    return {
      amountCents,
      currency: appointment.currency,
      description: `${appointment.serviceName} - ${appointment.organizationName}`,
      email: appointment.customerEmail,
    };
  }

  if (params.creditPackId) {
    const pack = await db()
      .selectFrom('credit_packs')
      .selectAll()
      .where('id', '=', params.creditPackId)
      .where('organization_id', '=', params.organizationId)
      .executeTakeFirst();
    if (!pack) throw new NotFoundError('El bono no existe');
    if (pack.active !== 1) {
      throw new BadRequestError('Este bono ya no está a la venta', 'credit_pack_inactive');
    }
    // La venta online se activa bono a bono: hay centros que solo los emiten
    // en mostrador, y la pasarela no puede ser una puerta trasera a eso.
    if (pack.online_purchase !== 1) {
      throw new BadRequestError(
        'Este bono solo se puede adquirir en el centro',
        'credit_pack_not_online',
      );
    }

    return {
      amountCents: pack.price_cents,
      currency: pack.currency,
      description: pack.name,
      email: null,
    };
  }

  throw new BadRequestError('Indica la cita o el bono que se va a pagar', 'missing_payment_target');
}

/* -------------------------------------------------------------------------- */
/* Confirmación                                                                */
/* -------------------------------------------------------------------------- */

export async function markPaymentPaid(
  paymentId: string,
  externalId?: string | null,
): Promise<void> {
  const payment = await db()
    .selectFrom('payments')
    .selectAll()
    .where('id', '=', paymentId)
    .executeTakeFirst();
  if (!payment || payment.status === 'paid') return;

  await db()
    .updateTable('payments')
    .set({
      status: 'paid',
      paid_at: isoNow(),
      external_id: externalId ?? payment.external_id,
      updated_at: isoNow(),
    })
    .where('id', '=', paymentId)
    .execute();

  if (payment.appointment_id) {
    await db()
      .updateTable('appointments')
      .set({ payment_status: 'paid', updated_at: isoNow() })
      .where('id', '=', payment.appointment_id)
      .execute();

    const appointment = await requireAppointmentDetail(payment.appointment_id);
    await notify({
      event: 'payment.succeeded',
      userId: appointment.customerId,
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      locale: appointment.locale as Locale,
      to: { email: appointment.customerEmail },
      vars: appointmentVars(appointment),
    });
  }

  if (payment.credit_pack_id && payment.user_id) {
    await grantPack({
      organizationId: payment.organization_id,
      userId: payment.user_id,
      packId: payment.credit_pack_id,
      source: 'online',
      paymentId: payment.id,
    });
  }

  await dispatchWebhook(payment.organization_id, 'payment.succeeded', {
    paymentId,
    appointmentId: payment.appointment_id,
    amountCents: payment.amount_cents,
    currency: payment.currency,
  });
}

export async function markPaymentFailed(paymentId: string, reason: string): Promise<void> {
  await db()
    .updateTable('payments')
    .set({
      status: 'failed',
      metadata_json: JSON.stringify({ reason }),
      updated_at: isoNow(),
    })
    .where('id', '=', paymentId)
    .execute();

  const payment = await db()
    .selectFrom('payments')
    .select(['appointment_id', 'organization_id'])
    .where('id', '=', paymentId)
    .executeTakeFirst();

  if (payment?.appointment_id) {
    await db()
      .updateTable('appointments')
      .set({ payment_status: 'failed', updated_at: isoNow() })
      .where('id', '=', payment.appointment_id)
      .execute();

    const appointment = await requireAppointmentDetail(payment.appointment_id);
    await notify({
      event: 'payment.failed',
      userId: appointment.customerId,
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      locale: appointment.locale as Locale,
      to: { email: appointment.customerEmail },
      vars: appointmentVars(appointment),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Webhooks de las pasarelas                                                   */
/* -------------------------------------------------------------------------- */

export async function handleStripeWebhook(params: {
  organizationId: string;
  payload: string;
  signature: string;
}): Promise<{ handled: boolean }> {
  const settings = await getPaymentSettings(params.organizationId);
  if (!settings.stripe?.webhookSecret) {
    throw new ServiceUnavailableError('Webhook de Stripe no configurado', 'stripe_webhook_missing');
  }

  const event = verifyStripeSignature({
    payload: params.payload,
    header: params.signature,
    secret: settings.stripe.webhookSecret,
  });
  if (!event) {
    throw new BadRequestError('Firma de Stripe no válida', 'invalid_signature');
  }

  const object = event.data.object;
  const reference: string | undefined =
    object.client_reference_id ?? object.metadata?.reference ?? undefined;

  if (!reference) return { handled: false };

  const payment = await db()
    .selectFrom('payments')
    .select(['id'])
    .where('external_reference', '=', reference)
    .executeTakeFirst();
  if (!payment) return { handled: false };

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await markPaymentPaid(payment.id, object.payment_intent ?? object.id);
      return { handled: true };

    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      await markPaymentFailed(payment.id, event.type);
      return { handled: true };

    default:
      return { handled: false };
  }
}

export async function handleRedsysNotification(params: {
  organizationId: string;
  body: Record<string, string>;
}): Promise<{ handled: boolean }> {
  const settings = await getPaymentSettings(params.organizationId);
  const notification = parseRedsysNotification(redsysConfig(settings), params.body);

  if (!notification) {
    logger.warn({ organizationId: params.organizationId }, 'Notificación de Redsys con firma inválida');
    throw new BadRequestError('Firma de Redsys no válida', 'invalid_signature');
  }

  const payment = await db()
    .selectFrom('payments')
    .select(['id'])
    .where('external_reference', '=', notification.order)
    .executeTakeFirst();
  if (!payment) return { handled: false };

  if (notification.authorised) {
    await markPaymentPaid(payment.id, notification.authorisationCode);
  } else {
    await markPaymentFailed(payment.id, `Redsys respuesta ${notification.responseCode}`);
  }
  return { handled: true };
}

/* -------------------------------------------------------------------------- */
/* Devoluciones                                                                */
/* -------------------------------------------------------------------------- */

export async function refundAppointmentPayments(
  appointmentId: string,
  options: { amountCents?: number; reason?: string } = {},
): Promise<{ refunded: number }> {
  const payments = await db()
    .selectFrom('payments')
    .selectAll()
    .where('appointment_id', '=', appointmentId)
    .where('status', '=', 'paid')
    .execute();

  let refunded = 0;
  for (const payment of payments) {
    const amount = options.amountCents ?? payment.amount_cents - payment.refunded_cents;
    if (amount <= 0) continue;

    if (payment.provider === 'stripe') {
      const settings = await getPaymentSettings(payment.organization_id);
      if (!settings.stripe?.secretKey || !payment.external_id) continue;
      await createRefund({
        secretKey: settings.stripe.secretKey,
        paymentIntentId: payment.external_id,
        amountCents: amount,
        reason: options.reason,
      });
    } else if (payment.provider === 'redsys') {
      // Redsys exige la devolución desde su panel o con la operación 3 del
      // API de comercios, que requiere alta específica. Se registra como
      // pendiente para que el responsable la complete allí.
      logger.info(
        { paymentId: payment.id },
        'Devolución de Redsys registrada; hay que completarla en el TPV',
      );
    }

    await db()
      .updateTable('payments')
      .set({
        refunded_cents: payment.refunded_cents + amount,
        status: payment.refunded_cents + amount >= payment.amount_cents ? 'refunded' : 'partially_refunded',
        updated_at: isoNow(),
      })
      .where('id', '=', payment.id)
      .execute();

    refunded += amount;
  }

  if (refunded > 0) {
    await db()
      .updateTable('appointments')
      .set({ payment_status: 'refunded', updated_at: isoNow() })
      .where('id', '=', appointmentId)
      .execute();

    const appointment = await requireAppointmentDetail(appointmentId);
    await notify({
      event: 'payment.refunded',
      userId: appointment.customerId,
      organizationId: appointment.organizationId,
      appointmentId,
      locale: appointment.locale as Locale,
      to: { email: appointment.customerEmail },
      vars: appointmentVars(appointment),
    });
    await dispatchWebhook(appointment.organizationId, 'payment.refunded', {
      appointmentId,
      refunded,
    });
  }

  return { refunded };
}
