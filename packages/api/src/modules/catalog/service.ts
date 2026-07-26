import type {
  CreateLocationInput,
  CreateOrganizationInput,
  CreateResourceInput,
  CreateServiceInput,
  I18nText,
  ScheduleExceptionInput,
  ScheduleRule,
} from '@cita-facil/shared';
import { isReservedSlug } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { slugify } from '../../db/seed.js';

/**
 * Catálogo: organizaciones, sedes, recursos, servicios y calendarios.
 *
 * Todas las lecturas devuelven objetos con nombres en `camelCase` y los textos
 * multiidioma ya deserializados, de forma que la API pública, el panel y el
 * servidor MCP consumen exactamente la misma forma de datos.
 */

/* -------------------------------------------------------------------------- */
/* Organizaciones                                                              */
/* -------------------------------------------------------------------------- */

export interface OrganizationView {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  settings: Record<string, unknown>;
  status: string;
  createdAt: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function createOrganization(
  input: CreateOrganizationInput,
  ownerUserId: string,
): Promise<OrganizationView> {
  const slug = await uniqueSlug('organizations', input.slug ?? slugify(input.name));
  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('organizations')
    .values({
      id,
      slug,
      name: input.name,
      timezone: input.timezone,
      locale: input.locale,
      currency: input.currency,
      email: input.email ?? null,
      phone: input.phone ?? null,
      tax_id: input.taxId ?? null,
      settings_json: input.settings ? JSON.stringify(input.settings) : null,
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  await db()
    .insertInto('memberships')
    .values({
      id: newId(),
      organization_id: id,
      user_id: ownerUserId,
      role: 'owner',
      job_title: null,
      bookable: 0,
      active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();

  // Una organización sin sede no puede recibir citas, así que se crea una por
  // defecto que el administrador puede renombrar después.
  await createLocation(id, {
    name: input.name,
    timezone: input.timezone,
    country: 'ES',
    active: true,
  });

  return (await getOrganization(id))!;
}

export async function getOrganization(id: string): Promise<OrganizationView | null> {
  const row = await db()
    .selectFrom('organizations')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? mapOrganization(row) : null;
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationView | null> {
  const row = await db()
    .selectFrom('organizations')
    .selectAll()
    .where('slug', '=', slug)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? mapOrganization(row) : null;
}

function mapOrganization(row: {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  settings_json: string | null;
  status: string;
  created_at: string;
}): OrganizationView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    locale: row.locale,
    currency: row.currency,
    email: row.email,
    phone: row.phone,
    taxId: row.tax_id,
    settings: parseJson<Record<string, unknown>>(row.settings_json, {}),
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function updateOrganization(
  id: string,
  patch: Partial<CreateOrganizationInput>,
): Promise<OrganizationView> {
  const update: Record<string, unknown> = { updated_at: isoNow() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.locale !== undefined) update.locale = patch.locale;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (patch.email !== undefined) update.email = patch.email;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.taxId !== undefined) update.tax_id = patch.taxId;
  if (patch.slug !== undefined) update.slug = await uniqueSlug('organizations', patch.slug, id);
  if (patch.settings !== undefined) {
    const current = await getOrganization(id);
    update.settings_json = JSON.stringify({ ...current?.settings, ...patch.settings });
  }

  await db().updateTable('organizations').set(update).where('id', '=', id).execute();
  const organization = await getOrganization(id);
  if (!organization) throw new NotFoundError('La organización no existe');
  return organization;
}

/**
 * Baja de una organización.
 *
 * Es un borrado lógico: se marca `deleted_at` y desaparece de todas las
 * consultas, pero sus citas, bonos y facturas siguen en la base. Borrar de
 * verdad obligaría a decidir qué hacer con el histórico de gente que no tiene
 * nada que ver con la decisión de cerrar el negocio.
 */
export async function deleteOrganization(id: string): Promise<void> {
  const organization = await getOrganization(id);
  if (!organization) throw new NotFoundError('La organización no existe');

  const now = isoNow();
  await db()
    .updateTable('organizations')
    .set({ deleted_at: now, status: 'closed', updated_at: now })
    .where('id', '=', id)
    .execute();

  // El personal deja de tener acceso: si no, seguiría viéndola en su selector.
  await db()
    .updateTable('memberships')
    .set({ active: 0, updated_at: now })
    .where('organization_id', '=', id)
    .execute();
}

/** Cuántas cosas cuelgan de la organización, para avisar antes de darla de baja. */
export async function organizationUsage(
  id: string,
): Promise<{ locations: number; services: number; appointments: number; members: number }> {
  const count = async (
    table: 'locations' | 'services' | 'appointments' | 'memberships',
  ): Promise<number> => {
    const row = await db()
      .selectFrom(table)
      .select(db().fn.countAll<number>().as('total'))
      .where('organization_id', '=', id)
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  };

  return {
    locations: await count('locations'),
    services: await count('services'),
    appointments: await count('appointments'),
    members: await count('memberships'),
  };
}

export async function listOrganizationsForUser(userId: string): Promise<OrganizationView[]> {
  const rows = await db()
    .selectFrom('organizations')
    .innerJoin('memberships', 'memberships.organization_id', 'organizations.id')
    .selectAll('organizations')
    .where('memberships.user_id', '=', userId)
    .where('memberships.active', '=', 1)
    .where('organizations.deleted_at', 'is', null)
    .orderBy('organizations.name')
    .execute();
  return rows.map(mapOrganization);
}

async function uniqueSlug(
  table: 'organizations' | 'locations',
  base: string,
  excludeId?: string,
): Promise<string> {
  const clean = slugify(base);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? clean : `${clean}-${attempt + 1}`;
    // Una organización se sirve en la raíz (`/peluqueria`), así que un nombre
    // reservado dejaría inaccesible una pantalla de la aplicación. Se trata
    // como ocupado para que el bucle pruebe con el siguiente.
    if (table === 'organizations' && isReservedSlug(candidate)) continue;
    let query = db().selectFrom(table).select(['id']).where('slug', '=', candidate);
    if (excludeId) query = query.where('id', '!=', excludeId);
    const clash = await query.executeTakeFirst();
    if (!clash) return candidate;
  }
  throw new ConflictError('No se pudo generar un identificador único', 'slug_conflict');
}

/* -------------------------------------------------------------------------- */
/* Sedes                                                                       */
/* -------------------------------------------------------------------------- */

export interface LocationView {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  timezone: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  description: I18nText | null;
  active: boolean;
  sortOrder: number;
}

export async function createLocation(
  organizationId: string,
  input: CreateLocationInput,
): Promise<LocationView> {
  const organization = await getOrganization(organizationId);
  if (!organization) throw new NotFoundError('La organización no existe');

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('locations')
    .values({
      id,
      organization_id: organizationId,
      slug: await uniqueSlug('locations', input.slug ?? input.name),
      name: input.name,
      timezone: input.timezone ?? organization.timezone,
      address_line: input.addressLine ?? null,
      city: input.city ?? null,
      postal_code: input.postalCode ?? null,
      region: input.region ?? null,
      country: input.country,
      latitude: input.latitude != null ? String(input.latitude) : null,
      longitude: input.longitude != null ? String(input.longitude) : null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      description_json: input.description ? JSON.stringify(input.description) : null,
      active: input.active === false ? 0 : 1,
      sort_order: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  return (await getLocation(id))!;
}

export async function getLocation(id: string): Promise<LocationView | null> {
  const row = await db()
    .selectFrom('locations')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? mapLocation(row) : null;
}

function mapLocation(row: any): LocationView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    addressLine: row.address_line,
    city: row.city,
    postalCode: row.postal_code,
    region: row.region,
    country: row.country,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    phone: row.phone,
    email: row.email,
    description: parseJson<I18nText | null>(row.description_json, null),
    active: row.active === 1,
    sortOrder: row.sort_order,
  };
}

export async function listLocations(
  organizationId: string,
  options: { onlyActive?: boolean } = {},
): Promise<LocationView[]> {
  let query = db()
    .selectFrom('locations')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null);
  if (options.onlyActive) query = query.where('active', '=', 1);
  const rows = await query.orderBy('sort_order').orderBy('name').execute();
  return rows.map(mapLocation);
}

export async function updateLocation(
  id: string,
  patch: Partial<CreateLocationInput>,
): Promise<LocationView> {
  const update: Record<string, unknown> = { updated_at: isoNow() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.addressLine !== undefined) update.address_line = patch.addressLine;
  if (patch.city !== undefined) update.city = patch.city;
  if (patch.postalCode !== undefined) update.postal_code = patch.postalCode;
  if (patch.region !== undefined) update.region = patch.region;
  if (patch.country !== undefined) update.country = patch.country;
  if (patch.latitude !== undefined) update.latitude = patch.latitude != null ? String(patch.latitude) : null;
  if (patch.longitude !== undefined) update.longitude = patch.longitude != null ? String(patch.longitude) : null;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.email !== undefined) update.email = patch.email;
  if (patch.description !== undefined) update.description_json = JSON.stringify(patch.description);
  if (patch.active !== undefined) update.active = patch.active ? 1 : 0;

  await db().updateTable('locations').set(update).where('id', '=', id).execute();
  const location = await getLocation(id);
  if (!location) throw new NotFoundError('La sede no existe');
  return location;
}

export async function deleteLocation(id: string): Promise<void> {
  const upcoming = await db()
    .selectFrom('appointments')
    .select(['id'])
    .where('location_id', '=', id)
    .where('starts_at', '>=', isoNow())
    .where('status', 'in', ['pending', 'confirmed'])
    .executeTakeFirst();
  if (upcoming) {
    throw new ConflictError(
      'No se puede borrar una sede con citas futuras. Cancélalas o muévelas primero.',
      'location_has_appointments',
    );
  }
  await db()
    .updateTable('locations')
    .set({ deleted_at: isoNow(), active: 0 })
    .where('id', '=', id)
    .execute();
}

/* -------------------------------------------------------------------------- */
/* Recursos                                                                    */
/* -------------------------------------------------------------------------- */

export interface ResourceView {
  id: string;
  organizationId: string;
  locationId: string;
  userId: string | null;
  name: string;
  type: string;
  description: I18nText | null;
  capacity: number;
  color: string | null;
  imageUrl: string | null;
  bookableDirectly: boolean;
  sortOrder: number;
  active: boolean;
}

function mapResource(row: any): ResourceView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    description: parseJson<I18nText | null>(row.description_json, null),
    capacity: row.capacity,
    color: row.color,
    imageUrl: row.image_url,
    bookableDirectly: row.bookable_directly === 1,
    sortOrder: row.sort_order,
    active: row.active === 1,
  };
}

export async function createResource(
  organizationId: string,
  input: CreateResourceInput,
): Promise<ResourceView> {
  const location = await getLocation(input.locationId);
  if (!location || location.organizationId !== organizationId) {
    throw new NotFoundError('La sede no existe', 'location_not_found');
  }

  const id = newId();
  const now = isoNow();
  await db()
    .insertInto('resources')
    .values({
      id,
      organization_id: organizationId,
      location_id: input.locationId,
      user_id: input.userId ?? null,
      name: input.name,
      type: input.type,
      description_json: input.description ? JSON.stringify(input.description) : null,
      capacity: input.capacity,
      color: input.color ?? null,
      image_url: input.imageUrl ?? null,
      bookable_directly: input.bookableDirectly === false ? 0 : 1,
      sort_order: input.sortOrder,
      active: input.active === false ? 0 : 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  return (await getResource(id))!;
}

export async function getResource(id: string): Promise<ResourceView | null> {
  const row = await db()
    .selectFrom('resources')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row ? mapResource(row) : null;
}

export async function listResources(
  organizationId: string,
  options: { locationId?: string; onlyActive?: boolean; serviceId?: string } = {},
): Promise<ResourceView[]> {
  let query = db()
    .selectFrom('resources')
    .selectAll('resources')
    .where('resources.organization_id', '=', organizationId)
    .where('resources.deleted_at', 'is', null);

  if (options.locationId) query = query.where('resources.location_id', '=', options.locationId);
  if (options.onlyActive) query = query.where('resources.active', '=', 1);
  if (options.serviceId) {
    query = query
      .innerJoin('service_resources', 'service_resources.resource_id', 'resources.id')
      .where('service_resources.service_id', '=', options.serviceId);
  }

  const rows = await query.orderBy('resources.sort_order').orderBy('resources.name').execute();
  return rows.map(mapResource);
}

export async function updateResource(
  id: string,
  patch: Partial<CreateResourceInput>,
): Promise<ResourceView> {
  const update: Record<string, unknown> = { updated_at: isoNow() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.type !== undefined) update.type = patch.type;
  if (patch.description !== undefined) update.description_json = JSON.stringify(patch.description);
  if (patch.capacity !== undefined) update.capacity = patch.capacity;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.imageUrl !== undefined) update.image_url = patch.imageUrl;
  if (patch.bookableDirectly !== undefined) update.bookable_directly = patch.bookableDirectly ? 1 : 0;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.active !== undefined) update.active = patch.active ? 1 : 0;
  if (patch.userId !== undefined) update.user_id = patch.userId;
  if (patch.locationId !== undefined) update.location_id = patch.locationId;

  await db().updateTable('resources').set(update).where('id', '=', id).execute();
  const resource = await getResource(id);
  if (!resource) throw new NotFoundError('El recurso no existe');
  return resource;
}

export async function deleteResource(id: string): Promise<void> {
  await db()
    .updateTable('resources')
    .set({ deleted_at: isoNow(), active: 0 })
    .where('id', '=', id)
    .execute();
  await db().deleteFrom('service_resources').where('resource_id', '=', id).execute();
}

/* -------------------------------------------------------------------------- */
/* Servicios                                                                   */
/* -------------------------------------------------------------------------- */

export interface ServiceView {
  id: string;
  organizationId: string;
  locationId: string | null;
  categoryId: string | null;
  name: string;
  nameI18n: I18nText | null;
  description: I18nText | null;
  color: string | null;
  imageUrl: string | null;
  durationMode: string;
  durationMinutes: number;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
  durationStepMinutes: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMode: string;
  priceCents: number;
  pricePerMinuteCents: number | null;
  currency: string;
  depositCents: number;
  paymentRequired: boolean;
  requiresCreditPack: boolean;
  capacity: number;
  requiresApproval: boolean;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  cancellationCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
  allocationStrategy: string | null;
  allowResourceSelection: boolean;
  publiclyBookable: boolean;
  staffOnly: boolean;
  customFields: unknown;
  sortOrder: number;
  active: boolean;
  resourceIds: string[];
}

function mapService(row: any, resourceIds: string[] = []): ServiceView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    categoryId: row.category_id,
    name: row.name,
    nameI18n: parseJson<I18nText | null>(row.name_i18n_json, null),
    description: parseJson<I18nText | null>(row.description_json, null),
    color: row.color,
    imageUrl: row.image_url,
    durationMode: row.duration_mode,
    durationMinutes: row.duration_minutes,
    minDurationMinutes: row.min_duration_minutes,
    maxDurationMinutes: row.max_duration_minutes,
    durationStepMinutes: row.duration_step_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    priceMode: row.price_mode,
    priceCents: row.price_cents,
    pricePerMinuteCents: row.price_per_minute_cents,
    currency: row.currency,
    depositCents: row.deposit_cents,
    paymentRequired: row.payment_required === 1,
    requiresCreditPack: row.requires_credit_pack === 1,
    capacity: row.capacity,
    requiresApproval: row.requires_approval === 1,
    minAdvanceMinutes: row.min_advance_minutes,
    maxAdvanceDays: row.max_advance_days,
    cancellationCutoffMinutes: row.cancellation_cutoff_minutes,
    rescheduleCutoffMinutes: row.reschedule_cutoff_minutes,
    allocationStrategy: row.allocation_strategy,
    allowResourceSelection: row.allow_resource_selection === 1,
    publiclyBookable: row.publicly_bookable === 1,
    staffOnly: row.staff_only === 1,
    customFields: parseJson<unknown>(row.custom_fields_json, null),
    sortOrder: row.sort_order,
    active: row.active === 1,
    resourceIds,
  };
}

export async function createService(
  organizationId: string,
  input: CreateServiceInput,
): Promise<ServiceView> {
  validateFlexibleDuration(input);

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('services')
    .values({
      id,
      organization_id: organizationId,
      location_id: input.locationId ?? null,
      category_id: input.categoryId ?? null,
      name: input.name,
      name_i18n_json: input.nameI18n ? JSON.stringify(input.nameI18n) : null,
      description_json: input.description ? JSON.stringify(input.description) : null,
      color: input.color ?? null,
      image_url: input.imageUrl ?? null,
      duration_mode: input.durationMode,
      duration_minutes: input.durationMinutes,
      min_duration_minutes: input.minDurationMinutes ?? null,
      max_duration_minutes: input.maxDurationMinutes ?? null,
      duration_step_minutes: input.durationStepMinutes ?? null,
      buffer_before_minutes: input.bufferBeforeMinutes,
      buffer_after_minutes: input.bufferAfterMinutes,
      price_mode: input.priceMode,
      price_cents: input.priceCents,
      price_per_minute_cents: input.pricePerMinuteCents ?? null,
      currency: input.currency,
      deposit_cents: input.depositCents,
      payment_required: input.paymentRequired ? 1 : 0,
      requires_credit_pack: input.requiresCreditPack ? 1 : 0,
      capacity: input.capacity,
      requires_approval: input.requiresApproval ? 1 : 0,
      min_advance_minutes: input.minAdvanceMinutes,
      max_advance_days: input.maxAdvanceDays,
      cancellation_cutoff_minutes: input.cancellationCutoffMinutes,
      reschedule_cutoff_minutes: input.rescheduleCutoffMinutes,
      allocation_strategy: input.allocationStrategy ?? null,
      allow_resource_selection: input.allowResourceSelection ? 1 : 0,
      publicly_bookable: input.publiclyBookable ? 1 : 0,
      staff_only: input.staffOnly ? 1 : 0,
      custom_fields_json: null,
      sort_order: input.sortOrder,
      active: input.active ? 1 : 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  if (input.resourceIds?.length) {
    await setServiceResources(id, input.resourceIds);
  }

  return (await getService(id))!;
}

/**
 * La duración ajustable necesita mínimo, máximo y tramo coherentes. Se valida
 * también aquí y no solo en el esquema porque la actualización parcial puede
 * dejar la combinación inconsistente campo a campo.
 */
function validateFlexibleDuration(input: Partial<CreateServiceInput>): void {
  if (input.durationMode !== 'flexible') return;

  const min = input.minDurationMinutes ?? input.durationMinutes;
  const max = input.maxDurationMinutes ?? input.durationMinutes;
  const step = input.durationStepMinutes ?? 5;

  if (min == null || max == null) {
    throw new BadRequestError(
      'Un servicio de duración ajustable necesita duración mínima y máxima',
      'flexible_duration_incomplete',
    );
  }
  if (min > max) {
    throw new BadRequestError('La duración mínima no puede superar a la máxima', 'invalid_duration_range');
  }
  if ((max - min) % step !== 0) {
    throw new BadRequestError(
      `El intervalo entre ${min} y ${max} minutos no es múltiplo del tramo de ${step}`,
      'invalid_duration_step',
    );
  }
}

export async function getService(id: string): Promise<ServiceView | null> {
  const row = await db()
    .selectFrom('services')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) return null;

  const links = await db()
    .selectFrom('service_resources')
    .select(['resource_id'])
    .where('service_id', '=', id)
    .execute();

  return mapService(row, links.map((link) => link.resource_id));
}

export async function listServices(
  organizationId: string,
  options: { locationId?: string; onlyActive?: boolean; onlyPublic?: boolean } = {},
): Promise<ServiceView[]> {
  let query = db()
    .selectFrom('services')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null);

  if (options.onlyActive) query = query.where('active', '=', 1);
  if (options.onlyPublic) {
    query = query.where('publicly_bookable', '=', 1).where('staff_only', '=', 0);
  }
  if (options.locationId) {
    // Un servicio sin sede está disponible en todas.
    query = query.where((eb) =>
      eb.or([eb('location_id', '=', options.locationId!), eb('location_id', 'is', null)]),
    );
  }

  const rows = await query.orderBy('sort_order').orderBy('name').execute();
  if (rows.length === 0) return [];

  const links = await db()
    .selectFrom('service_resources')
    .select(['service_id', 'resource_id'])
    .where(
      'service_id',
      'in',
      rows.map((row) => row.id),
    )
    .execute();

  const byService = new Map<string, string[]>();
  for (const link of links) {
    const list = byService.get(link.service_id) ?? [];
    list.push(link.resource_id);
    byService.set(link.service_id, list);
  }

  return rows.map((row) => mapService(row, byService.get(row.id) ?? []));
}

export async function updateService(
  id: string,
  patch: Partial<CreateServiceInput>,
): Promise<ServiceView> {
  const current = await getService(id);
  if (!current) throw new NotFoundError('El servicio no existe');

  validateFlexibleDuration({
    durationMode: patch.durationMode ?? (current.durationMode as never),
    durationMinutes: patch.durationMinutes ?? current.durationMinutes,
    minDurationMinutes: patch.minDurationMinutes ?? current.minDurationMinutes,
    maxDurationMinutes: patch.maxDurationMinutes ?? current.maxDurationMinutes,
    durationStepMinutes: patch.durationStepMinutes ?? current.durationStepMinutes,
  });

  const update: Record<string, unknown> = { updated_at: isoNow() };
  const map: Record<string, string> = {
    locationId: 'location_id',
    categoryId: 'category_id',
    name: 'name',
    color: 'color',
    imageUrl: 'image_url',
    durationMode: 'duration_mode',
    durationMinutes: 'duration_minutes',
    minDurationMinutes: 'min_duration_minutes',
    maxDurationMinutes: 'max_duration_minutes',
    durationStepMinutes: 'duration_step_minutes',
    bufferBeforeMinutes: 'buffer_before_minutes',
    bufferAfterMinutes: 'buffer_after_minutes',
    priceMode: 'price_mode',
    priceCents: 'price_cents',
    pricePerMinuteCents: 'price_per_minute_cents',
    currency: 'currency',
    depositCents: 'deposit_cents',
    capacity: 'capacity',
    minAdvanceMinutes: 'min_advance_minutes',
    maxAdvanceDays: 'max_advance_days',
    cancellationCutoffMinutes: 'cancellation_cutoff_minutes',
    rescheduleCutoffMinutes: 'reschedule_cutoff_minutes',
    allocationStrategy: 'allocation_strategy',
    sortOrder: 'sort_order',
  };

  for (const [key, column] of Object.entries(map)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) update[column] = value;
  }

  const booleans: Record<string, string> = {
    paymentRequired: 'payment_required',
    requiresCreditPack: 'requires_credit_pack',
    requiresApproval: 'requires_approval',
    allowResourceSelection: 'allow_resource_selection',
    publiclyBookable: 'publicly_bookable',
    staffOnly: 'staff_only',
    active: 'active',
  };
  for (const [key, column] of Object.entries(booleans)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) update[column] = value ? 1 : 0;
  }

  if (patch.nameI18n !== undefined) update.name_i18n_json = JSON.stringify(patch.nameI18n);
  if (patch.description !== undefined) update.description_json = JSON.stringify(patch.description);

  await db().updateTable('services').set(update).where('id', '=', id).execute();

  if (patch.resourceIds !== undefined) {
    await setServiceResources(id, patch.resourceIds);
  }

  return (await getService(id))!;
}

export async function setServiceResources(serviceId: string, resourceIds: string[]): Promise<void> {
  await db().deleteFrom('service_resources').where('service_id', '=', serviceId).execute();
  if (resourceIds.length === 0) return;

  await db()
    .insertInto('service_resources')
    .values(
      [...new Set(resourceIds)].map((resourceId) => ({
        service_id: serviceId,
        resource_id: resourceId,
        duration_minutes: null,
        price_cents: null,
      })),
    )
    .execute();
}

export async function deleteService(id: string): Promise<void> {
  const upcoming = await db()
    .selectFrom('appointments')
    .select(['id'])
    .where('service_id', '=', id)
    .where('starts_at', '>=', isoNow())
    .where('status', 'in', ['pending', 'confirmed'])
    .executeTakeFirst();
  if (upcoming) {
    throw new ConflictError(
      'No se puede borrar un servicio con citas futuras',
      'service_has_appointments',
    );
  }
  await db()
    .updateTable('services')
    .set({ deleted_at: isoNow(), active: 0 })
    .where('id', '=', id)
    .execute();
}

/* -------------------------------------------------------------------------- */
/* Categorías                                                                  */
/* -------------------------------------------------------------------------- */

export async function listCategories(organizationId: string) {
  const rows = await db()
    .selectFrom('service_categories')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .orderBy('sort_order')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameI18n: parseJson<I18nText | null>(row.name_i18n_json, null),
    color: row.color,
    sortOrder: row.sort_order,
  }));
}

export async function createCategory(
  organizationId: string,
  input: { name: string; nameI18n?: I18nText; color?: string; sortOrder?: number },
) {
  const id = newId();
  const now = isoNow();
  await db()
    .insertInto('service_categories')
    .values({
      id,
      organization_id: organizationId,
      name: input.name,
      name_i18n_json: input.nameI18n ? JSON.stringify(input.nameI18n) : null,
      color: input.color ?? null,
      sort_order: input.sortOrder ?? 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return { id };
}

/* -------------------------------------------------------------------------- */
/* Horarios                                                                    */
/* -------------------------------------------------------------------------- */

export async function getSchedule(
  organizationId: string,
  ownerType: string,
  ownerId: string,
): Promise<ScheduleRule[]> {
  const rows = await db()
    .selectFrom('schedules')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .orderBy('weekday')
    .orderBy('start_minute')
    .execute();

  return rows.map((row) => ({
    weekday: row.weekday as ScheduleRule['weekday'],
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }));
}

/** Sustituye el horario completo del propietario indicado. */
export async function setSchedule(
  organizationId: string,
  ownerType: string,
  ownerId: string,
  rules: ScheduleRule[],
): Promise<void> {
  for (const rule of rules) {
    if (rule.endMinute <= rule.startMinute) {
      throw new BadRequestError(
        'La hora de fin tiene que ser posterior a la de inicio',
        'invalid_schedule_rule',
      );
    }
  }

  await db()
    .deleteFrom('schedules')
    .where('organization_id', '=', organizationId)
    .where('owner_type', '=', ownerType)
    .where('owner_id', '=', ownerId)
    .execute();

  if (rules.length === 0) return;

  await db()
    .insertInto('schedules')
    .values(
      rules.map((rule) => ({
        id: newId(),
        organization_id: organizationId,
        owner_type: ownerType,
        owner_id: ownerId,
        weekday: rule.weekday,
        start_minute: rule.startMinute,
        end_minute: rule.endMinute,
        valid_from: rule.validFrom ?? null,
        valid_to: rule.validTo ?? null,
        created_at: isoNow(),
      })),
    )
    .execute();
}

export async function listExceptions(
  organizationId: string,
  options: { ownerType?: string; ownerId?: string; from?: string; to?: string } = {},
) {
  let query = db()
    .selectFrom('schedule_exceptions')
    .selectAll()
    .where('organization_id', '=', organizationId);

  if (options.ownerType) query = query.where('owner_type', '=', options.ownerType);
  if (options.ownerId) query = query.where('owner_id', '=', options.ownerId);
  if (options.from) query = query.where('date', '>=', options.from);
  if (options.to) query = query.where('date', '<=', options.to);

  const rows = await query.orderBy('date').execute();
  return rows.map((row) => ({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    type: row.type,
    date: row.date,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    reason: row.reason,
  }));
}

export async function addException(
  organizationId: string,
  input: ScheduleExceptionInput,
): Promise<{ id: string }> {
  const id = newId();
  await db()
    .insertInto('schedule_exceptions')
    .values({
      id,
      organization_id: organizationId,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      type: input.type,
      date: input.date,
      start_minute: input.startMinute ?? null,
      end_minute: input.endMinute ?? null,
      reason: input.reason ?? null,
      created_at: isoNow(),
    })
    .execute();
  return { id };
}

export async function deleteException(organizationId: string, id: string): Promise<void> {
  await db()
    .deleteFrom('schedule_exceptions')
    .where('organization_id', '=', organizationId)
    .where('id', '=', id)
    .execute();
}

/* -------------------------------------------------------------------------- */
/* Ausencias                                                                   */
/* -------------------------------------------------------------------------- */

export async function listTimeOff(
  organizationId: string,
  options: { resourceId?: string; from?: string; to?: string } = {},
) {
  let query = db()
    .selectFrom('time_off')
    .selectAll()
    .where('organization_id', '=', organizationId);

  if (options.resourceId) query = query.where('resource_id', '=', options.resourceId);
  if (options.from) query = query.where('ends_at', '>=', options.from);
  if (options.to) query = query.where('starts_at', '<=', options.to);

  const rows = await query.orderBy('starts_at').execute();
  return rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    locationId: row.location_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  }));
}

export async function addTimeOff(
  organizationId: string,
  input: {
    resourceId?: string | null;
    locationId?: string | null;
    startsAt: string;
    endsAt: string;
    reason?: string;
  },
  createdBy?: string | null,
): Promise<{ id: string; affectedAppointments: number }> {
  const id = newId();
  await db()
    .insertInto('time_off')
    .values({
      id,
      organization_id: organizationId,
      location_id: input.locationId ?? null,
      resource_id: input.resourceId ?? null,
      starts_at: new Date(input.startsAt).toISOString(),
      ends_at: new Date(input.endsAt).toISOString(),
      reason: input.reason ?? null,
      created_by: createdBy ?? null,
      created_at: isoNow(),
    })
    .execute();

  // Bloquear una franja no cancela lo que ya había: se informa de cuántas citas
  // quedan dentro para que el responsable decida qué hacer con ellas.
  let query = db()
    .selectFrom('appointments')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('organization_id', '=', organizationId)
    .where('starts_at', '<', new Date(input.endsAt).toISOString())
    .where('ends_at', '>', new Date(input.startsAt).toISOString())
    .where('status', 'in', ['pending', 'confirmed']);

  if (input.resourceId) query = query.where('resource_id', '=', input.resourceId);
  else if (input.locationId) query = query.where('location_id', '=', input.locationId);

  const row = await query.executeTakeFirst();
  return { id, affectedAppointments: Number(row?.total ?? 0) };
}

export async function deleteTimeOff(organizationId: string, id: string): Promise<void> {
  await db()
    .deleteFrom('time_off')
    .where('organization_id', '=', organizationId)
    .where('id', '=', id)
    .execute();
}
