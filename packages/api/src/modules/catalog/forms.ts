import type {
  CreateFormInput,
  FormDefinition,
  FormResponse,
  SubmitFormResponseInput,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { fromDbJson } from '../../db/columns.js';
import { isoNow } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

/**
 * Formularios y consentimientos.
 *
 * Son de la organización y se enganchan a los servicios que los piden. La misma
 * hoja de alergias vale para cinco tratamientos, y mantenerla en cinco sitios
 * acabaría con cinco versiones distintas de la misma pregunta.
 *
 * Las respuestas viven en su propia tabla y no dentro de la cita porque
 * sobreviven a la cita que las originó: un consentimiento firmado sigue siendo
 * válido aunque esa cita se cancele, y es justo lo que evita volver a pedirlo.
 */

type FormRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  kind: string;
  fields_json: string | null;
  consent_text: string | null;
  requires_signature: number;
  active: number;
  created_at: string;
};

function mapForm(row: FormRow): FormDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    kind: row.kind === 'consent' ? 'consent' : 'form',
    fields: fromDbJson<FormDefinition['fields']>(row.fields_json, []),
    consentText: row.consent_text,
    requiresSignature: row.requires_signature === 1,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export async function listForms(
  organizationId: string,
  options: { onlyActive?: boolean } = {},
): Promise<FormDefinition[]> {
  let query = db()
    .selectFrom('forms')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .orderBy('name');
  if (options.onlyActive) query = query.where('active', '=', 1);

  return (await query.execute()).map(mapForm);
}

export async function getForm(organizationId: string, id: string): Promise<FormDefinition> {
  const row = await db()
    .selectFrom('forms')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('El formulario no existe', 'form_not_found');
  return mapForm(row);
}

function assertUsable(input: Partial<CreateFormInput>): void {
  if (input.kind === 'consent' && !input.consentText?.trim()) {
    throw new BadRequestError('Un consentimiento necesita su texto', 'consent_text_required');
  }
  const claves = (input.fields ?? []).map((field) => field.key);
  if (new Set(claves).size !== claves.length) {
    throw new BadRequestError('Hay dos campos con la misma clave', 'form_duplicate_key');
  }
}

export async function createForm(
  organizationId: string,
  input: CreateFormInput,
): Promise<FormDefinition> {
  assertUsable(input);
  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('forms')
    .values({
      id,
      organization_id: organizationId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind,
      fields_json: JSON.stringify(input.fields),
      consent_text: input.consentText ?? null,
      requires_signature: input.requiresSignature ? 1 : 0,
      active: input.active ? 1 : 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return getForm(organizationId, id);
}

export async function updateForm(
  organizationId: string,
  id: string,
  patch: Partial<CreateFormInput>,
): Promise<FormDefinition> {
  const actual = await getForm(organizationId, id);
  assertUsable({ ...actual, ...patch });

  await db()
    .updateTable('forms')
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description ?? null }),
      ...(patch.kind === undefined ? {} : { kind: patch.kind }),
      ...(patch.fields === undefined ? {} : { fields_json: JSON.stringify(patch.fields) }),
      ...(patch.consentText === undefined ? {} : { consent_text: patch.consentText ?? null }),
      ...(patch.requiresSignature === undefined
        ? {}
        : { requires_signature: patch.requiresSignature ? 1 : 0 }),
      ...(patch.active === undefined ? {} : { active: patch.active ? 1 : 0 }),
      updated_at: isoNow(),
    })
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .execute();

  return getForm(organizationId, id);
}

/**
 * Borrar un formulario del que ya hay respuestas lo desactiva.
 *
 * Es la misma norma que con los bonos: lo que alguien firmó no puede
 * desaparecer porque el negocio deje de usar esa hoja.
 */
export async function deleteForm(organizationId: string, id: string): Promise<void> {
  await getForm(organizationId, id);

  const respuesta = await db()
    .selectFrom('form_responses')
    .select(['id'])
    .where('form_id', '=', id)
    .executeTakeFirst();

  if (respuesta) {
    await updateForm(organizationId, id, { active: false });
    return;
  }

  await db().deleteFrom('service_forms').where('form_id', '=', id).execute();
  await db().deleteFrom('forms').where('id', '=', id).execute();
}

/* -------------------------------------------------------------------------- */
/* Qué pide cada servicio                                                      */
/* -------------------------------------------------------------------------- */

export interface AttachedForm extends FormDefinition {
  required: boolean;
  oncePerCustomer: boolean;
}

export async function formsOfService(
  organizationId: string,
  serviceId: string,
): Promise<AttachedForm[]> {
  const rows = await db()
    .selectFrom('service_forms')
    .innerJoin('forms', 'forms.id', 'service_forms.form_id')
    .selectAll('forms')
    .select(['service_forms.required', 'service_forms.once_per_customer', 'service_forms.sort_order'])
    .where('service_forms.service_id', '=', serviceId)
    .where('forms.organization_id', '=', organizationId)
    .where('forms.active', '=', 1)
    .orderBy('service_forms.sort_order')
    .execute();

  return rows.map((row) => ({
    ...mapForm(row as unknown as FormRow),
    required: row.required === 1,
    oncePerCustomer: row.once_per_customer === 1,
  }));
}

export async function setServiceForms(
  organizationId: string,
  serviceId: string,
  links: { formId: string; required: boolean; oncePerCustomer: boolean; sortOrder: number }[],
): Promise<AttachedForm[]> {
  // Se comprueba que todos los formularios son de esta organización antes de
  // enganchar nada: el identificador llega del panel y podría ser de otra.
  for (const link of links) await getForm(organizationId, link.formId);

  await db().deleteFrom('service_forms').where('service_id', '=', serviceId).execute();

  if (links.length > 0) {
    await db()
      .insertInto('service_forms')
      .values(
        links.map((link) => ({
          service_id: serviceId,
          form_id: link.formId,
          required: link.required ? 1 : 0,
          once_per_customer: link.oncePerCustomer ? 1 : 0,
          sort_order: link.sortOrder,
        })),
      )
      .execute();
  }

  return formsOfService(organizationId, serviceId);
}

/**
 * Formularios que le faltan a esta persona para este servicio.
 *
 * Los marcados como "una vez por persona" desaparecen en cuanto los respondió
 * alguna vez; el resto se piden en cada cita. Quien reserva sin cuenta los
 * responde siempre, porque no hay a quién atribuirle lo de la vez anterior.
 */
export async function pendingForms(
  organizationId: string,
  serviceId: string,
  customerId: string | null,
): Promise<AttachedForm[]> {
  const enganchados = await formsOfService(organizationId, serviceId);
  if (enganchados.length === 0 || !customerId) return enganchados;

  const respondidos = await db()
    .selectFrom('form_responses')
    .select(['form_id'])
    .where('organization_id', '=', organizationId)
    .where('customer_id', '=', customerId)
    .execute();

  const yaEstan = new Set(respondidos.map((row) => row.form_id));
  return enganchados.filter((form) => !(form.oncePerCustomer && yaEstan.has(form.id)));
}

/* -------------------------------------------------------------------------- */
/* Respuestas                                                                  */
/* -------------------------------------------------------------------------- */

function assertAnswers(form: FormDefinition, input: SubmitFormResponseInput): void {
  if (form.kind === 'consent') {
    if (!input.accepted) {
      throw new BadRequestError('Hay que aceptar el consentimiento', 'consent_not_accepted');
    }
    if (form.requiresSignature && !input.signatureName?.trim()) {
      throw new BadRequestError('Falta la firma', 'signature_required');
    }
    return;
  }

  for (const field of form.fields) {
    if (!field.required) continue;
    const valor = input.answers[field.key];
    const vacio = valor === undefined || valor === null || valor === '' || valor === false;
    if (vacio) {
      throw new BadRequestError(`Falta responder "${field.label}"`, 'form_field_required');
    }
  }
}

export async function saveFormResponse(
  organizationId: string,
  input: SubmitFormResponseInput,
  context: {
    appointmentId?: string | null;
    customerId?: string | null;
    guestName?: string | null;
    ip?: string | null;
  } = {},
): Promise<FormResponse> {
  const form = await getForm(organizationId, input.formId);
  assertAnswers(form, input);

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('form_responses')
    .values({
      id,
      organization_id: organizationId,
      form_id: form.id,
      appointment_id: context.appointmentId ?? null,
      customer_id: context.customerId ?? null,
      guest_name: context.guestName ?? null,
      answers_json: JSON.stringify(input.answers),
      accepted_at: form.kind === 'consent' ? now : null,
      signature_name: input.signatureName?.trim() || null,
      ip: context.ip ?? null,
      created_at: now,
    })
    .execute();

  const respuestas = await listResponses(organizationId, { responseId: id });
  return respuestas[0]!;
}

export async function listResponses(
  organizationId: string,
  filters: {
    responseId?: string;
    appointmentId?: string;
    customerId?: string;
    formId?: string;
    limit?: number;
  } = {},
): Promise<FormResponse[]> {
  let query = db()
    .selectFrom('form_responses')
    .innerJoin('forms', 'forms.id', 'form_responses.form_id')
    .select([
      'form_responses.id',
      'form_responses.form_id',
      'form_responses.appointment_id',
      'form_responses.customer_id',
      'form_responses.guest_name',
      'form_responses.answers_json',
      'form_responses.accepted_at',
      'form_responses.signature_name',
      'form_responses.created_at',
      'forms.name as form_name',
      'forms.kind',
    ])
    .where('form_responses.organization_id', '=', organizationId)
    .orderBy('form_responses.created_at', 'desc')
    .limit(filters.limit ?? 100);

  if (filters.responseId) query = query.where('form_responses.id', '=', filters.responseId);
  if (filters.appointmentId) {
    query = query.where('form_responses.appointment_id', '=', filters.appointmentId);
  }
  if (filters.customerId) query = query.where('form_responses.customer_id', '=', filters.customerId);
  if (filters.formId) query = query.where('form_responses.form_id', '=', filters.formId);

  const rows = await query.execute();

  return rows.map((row) => ({
    id: row.id,
    formId: row.form_id,
    formName: row.form_name,
    kind: row.kind === 'consent' ? 'consent' : 'form',
    appointmentId: row.appointment_id,
    customerId: row.customer_id,
    guestName: row.guest_name,
    answers: fromDbJson<FormResponse['answers']>(row.answers_json, {}),
    acceptedAt: row.accepted_at,
    signatureName: row.signature_name,
    createdAt: row.created_at,
  }));
}
