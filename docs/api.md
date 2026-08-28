# API

Base: `/api/v1`. Documentación interactiva en `/api/docs` (OpenAPI 3.1).

## Autenticación

Tres formas, en este orden de precedencia:

| Método | Cabecera | Uso |
| --- | --- | --- |
| Clave de API | `x-api-key: cf_<prefijo>_<secreto>` | Máquinas: puertas, integraciones, sistemas externos. |
| Token de sesión | `Authorization: Bearer <token>` | Aplicaciones y clientes con usuario. |
| Cookie de sesión | automática | El frontend integrado. |

Los endpoints bajo `/public` no requieren autenticación.

### Ciclo de la sesión

```http
POST /api/v1/auth/login
{ "email": "...", "password": "..." }
```

Respuesta con sesión iniciada:

```json
{
  "status": "authenticated",
  "tokens": { "accessToken": "...", "expiresIn": 900, "tokenType": "Bearer" },
  "user": { "id": "...", "name": "...", "memberships": [...] }
}
```

O con segundo factor pendiente:

```json
{
  "status": "mfa_required",
  "challengeId": "...",
  "methods": ["totp", "email"],
  "hint": "ma***@ejemplo.es"
}
```

El token de refresco viaja en una cookie `httpOnly`. `POST /auth/refresh` emite
un token de acceso nuevo y rota el de refresco.

## Errores

Formato único:

```json
{
  "error": {
    "code": "slot_unavailable",
    "message": "El horario solicitado ya no está disponible",
    "details": { "startsAt": "2026-07-27T09:00:00.000Z" },
    "requestId": "req_a1b2c3"
  }
}
```

`code` es estable y es lo que se debe usar para reaccionar en el cliente.
Códigos habituales:

| Código | HTTP | Significado |
| --- | --- | --- |
| `validation_error` | 422 | Datos de entrada no válidos |
| `unauthorized` | 401 | Falta autenticación o el token caducó |
| `permission_denied` | 403 | Sin permiso para la operación |
| `not_found` | 404 | No existe |
| `slot_unavailable` | 409 | El hueco ya no está libre |
| `cancellation_too_late` | 403 | Fuera del plazo para cancelar |
| `too_many_active_appointments` | 403 | Límite de citas activas alcanzado |
| `rate_limited` | 429 | Demasiadas peticiones |

## Endpoints principales

### Público

```
GET  /public/config                                   Configuración de la instalación
GET  /public/organizations                            Establecimientos con reserva online (sin sesión, solo si hay uno)
GET  /public/organizations/:slug                      Servicios, sedes y recursos
GET  /public/organizations/:id/availability            Huecos libres
GET  /public/organizations/:id/calendar                Días con hueco (para el calendario)
GET  /public/appointments/lookup?code=XXXX             Consultar cita por código
```

### Disponibilidad

```
GET /organizations/:id/availability
      ?serviceId=...&from=2026-07-27&to=2026-08-02
      &durationMinutes=90&partySize=1&resourceId=...
```

`durationMinutes` solo se admite en servicios de duración ajustable, y cambia el
resultado: cuanto más larga sea la reserva, menos huecos caben.

```json
{
  "serviceId": "...",
  "timezone": "Europe/Madrid",
  "durationMinutes": 90,
  "days": [
    {
      "date": "2026-07-27",
      "closed": false,
      "slots": [
        {
          "startsAt": "2026-07-27T07:00:00.000Z",
          "endsAt": "2026-07-27T08:30:00.000Z",
          "localDate": "2026-07-27",
          "localStartMinute": 540,
          "durationMinutes": 90,
          "resourceIds": ["..."],
          "remainingCapacity": 1,
          "priceCents": 1800,
          "currency": "EUR"
        }
      ]
    }
  ]
}
```

```
GET /organizations/:id/availability/next?serviceId=...
```

Devuelve el primer hueco libre buscando hacia adelante. Es lo que usan los
asistentes de voz para "dame la primera cita que haya".

### Citas

```
POST   /organizations/:id/appointments/hold        Bloquear un hueco unos minutos
DELETE /organizations/:id/appointments/hold/:holdId
POST   /organizations/:id/appointments             Reservar
POST   /organizations/:id/appointments/recurring   Serie periódica
GET    /organizations/:id/appointments             Listar y buscar
GET    /organizations/:id/appointments/:id         Detalle
PATCH  /organizations/:id/appointments/:id         Editar
POST   /organizations/:id/appointments/:id/reschedule
POST   /organizations/:id/appointments/:id/cancel
POST   /organizations/:id/appointments/:id/status
POST   /organizations/:id/appointments/:id/check-in
GET    /organizations/:id/appointments/:id/ics     Fichero de calendario
GET    /organizations/:id/appointments/:id/receipt Resguardo en PDF
GET    /organizations/:id/appointments/:id/qr      Código QR de acceso
```

Reserva mínima:

```http
POST /api/v1/organizations/<orgId>/appointments
Authorization: Bearer <token>

{
  "serviceId": "...",
  "startsAt": "2026-07-27T09:00:00.000Z",
  "durationMinutes": 90,
  "partySize": 1,
  "notes": "Primera visita",
  "idempotencyKey": "una-clave-por-intento"
}
```

`idempotencyKey` evita duplicar la cita si el cliente reintenta la petición: la
segunda llamada con la misma clave devuelve la cita ya creada con un 200.

### Control de acceso

```
POST /organizations/:id/access/validate
```

Ver [control-de-acceso.md](control-de-acceso.md).

### Catálogo y administración

```
GET|POST               /organizations
GET|PATCH|DELETE       /organizations/:id
GET|PUT                /organizations/:id/pages
GET                    /organizations/:id/usage
GET|POST|PATCH|DELETE  /organizations/:id/locations
GET|POST|PATCH|DELETE  /organizations/:id/resources
GET|POST|PATCH|DELETE  /organizations/:id/services
GET|PUT                /organizations/:id/schedules
GET|POST|DELETE        /organizations/:id/schedule-exceptions
GET|POST|DELETE        /organizations/:id/time-off
GET|POST|PATCH|DELETE  /organizations/:id/members
GET|POST|PATCH|DELETE  /organizations/:id/credit-packs
GET|POST|PATCH         /organizations/:id/credit-wallets
GET                    /organizations/:id/credits/{balance,eligibility}
GET                    /organizations/:id/reports/{summary,daily,services,resources,hours,today}
```

### Perfil

```
GET|PATCH /me
GET       /me/appointments
GET|PUT   /me/notification-preferences
GET|PUT   /me/reminder-rules
GET|DELETE /me/sessions[/:id]
GET|DELETE /me/passkeys[/:id]
POST      /me/identities/certificate   Vincular DNIe o certificado a la cuenta
POST      /me/push/devices
GET       /me/export             Descarga de datos personales
DELETE    /me                    Baja de la cuenta
```

## Claves de API

Se crean desde el panel o con `POST /organizations/:id/api-keys`, indicando
nombre y permisos. La clave completa se muestra una sola vez.

```json
{ "name": "Puerta principal", "scopes": ["appointment:checkin", "appointment:read"] }
```

Una clave nunca puede tener más permisos que quien la crea. Admite lista de IP
permitidas y caducidad.

## Límite de peticiones

- General: 300 por minuto y por IP (o por clave de API).
- Autenticación: 10 por minuto.
- Validación de acceso: 600 por minuto, porque un lector consulta a menudo.

Al superarlo se devuelve un 429 con código `rate_limited`.

## Paginación

```
?page=1&pageSize=25
```

```json
{ "items": [...], "page": 1, "pageSize": 25, "total": 132, "totalPages": 6 }
```

## Webhooks salientes

Ver [integraciones.md](integraciones.md).
