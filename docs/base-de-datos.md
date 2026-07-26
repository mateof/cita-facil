# Base de datos

## Motores admitidos

| Motor | `DB_CLIENT` | Notas |
| --- | --- | --- |
| SQLite | `sqlite` | Por defecto. Un fichero, sin instalación. |
| PostgreSQL | `postgres` | Recomendado para varias instancias. |
| MySQL | `mysql` | 8.0 o superior. |
| MariaDB | `mariadb` | 10.6 o superior. |
| SQL Server | `mssql` | 2019 o superior. |

Cambiar de motor es cambiar variables de entorno. El esquema se crea solo en
cualquiera de ellos.

```
DB_CLIENT=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=citafacil
DB_USER=citafacil
DB_PASSWORD=...
```

## Migraciones

Al arrancar, con `DB_AUTO_MIGRATE=true` (por defecto), se aplican las
migraciones pendientes. Si la base está vacía se crea el esquema completo; si ya
existe, solo se ejecuta lo que falte.

```bash
npm run migrate          # aplicar pendientes
npm run migrate:status   # ver estado
npm run migrate:down     # deshacer la última
```

Las migraciones se registran en un objeto estático en el código, no se leen del
disco, para que funcionen igual con TypeScript en desarrollo, con JavaScript
compilado en producción y dentro de un contenedor.

## Convenciones de tipos

Escribir una sola migración que valga para cinco motores obliga a evitar los
tipos donde más difieren. Las decisiones:

| Concepto | Representación | Motivo |
| --- | --- | --- |
| Identificadores | `varchar(36)` con UUID v7 generado en la aplicación | Ordenables por tiempo, así que los índices de clave primaria se mantienen compactos. No dependen de secuencias ni de `AUTO_INCREMENT`. |
| Booleanos | Entero 0/1 | Evita las diferencias entre `boolean`, `tinyint(1)` y `bit`, y hace que el driver devuelva siempre lo mismo. |
| Instantes | `varchar(24)` con ISO-8601 UTC (`2026-07-25T09:30:00.000Z`) | Con formato fijo, el orden lexicográfico coincide con el cronológico en los cinco motores. Se comparan y ordenan sin funciones de fecha propietarias. |
| Fechas locales | `varchar(10)` (`2026-07-25`) | Agrupar informes por día sin conversiones de zona. |
| Horas locales | Entero, minutos desde medianoche | `540` es las 9:00. Aritmética trivial y sin ambigüedad de zona. |
| Importes | Entero en unidades menores | Céntimos. Nunca coma flotante para dinero. |
| Objetos | Texto con JSON | Los tipos JSON nativos difieren demasiado entre motores. |
| Coordenadas | Texto | Igual que arriba, con los decimales. |

### El truco de `email_key` y `nif_key`

SQL Server considera iguales dos `NULL` en un índice único, así que no permitiría
más de un usuario sin correo. Por eso hay dos columnas espejo, `email_key` y
`nif_key`, que nunca son nulas: contienen el valor normalizado o, si falta, el
propio identificador del usuario. El índice único va sobre ellas.

## Esquema

### Organización y catálogo

```
organizations ──┬── locations ──┬── resources ──┐
                │               │               │
                ├── services ───┴───────────────┤ service_resources
                ├── service_categories          │
                ├── schedules (por sede,        │
                │   recurso o servicio)         │
                ├── schedule_exceptions         │
                └── time_off ───────────────────┘
```

- **`services`**: lo reservable. `duration_mode` decide si la duración la fija
  el establecimiento (`fixed`) o la elige el cliente (`flexible`, con
  `min_duration_minutes`, `max_duration_minutes` y `duration_step_minutes`).
  `capacity` mayor que uno convierte el servicio en clase o espacio compartido.
- **`resources`**: quién o qué presta el servicio. También tiene aforo propio.
- **`service_resources`**: relación N:M. Si un servicio no tiene ningún recurso
  asociado, no necesita asignar recurso y el aforo lo controla el propio
  servicio.
- **`schedules`**: reglas semanales por propietario (`location`, `resource` o
  `service`), con vigencia opcional. El horario de un recurso se intersecta con
  el de su sede.
- **`schedule_exceptions`**: festivos, cierres puntuales y aperturas
  extraordinarias, por fecha.
- **`time_off`**: ausencias con rango de instantes, para vacaciones y bajas.

### Citas

```
appointments ──┬── appointment_recurrences
               ├── waitlist_entries
               ├── reviews
               ├── payments
               └── access_logs
```

`appointments` guarda tanto el intervalo real (`starts_at`, `ends_at`) como el
bloqueado con márgenes (`block_starts_at`, `block_ends_at`), que es el que
consulta el motor de disponibilidad. Además desnormaliza `local_date` y
`local_start_minute` para las agendas y los informes.

Los estados y sus transiciones válidas están en el módulo de citas:

```
hold ──▶ confirmed / expired
pending ──▶ confirmed / rejected / cancelled
confirmed ──▶ checked_in / in_progress / completed / cancelled / no_show
checked_in ──▶ in_progress / completed / no_show
in_progress ──▶ completed / cancelled
```

### Identidad

```
users ──┬── identities (password, passkey, certificate, oidc)
        ├── webauthn_credentials
        ├── sessions
        ├── trusted_devices
        ├── memberships ── membership_locations
        └── push_devices / messaging_links
```

Un usuario puede tener varias identidades: entrar con contraseña un día y con
DNIe otro sin duplicar la cuenta.

### Resto

`notifications` (cola y historial), `notification_templates`,
`notification_preferences`, `reminder_rules`, `credit_packs` (tipos de bono),
`organization_pages` (contacto y sobre nosotros), `credit_wallets` (bonos emitidos) y `credit_ledger` (cada sesión consumida o
devuelta), `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `audit_logs`,
`settings` (con secretos cifrados) y `backups`.

## Índices

Los que importan para el rendimiento de la agenda:

| Índice | Uso |
| --- | --- |
| `ix_appt_org_range` | Disponibilidad: citas de una organización en un rango. |
| `ix_appt_resource_range` | Ocupación de un recurso concreto. |
| `ix_appt_loc_date` | Agenda del día de una sede. |
| `ux_appt_access_code` | Validación de acceso por código, en una sola lectura. |
| `ix_notif_queue` | Cola de avisos por estado y momento programado. |

## Integridad

Hay claves ajenas en las relaciones principales, sin acciones en cascada. El
borrado en cascada está descartado a propósito: SQL Server rechaza los caminos
de cascada múltiples, que aparecerían enseguida con `organization_id` presente
en casi todas las tablas. El borrado se resuelve en la aplicación y, en la
mayoría de los casos, es borrado lógico (`deleted_at`).

## Cambiar de motor con los datos

Las copias de seguridad son lógicas (NDJSON comprimido), no volcados nativos, y
eso permite migrar entre motores:

```bash
npm run backup                        # con SQLite
# cambiar DB_CLIENT y credenciales a postgres
npm run migrate                       # crear el esquema
npm run restore -- <fichero> --truncate
```
