# Despliegue

## Lista de comprobación para producción

- [ ] `APP_SECRET` generado y guardado fuera del repositorio.
- [ ] `APP_URL` con la URL pública real, incluido `https://`.
- [ ] `NODE_ENV=production`.
- [ ] `COOKIE_SECURE=true` y todo el tráfico por HTTPS.
- [ ] `TRUST_PROXY=true` si hay proxy inverso delante.
- [ ] `MAIL_TRANSPORT=smtp` con credenciales que funcionen (probar desde
      Sistema → Comprobar SMTP).
- [ ] Copias de seguridad activas y sincronizadas fuera de la máquina.
- [ ] Certificados de confianza en `config/trust` si se usa DNIe o FNMT.
- [ ] `MFA_REQUIRED_FOR_ADMINS=true` si hay más de un administrador.

## Con Docker

```bash
cp .env.example .env
# editar .env
docker compose up -d
docker compose logs -f app
```

La imagen expone el 3000. Lo normal es ponerle delante nginx o Traefik para el
TLS.

Actualizar:

```bash
docker compose pull       # o docker compose build
docker compose up -d
```

Las migraciones se aplican al arrancar. Haz una copia antes.

## Imágenes publicadas

Cada empujón a `develop` o a `main` publica una imagen en el registro de
GitHub, siempre que los tres trabajos de pruebas hayan pasado. Una imagen que no
supera las pruebas no llega al registro.

```
ghcr.io/mateof/cita-facil
```

Se publican tres etiquetas cada vez:

| Rama | Móvil | Versión | Instante |
| --- | --- | --- | --- |
| `main` | `latest` | `0.1.0` | `0.1.0-20260726-1930` |
| `develop` | `latest-dev` | `0.1.0-dev` | `0.1.0-dev-20260726-1930` |

La **móvil** apunta siempre a lo último de esa rama y es cómoda para
desarrollo. La de **versión** sigue al `package.json`, así que se sobrescribe
mientras no se suba el número. La del **instante** es única e inmutable: es la
que hay que fijar en producción, porque permite saber con exactitud qué está
desplegado y volver atrás sin ambigüedad.

El instante va en UTC, con formato `AAAAMMDD-HHMM`.

### Usarla

El registro es privado, como el repositorio, así que hace falta entrar antes con
un token de GitHub con permiso `read:packages`:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u mateof --password-stdin
docker pull ghcr.io/mateof/cita-facil:latest
```

Para fijar una versión concreta en `docker-compose.yml`, en lugar de construir
en el servidor:

```yaml
services:
  app:
    image: ghcr.io/mateof/cita-facil:0.1.0-20260726-1930
    # y se quita el bloque `build`
```

### Publicar una versión nueva

Subir el número en el `package.json` de la raíz y fusionar en `main`. La
etiqueta de versión sale de ahí, no de las etiquetas de git.

## Sin Docker, con systemd

```ini
# /etc/systemd/system/citafacil.service
[Unit]
Description=CitaFácil
After=network.target

[Service]
Type=simple
User=citafacil
WorkingDirectory=/opt/citafacil
EnvironmentFile=/opt/citafacil/.env
ExecStart=/usr/bin/node --enable-source-maps packages/api/dist/main.js
Restart=on-failure
RestartSec=5

# El proceso solo necesita escribir en su directorio de datos.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/citafacil/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now citafacil
sudo journalctl -u citafacil -f
```

## Proxy inverso

El fichero `docker/nginx/nginx.conf` sirve tal cual para nginx, con TLS mutuo
incluido. Puntos a respetar en cualquier proxy:

- Reenviar `X-Forwarded-For` y `X-Forwarded-Proto`.
- Reenviar el certificado de cliente en `X-Client-Cert` y el veredicto en
  `X-Client-Verify` si se usa DNIe o FNMT.
- **No permitir** que esas cabeceras lleguen del exterior: la aplicación confía
  en ellas.
- No exponer el puerto de la aplicación directamente a internet.

Con Traefik:

```yaml
labels:
  - traefik.http.routers.citafacil.rule=Host(`citas.ejemplo.es`)
  - traefik.http.routers.citafacil.tls=true
  - traefik.http.routers.citafacil.tls.options=mtls@file
  - traefik.http.middlewares.cert.passtlsclientcert.pem=true
  - traefik.http.routers.citafacil.middlewares=cert
```

Traefik entrega el certificado en `X-Forwarded-Tls-Client-Cert`, así que hay que
ajustar `CERT_HEADER=x-forwarded-tls-client-cert`.

## Separar el frontend

```
SERVE_WEB=false
CORS_ORIGINS=https://citas.ejemplo.es
```

Y publicar `packages/web/dist` donde se quiera (Nginx, Netlify, un bucket). El
frontend habla con el API por rutas relativas `/api/v1`, así que hace falta un
proxy en el servidor de estáticos o cambiar la base en `packages/web/src/lib/api.ts`.

## Varias instancias

La aplicación no guarda estado de negocio en memoria: las sesiones, las citas y
los avisos están en la base de datos y sobreviven a los reinicios. En memoria
solo hay cachés que se reconstruyen solas (certificados de confianza, CRL y, si
no hay Redis, el contador del limitador). Se puede escalar horizontalmente con
estas condiciones:

1. **Base de datos compartida**: PostgreSQL, MySQL/MariaDB o SQL Server. SQLite
   no vale para varias instancias.
2. **El planificador solo en una**: `SCHEDULER_ENABLED=false` en todas menos
   una, o los recordatorios se enviarían por duplicado.
3. **Mismo `APP_SECRET`** en todas, o las sesiones emitidas por una no valdrían
   en otra.
4. **Redis para el límite de peticiones**: sin él cada proceso cuenta su propio
   cupo, así que con tres instancias el límite efectivo es el triple. Con
   `REDIS_URL` el cupo pasa a ser común. La alternativa es aplicarlo en el
   proxy. Ver [configuración](configuracion.md).

### Sobre el límite de peticiones

`RATE_LIMIT_MAX` cuenta por IP. Con muchas personas detrás de la misma salida a
internet (una empresa, un centro educativo, una red móvil con NAT) todas
comparten cupo, y la página de reservas hace varias consultas por interacción.
Si aparecen 429 en un despliegue real, súbelo: 300 por minuto es un valor
prudente para un negocio pequeño, no un límite bien medido para cualquier caso.

## Supervisión

- `GET /health` devuelve 200 cuando el proceso responde. Es lo que usan el
  `HEALTHCHECK` de Docker y cualquier balanceador.
- El panel de Sistema muestra migraciones aplicadas, próximas ejecuciones de
  cada tarea, avisos en cola, memoria y tiempo activo.
- Los registros salen en JSON en producción (pino), listos para cualquier
  agregador. Las cabeceras sensibles se ocultan.

## Rendimiento

Para una instalación normal (un negocio, unos miles de citas al mes) no hace
falta ajustar nada. Si crece:

- `DB_CLIENT=postgres` y `DB_POOL_MAX` acorde a las conexiones disponibles.
- Ampliar `slotGranularityMinutes` en los ajustes de la organización reduce el
  número de huecos que se calculan y se envían.
- `LOG_LEVEL=warn` en instalaciones con mucho tráfico.
- Poner una caché de estáticos en el proxy; los ficheros del frontend llevan
  hash en el nombre y se sirven con `immutable` y un año de caducidad.
- `REDIS_URL` ahorra una consulta por petición autenticada, la que comprueba que
  la sesión sigue viva.

## Retirada

Todo el estado está en el directorio de datos y en `.env`. Para llevarse los
datos a otro sitio, una copia de seguridad y el `.env` bastan.
