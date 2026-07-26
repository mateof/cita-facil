import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe a través de su API REST.
 *
 * Solo se usan dos operaciones (crear una sesión de pago y devolver un cobro)
 * más la verificación de firma de los webhooks, así que se hablan directamente
 * con `fetch` en lugar de añadir el SDK completo. El formato de cuerpo de
 * Stripe es `application/x-www-form-urlencoded` con notación de corchetes para
 * los objetos anidados.
 */

const API_BASE = 'https://api.stripe.com/v1';

async function call<T>(
  secretKey: string,
  path: string,
  body?: Record<string, string | number | undefined>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value !== undefined) params.append(key, String(value));
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-11-20.acacia',
    },
    body: body ? params : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Stripe: ${data?.error?.message ?? response.status}`);
  }
  return data as T;
}

export interface StripeCheckoutInput {
  secretKey: string;
  amountCents: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  /** Se devuelve tal cual en el webhook para casar el pago con la cita. */
  reference: string;
  locale?: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession(
  input: StripeCheckoutInput,
): Promise<StripeCheckoutSession> {
  const session = await call<{ id: string; url: string }>(input.secretKey, '/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': input.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': input.amountCents,
    'line_items[0][price_data][product_data][name]': input.description.slice(0, 250),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail ?? undefined,
    client_reference_id: input.reference,
    'metadata[reference]': input.reference,
    locale: input.locale === 'en' ? 'en' : 'es',
  });

  return { id: session.id, url: session.url };
}

export async function createRefund(params: {
  secretKey: string;
  paymentIntentId: string;
  amountCents?: number;
  reason?: string;
}): Promise<{ id: string; status: string }> {
  return call<{ id: string; status: string }>(params.secretKey, '/refunds', {
    payment_intent: params.paymentIntentId,
    amount: params.amountCents,
    reason: 'requested_by_customer',
    'metadata[motivo]': params.reason,
  });
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

/**
 * Verifica la cabecera `Stripe-Signature`. Hay que hacerlo sobre el cuerpo en
 * bruto, sin volver a serializar el JSON: cualquier reordenación de claves o
 * cambio de espaciado invalida la firma.
 */
export function verifyStripeSignature(params: {
  payload: string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
}): StripeEvent | null {
  const parts = Object.fromEntries(
    params.header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim() ?? '', value?.trim() ?? ''];
    }),
  );

  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return null;

  const tolerance = params.toleranceSeconds ?? 300;
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) return null;

  const expected = createHmac('sha256', params.secret)
    .update(`${timestamp}.${params.payload}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }

  return JSON.parse(params.payload) as StripeEvent;
}
