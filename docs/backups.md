# Copias de seguridad

## Formato

Las copias son **lógicas**: se exporta el contenido tabla a tabla en NDJSON
comprimido con gzip, no un volcado nativo del motor.

El coste es que restaurar es más lento que un `pg_restore`. A cambio se
obtienen dos cosas que aquí importan más: el mismo formato de copia funciona en
los cinco motores admitidos, y una copia hecha en SQLite se puede restaurar en
PostgreSQL. Ese es justo el camino que sigue una instalación que empieza pequeña
y crece.

Nombre de fichero:

```
cita-facil-2026-07-25T15-43-35-888Z.ndjson.gz
cita-facil-2026-07-25T15-43-35-888Z.ndjson.gz.enc   (si va cifrada)
```

## Automáticas

```
BACKUP_ENABLED=true
BACKUP_DIR=./data/backups
BACKUP_CRON=30 3 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_MAX_FILES=60
BACKUP_ENCRYPT=false
```

La política de retención se aplica después de cada copia: se borran las que
superen la antigüedad o el número máximo de ficheros, lo que ocurra antes.

Si una copia programada falla, se avisa por correo a los superadministradores.

## Manuales

Desde el panel (Sistema → Copias de seguridad) o por línea de comandos:

```bash
npm run backup
```

Por API:

```http
POST /api/v1/admin/backups
Authorization: Bearer <token de superadministrador>
```

## Cifrado

```
BACKUP_ENCRYPT=true
```

AES-256-GCM con una clave derivada de `APP_SECRET`. El fichero lleva el vector
de inicialización al principio y la etiqueta de autenticación al final.

> Sin el mismo `APP_SECRET` una copia cifrada no se puede restaurar. Guarda la
> clave maestra en un sitio distinto de las copias, o el cifrado no protege de
> nada.

## Restauración

Desde el panel, o:

```bash
npm run restore -- cita-facil-2026-07-25T15-43-35-888Z.ndjson.gz --truncate
```

Por API:

```http
POST /api/v1/admin/backups/<fichero>/restore
{ "truncate": true, "confirm": true }
```

`truncate: true` vacía las tablas antes de restaurar. Antes de vaciar nada se
crea automáticamente una copia del estado actual, para que un error de fichero
no deje la instalación sin salida.

Sin `truncate` solo se añaden filas, lo que sirve para recuperar datos borrados
por accidente si no chocan las claves.

Las tablas se recorren en un orden fijo (organizaciones antes que sedes, sedes
antes que recursos) para respetar las claves ajenas.

## Migrar de motor

```bash
# 1. Copia con el motor actual
npm run backup

# 2. Cambia DB_CLIENT y las credenciales en .env

# 3. Crea el esquema en el motor nuevo
npm run migrate

# 4. Restaura
npm run restore -- <fichero> --truncate
```

## Qué NO incluye la copia

- El fichero `.env`. Guárdalo aparte: sin `APP_SECRET` las sesiones se
  invalidan, las credenciales de pago cifradas dejan de leerse y las copias
  cifradas no se pueden abrir.
- Los certificados de confianza de `config/trust`, que son públicos y se pueden
  volver a descargar.

## Estrategia recomendada

Para una instalación pequeña:

1. Copia automática diaria de madrugada con retención de 30 días.
2. `BACKUP_ENCRYPT=true` si las copias salen de la máquina.
3. Sincronización del directorio `data/backups` a un destino externo (Synology
   Drive, rclone, rsync, S3).
4. Copia del `.env` en un gestor de contraseñas.
5. Prueba de restauración cada pocos meses en una instalación aparte. Una copia
   que nunca se ha restaurado es una copia que no se sabe si funciona.
