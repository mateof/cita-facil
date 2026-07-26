# Integraciones

## Servidor MCP para asistentes de IA

El Model Context Protocol permite que un asistente (Claude, o cualquier cliente
MCP) consulte y gestione citas en nombre del usuario.

**Endpoint**: `POST /api/v1/mcp/<organizationId>`

Autenticación con el mismo token de sesión o clave de API que el resto del API,
así que las citas que cree quedan a nombre del usuario real y con sus permisos,
no con una identidad de servicio anónima.

### Herramientas disponibles

| Herramienta | Qué hace |
| --- | --- |
| `listar_servicios` | Servicios reservables, con duración, precio y si admiten duración ajustable |
| `listar_sedes` | Sedes con dirección y zona horaria |
| `consultar_disponibilidad` | Huecos libres entre dos fechas |
| `proximo_hueco` | Primer hueco libre; acepta el nombre del servicio en lenguaje natural |
| `reservar_cita` | Crea la cita y devuelve el código de acceso |
| `mis_citas` | Citas del usuario |
| `detalle_cita` | Detalle completo |
| `cancelar_cita` | Cancela una cita |

### Configuración en el cliente

```json
{
  "mcpServers": {
    "citafacil": {
      "type": "http",
      "url": "https://citas.ejemplo.es/api/v1/mcp/<organizationId>",
      "headers": { "x-api-key": "cf_abc12345_..." }
    }
  }
}
```

La URL exacta aparece en Panel → Integraciones.

### Ejemplo de conversación

> "¿Cuándo tenéis hueco para un corte de pelo?"

El asistente llama a `proximo_hueco` con `servicio: "corte de pelo"`, recibe el
primer hueco y lo dice. Si el usuario confirma, llama a `reservar_cita`.

## Alexa

**Endpoint**: `POST /api/v1/organizations/<id>/integrations/alexa`

Se verifica la firma de Amazon antes de atender nada: certificado descargado de
la URL que indica la petición (con formato comprobado, para evitar un SSRF),
cadena válida, nombre alternativo `echo-api.amazon.com` y firma RSA-SHA1 del
cuerpo en bruto. Sin eso, cualquiera podría reservar citas haciendo peticiones
al endpoint.

```
ALEXA_ENABLED=true
ALEXA_SKILL_ID=amzn1.ask.skill.xxxxxxxx
```

### Intenciones esperadas

| Intención | Ejemplo de frase |
| --- | --- |
| `ListarServiciosIntent` | "¿Qué servicios tenéis?" |
| `ProximoHuecoIntent` | "¿Cuándo hay hueco para un corte?" |
| `ReservarIntent` | "Resérvame una cita para mañana" |
| `MisCitasIntent` | "¿Qué citas tengo?" |
| `CancelarCitaIntent` | "Cancela mi próxima cita" |

Para reservar hace falta vinculación de cuenta (*account linking*): Alexa manda
el token en `accessToken` y la aplicación lo valida como cualquier otro token de
sesión.

## Google

**Endpoint**: `POST /api/v1/organizations/<id>/integrations/google`

Acepta el formato de webhook de Dialogflow CX (el actual) y el clásico de
Dialogflow ES, para no dejar fuera a quien tenga un agente antiguo. La
autenticación va por la cabecera `Authorization` que reenvía el agente.

Etiquetas de intención reconocidas: `listar_servicios`, `proximo_hueco`,
`reservar`, `mis_citas`, `cancelar_cita`.

## Webhooks salientes

Panel → Integraciones → Webhooks.

Eventos: `appointment.created`, `appointment.confirmed`,
`appointment.rescheduled`, `appointment.cancelled`, `appointment.checked_in`,
`appointment.completed`, `appointment.no_show`, `access.granted`,
`access.denied`, `payment.succeeded`, `payment.refunded`, `waitlist.matched`.
También se puede suscribir a `*`.

### Firma

Cada entrega lleva:

```
X-CitaFacil-Signature: t=1753459200,v1=<hex>
X-CitaFacil-Event: appointment.created
```

La firma es `HMAC-SHA256(secreto, "<timestamp>.<cuerpo>")`. Incluir la marca de
tiempo dentro de lo firmado es lo que impide reenviar una petición interceptada
más tarde: rechaza las firmas de más de cinco minutos.

Verificación en Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verificar(secreto, cabecera, cuerpo) {
  const [, t, v1] = /^t=(\d+),v1=([a-f0-9]+)$/.exec(cabecera) ?? [];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const esperado = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest();
  const recibido = Buffer.from(v1, 'hex');
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
```

Reintentos a 1, 5, 30, 120 y 720 minutos. Tras 50 fallos acumulados el endpoint
se desactiva solo.

## Pagos

Panel → Ajustes → Pagos. Las credenciales se guardan cifradas con AES-256-GCM
usando una clave derivada de `APP_SECRET`, así que una copia de la base de datos
sin el `.env` no sirve para cobrar en nombre de nadie.

### Stripe

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Webhook a configurar en Stripe:

```
https://citas.ejemplo.es/api/v1/organizations/<orgId>/payments/stripe/webhook
```

Eventos: `checkout.session.completed`, `checkout.session.expired`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`.

### Redsys

```
REDSYS_MERCHANT_CODE=...
REDSYS_TERMINAL=001
REDSYS_SECRET_KEY=...
REDSYS_ENVIRONMENT=test
```

URL de notificación a dar de alta en el TPV:

```
https://citas.ejemplo.es/api/v1/organizations/<orgId>/payments/redsys/notify
```

Se implementa la firma HMAC SHA-256 v1: los datos van en un JSON en base64 y la
clave se deriva cifrando el número de pedido con 3DES. Las devoluciones se
registran, pero hay que completarlas desde el panel del TPV salvo que el
comercio tenga habilitada la operación 3 del API de comercios.

### Cobro por servicio

Cada servicio decide si exige pago (`paymentRequired`) o solo una señal
(`depositCents`). Con señal, se cobra la señal y el resto queda pendiente.

### Bonos

Series de sesiones prepagadas, habituales en gimnasios y piscinas. Se crean en
Panel → Bonos y se pueden vender por la web con la pasarela configurada: el bono
se emite cuando el cobro está confirmado, no antes. Ver [bonos](bonos.md) para
el detalle, incluidos los servicios que solo se reservan con bono.

## Widget de reserva

La página pública de un establecimiento está en `/reservar/<slug>` y se puede
empotrar en otra web:

```html
<iframe
  src="https://citas.ejemplo.es/reservar/mi-negocio"
  style="width:100%;height:760px;border:0"
  title="Reservar cita"
></iframe>
```

Si el sitio que empotra necesita otras cabeceras de seguridad, ajusta
`frameAncestors` en la política de contenido (`packages/api/src/app.ts`).
