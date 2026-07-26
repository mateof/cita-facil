# Autenticación

CitaFácil admite seis formas de identificarse: contraseña, passkey, DNIe o
certificado FNMT, Google, Cl@ve y cualquier otro proveedor OpenID Connect.

**Cuáles están activas lo decide el administrador desde el panel**, en
Panel → Acceso y registro. La variable `AUTH_METHODS` solo fija el estado
inicial de una instalación recién creada; en cuanto alguien guarda esa pantalla,
manda lo que hay en base de datos y no hace falta reiniciar para apagar un
método.

```
AUTH_METHODS=password,passkey,certificate     # solo el estado de partida
```

La pantalla de acceso pregunta a `GET /api/v1/auth/methods` y pinta únicamente
lo que está activo y además configurado: activar Google sin credenciales no
tiene efecto, y el propio panel lo indica.

## Quién puede darse de alta

Cuatro modos, en Panel → Acceso y registro → Alta de cuentas:

| Modo | Quién puede crear cuenta |
| --- | --- |
| **Abierto** | Cualquiera desde la web. Se puede limitar por dominio de correo. |
| **Solo personas autorizadas** | Únicamente quien esté en la lista, identificado por correo, por dominio de correo o por DNI. |
| **Solo por invitación** | Nadie por su cuenta. Las cuentas las crea el administrador y cada persona activa la suya con el enlace que recibe. |
| **Cerrado** | No se admiten altas por ningún medio. |

### La lista de personas autorizadas

Cada entrada identifica a alguien de una de estas tres formas:

- **Correo**: `ana@ejemplo.es`. La coincidencia más específica.
- **Dominio**: `ejemplo.es`. Vale para cualquier correo de ese dominio, así que
  sirve para "todo el personal de la empresa".
- **DNI o NIE**: `12345678Z`. Es lo que se comprueba cuando alguien entra con
  **DNIe o certificado**, donde no hay correo de por medio. Es la forma de
  preautorizar a alguien de quien solo se conoce el documento.

Si hay varias coincidencias gana la más específica: correo, luego DNI, luego
dominio. Una entrada puede además conceder el rol de administrador de la
instalación y dar de alta directamente en una organización con un rol concreto,
que es lo que evita tener que invitar dos veces a la misma persona.

Se pueden pegar listas enteras de golpe, separadas por líneas o por comas.

### Alta automática con certificado o con proveedor externo

Con el registro restringido hay dos interruptores aparte:

- **Crear cuenta automáticamente con DNIe o certificado**: cualquiera con un
  certificado válido entra, aunque no esté en la lista. Es lo razonable en una
  administración pública y peligroso en un negocio privado.
- **Crear cuenta automáticamente con Google o Cl@ve**: lo mismo para los
  proveedores federados.

Con los dos apagados, esos métodos solo sirven para entrar en cuentas que ya
existen o que estén expresamente autorizadas.

### Cuentas creadas por el administrador

En Panel → Acceso y registro → Usuarios → Crear cuenta.

La cuenta nace en estado **pendiente y sin contraseña**, y la persona recibe un
correo con un enlace de activación (14 días de validez por defecto) para elegir
la suya. Hasta que no la activa no se puede entrar con ella, así que un correo
que se pierda no deja una cuenta accesible con una contraseña provisional que
nadie ha cambiado.

Si se desactiva el envío del correo, el panel muestra el enlace para entregarlo
por otra vía. También se puede reenviar en cualquier momento.

Al crear la cuenta se puede indicar el DNI: con eso, esa misma persona podrá
entrar después con su DNIe sin ningún paso adicional.

## Reservar sin cuenta

Se decide en dos niveles, y hacen falta los dos:

1. **Instalación**: Panel → Acceso y registro → "Permitir reservar sin cuenta".
   Es un tope; si está apagado, ninguna organización puede saltárselo.
2. **Organización**: Panel → Ajustes → Reservas → "Permitir reservar sin cuenta".

El personal siempre puede crear una cita a nombre de alguien sin cuenta desde el
mostrador, independientemente de estos ajustes: es una reserva hecha por una
persona identificada, no una reserva anónima.

## DNI electrónico y certificado de la FNMT

### Cómo funciona

El apretón de manos TLS con petición de certificado de cliente lo hace el proxy
inverso, no Node. El proxy reenvía el certificado en una cabecera y la
aplicación se encarga de lo que el proxy no hace: comprobar que la cadena sube
hasta una CA de confianza propia, que está en vigor, que no está revocado y,
sobre todo, extraer la identidad.

```
Navegador ──TLS mutuo──▶ nginx ──X-Client-Cert──▶ CitaFácil
   DNIe                    │                          │
   o FNMT                  │                          ├─ valida cadena
                           │                          ├─ comprueba vigencia
                           └─ X-Client-Verify         ├─ consulta CRL
                                                      └─ extrae NIF y nombre
```

### Configuración de nginx

El fichero `docker/nginx/nginx.conf` viene listo. Lo esencial:

```nginx
ssl_client_certificate /etc/nginx/trust/ca-bundle.pem;
ssl_verify_client optional;
ssl_verify_depth 3;

proxy_set_header X-Client-Cert   $ssl_client_escaped_cert;
proxy_set_header X-Client-Verify $ssl_client_verify;
```

`optional` en lugar de `on` es deliberado: si fuese obligatorio, el navegador
pediría certificado en todas las peticiones, incluida la portada, y quien entre
con contraseña vería un diálogo de certificado sin motivo.

`$ssl_client_escaped_cert` codifica el PEM en URL, que es la forma segura de
meter un texto multilínea en una cabecera. La aplicación lo decodifica y admite
también las variantes de Apache y Traefik.

> **Importante**: la aplicación confía en esas cabeceras. Tienen que llegar
> siempre del proxy y nunca del exterior. Con `TRUST_PROXY=true` y el proxy
> como único camino de entrada, está cubierto. Si expones el puerto del
> contenedor directamente a internet, cualquiera podría inyectarlas.

### Certificados de confianza

Coloca en `CERT_TRUST_DIR` (por defecto `./config/trust`) los certificados raíz
e intermedios en PEM, con extensión `.pem`, `.crt` o `.cer`:

- **DNIe**: AC RAIZ DNIE, AC DNIE 001/002/003/004/005.
- **FNMT**: AC RAIZ FNMT-RCM, AC FNMT Usuarios, AC Componentes Informáticos,
  AC Representación, AC Administración Pública.

Se descargan de las sedes electrónicas de la Policía Nacional y de la FNMT. Un
mismo fichero puede contener varios certificados concatenados.

Para nginx hay que concatenarlos todos en `config/trust/ca-bundle.pem`.

Tras añadir CA nuevas, se recargan sin reiniciar desde el panel de sistema o con:

```
POST /api/v1/admin/certificates/reload
```

### Revocación

```
CERT_CHECK_CRL=true
CERT_CRL_DIR=./data/crl
CERT_CRL_REFRESH_HOURS=24
```

La aplicación descarga las CRL que declara el propio certificado, las cachea en
disco y comprueba el número de serie. También acepta CRL puestas a mano en el
directorio, en DER o en PEM, útil para redes sin salida a internet.

Si no hay ninguna CRL disponible se registra un aviso y se acepta el
certificado: cortar el acceso a todo el mundo porque un servidor de CRL está
caído suele ser peor que el riesgo que evita. Si tu caso exige lo contrario,
mantén las CRL en disco y vigila su frescura.

### Identidad extraída

Los emisores españoles colocan el NIF en sitios distintos, así que se busca en
`serialNumber` (con o sin prefijo `IDCES-`), en el nombre común (`... - NIF
12345678Z`), en `OU`, `UID` y `dnQualifier`. Se admiten DNI y NIE.

Con `CERT_AUTO_PROVISION=true` (por defecto), la primera entrada con un
certificado válido crea la cuenta con el nombre y el NIF del certificado. Si el
certificado trae correo y ese correo ya existe, se enlaza el NIF a esa cuenta en
lugar de duplicarla.

Una sesión abierta con certificado se considera de doble factor: el PIN del
DNIe ya es el segundo factor.

### Desarrollo sin proxy

```
CERT_AUTH_ALLOW_BODY=true
```

Permite mandar el PEM en el cuerpo de `POST /api/v1/auth/certificate`. **Nunca
en producción**: sin TLS mutuo, un PEM en el cuerpo no demuestra nada, porque
cualquiera puede copiar el certificado público de otra persona.

## Google

### Alta del cliente OAuth

1. En [Google Cloud](https://console.cloud.google.com), crea un proyecto o
   entra en el que uses.
2. **APIs y servicios → Pantalla de consentimiento**: rellena nombre, correo de
   soporte y dominio. Si la aplicación es para una empresa, elige "Interno" y
   solo entrarán cuentas de tu Workspace.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de
   OAuth**, tipo **Aplicación web**.
4. En **URI de redireccionamiento autorizados** añade exactamente:

   ```
   https://citas.ejemplo.es/api/v1/auth/google/callback
   ```

   El panel muestra esta URI ya formada para copiarla sin equivocarse.

5. Copia el identificador y el secreto al `.env`:

   ```
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```

6. Reinicia y activa Google en Panel → Acceso y registro.

En desarrollo, la URI de retorno es `http://localhost:3000/api/v1/auth/google/callback`.
Google acepta `localhost` sin HTTPS, así que se puede probar tal cual.

### Limitar a un dominio de empresa

```
GOOGLE_HOSTED_DOMAINS=miempresa.com
```

Con un solo dominio, Google ya ofrece únicamente cuentas de ese dominio en el
selector. La comprobación de verdad se hace después sobre la reclamación `hd`
del token, porque el parámetro del selector es solo una ayuda de interfaz y se
puede manipular.

### Qué se guarda

El identificador estable de Google (`sub`) queda como identidad del usuario,
así que cambiar de correo en Google no crea una cuenta nueva. Si el correo ya
existía en la aplicación, la cuenta de Google se enlaza a esa en lugar de
duplicarla: quien se registró con contraseña puede empezar a entrar con Google
sin perder sus citas.

## Cl@ve y OpenID Connect

Flujo de código de autorización con PKCE contra cualquier proveedor estándar.

```
OIDC_ISSUER=https://...
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://citas.ejemplo.es/api/v1/auth/oidc/callback
OIDC_LABEL=Cl@ve
```

El documento de identidad se busca en las reclamaciones `nif`, `dni` y
`document_number`, que son los nombres que usan los perfiles habituales. La
sesión hereda las garantías del proveedor, incluido su segundo factor.

## Passkeys

Sirven para entrar sin contraseña y como segundo factor. El dominio se toma de
`APP_URL`; si sirves varios dominios, fija `WEBAUTHN_RP_ID` al principal, porque
una credencial creada en un dominio no vale en otro.

Una passkey verificada con presencia de usuario cubre ya dos factores (el
dispositivo y la biometría o el PIN), así que no se pide otro.

## Usuario y contraseña

- Hash con **Argon2id** (19 MiB, 2 iteraciones), los parámetros recomendados por
  OWASP para servidores generales.
- Mínimo 10 caracteres, sin reglas de composición (empeoran la entropía real) y
  con rechazo de las contraseñas más filtradas.
- Bloqueo progresivo: 5 minutos a los cinco intentos fallidos, una hora a los
  diez.
- El tiempo de respuesta es el mismo exista o no la cuenta, para que no se pueda
  averiguar qué correos están registrados.
- Cambiar la contraseña revoca todas las demás sesiones.

## Segundo factor

| Método | Notas |
| --- | --- |
| Aplicación de autenticación | TOTP estándar (RFC 6238). Compatible con Google Authenticator, Microsoft Authenticator, Authy, 1Password. |
| Código por correo | Seis dígitos, diez minutos, cinco intentos. |
| Passkey | Sirve también como método completo. |
| Códigos de recuperación | Diez códigos de un solo uso al activar el segundo factor. |

`MFA_REQUIRED_FOR_ADMINS=true` lo exige a propietarios, administradores y al
superadministrador de la instalación.

Con "recordar este dispositivo" se emite una cookie de dispositivo de confianza
con la vigencia de `MFA_TRUSTED_DEVICE_DAYS`.

## Sesiones

Dos piezas:

- **Token de acceso**: JWT HS256, 15 minutos, se valida sin tocar la base de
  datos.
- **Token de refresco**: opaco y aleatorio, guardado solo como hash, rotado en
  cada uso. Al estar en base de datos se puede revocar de verdad.

La rotación es obligatoria: si alguien roba un token de refresco y lo usa, el
legítimo deja de funcionar y el robo se hace visible.

Cada petición comprueba que la sesión sigue viva, aunque el JWT sea válido.
Revocar de verdad importa más que ahorrar una consulta.

## Permisos

El control es por permiso, no por rol; los roles son conjuntos predefinidos.

| Rol | Alcance |
| --- | --- |
| `owner` | Todo, incluido borrar la organización y la facturación |
| `admin` | Todo salvo lo anterior |
| `manager` | Agenda completa, catálogo, bonos, informes, sin ajustes ni integraciones |
| `staff` | Su propia agenda, registrar entradas, ver clientes y su saldo de bonos |

Nadie puede gestionar a alguien de rango igual o superior al suyo, ni conceder a
una clave de API permisos que no tenga.

El `superadmin` de la instalación entra en cualquier organización; es un rol de
plataforma, no de negocio.

## Crear y usar la cuenta de administrador

Hay tres formas, según el momento.

### 1. Desde la consola del servidor (la más directa)

```bash
npm run admin -- mateo@ejemplo.es "una-contraseña-larga-y-tuya"
```

Si el usuario no existe, lo crea como administrador de la instalación y activo.
Si ya existe, lo promueve y, si le pasas contraseña, se la cambia. Es también la
vía de rescate cuando nadie puede entrar al panel.

Sin contraseña, la cuenta queda pendiente y el comando imprime un enlace de
activación:

```bash
npm run admin -- mateo@ejemplo.es
# Administrador creado: mateo@ejemplo.es
# Enlace de activación: https://citas.ejemplo.es/activar?token=...
```

Con Docker:

```bash
docker compose exec app node packages/api/dist/db/cli.js admin mateo@ejemplo.es "contraseña"
```

### 2. Al arrancar por primera vez, desde `.env`

```
BOOTSTRAP_ADMIN_EMAIL=mateo@ejemplo.es
BOOTSTRAP_ADMIN_PASSWORD=una-contraseña-larga
BOOTSTRAP_ORG_NAME=Mi establecimiento
```

Se crea solo si no existía ya. Conviene quitar la contraseña del fichero
después.

### 3. Con los datos de ejemplo

```bash
npm run seed
```

Crea `admin@ejemplo.es` con contraseña `CitaFacil2026!`, que es administrador de
la instalación y propietario de la organización de ejemplo. Sirve para probar,
no para producción.

### Entrar

Ve a `/entrar`, usa el correo y la contraseña, y tendrás disponible el enlace
**Panel**. Las secciones **Acceso y registro** y **Sistema** solo las ve quien
es administrador de la instalación.

Desde ahí puedes promover a otras personas en Acceso y registro → Usuarios. La
aplicación impide quitarse el rol a uno mismo si es el último administrador que
queda.
