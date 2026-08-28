import { findTemplate, templateText, type OrganizationTemplate } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { isoNow } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { createResource, createService, getOrganization, listLocations } from './service.js';
import { createForm, setServiceForms } from './forms.js';

/**
 * Aplicar una plantilla de alta.
 *
 * Deja la organización con servicios, recursos y horario para poder probar la
 * reserva en el primer minuto. Es lo que evita el arranque en frío: una
 * organización recién creada está vacía y hay que inventarse tres cosas antes
 * de poder ver nada funcionando.
 *
 * **Solo se aplica sobre una organización vacía.** Aplicarla dos veces
 * duplicaría el catálogo, y sobre un negocio en marcha metería servicios que
 * nadie pidió entre los suyos.
 */

export interface TemplateResult {
  services: number;
  resources: number;
  schedules: number;
}

export async function applyTemplate(
  organizationId: string,
  key: string,
): Promise<TemplateResult> {
  const template = findTemplate(key);
  if (!template) throw new NotFoundError('Esa plantilla no existe', 'template_not_found');

  const organization = await getOrganization(organizationId);
  if (!organization) throw new NotFoundError('La organización no existe');

  const existentes = await db()
    .selectFrom('services')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (existentes) {
    throw new BadRequestError(
      'La plantilla solo se puede aplicar sobre una organización sin servicios',
      'template_not_empty',
    );
  }

  const locales = await listLocations(organizationId, { onlyActive: true });
  const location = locales[0];
  if (!location) throw new NotFoundError('La organización no tiene sedes', 'location_not_found');

  const locale = organization.locale;
  const nombre = (texto: OrganizationTemplate['label']) => templateText(texto, locale);

  /* ------------------------------------------------------------- Recursos */
  const recursos = [];
  for (const [indice, recurso] of template.resources.entries()) {
    recursos.push(
      await createResource(organizationId, {
        locationId: location.id,
        name: nombre(recurso.name),
        type: recurso.type,
        capacity: recurso.capacity ?? 1,
        bookableDirectly: true,
        commissionPercent: 0,
        sortOrder: indice,
        active: true,
      }),
    );
  }

  const resourceIds = recursos.map((recurso) => recurso.id);

  /* ------------------------------------------------------------ Servicios */
  const servicios = [];
  for (const [indice, servicio] of template.services.entries()) {
    servicios.push(
      await createService(organizationId, {
        name: nombre(servicio.name),
        // El nombre viaja en los tres idiomas: el catálogo se enseña en el del
        // visitante, no en el de quien dio de alta el negocio.
        nameI18n: servicio.name,
        durationMode: servicio.flexible ? 'flexible' : 'fixed',
        durationMinutes: servicio.durationMinutes,
        minDurationMinutes: servicio.flexible?.min ?? null,
        maxDurationMinutes: servicio.flexible?.max ?? null,
        durationStepMinutes: servicio.flexible?.step ?? null,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        priceMode: 'fixed',
        priceCents: servicio.priceCents,
        currency: organization.currency,
        depositCents: 0,
        paymentRequired: false,
        requiresCreditPack: false,
        capacity: servicio.capacity ?? 1,
        requiresApproval: false,
        creditChargeMode: 'inherit',
        maxAdvanceDays: 90,
        rescheduleCutoffMinutes: 0,
        allowResourceSelection: true,
        publiclyBookable: true,
        staffOnly: false,
        startMode: 'inherit' as const,
        startOffsetMinutes: 0,
        sortOrder: indice,
        active: true,
        resourceIds,
      }),
    );
  }

  /* -------------------------------------------------------------- Horario */
  const now = isoNow();
  const filas = template.schedules.flatMap((horario) =>
    horario.weekdays.flatMap((weekday) =>
      horario.ranges.map(([start, end]) => ({
        id: newId(),
        organization_id: organizationId,
        owner_type: 'location',
        owner_id: location.id,
        weekday,
        start_minute: start,
        end_minute: end,
        valid_from: null,
        valid_to: null,
        created_at: now,
      })),
    ),
  );

  if (filas.length > 0) await db().insertInto('schedules').values(filas).execute();

  /* ---------------------------------------------------------------- Bonos */
  if (template.creditPack) {
    await db()
      .insertInto('credit_packs')
      .values({
        id: newId(),
        organization_id: organizationId,
        name: nombre(template.creditPack.name),
        description: null,
        credits: template.creditPack.credits,
        price_cents: template.creditPack.priceCents,
        currency: organization.currency,
        validity_days: template.creditPack.validityDays,
        service_ids_json: JSON.stringify([]),
        online_purchase: 1,
        sort_order: 0,
        active: 1,
        image_url: null,
        icon: null,
        color: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  /* ------------------------------------------------------- Consentimiento */
  if (template.consent) {
    const consent = await createForm(organizationId, {
      name: nombre(template.consent.name),
      kind: 'consent',
      fields: [],
      consentText: nombre(template.consent.text),
      requiresSignature: true,
      active: true,
    });

    // Se engancha a todos los servicios de la plantilla, una sola vez por
    // persona: es lo normal en una consulta, se firma en la primera visita.
    for (const servicio of servicios) {
      await setServiceForms(organizationId, servicio.id, [
        { formId: consent.id, required: true, oncePerCustomer: true, sortOrder: 0 },
      ]);
    }
  }

  /* -------------------------------------------------------------- Ajustes */
  if (template.settings) {
    await db()
      .updateTable('organizations')
      .set({
        settings_json: JSON.stringify({
          ...(organization.settings ?? {}),
          ...template.settings,
        }),
        updated_at: now,
      })
      .where('id', '=', organizationId)
      .execute();
  }

  return { services: servicios.length, resources: recursos.length, schedules: filas.length };
}
