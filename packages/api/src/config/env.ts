import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DB_CLIENTS, LOCALES } from '@cita-facil/shared';

loadDotenv({ quiet: true } as never);

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((value) =>
      typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(value.toLowerCase()),
    );

const int = (fallback: number) => z.coerce.number().int().default(fallback);

const csv = <T extends string>(values: readonly T[], fallback: T[]) =>
  z
    .string()
    .optional()
    .transform((raw) =>
      (raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : fallback) as T[],
    )
    .refine((list) => list.every((v) => values.includes(v)), {
      message: `Valores admitidos: ${values.join(', ')}`,
    });

const envSchema = z.object({
  /* ---------------------------------------------------------------- General */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000),
  HOST: z.string().default('0.0.0.0'),
  /** URL pública de la aplicación. Se usa en enlaces de correo, QR y webhooks. */
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('CitaFácil'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Orígenes permitidos por CORS. Vacío = mismo origen (el front va integrado). */
  CORS_ORIGINS: z.string().optional(),
  TRUST_PROXY: bool(false),
  /** Sirve el frontend compilado desde el propio proceso del API. */
  SERVE_WEB: bool(true),
  WEB_DIST_PATH: z.string().optional(),
  DEFAULT_LOCALE: z.enum(LOCALES).default('es'),
  DEFAULT_TIMEZONE: z.string().default('Europe/Madrid'),
  DATA_DIR: z.string().default('./data'),

  /* --------------------------------------------------------------- Base de datos */
  DB_CLIENT: z.enum(DB_CLIENTS).default('sqlite'),
  DB_FILE: z.string().default('./data/cita-facil.sqlite'),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().optional(),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_SCHEMA: z.string().optional(),
  DB_SSL: bool(false),
  DB_SSL_REJECT_UNAUTHORIZED: bool(true),
  DB_POOL_MIN: int(0),
  DB_POOL_MAX: int(10),
  /** Ejecuta las migraciones pendientes al arrancar. */
  DB_AUTO_MIGRATE: bool(true),
  /** Carga datos de ejemplo si la base de datos está vacía. */
  DB_AUTO_SEED: bool(false),
  DB_LOG_QUERIES: bool(false),

  /* ------------------------------------------------------------------ Seguridad */
  /** Clave maestra de firma y cifrado. Obligatoria en producción. */
  APP_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_MINUTES: int(15),
  REFRESH_TOKEN_TTL_DAYS: int(30),
  SESSION_COOKIE_NAME: z.string().default('cf_session'),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z.string().optional(),
  RATE_LIMIT_MAX: int(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /* --------------------------------------------------------------------- Redis */
  /**
   * Redis es opcional. Sin él la aplicación funciona igual: el limitador cuenta
   * en memoria del proceso y cada petición autenticada comprueba la sesión en
   * la base de datos. Con él, el cupo se comparte entre instancias y la
   * comprobación de sesión se cachea.
   */
  REDIS_URL: z.string().optional(),
  /** Prefijo de las claves, para compartir un Redis entre varias aplicaciones. */
  REDIS_PREFIX: z.string().default('cf:'),
  /** Segundos que se cachea el estado de una sesión. 0 desactiva la caché. */
  REDIS_SESSION_TTL: int(60),
  AUTH_RATE_LIMIT_MAX: int(10),
  PASSWORD_MIN_LENGTH: int(10),
  /**
   * Métodos de autenticación habilitados de fábrica. A partir del primer
   * cambio en el panel manda lo guardado en base de datos: esto solo fija el
   * estado inicial de una instalación recién creada.
   */
  AUTH_METHODS: csv(
    ['password', 'passkey', 'certificate', 'oidc', 'clave', 'google'] as const,
    ['password', 'passkey', 'certificate'],
  ),
  /**
   * Política de alta inicial: `open`, `allowlist`, `invite_only` o `closed`.
   * También se cambia después desde el panel.
   */
  REGISTRATION_MODE: z.enum(['open', 'allowlist', 'invite_only', 'closed']).default('open'),
  /** Tope de la instalación para la reserva sin cuenta. */
  ALLOW_ANONYMOUS_BOOKING: bool(true),
  MFA_REQUIRED_FOR_ADMINS: bool(false),
  MFA_TRUSTED_DEVICE_DAYS: int(30),

  /* ------------------------------------------------------ Certificado / DNIe / mTLS */
  /** Cabecera por la que el proxy inverso entrega el certificado del cliente. */
  CERT_HEADER: z.string().default('x-client-cert'),
  /** Cabecera con el veredicto de verificación del proxy (`SUCCESS`, `NONE`, ...). */
  CERT_VERIFY_HEADER: z.string().default('x-client-verify'),
  /** Directorio con los certificados raíz e intermedios de confianza (PEM). */
  CERT_TRUST_DIR: z.string().default('./config/trust'),
  /** Comprueba la lista de revocación antes de aceptar el certificado. */
  CERT_CHECK_CRL: bool(false),
  CERT_CRL_DIR: z.string().default('./data/crl'),
  CERT_CRL_REFRESH_HOURS: int(24),
  /** Permite enviar el certificado en el cuerpo. Solo para desarrollo. */
  CERT_AUTH_ALLOW_BODY: bool(false),
  /** Crea la cuenta automáticamente la primera vez que entra un certificado válido. */
  CERT_AUTO_PROVISION: bool(true),

  /* --------------------------------------------------------------------- OIDC / Cl@ve */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().default('openid profile email'),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_LABEL: z.string().default('Cl@ve'),

  /* ------------------------------------------------------------------ Google */
  /**
   * Credenciales de un cliente OAuth 2.0 de tipo "aplicación web" creado en
   * Google Cloud. La URI de retorno se deriva de APP_URL si no se indica.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  /** Restringe el acceso a las cuentas de estos dominios de Google Workspace. */
  GOOGLE_HOSTED_DOMAINS: z.string().optional(),

  /* ------------------------------------------------------------------- WebAuthn */
  WEBAUTHN_RP_NAME: z.string().optional(),
  /** Dominio del servicio. Se deriva de APP_URL si no se indica. */
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().optional(),

  /* ------------------------------------------------------------------ Correo */
  MAIL_ENABLED: bool(true),
  /** `smtp`, `json` (registra en el log, útil en desarrollo) o `none`. */
  MAIL_TRANSPORT: z.enum(['smtp', 'json', 'none']).default('json'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('CitaFácil <no-reply@localhost>'),
  MAIL_REPLY_TO: z.string().optional(),

  /* ------------------------------------------------------------- Push (FCM / WebPush) */
  PUSH_ENABLED: bool(false),
  /** Ruta al JSON de la cuenta de servicio de Firebase, o su contenido en base64. */
  FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_PROJECT_ID: z.string().optional(),
  WEBPUSH_PUBLIC_KEY: z.string().optional(),
  WEBPUSH_PRIVATE_KEY: z.string().optional(),
  WEBPUSH_SUBJECT: z.string().default('mailto:admin@localhost'),

  /* ---------------------------------------------------------------- Telegram */
  TELEGRAM_ENABLED: bool(false),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  /* ---------------------------------------------------------------- WhatsApp */
  WHATSAPP_ENABLED: bool(false),
  /** API oficial de Meta (WhatsApp Cloud API). */
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  /* --------------------------------------------------------------------- SMS */
  SMS_ENABLED: bool(false),
  SMS_PROVIDER: z.enum(['twilio', 'none']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  /* ------------------------------------------------------------------- Pagos */
  PAYMENTS_ENABLED: bool(false),
  PAYMENTS_DEFAULT_PROVIDER: z.enum(['stripe', 'redsys', 'manual']).default('stripe'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  REDSYS_MERCHANT_CODE: z.string().optional(),
  REDSYS_TERMINAL: z.string().default('001'),
  REDSYS_SECRET_KEY: z.string().optional(),
  REDSYS_ENVIRONMENT: z.enum(['test', 'live']).default('test'),

  /* ----------------------------------------------------------------- Backups */
  BACKUP_ENABLED: bool(true),
  BACKUP_DIR: z.string().default('./data/backups'),
  /** Expresión cron. Por defecto, todos los días a las 3:30. */
  BACKUP_CRON: z.string().default('30 3 * * *'),
  BACKUP_RETENTION_DAYS: int(30),
  BACKUP_MAX_FILES: int(60),
  /** Cifra el backup con AES-256-GCM derivando la clave de APP_SECRET. */
  BACKUP_ENCRYPT: bool(false),

  /* ------------------------------------------------------------ Integraciones */
  MCP_ENABLED: bool(true),
  /** Ruta HTTP del servidor MCP (transporte streamable). */
  MCP_PATH: z.string().default('/mcp'),
  ALEXA_ENABLED: bool(false),
  ALEXA_SKILL_ID: z.string().optional(),
  GOOGLE_ASSISTANT_ENABLED: bool(false),
  GOOGLE_PROJECT_ID: z.string().optional(),
  PUBLIC_API_ENABLED: bool(true),
  WEBHOOKS_ENABLED: bool(true),

  /* -------------------------------------------------------------- Planificador */
  SCHEDULER_ENABLED: bool(true),
  /** Frecuencia con la que se despacha la cola de notificaciones. */
  NOTIFICATION_DISPATCH_CRON: z.string().default('* * * * *'),
  NOTIFICATION_MAX_ATTEMPTS: int(5),
  NOTIFICATION_BATCH_SIZE: int(50),

  /* ------------------------------------------------------ Primer administrador */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ORG_NAME: z.string().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

function parseEnv(): RawEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida en las variables de entorno:\n${details}`);
  }
  return parsed.data;
}

const raw = parseEnv();

if (raw.NODE_ENV === 'production' && !raw.APP_SECRET) {
  throw new Error(
    'APP_SECRET es obligatoria en producción. Genera una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  );
}

/** Secreto efectivo. En desarrollo se usa uno fijo para no invalidar sesiones al reiniciar. */
const appSecret =
  raw.APP_SECRET ?? 'desarrollo-inseguro-cambia-APP_SECRET-antes-de-produccion-0000';

const appUrl = new URL(raw.APP_URL);

export const env = {
  ...raw,
  APP_SECRET: appSecret,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS
    ? raw.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [],
  webauthn: {
    rpName: raw.WEBAUTHN_RP_NAME ?? raw.APP_NAME,
    rpId: raw.WEBAUTHN_RP_ID ?? appUrl.hostname,
    origin: raw.WEBAUTHN_ORIGIN ?? appUrl.origin,
  },
} as const;

export type Env = typeof env;
