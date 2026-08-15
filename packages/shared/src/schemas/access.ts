import { z } from 'zod';
import { ORG_ROLES, PLATFORM_ROLES } from '../enums.js';
import { emailSchema, idSchema, localeSchema } from './common.js';

/**
 * Política de acceso de la instalación.
 *
 * A diferencia de los ajustes de una organización, esto es de toda la
 * instalación: quién puede darse de alta y por qué medios. Lo gestiona el
 * administrador de la plataforma desde el panel, y las variables de entorno
 * solo aportan los valores iniciales.
 */

/** Métodos de acceso que se pueden activar o desactivar. */
export const LOGIN_METHODS = ['password', 'passkey', 'certificate', 'oidc', 'google'] as const;
export type LoginMethod = (typeof LOGIN_METHODS)[number];

/**
 * Modo de registro:
 * - `open`: cualquiera puede crear su cuenta.
 * - `allowlist`: solo quien esté en la lista de autorizados, identificado por
 *   correo, por dominio de correo o por DNI cuando entra con certificado.
 * - `invite_only`: nadie se da de alta por su cuenta; las cuentas las crea el
 *   administrador y la persona las activa con el enlace que recibe por correo.
 * - `closed`: no se admiten altas nuevas de ninguna forma.
 */
export const REGISTRATION_MODES = ['open', 'allowlist', 'invite_only', 'closed'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export const authSettingsSchema = z.object({
  /** Métodos habilitados. Al menos uno tiene que quedar activo. */
  methods: z
    .object({
      password: z.boolean(),
      passkey: z.boolean(),
      certificate: z.boolean(),
      oidc: z.boolean(),
      google: z.boolean(),
    })
    .refine((value) => Object.values(value).some(Boolean), {
      message: 'Tiene que quedar al menos un método de acceso activo',
    }),

  registrationMode: z.enum(REGISTRATION_MODES),

  /**
   * Con `allowlist`, si además se permite que quien entre por primera vez con
   * certificado o con un proveedor externo cree su cuenta aunque no esté en la
   * lista. Con `false`, el certificado solo sirve para entrar en cuentas que ya
   * existen o que estén autorizadas por su NIF.
   */
  autoProvisionCertificate: z.boolean(),
  autoProvisionSocial: z.boolean(),

  /** Exige confirmar el correo antes de poder reservar. */
  requireVerifiedEmail: z.boolean(),

  /**
   * Permite reservar sin cuenta. Es un tope de la instalación: cada
   * organización decide después si lo usa, pero no puede saltárselo.
   */
  allowAnonymousBooking: z.boolean(),

  /** Segundo factor obligatorio para administradores. */
  mfaRequiredForAdmins: z.boolean(),

  /**
   * Cualquier cuenta puede crear su propia organización y quedarse como
   * propietaria. Es lo que convierte la instalación en un servicio abierto.
   * Desactivado (lo normal), solo el administrador de la instalación crea
   * organizaciones.
   */
  allowOrganizationSelfService: z.boolean(),

  /** Dominios de correo admitidos en el alta abierta. Vacío = todos. */
  allowedEmailDomains: z.array(z.string().max(255)).max(200),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

/** Actualización parcial desde el panel. */
export const updateAuthSettingsSchema = authSettingsSchema.partial();

/* -------------------------------------------------------------------------- */
/* Lista de autorizados                                                        */
/* -------------------------------------------------------------------------- */

export const ALLOWLIST_TYPES = ['email', 'nif', 'domain'] as const;
export type AllowlistType = (typeof ALLOWLIST_TYPES)[number];

export const createAllowlistEntrySchema = z
  .object({
    type: z.enum(ALLOWLIST_TYPES),
    /** Correo, NIF/NIE o dominio (`ejemplo.es`, sin arroba). */
    value: z.string().min(3).max(255).trim(),
    note: z.string().max(200).optional(),
    /** Rol de plataforma que se concede al darse de alta. */
    platformRole: z.enum(PLATFORM_ROLES).default('user'),
    /** Organización a la que se une automáticamente. */
    organizationId: idSchema.optional(),
    organizationRole: z.enum(ORG_ROLES).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Correo no válido' });
    }
    if (value.type === 'domain' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Dominio no válido' });
    }
    if (
      value.type === 'nif' &&
      !/^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/i.test(value.value.replace(/[\s-]/g, ''))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'DNI o NIE no válido' });
    }
    if (value.organizationId && !value.organizationRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationRole'],
        message: 'Indica el rol dentro de la organización',
      });
    }
  });
export type CreateAllowlistEntryInput = z.infer<typeof createAllowlistEntrySchema>;

/** Alta en bloque, pegando una lista de correos o de documentos. */
export const bulkAllowlistSchema = z.object({
  type: z.enum(ALLOWLIST_TYPES),
  /** Un valor por línea, o separados por comas y puntos y comas. */
  values: z.string().min(1).max(100_000),
  note: z.string().max(200).optional(),
  organizationId: idSchema.optional(),
  organizationRole: z.enum(ORG_ROLES).optional(),
});

/* -------------------------------------------------------------------------- */
/* Alta de usuarios por el administrador                                       */
/* -------------------------------------------------------------------------- */

export const adminCreateUserSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(120).trim(),
  nif: z.string().max(20).optional(),
  phone: z.string().max(32).optional(),
  locale: localeSchema.optional(),
  platformRole: z.enum(PLATFORM_ROLES).default('user'),
  /** Se le añade a esta organización con este rol. */
  organizationId: idSchema.optional(),
  organizationRole: z.enum(ORG_ROLES).optional(),
  /**
   * Envía el correo de activación. Si es `false`, la cuenta queda creada y
   * pendiente, y el enlace se puede obtener después desde el panel.
   */
  sendInvitation: z.boolean().default(true),
  /** Días de validez del enlace de activación. */
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const activateAccountSchema = z.object({
  token: z.string().min(10).max(500),
  password: z.string().min(10).max(200),
  name: z.string().min(2).max(120).optional(),
});

export const adminListUsersSchema = z.object({
  search: z.string().max(120).optional(),
  status: z.enum(['active', 'pending', 'blocked', 'deleted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** Lo que el frontend necesita saber antes de pintar la pantalla de acceso. */
export const authMethodsResponseSchema = z.object({
  password: z.boolean(),
  passkey: z.boolean(),
  certificate: z.boolean(),
  oidc: z.boolean(),
  google: z.boolean(),
  oidcLabel: z.string(),
  registrationMode: z.enum(REGISTRATION_MODES),
  registrationOpen: z.boolean(),
  allowAnonymousBooking: z.boolean(),
});
export type AuthMethodsResponse = z.infer<typeof authMethodsResponseSchema>;
