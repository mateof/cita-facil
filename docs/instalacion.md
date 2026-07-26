# Instalación

## Requisitos

- Node.js 22 o superior (probado con 24).
- npm 10 o superior.
- Nada más para empezar: la base de datos por defecto es SQLite y vive en un
  fichero dentro de `./data`.

Para producción con acceso por DNI electrónico hace falta además un proxy
inverso que termine TLS y pida el certificado de cliente. Ver
[autenticacion.md](autenticacion.md).

## Instalación local

```bash
git clone <repositorio> cita-facil
cd cita-facil
cp .env.example .env
npm install
```

Genera una clave maestra y ponla en `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```
APP_SECRET=<lo que ha salido>
```

Compila y arranca:

```bash
npm run build
npm start
```

La aplicación queda en <http://localhost:3000>. El frontend y el API comparten
puerto: `/` sirve la interfaz y `/api/v1` el API.

### Datos de ejemplo

```bash
npm run seed
```

Crea una peluquería con dos servicios (uno de duración fija y otro ajustable),
un profesional, horarios de lunes a sábado y tres usuarios:

| Correo | Rol | Contraseña |
| --- | --- | --- |
| `admin@ejemplo.es` | Propietario y superadministrador | `CitaFacil2026!` |
| `carlos@ejemplo.es` | Personal | `CitaFacil2026!` |
| `cliente@ejemplo.es` | Cliente | `CitaFacil2026!` |

### Primer administrador sin datos de ejemplo

Para una instalación limpia, define en `.env`:

```
BOOTSTRAP_ADMIN_EMAIL=admin@mi-negocio.es
BOOTSTRAP_ADMIN_PASSWORD=una-contraseña-larga
BOOTSTRAP_ORG_NAME=Mi establecimiento
```

Se crean al arrancar y solo si no existían ya. Después conviene quitar la
contraseña del fichero.

## Modo desarrollo

```bash
npm run dev
```

Levanta el API con recarga automática en el puerto 3000 y el frontend con Vite
en el 5173, que hace de proxy hacia el API. Se trabaja contra
<http://localhost:5173>.

## Docker

```bash
cp .env.example .env     # define al menos APP_SECRET
docker compose up -d
```

La imagen incluye el frontend compilado. Los datos persisten en el volumen
`cita-facil-data`, montado en `/data`: base de datos SQLite, copias de
seguridad y CRL descargadas.

### Con otro motor de base de datos

```bash
docker compose --profile postgres up -d
```

Y en `.env`:

```
DB_CLIENT=postgres
DB_HOST=postgres
DB_PORT=5432
DB_NAME=citafacil
DB_USER=citafacil
DB_PASSWORD=citafacil
```

Al arrancar, la aplicación crea el esquema si no existe. Los perfiles
disponibles son `postgres`, `mysql` (MariaDB), `mssql` y `proxy`.

### Con proxy y certificado de cliente

```bash
mkdir -p config/tls config/trust
# config/tls/fullchain.pem y config/tls/privkey.pem: certificado del servidor
# config/trust/ca-bundle.pem: CA del DNIe y de la FNMT concatenadas
docker compose --profile proxy up -d
```

## Actualización

```bash
git pull
npm install
npm run build
npm start
```

Las migraciones pendientes se aplican solas al arrancar mientras
`DB_AUTO_MIGRATE` esté a `true`. Si prefieres controlarlas a mano:

```bash
DB_AUTO_MIGRATE=false npm start
npm run migrate:status
npm run migrate
```

Antes de actualizar en producción, haz una copia:

```bash
npm run backup
```

## Desinstalación

Todo el estado vive en `./data` (o en el volumen de Docker) y en el fichero
`.env`. Borrar ambos deja la máquina como estaba.
