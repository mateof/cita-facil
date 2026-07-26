# Configuración

Toda la configuración de infraestructura va por variables de entorno, leídas de
`.env` o del entorno del proceso. Lo que es propio de cada negocio (horarios,
reglas de reserva, márgenes de acceso, plantillas) se configura desde el panel y
vive en la base de datos.

Las variables se validan al arrancar: un valor mal escrito detiene el proceso
con un mensaje que dice cuál es.

## General

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` activa la política de contenido estricta y oculta las trazas de error. |
| `PORT` | `3000` | Puerto de escucha. |
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `APP_URL` | `http://localhost:3000` | URL pública. Se usa en enlaces de correo, QR y webhooks. |
| `APP_NAME` | `CitaFácil` | Nombre que aparece en la interfaz y los correos. |
| `APP_SECRET` | (ninguno) | Clave maestra. **Obligatoria en producción.** |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `CORS_ORIGINS` | (vacío) | Orígenes permitidos, separados por comas. Vacío = mismo origen. |
| `TRUST_PROXY` | `false` | Activar con proxy inverso delante. |
| `SERVE_WEB` | `true` | Servir el frontend desde el propio proceso. |
| `WEB_DIST_PATH` | `packages/web/dist` | Ruta al frontend compilado. |
| `DEFAULT_LOCALE` | `es` | `es`, `gl` o `en`. |
| `DEFAULT_TIMEZONE` | `Europe/Madrid` | Zona horaria por defecto. |
| `DATA_DIR` | `./data` | Directorio de datos. |

## Base de datos

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `DB_CLIENT` | `sqlite` | `sqlite`, `postgres`, `mysql`, `mariadb`, `mssql`. |
| `DB_FILE` | `./data/cita-facil.sqlite` | Solo SQLite. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | | Resto de motores. |
| `DB_SSL` | `false` | TLS contra el servidor de base de datos. |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | Poner a `false` solo con certificados autofirmados. |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `0` / `10` | Tamaño del pool. |
| `DB_AUTO_MIGRATE` | `true` | Aplicar migraciones pendientes al arrancar. |
| `DB_AUTO_SEED` | `false` | Cargar datos de ejemplo si no hay organizaciones. |
| `DB_LOG_QUERIES` | `false` | Registrar cada consulta (necesita `LOG_LEVEL=debug`). |

## Seguridad y sesiones

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | Vida del token de acceso. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Vida de la sesión. |
| `SESSION_COOKIE_NAME` | `cf_session` | Nombre de la cookie de sesión. |
| `COOKIE_SECURE` | `false` | **A `true` en producción.** |
| `COOKIE_DOMAIN` | (ninguno) | Para compartir sesión entre subdominios. |
| `RATE_LIMIT_MAX` | `300` | Peticiones por ventana. |
| `RATE_LIMIT_WINDOW` | `1 minute` | Ventana del límite. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Límite específico de los endpoints de acceso. |
| `PASSWORD_MIN_LENGTH` | `10` | Longitud mínima de contraseña. |
| `AUTH_METHODS` | `password,passkey,certificate` | Métodos habilitados **de fábrica**. A partir del primer cambio en el panel manda la base de datos. |
| `REGISTRATION_MODE` | `open` | Política de alta inicial: `open`, `allowlist`, `invite_only` o `closed`. También editable desde el panel. |
| `ALLOW_ANONYMOUS_BOOKING` | `true` | Tope de la instalación para la reserva sin cuenta. |
| `MFA_REQUIRED_FOR_ADMINS` | `false` | Exigir segundo factor a administradores. |
| `MFA_TRUSTED_DEVICE_DAYS` | `30` | Duración de "recordar este dispositivo". |
| `REDIS_URL` | (ninguno) | Redis opcional. Ver la sección siguiente. |
| `REDIS_PREFIX` | `cf:` | Prefijo de las claves, para compartir servidor. |
| `REDIS_SESSION_TTL` | `60` | Segundos que se cachea el estado de una sesión. `0` desactiva esa caché. |

> Los cuatro primeros son solo el estado inicial de una instalación nueva. Lo
> que manda en el día a día es Panel → Acceso y registro, que se guarda en base
> de datos y tiene efecto sin reiniciar.

## Redis (opcional)

**Las sesiones no viven en memoria**: están en la tabla `sessions` y sobreviven a
los reinicios con Redis y sin él. Redis no cambia dónde se guardan; es una
caché, y perderlo entero no cierra la sesión de nadie: la siguiente petición
vuelve a consultar la base de datos.

Sin `REDIS_URL` todo funciona como siempre. Con él se ganan dos cosas:

- **El cupo del limitador pasa a ser común.** Sin Redis cada proceso cuenta el
  suyo, así que con tres instancias el límite efectivo es el triple.
- **La comprobación de sesión deja de ser una consulta por petición.** Cada
  petición autenticada comprueba que la sesión sigue viva; con la caché eso sale
  de memoria durante `REDIS_SESSION_TTL` segundos.

Cerrar sesión sigue teniendo efecto inmediato: al revocar se borra la entrada,
no se espera a que caduque.

Si se configura y no responde, la aplicación arranca igual, deja un aviso en el
registro y sigue sin caché. Un Redis caído no puede tumbar las reservas. El
estado se ve en `GET /admin/status`, en el campo `cache`.

```bash
REDIS_URL=redis://redis:6379
# Con contraseña: redis://:contrasena@servidor:6379
# Con TLS:        rediss://servidor:6380
```

Con Docker: `docker compose --profile redis up -d`.

## Certificado, DNIe y Cl@ve

Ver [autenticacion.md](autenticacion.md) para el detalle.

| Variable | Por defecto |
| --- | --- |
| `CERT_HEADER` | `x-client-cert` |
| `CERT_VERIFY_HEADER` | `x-client-verify` |
| `CERT_TRUST_DIR` | `./config/trust` |
| `CERT_CHECK_CRL` | `false` |
| `CERT_CRL_DIR` | `./data/crl` |
| `CERT_CRL_REFRESH_HOURS` | `24` |
| `CERT_AUTH_ALLOW_BODY` | `false` |
| `CERT_AUTO_PROVISION` | `true` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_SCOPES`, `OIDC_LABEL` | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Cliente OAuth 2.0 de tipo aplicación web. |
| `GOOGLE_REDIRECT_URI` | Se deriva de `APP_URL`: `<APP_URL>/api/v1/auth/google/callback`. |
| `GOOGLE_HOSTED_DOMAINS` | Limita el acceso a esos dominios de Google Workspace. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME` | Se derivan de `APP_URL`. |

## Notificaciones

Ver [notificaciones.md](notificaciones.md).

| Variable | Por defecto |
| --- | --- |
| `MAIL_ENABLED` | `true` |
| `MAIL_TRANSPORT` | `json` (`smtp`, `json`, `none`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | |
| `MAIL_FROM`, `MAIL_REPLY_TO` | |
| `PUSH_ENABLED` | `false` |
| `FCM_SERVICE_ACCOUNT_FILE` / `FCM_SERVICE_ACCOUNT_JSON` / `FCM_PROJECT_ID` | |
| `WEBPUSH_PUBLIC_KEY`, `WEBPUSH_PRIVATE_KEY`, `WEBPUSH_SUBJECT` | |
| `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | |
| `WHATSAPP_ENABLED`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_VERIFY_TOKEN` | |
| `SMS_ENABLED`, `SMS_PROVIDER`, `TWILIO_*` | |

## Pagos, copias e integraciones

| Variable | Por defecto |
| --- | --- |
| `PAYMENTS_ENABLED` | `false` |
| `PAYMENTS_DEFAULT_PROVIDER` | `stripe` |
| `STRIPE_*`, `REDSYS_*` | |
| `BACKUP_ENABLED` | `true` |
| `BACKUP_DIR` | `./data/backups` |
| `BACKUP_CRON` | `30 3 * * *` |
| `BACKUP_RETENTION_DAYS` | `30` |
| `BACKUP_MAX_FILES` | `60` |
| `BACKUP_ENCRYPT` | `false` |
| `MCP_ENABLED` | `true` |
| `ALEXA_ENABLED`, `ALEXA_SKILL_ID` | `false` |
| `GOOGLE_ASSISTANT_ENABLED` | `false` |
| `WEBHOOKS_ENABLED` | `true` |
| `SCHEDULER_ENABLED` | `true` |
| `NOTIFICATION_DISPATCH_CRON` | `* * * * *` |
| `NOTIFICATION_MAX_ATTEMPTS` | `5` |
| `NOTIFICATION_BATCH_SIZE` | `50` |

## Ajustes por organización

Estos no son variables de entorno: se configuran en Panel → Ajustes y se
guardan en la base de datos, así que cada organización tiene los suyos.

| Ajuste | Por defecto | Qué hace |
| --- | --- | --- |
| Minutos de bloqueo del hueco | 10 | Cuánto se reserva el hueco mientras el cliente completa la reserva. |
| Permitir reservar sin cuenta | no | Reserva como invitado con nombre, correo y teléfono. |
| Máximo de citas activas por cliente | 0 (sin límite) | Frena a quien acapara horas. |
| Bloquear tras N faltas | 0 (desactivado) | Impide reservar online a quien falta repetidamente. |
| Asignación de recurso | Minimizar huecos muertos | Cómo se elige el profesional cuando el cliente no lo indica. |
| Rejilla de horas | 15 min | Cada cuánto se ofrecen inicios de cita. |
| Reserva online activa | sí | Apaga la página pública sin borrar nada. |
| Mostrar nombres de profesionales | sí | Ocultarlos si el negocio prefiere no publicarlos. |
| Lista de espera | sí | Avisar cuando se libere un hueco. |
| Pedir valoración tras la cita | sí | |
| Margen de acceso antes/después | 15 / 15 min | Tolerancia del control de acceso. |
| Código de acceso de un solo uso | no | Para entradas de evento. |
| Marcar falta automáticamente tras | 0 (desactivado) | Minutos tras el final de la cita sin registrar llegada. |
| Color de marca | `#2563eb` | Se aplica a la interfaz pública. |
