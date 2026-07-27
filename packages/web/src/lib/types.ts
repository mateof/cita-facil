/** Tipos de las respuestas del API que consume la interfaz. */

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: 'owner' | 'admin' | 'manager' | 'staff';
  locationIds: string[];
  permissions: string[];
}

export interface SessionUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  nif: string | null;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  platformRole: 'superadmin' | 'user';
  mfaEnabled: boolean;
  emailVerified: boolean;
  identityProviders: string[];
  memberships: Membership[];
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export type LoginResponse =
  | { status: 'authenticated'; tokens: AuthTokens; user: SessionUser }
  | { status: 'mfa_required'; challengeId: string; methods: string[]; hint: string | null };

export interface PublicConfig {
  appName: string;
  defaultLocale: string;
  locales: string[];
  defaultTimezone: string;
  authMethods: string[];
  registrationOpen: boolean;
  paymentsEnabled: boolean;
  pushEnabled: boolean;
}

export interface AuthMethods {
  password: boolean;
  passkey: boolean;
  certificate: boolean;
  oidc: boolean;
  google: boolean;
  oidcLabel: string;
  registrationMode: 'open' | 'allowlist' | 'invite_only' | 'closed';
  registrationOpen: boolean;
  allowAnonymousBooking: boolean;
}

export interface AuthSettings {
  methods: {
    password: boolean;
    passkey: boolean;
    certificate: boolean;
    oidc: boolean;
    google: boolean;
  };
  registrationMode: 'open' | 'allowlist' | 'invite_only' | 'closed';
  autoProvisionCertificate: boolean;
  autoProvisionSocial: boolean;
  requireVerifiedEmail: boolean;
  allowAnonymousBooking: boolean;
  mfaRequiredForAdmins: boolean;
  allowOrganizationSelfService: boolean;
  allowedEmailDomains: string[];
  configured: { oidc: boolean; google: boolean };
  googleRedirectUri: string;
  oidcRedirectUri: string;
}

export interface AllowlistEntry {
  id: string;
  type: 'email' | 'nif' | 'domain';
  value: string;
  note: string | null;
  platformRole: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationRole: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface PlatformUser {
  id: string;
  email: string | null;
  name: string;
  nif: string | null;
  phone: string | null;
  platformRole: string;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PublicLocation {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  timezone: string;
  description: string;
}

export interface PublicService {
  id: string;
  locationId: string | null;
  categoryId: string | null;
  name: string;
  description: string;
  color: string | null;
  imageUrl: string | null;
  icon: string | null;
  durationMode: 'fixed' | 'flexible';
  durationMinutes: number;
  minDurationMinutes: number | null;
  maxDurationMinutes: number | null;
  durationStepMinutes: number | null;
  priceMode: string;
  priceCents: number;
  pricePerMinuteCents: number | null;
  currency: string;
  depositCents: number;
  capacity: number;
  requiresApproval: boolean;
  requiresCreditPack: boolean;
  allowResourceSelection: boolean;
  resourceIds: string[];
  maxAdvanceDays: number;
  minAdvanceMinutes: number;
  cancellationCutoffMinutes: number;
}

export interface PublicResource {
  id: string;
  locationId: string;
  name: string;
  type: string;
  color: string | null;
  imageUrl: string | null;
  capacity: number;
}

export type PublicPageKey = 'contact' | 'about';

export interface PublicPage {
  key: PublicPageKey;
  format: 'markdown' | 'html';
  title: string;
  body: string;
}

/** Página de contenido tal y como la edita el panel, con sus idiomas. */
export interface OrganizationPage {
  id: string | null;
  key: PublicPageKey;
  format: 'markdown' | 'html';
  title: Record<string, string> | null;
  body: Record<string, string> | null;
  published: boolean;
  sortOrder: number;
  updatedAt: string | null;
}

export interface PublicOrganization {
  organization: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    locale: string;
    currency: string;
    phone: string | null;
    email: string | null;
    branding: {
      brandColor: string;
      logoUrl: string | null;
      termsUrl: string | null;
      privacyUrl: string | null;
    };
    allowGuestBooking: boolean;
    waitlistEnabled: boolean;
    imageUrl: string | null;
    icon: string | null;
    color: string | null;
  };
  /** Páginas de contenido publicadas, para el pie. */
  pages: { key: PublicPageKey; title: string }[];
  locations: PublicLocation[];
  categories: { id: string; name: string; color: string | null; sortOrder: number }[];
  services: PublicService[];
  resources: PublicResource[];
  theme: {
    variables: Record<string, string>;
    customCss: string | null;
    header: {
      longName?: string | null;
      shortName?: string | null;
      color?: string | null;
      fontSize?: string | null;
      weight?: string | null;
      fontFamily?: 'system' | 'serif' | 'mono' | 'rounded' | null;
      useImage?: boolean;
    } | null;
  } | null;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  localDate: string;
  localStartMinute: number;
  durationMinutes: number;
  resourceIds: string[];
  remainingCapacity: number;
  priceCents: number;
  currency: string;
}

export interface Availability {
  serviceId: string;
  timezone: string;
  durationMinutes: number;
  days: { date: string; closed: boolean; slots: Slot[] }[];
}

export interface Appointment {
  id: string;
  organizationId: string;
  organizationName: string;
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  serviceId: string;
  serviceName: string;
  resourceId: string | null;
  resourceName: string | null;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  locale: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  localStartMinute: number;
  durationMinutes: number;
  timezone: string;
  status: string;
  source: string;
  partySize: number;
  priceCents: number;
  currency: string;
  paymentStatus: string;
  notes: string | null;
  internalNotes: string | null;
  accessCode: string;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminService {
  id: string;
  organizationId: string;
  locationId: string | null;
  categoryId: string | null;
  name: string;
  description: Record<string, string> | null;
  color: string | null;
  imageUrl: string | null;
  icon: string | null;
  durationMode: 'fixed' | 'flexible';
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
  maxAdvanceDays: number;
  rescheduleCutoffMinutes: number;
  allowResourceSelection: boolean;
  publiclyBookable: boolean;
  staffOnly: boolean;
  sortOrder: number;
  active: boolean;
  resourceIds: string[];
  /** `null` = hereda el plazo de la organización. */
  minAdvanceMinutes: number | null;
  cancellationCutoffMinutes: number | null;
  creditChargeMode: 'inherit' | 'booking' | 'completion';
}

export interface AdminResource {
  id: string;
  organizationId: string;
  locationId: string;
  userId: string | null;
  name: string;
  type: string;
  capacity: number;
  color: string | null;
  imageUrl: string | null;
  icon: string | null;
  bookableDirectly: boolean;
  sortOrder: number;
  active: boolean;
}

export interface AdminLocation {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  timezone: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface TodayPanel {
  date: string;
  timezone: string;
  dayStart: string;
  counts: {
    total: number;
    pending: number;
    confirmed: number;
    checkedIn: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  appointments: {
    id: string;
    startsAt: string;
    endsAt: string;
    localStartMinute: number;
    durationMinutes: number;
    status: string;
    partySize: number;
    priceCents: number;
    paymentStatus: string;
    checkedInAt: string | null;
    accessCode: string;
    customerName: string | null;
    customerPhone: string | null;
    serviceName: string | null;
    serviceColor: string | null;
    resourceName: string | null;
  }[];
}

export interface ScheduleRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface ReminderRule {
  id?: string;
  offsetMinutes: number;
  channels: string[];
  enabled: boolean;
  serviceId?: string | null;
}

/* ------------------------------------------------------------------- Bonos */

export interface CreditPack {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  priceCents: number;
  currency: string;
  validityDays: number;
  serviceIds: string[];
  serviceNames: string[];
  onlinePurchase: boolean;
  sortOrder: number;
  active: boolean;
  /** Bonos vivos emitidos de este tipo. Solo llega en el panel. */
  issuedCount?: number;
  imageUrl: string | null;
  icon: string | null;
  color: string | null;
}

export type CreditWalletStatus = 'active' | 'exhausted' | 'expired' | 'cancelled';

export interface CreditWallet {
  id: string;
  packId: string | null;
  packName: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  total: number;
  used: number;
  remaining: number;
  expiresAt: string | null;
  status: CreditWalletStatus;
  source: string;
  note: string | null;
  serviceIds: string[];
  serviceNames: string[];
  createdAt: string;
}

/** Persona a la que se le puede entregar un bono. */
export interface CreditCustomer {
  id: string;
  name: string;
  email: string | null;
}

export interface CreditMovement {
  id: string;
  delta: number;
  reason: string;
  appointmentId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreditBalance {
  available: number;
  wallets: CreditWallet[];
  packsForSale: CreditPack[];
}

export interface CreditEligibility {
  required: boolean;
  allowed: boolean;
  available: number;
  reason: 'ok' | 'not_required' | 'anonymous' | 'no_credits';
  packsForSale: CreditPack[];
}
