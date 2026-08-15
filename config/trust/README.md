# Autoridades de certificación de confianza

Coloca aquí, en formato PEM y con extensión `.pem`, `.crt` o `.cer`, los
certificados raíz e intermedios que se admiten para la autenticación con DNI
electrónico y certificado de la FNMT.

Sin certificados en este directorio, el acceso por certificado **rechaza todo**:
es el comportamiento seguro por defecto.

## Qué descargar

**DNI electrónico** (sede electrónica de la Policía Nacional):

- AC RAIZ DNIE
- AC DNIE 001, 002, 003, 004, 005 (las intermedias en vigor)

**FNMT-RCM** (sede electrónica de la FNMT):

- AC RAIZ FNMT-RCM
- AC FNMT Usuarios
- AC Representación
- AC Administración Pública
- AC Componentes Informáticos

Un mismo fichero puede contener varios certificados concatenados.

## Para nginx

El proxy necesita todos los certificados en un único fichero:

```bash
cat *.pem > ca-bundle.pem
```

Ese `ca-bundle.pem` es el que monta `docker-compose.yml` en el contenedor de
nginx.

## Recarga

Tras añadir o quitar certificados no hace falta reiniciar la aplicación:

```
POST /api/v1/admin/certificates/reload
```

o desde el panel, en Sistema.

## Listas de revocación

Si activas `CERT_CHECK_CRL=true`, las CRL se descargan solas de los puntos que
declara cada certificado y se cachean en `CERT_CRL_DIR`. En redes sin salida a
internet puedes dejarlas a mano en ese directorio, en DER o en PEM, con
extensión `.crl`.
