/**
 * Definición de tablas para Kysely.
 *
 * Convenciones:
 * - Los identificadores son UUID v7 en texto (`varchar(36)`), generados en la
 *   aplicación: ordenables por tiempo y válidos en los cinco motores.
 * - Los booleanos viajan como `number` (0/1). Usa `fromDbBool` al leerlos.
 * - Los campos `*_json` son texto con JSON serializado.
 * - Los instantes son cadenas ISO-8601 UTC; las fechas locales, `YYYY-MM-DD`;
 *   las horas locales, minutos desde medianoche.
 */

export interface Database {
  organizations: OrganizationsTable;
  locations: LocationsTable;
  settings: SettingsTable;

  users: UsersTable;
  identities: IdentitiesTable;
  webauthn_credentials: WebauthnCredentialsTable;
  sessions: SessionsTable;
  auth_challenges: AuthChallengesTable;
  trusted_devices: TrustedDevicesTable;
  verification_tokens: VerificationTokensTable;
  memberships: MembershipsTable;
  membership_locations: MembershipLocationsTable;
  invitations: InvitationsTable;
  access_allowlist: AccessAllowlistTable;

  service_categories: ServiceCategoriesTable;
  services: ServicesTable;
  service_resources: ServiceResourcesTable;
  resources: ResourcesTable;
  schedules: SchedulesTable;
  schedule_exceptions: ScheduleExceptionsTable;
  time_off: TimeOffTable;

  appointments: AppointmentsTable;
  appointment_recurrences: AppointmentRecurrencesTable;
  waitlist_entries: WaitlistEntriesTable;
  reviews: ReviewsTable;
  idempotency_keys: IdempotencyKeysTable;

  notification_preferences: NotificationPreferencesTable;
  notification_templates: NotificationTemplatesTable;
  notifications: NotificationsTable;
  reminder_rules: ReminderRulesTable;
  push_devices: PushDevicesTable;
  messaging_links: MessagingLinksTable;

  payments: PaymentsTable;
  organization_pages: OrganizationPagesTable;
  credit_packs: CreditPacksTable;
  credit_wallets: CreditWalletsTable;
  themes: ThemesTable;
  credit_debts: CreditDebtsTable;
  appointment_schedules: AppointmentSchedulesTable;
  schedule_occurrences: ScheduleOccurrencesTable;
  credit_ledger: CreditLedgerTable;
  customer_profiles: CustomerProfilesTable;
  queue_entries: QueueEntriesTable;
  forms: FormsTable;
  service_forms: ServiceFormsTable;
  form_responses: FormResponsesTable;

  api_keys: ApiKeysTable;
  webhook_endpoints: WebhookEndpointsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  audit_logs: AuditLogsTable;
  access_logs: AccessLogsTable;
  backups: BackupsTable;
}

/* -------------------------------------------------------------------------- */

export interface OrganizationsTable {
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
  updated_at: string;
  deleted_at: string | null;
  image_url: string | null;
  icon: string | null;
  color: string | null;
}

export interface LocationsTable {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  timezone: string;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  region: string | null;
  country: string;
  /** Coordenadas en texto para no depender del tipo decimal de cada motor. */
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  email: string | null;
  description_json: string | null;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  image_url: string | null;
  icon: string | null;
  color: string | null;
}

/** Ajustes por organización que no caben en columnas fijas (pagos, marca, etc.). */
export interface SettingsTable {
  id: string;
  organization_id: string | null;
  namespace: string;
  key: string;
  value_json: string | null;
  /** 1 si el valor está cifrado con AES-256-GCM. */
  encrypted: number;
  updated_at: string;
}

/* ------------------------------------------------------------------ Usuarios */

export interface UsersTable {
  id: string;
  email: string | null;
  /** Copia no nula del email (o del id si no hay) para poder indexar en único. */
  email_key: string;
  email_verified: number;
  phone: string | null;
  phone_verified: number;
  password_hash: string | null;
  name: string;
  given_name: string | null;
  family_name: string | null;
  /** DNI/NIE normalizado en mayúsculas y sin separadores. */
  nif: string | null;
  nif_key: string;
  locale: string;
  timezone: string;
  avatar_url: string | null;
  platform_role: string;
  status: string;
  mfa_enabled: number;
  mfa_totp_secret: string | null;
  mfa_recovery_codes: string | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  /** Contador de faltas sin avisar, para las políticas anti no-show. */
  no_show_count: number;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  marketing_opt_in: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  icon: string | null;
  color: string | null;
}

export interface IdentitiesTable {
  id: string;
  user_id: string;
  provider: string;
  /** Identificador del sujeto en el proveedor: `sub` de OIDC, NIF del certificado... */
  subject: string;
  /** Emisor, para certificados y OIDC. */
  issuer: string | null;
  metadata_json: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface WebauthnCredentialsTable {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  device_name: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip: string | null;
  /** Método con el que se inició la sesión. */
  auth_method: string;
  /** 1 si la sesión ya superó el segundo factor. */
  mfa_satisfied: number;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string;
  created_at: string;
}

/** Retos temporales: segundo factor pendiente, WebAuthn, OIDC state, vinculaciones. */
export interface AuthChallengesTable {
  id: string;
  user_id: string | null;
  kind: string;
  /** Reto de WebAuthn, `state` de OIDC, código enviado por email... */
  payload_json: string | null;
  code_hash: string | null;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface TrustedDevicesTable {
  id: string;
  user_id: string;
  token_hash: string;
  label: string | null;
  expires_at: string;
  created_at: string;
}

export interface VerificationTokensTable {
  id: string;
  user_id: string;
  purpose: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface MembershipsTable {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  /** Título profesional visible al cliente (p. ej. "Fisioterapeuta"). */
  job_title: string | null;
  /** 1 si el miembro tiene agenda propia como recurso. */
  bookable: number;
  active: number;
  created_at: string;
  updated_at: string;
}

/** Restringe un miembro a sedes concretas. Sin filas = todas las sedes. */
export interface MembershipLocationsTable {
  membership_id: string;
  location_id: string;
}

export interface InvitationsTable {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token_hash: string;
  invited_by: string | null;
  location_ids_json: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

/** Personas autorizadas a registrarse cuando el alta no es abierta. */
export interface AccessAllowlistTable {
  id: string;
  /** `email`, `nif` o `domain`. */
  type: string;
  value: string;
  note: string | null;
  platform_role: string;
  organization_id: string | null;
  organization_role: string | null;
  created_by: string | null;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ Catálogo */

export interface ServiceCategoriesTable {
  id: string;
  organization_id: string;
  name: string;
  name_i18n_json: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  image_url: string | null;
  icon: string | null;
}

export interface ServicesTable {
  id: string;
  organization_id: string;
  location_id: string | null;
  category_id: string | null;
  name: string;
  name_i18n_json: string | null;
  description_json: string | null;
  color: string | null;
  image_url: string | null;

  duration_mode: string;
  duration_minutes: number;
  min_duration_minutes: number | null;
  max_duration_minutes: number | null;
  duration_step_minutes: number | null;

  buffer_before_minutes: number;
  buffer_after_minutes: number;

  price_mode: string;
  price_cents: number;
  price_per_minute_cents: number | null;
  currency: string;
  deposit_cents: number;
  payment_required: number;
  /** `-1` hereda el cargo por falta de la organización. */
  no_show_fee_cents: number;
  /** Solo se puede reservar con un bono activo que cubra este servicio. */
  requires_credit_pack: number;

  capacity: number;
  requires_approval: number;
  /** `-1` hereda el plazo de la organización. Ver `appointments/rules.ts`. */
  min_advance_minutes: number;
  max_advance_days: number;
  /** `-1` hereda el plazo de la organización. */
  cancellation_cutoff_minutes: number;
  reschedule_cutoff_minutes: number;
  allocation_strategy: string | null;
  allow_resource_selection: number;
  publicly_bookable: number;
  staff_only: number;
  /** Definición de campos adicionales del formulario de reserva. */
  custom_fields_json: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  icon: string | null;
  /** `inherit`, `booking` o `completion`. */
  credit_charge_mode: string | null;
}

export interface ServiceResourcesTable {
  service_id: string;
  resource_id: string;
  /** Sobrescribe la duración del servicio para ese recurso concreto. */
  duration_minutes: number | null;
  price_cents: number | null;
}

export interface ResourcesTable {
  id: string;
  organization_id: string;
  location_id: string;
  user_id: string | null;
  name: string;
  type: string;
  description_json: string | null;
  capacity: number;
  color: string | null;
  image_url: string | null;
  bookable_directly: number;
  sort_order: number;
  active: number;
  /** Comisión del profesional en puntos básicos: 1000 = 10 %. */
  commission_bp: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  icon: string | null;
}

export interface SchedulesTable {
  id: string;
  organization_id: string;
  owner_type: string;
  owner_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
}

export interface ScheduleExceptionsTable {
  id: string;
  organization_id: string;
  owner_type: string;
  owner_id: string;
  type: string;
  date: string;
  start_minute: number | null;
  end_minute: number | null;
  reason: string | null;
  created_at: string;
}

export interface TimeOffTable {
  id: string;
  organization_id: string;
  location_id: string | null;
  resource_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

/* --------------------------------------------------------------------- Citas */

export interface AppointmentsTable {
  id: string;
  organization_id: string;
  location_id: string;
  service_id: string;
  resource_id: string | null;
  customer_id: string | null;

  /** Datos de contacto cuando se reserva sin cuenta. */
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_locale: string | null;

  starts_at: string;
  ends_at: string;
  /** Incluye los márgenes previo y posterior; es lo que bloquea la agenda. */
  block_starts_at: string;
  block_ends_at: string;
  local_date: string;
  local_start_minute: number;
  duration_minutes: number;
  timezone: string;

  status: string;
  source: string;
  party_size: number;

  price_cents: number;
  currency: string;
  payment_status: string;

  notes: string | null;
  internal_notes: string | null;
  custom_fields_json: string | null;

  /** Código del QR y del control de acceso físico. */
  access_code: string;
  access_uses: number;
  /** Cuándo dijo el cliente que iba a venir, desde el enlace del recordatorio. */
  attendance_confirmed_at: string | null;
  /** Cargo aplicado por faltar o por avisar fuera de plazo. */
  no_show_fee_cents: number;
  checked_in_at: string | null;
  completed_at: string | null;

  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;

  recurrence_id: string | null;
  /** Cita de la que procede tras una reprogramación. */
  rescheduled_from: string | null;
  waitlist_entry_id: string | null;

  /** Bono del que salió el crédito de esta cita, si el servicio lo exige. */
  credit_wallet_id: string | null;
  hold_expires_at: string | null;
  reminder_scheduled_at: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRecurrencesTable {
  id: string;
  organization_id: string;
  interval_weeks: number;
  weekdays_json: string;
  until_date: string | null;
  occurrence_count: number | null;
  created_by: string | null;
  created_at: string;
}

export interface WaitlistEntriesTable {
  id: string;
  organization_id: string;
  location_id: string | null;
  service_id: string;
  resource_id: string | null;
  customer_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  from_date: string;
  to_date: string;
  earliest_minute: number;
  latest_minute: number;
  weekdays_json: string | null;
  party_size: number;
  notes: string | null;
  status: string;
  offered_appointment_id: string | null;
  offer_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewsTable {
  id: string;
  organization_id: string;
  appointment_id: string;
  customer_id: string | null;
  resource_id: string | null;
  service_id: string;
  rating: number;
  comment: string | null;
  published: number;
  reply: string | null;
  created_at: string;
}

export interface IdempotencyKeysTable {
  id: string;
  scope: string;
  key_hash: string;
  response_json: string | null;
  created_at: string;
  expires_at: string;
}

/* ------------------------------------------------------------- Notificaciones */

export interface NotificationPreferencesTable {
  id: string;
  /** Preferencia de un usuario, o valor por defecto de una organización. */
  user_id: string | null;
  organization_id: string | null;
  event: string;
  channel: string;
  enabled: number;
  updated_at: string;
}

export interface NotificationTemplatesTable {
  id: string;
  organization_id: string | null;
  event: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  enabled: number;
  updated_at: string;
}

export interface NotificationsTable {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  appointment_id: string | null;
  event: string;
  channel: string;
  locale: string;
  /** Dirección de correo, chat id de Telegram, teléfono, token push... */
  destination: string;
  subject: string | null;
  body: string;
  payload_json: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  /** Agrupa los avisos de un mismo recordatorio para poder cancelarlos juntos. */
  group_key: string | null;
  created_at: string;
}

export interface ReminderRulesTable {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  service_id: string | null;
  offset_minutes: number;
  channels_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface PushDevicesTable {
  id: string;
  user_id: string;
  provider: string;
  token: string;
  keys_json: string | null;
  device_name: string | null;
  locale: string | null;
  last_used_at: string | null;
  failure_count: number;
  created_at: string;
}

/** Vinculación de un usuario con Telegram o WhatsApp. */
export interface MessagingLinksTable {
  id: string;
  user_id: string;
  channel: string;
  /** `chat_id` de Telegram o teléfono en formato E.164 para WhatsApp. */
  external_id: string;
  username: string | null;
  verified: number;
  opt_out: number;
  created_at: string;
}

/* -------------------------------------------------------------------- Pagos */

export interface PaymentsTable {
  id: string;
  organization_id: string;
  appointment_id: string | null;
  credit_pack_id: string | null;
  user_id: string | null;
  provider: string;
  amount_cents: number;
  currency: string;
  status: string;
  external_id: string | null;
  external_reference: string | null;
  refunded_cents: number;
  metadata_json: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationPagesTable {
  id: string;
  organization_id: string;
  /** `contact`, `about`, y las que se añadan después. */
  key: string;
  /** `markdown` o `html`. Se guarda el contenido tal cual se escribió. */
  format: string;
  title_i18n_json: string | null;
  body_i18n_json: string | null;
  published: number;
  sort_order: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditPacksTable {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  credits: number;
  price_cents: number;
  currency: string;
  validity_days: number;
  /** Servicios donde se canjea. Nulo o lista vacía = todos. */
  service_ids_json: string | null;
  /** Se puede comprar desde la web. Si no, solo lo emite el centro. */
  online_purchase: number;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
  image_url: string | null;
  icon: string | null;
  color: string | null;
}

export interface CreditWalletsTable {
  id: string;
  organization_id: string;
  user_id: string;
  credit_pack_id: string | null;
  credits_total: number;
  credits_used: number;
  expires_at: string | null;
  /** `online` si lo compró el cliente, `admin` si lo emitió el centro. */
  source: string;
  granted_by: string | null;
  payment_id: string | null;
  note: string | null;
  /** Anulado por el centro. No se borra: el histórico de consumos cuelga de él. */
  cancelled_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreditLedgerTable {
  id: string;
  wallet_id: string;
  appointment_id: string | null;
  delta: number;
  reason: string;
  created_by: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Lo que el mostrador anota sobre una persona. El resto de la ficha (citas,
 * gasto, faltas, saldo) se calcula de las tablas de siempre.
 */
export interface CustomerProfilesTable {
  id: string;
  organization_id: string;
  user_id: string;
  notes: string | null;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Turno de la cola sin cita previa. No es una cita: no ocupa hueco ni bloquea
 * disponibilidad hasta que alguien lo atiende.
 */
export interface QueueEntriesTable {
  id: string;
  organization_id: string;
  location_id: string;
  service_id: string | null;
  resource_id: string | null;
  customer_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  /** Número visible en la pantalla de sala; se reinicia cada día. */
  ticket_number: number;
  local_date: string;
  party_size: number;
  /** `waiting`, `called`, `serving`, `done`, `left`. */
  status: string;
  note: string | null;
  source: string;
  called_at: string | null;
  served_at: string | null;
  closed_at: string | null;
  appointment_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Formulario o consentimiento de la organización. Se engancha a los servicios
 * que lo piden, no al revés: la misma hoja vale para varios tratamientos.
 */
export interface FormsTable {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  /** `form` o `consent`. */
  kind: string;
  fields_json: string | null;
  consent_text: string | null;
  requires_signature: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceFormsTable {
  service_id: string;
  form_id: string;
  required: number;
  /** Se pide una sola vez por persona, no en cada cita. */
  once_per_customer: number;
  sort_order: number;
}

export interface FormResponsesTable {
  id: string;
  organization_id: string;
  form_id: string;
  appointment_id: string | null;
  customer_id: string | null;
  guest_name: string | null;
  answers_json: string | null;
  accepted_at: string | null;
  signature_name: string | null;
  ip: string | null;
  created_at: string;
}

/* ------------------------------------------------------------ Integraciones */

export interface ApiKeysTable {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes_json: string;
  /** Restringe el uso a estas IP o rangos CIDR. */
  ip_allowlist_json: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WebhookEndpointsTable {
  id: string;
  organization_id: string;
  url: string;
  secret: string;
  events_json: string;
  active: number;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveriesTable {
  id: string;
  endpoint_id: string;
  event: string;
  payload_json: string;
  status: string;
  response_code: number | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface AuditLogsTable {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes_json: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AccessLogsTable {
  id: string;
  organization_id: string;
  location_id: string | null;
  appointment_id: string | null;
  user_id: string | null;
  device_id: string | null;
  presented_code: string | null;
  result: string;
  granted: number;
  reason: string | null;
  created_at: string;
}

export interface BackupsTable {
  id: string;
  filename: string;
  size_bytes: number;
  db_client: string;
  format: string;
  encrypted: number;
  checksum: string | null;
  trigger: string;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ThemesTable {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  tokens_json: string | null;
  custom_css: string | null;
  header_json: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CreditDebtsTable {
  id: string;
  organization_id: string;
  user_id: string;
  appointment_id: string | null;
  service_id: string | null;
  settled_wallet_id: string | null;
  settled_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentSchedulesTable {
  id: string;
  organization_id: string;
  service_id: string;
  location_id: string | null;
  resource_id: string | null;
  customer_id: string;
  weekday: number;
  start_minute: number;
  duration_minutes: number | null;
  notes: string | null;
  on_conflict: string;
  horizon_days: number;
  active: number;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleOccurrencesTable {
  id: string;
  schedule_id: string;
  date: string;
  appointment_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
}
