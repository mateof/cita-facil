import { z } from 'zod';
import { MFA_METHODS, ORG_ROLES } from '../enums.js';
import {
  emailSchema,
  idSchema,
  localeSchema,
  phoneSchema,
  timezoneSchema,
} from './common.js';

/**
 * Contraseña: mínimo 10 caracteres. No se imponen reglas de composición
 * (mayúsculas, símbolos) porque empeoran la entropía real; en su lugar se
 * rechazan las contraseñas filtradas más comunes en el servicio de auth.
 */
export const passwordSchema = z.string().min(10).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(2).max(120).trim(),
  phone: phoneSchema.optional(),
  locale: localeSchema.optional(),
  timezone: timezoneSchema.optional(),
  acceptTerms: z.literal(true),
  /** Invitación opcional para unirse directamente a una organización. */
  invitationToken: z.string().max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Código de segundo factor si el cliente ya lo tiene a mano. */
  mfaCode: z.string().min(4).max(12).optional(),
  rememberDevice: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  challengeId: idSchema,
  method: z.enum(MFA_METHODS),
  code: z.string().min(4).max(64),
  rememberDevice: z.boolean().optional(),
});

export const mfaEnrollTotpSchema = z.object({
  code: z.string().min(6).max(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(500).optional(),
});

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(500),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(500) });

/** Alta de passkey: el cliente devuelve la respuesta de WebAuthn tal cual. */
export const passkeyRegistrationSchema = z.object({
  response: z.any(),
  deviceName: z.string().max(80).optional(),
});

export const passkeyAuthenticationSchema = z.object({
  response: z.any(),
  challengeId: idSchema,
});

/**
 * Autenticación por certificado. En producción el certificado lo valida el
 * proxy mTLS y llega por cabecera; este cuerpo solo se usa en el modo de
 * desarrollo `CERT_AUTH_ALLOW_BODY=true`.
 */
export const certificateLoginSchema = z.object({
  certificatePem: z.string().min(100).max(20_000).optional(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string().optional(),
  tokenType: z.literal('Bearer'),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  name: z.string(),
  nif: z.string().nullable(),
  locale: localeSchema,
  timezone: z.string(),
  avatarUrl: z.string().nullable(),
  platformRole: z.enum(['superadmin', 'user']),
  mfaEnabled: z.boolean(),
  emailVerified: z.boolean(),
  identityProviders: z.array(z.string()),
  memberships: z.array(
    z.object({
      organizationId: idSchema,
      organizationName: z.string(),
      organizationSlug: z.string(),
      role: z.enum(ORG_ROLES),
      locationIds: z.array(idSchema),
      permissions: z.array(z.string()),
    }),
  ),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Respuesta de login: o bien tokens, o bien un reto de segundo factor. */
export const loginResponseSchema = z.union([
  z.object({
    status: z.literal('authenticated'),
    tokens: authTokensSchema,
    user: sessionUserSchema,
  }),
  z.object({
    status: z.literal('mfa_required'),
    challengeId: idSchema,
    methods: z.array(z.enum(MFA_METHODS)),
    /** Pista del destino del código, ofuscada (`ma***@dominio.com`). */
    hint: z.string().nullable(),
  }),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;
