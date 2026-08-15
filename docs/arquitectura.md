# Arquitectura

## Visión general

```
                    ┌──────────────────────────────┐
   navegador  ───▶  │  nginx (opcional)            │
   DNIe / FNMT      │  TLS mutuo, cabeceras cert.  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  Fastify                     │
                    │  ├─ /            SPA React   │
                    │  ├─ /api/v1/...  API REST    │
                    │  ├─ /api/v1/mcp  servidor MCP│
                    │  └─ planificador en proceso  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  SQLite / PostgreSQL /       │
                    │  MySQL / MariaDB / SQL Server│
                    └──────────────────────────────┘
```

Un solo proceso sirve la interfaz, el API, el servidor MCP y las tareas
programadas. Es una decisión consciente: el objetivo es que una peluquería
pueda tener esto funcionando en una Raspberry o en un VPS de cinco euros sin
montar una infraestructura. Cuando hace falta escalar, se puede separar el
frontend (`SERVE_WEB=false`) y desactivar el planificador en todas las
instancias menos una.

## Paquetes

| Paquete | Responsabilidad |
| --- | --- |
| `@cita-facil/shared` | Enumerados, permisos, esquemas de validación (Zod) y utilidades de tiempo. Lo consumen tanto el backend como el frontend, de forma que un cambio en el contrato rompe la compilación de los dos lados a la vez. |
| `@cita-facil/api` | Backend. |
| `@cita-facil/web` | Frontend. |

## Organización del backend

```
src/
  config/            Lectura y validación de variables de entorno
  db/                Dialectos, migraciones, tipos de tabla y semillas
  lib/               Utilidades transversales: fechas, cripto, ids, errores
  plugins/           Plugins de Fastify: autenticación y errores
  routes/            Definición de endpoints y validación de entrada
  modules/           Lógica de dominio
    auth/            Sesiones, certificados, passkeys, OIDC, retos
    users/           Repositorio de usuarios y pertenencias
    catalog/         Organizaciones, sedes, recursos, servicios, horarios
    availability/    Motor de disponibilidad y asignación de recursos
    appointments/    Ciclo de vida de las citas, acceso, recordatorios, espera
    notifications/   Cola de avisos, plantillas y canales
    payments/        Stripe, Redsys, bonos
    integrations/    MCP, Alexa, Google, webhooks salientes
    backups/         Copias de seguridad y restauración
    audit/           Traza de auditoría
    settings/        Ajustes por organización, con cifrado de secretos
  jobs/              Planificador
```

Las rutas no contienen lógica de negocio: validan la entrada, comprueban
permisos y llaman a un módulo. Eso permite que el mismo caso de uso lo invoquen
el panel, el servidor MCP y la skill de Alexa sin duplicar reglas.

## Decisiones que conviene conocer

### Un solo proceso, sin cola externa

Los avisos se guardan como filas en `notifications` con su momento de envío. El
planificador (croner, en proceso) despacha cada minuto lo que toque, con
reintentos de espera creciente. Se gana simplicidad de despliegue y trazabilidad
(el panel muestra el historial real de envíos); se pierde la capacidad de
repartir la carga entre varios trabajadores, que no es un objetivo aquí.

La misma idea vale para las sesiones: viven en la tabla `sessions`, no en
memoria, así que reiniciar no echa a nadie. Redis es opcional y solo actúa como
caché de esa comprobación y como almacén compartido del límite de peticiones;
perderlo no pierde sesiones. Ver [configuración](configuracion.md).

### Multi-tenant desde el principio

Todo cuelga de una organización, incluso en una instalación de un solo negocio.
El coste es una columna más en cada tabla; el beneficio es que alojar un segundo
establecimiento no requiere migrar nada.

Una organización es un negocio completo e independiente: sus sedes, su catálogo,
sus horarios, su personal, sus bonos, sus citas y su configuración. Nada se
comparte entre organizaciones salvo las cuentas de usuario, que son de la
instalación: la misma persona puede ser clienta de la peluquería y del gimnasio
con un solo acceso, y su historial en cada una es independiente.

Se gestionan en **Panel → Organizaciones**, visible solo para el administrador
de la instalación. Ver [organizaciones](organizaciones.md).

### Hora local y hora UTC

La agenda razona en minutos desde medianoche de la hora local de la sede, porque
un negocio abre "de 9 a 14" en su zona, no en UTC. Se persiste el instante UTC
para poder comparar entre sedes, y además se desnormaliza la fecha local
(`local_date`) y el minuto de inicio (`local_start_minute`) en cada cita, que es
lo que hace que los informes por día y las agendas sean consultas directas.

Los cambios de hora se tienen en cuenta: `minutesInLocalDay` devuelve 1380 o
1500 minutos los días del salto, de forma que no se generan huecos en horas que
no existen ni se pierde una hora de disponibilidad.

### Doble comprobación al reservar

La disponibilidad se calcula dos veces: al mostrar los huecos y, otra vez,
dentro de la transacción que inserta la cita, contando las plazas ya ocupadas
del recurso. Entre que alguien ve un hueco y pulsa "reservar" pueden pasar
minutos, y sin la segunda comprobación dos personas se llevarían la misma hora.

### Errores con código estable

Todas las respuestas de error tienen la misma forma y un `code` que no cambia:

```json
{ "error": { "code": "slot_unavailable", "message": "...", "requestId": "req_..." } }
```

El frontend traduce por ese código, así que el mensaje del servidor sirve para
depurar y para clientes que no traducen.

### Búsqueda aproximada en JavaScript, no en la base de datos

Los campos que enlazan con otra entidad (una persona, un servicio, un recurso)
sugieren mientras se escribe, tolerando acentos y erratas: "pena" encuentra
"Peña", "nuira" encuentra "Nuria". La comparación vive en
`packages/shared/src/search.ts` y la usan **los dos lados**: el backend, sobre
los candidatos que saca de la base de datos, y el frontend, sobre las listas que
ya tiene en memoria.

No se hace en SQL porque la aplicación soporta cinco motores y ninguno comparte
la misma extensión de similitud (`pg_trgm`, `SOUNDEX`, FTS5...). `LIKE` sirve
para acotar, pero no encuentra una palabra con una letra cambiada de sitio.

Se puntúa de 0 a 1 en el orden en que la gente espera los resultados: primero lo
que empieza igual, luego lo que lo contiene y por último lo que se le parece con
alguna errata. Para las erratas se usa distancia de edición contando la
transposición de dos letras contiguas como **una sola** operación, porque es la
equivocación de tecleo más frecuente y con Levenshtein a secas se quedaría
fuera del umbral.

El coste: el backend se trae los candidatos de la organización (hasta 2000) y
puntúa en memoria. Por encima de esa cifra la búsqueda sigue funcionando, pero
los que queden fuera solo se encuentran escribiendo bien.

## Frontend

React con Vite, TanStack Query para el estado de servidor y Zustand solo para
la sesión. Tailwind 4 para los estilos, con el color de marca como variable CSS
que la organización puede cambiar en tiempo de ejecución.

El token de acceso vive en memoria, no en `localStorage`: un XSS no lo puede
leer de una variable de módulo tan fácilmente. La sesión de larga duración es
una cookie `httpOnly` que el JavaScript de la página no ve, y con ella se
renueva el token al recargar.

La interfaz de cliente parte de móvil (navegación inferior, objetivos táctiles
de 44 píxeles, un paso por pantalla en la reserva) y crece hacia escritorio. El
panel de administración asume pantalla grande pero sigue siendo usable desde el
teléfono con el menú plegable.
