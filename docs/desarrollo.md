# Desarrollo

## Puesta en marcha

```bash
npm install
cp .env.example .env
npm run build -w @cita-facil/shared   # el resto depende de este paquete
npm run seed                           # datos de ejemplo
npm run dev
```

- API con recarga automática en <http://localhost:3000>.
- Frontend con Vite en <http://localhost:5173>, con proxy hacia el API.

Se trabaja contra el puerto 5173: así el navegador ve un único origen y las
cookies de sesión se comportan igual que en producción.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API y frontend en paralelo |
| `npm run build` | Compila los tres paquetes |
| `npm start` | Arranca el compilado |
| `npm test` | Pruebas del backend |
| `npm run typecheck` | Comprobación de tipos en todos los paquetes |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run migrate` | Aplica migraciones |
| `npm run migrate:status` | Estado de las migraciones |
| `npm run seed` | Datos de ejemplo |
| `npm run backup` | Copia de seguridad |
| `npm run restore -- <fichero> [--truncate]` | Restaura |

Los comandos se ejecutan desde la raíz del repositorio, de forma que las rutas
relativas de `.env` (`./data`, `./config/trust`) apunten siempre al mismo sitio.

## Estructura

```
packages/shared/src/
  enums.ts          Enumerados del dominio
  permissions.ts    Catálogo de permisos y roles
  time.ts           Utilidades de tiempo puras
  schemas/          Esquemas Zod compartidos por API y frontend

packages/api/src/
  config/env.ts     Todas las variables de entorno, validadas
  db/               Dialectos, migraciones, tipos, semillas
  lib/              Fechas, criptografía, contraseñas, TOTP, DER, errores
  plugins/          Autenticación y manejo de errores
  routes/           Endpoints (validación + permisos, sin lógica de negocio)
  modules/          Dominio
  jobs/scheduler.ts Tareas programadas

packages/web/src/
  lib/api.ts        Cliente del API con renovación de token
  stores/auth.ts    Estado de sesión
  i18n/             Traducciones es, gl, en
  components/       Primitivas de interfaz y contenedores
  pages/            Pantallas de cliente
  pages/admin/      Pantallas del panel
```

## Añadir un endpoint

1. Si hay entrada o salida nueva, define el esquema Zod en
   `packages/shared/src/schemas/`.
2. Escribe la lógica en el módulo correspondiente de `modules/`.
3. Añade la ruta en `routes/`, con su `schema` (validación y documentación) y la
   comprobación de permisos.
4. Añade una prueba.

Las rutas no llevan lógica de negocio: validan, comprueban permisos y delegan.
Es lo que permite que el mismo caso de uso lo usen el panel, el servidor MCP y
la skill de Alexa sin duplicar reglas.

## Añadir una migración

```ts
// packages/api/src/db/migrations/004_lo_que_sea.ts
import type { Kysely } from 'kysely';
import { createTable, index, notNull, pk, t, type } from './helpers.js';

export async function up(db: Kysely<any>): Promise<void> {
  await pk(createTable(db, 'mi_tabla'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'mi_tabla', ['organization_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mi_tabla').ifExists().execute();
}
```

Regístrala en `migrations/index.ts` y añade el tipo de la tabla en `db/types.ts`.

Usa siempre los ayudantes de tipo (`t.id()`, `t.instant()`, `t.bool()`): son los
que hacen que la misma migración valga en los cinco motores. Ver
[base-de-datos.md](base-de-datos.md).

## Pruebas

Hay dos suites: unitarias y de integración del backend, y end-to-end sobre la
aplicación real.

```bash
npm test          # backend
npm run test:e2e  # navegador, incluye compilar y levantar la aplicación
npm run test:all  # las dos
```

### Backend

Usan el ejecutor de Node. Cada prueba abre su propia base SQLite en memoria y
aplica las migraciones reales, así que lo que se verifica es el comportamiento
contra el esquema que se va a desplegar.

Estilo: **una prueba, un comportamiento**. Si una prueba verifica dos cosas que
pueden fallar por motivos distintos, son dos pruebas. La excepción son varios
asertos encadenados sobre facetas de un mismo resultado.

```ts
it('no genera huecos que se salgan de la hora de cierre', async () => {
  const result = await computeAvailability({ ... });
  const last = result.days[0]!.slots.at(-1)!;
  assert.equal(last.localStartMinute + last.durationMinutes, 14 * 60);
});
```

Lo que hay cubierto: motor de disponibilidad (horarios, márgenes, aforo,
duración ajustable, antelación), reserva y conflictos, política de acceso y
lista de autorizados, aritmética de intervalos, zonas horarias y cambios de
hora, TOTP, cifrado y firmas, firma de Redsys y de webhooks, expansión de series
periódicas, copias de seguridad y extracción de NIF de certificados.

### End-to-end (Playwright)

```bash
npm run test:e2e                                  # todo
npx playwright test --project=escritorio          # solo escritorio
npx playwright test --ui                          # modo interactivo
npx playwright show-report                        # informe de la última tirada
```

Los dos últimos se ejecutan desde `packages/web`.

Se prueba contra el **binario compilado**, no contra el servidor de desarrollo:
lo que se verifica es exactamente lo que se despliega, con el frontend servido
por Fastify en el mismo puerto que el API.

Cada tirada levanta la aplicación en el puerto 3100 con una base SQLite propia
(`data/e2e/`) que se siembra con los datos de ejemplo, así que parte siempre del
mismo estado y no toca la base de desarrollo. La configuración está en
`packages/web/playwright.config.ts`.

Ahí se sube también el límite de peticiones: toda la suite ataca desde la misma
IP y en serie, y con el valor de producción (300 por minuto) se agota a mitad de
la tirada y el API empieza a devolver 429. El limitador sigue montado, solo se
le da margen.

Ficheros:

| Fichero | Qué cubre |
| --- | --- |
| `e2e/acceso.spec.ts` | Métodos que se ofrecen, entrada, credenciales incorrectas, persistencia de la sesión al recargar, cierre de sesión y retorno a la ruta pedida. |
| `e2e/reserva.spec.ts` | Recorrido completo de reserva, duración ajustable, precio por minuto, desaparición del hueco reservado y consulta por código. |
| `e2e/panel.spec.ts` | Las trece secciones del panel cargan con datos, y el caso del administrador sin organización. |
| `e2e/administracion.spec.ts` | Lo que se crea en el panel se ve en la página pública, apagar un método de acceso y cerrar el registro. |

Los dos proyectos (`escritorio` y `movil`) ejecutan la misma suite en un
viewport de escritorio y en uno de móvil, porque la interfaz de cliente cambia
de disposición y la del panel pliega el menú.

Las pruebas localizan los elementos por rol y por texto accesible
(`getByRole`, `getByLabel`), no por clases CSS. Es más lento de escribir y a
cambio detecta problemas reales: la primera versión de la suite no encontraba
ningún campo porque las etiquetas no estaban asociadas a sus controles, que era
un defecto de accesibilidad de verdad, no del test.

## Integración continua

En cada propuesta de cambio contra `develop` o `main`, y en cada empujón a esas
ramas, GitHub Actions ejecuta tres trabajos en paralelo
(`.github/workflows/ci.yml`):

| Trabajo | Qué hace |
| --- | --- |
| Tipos y estilo | `npm run typecheck` y `npm run lint` |
| Pruebas de backend | `npm test` |
| Pruebas end-to-end | Compila y recorre la aplicación con Playwright |

Al empujar (no en las propuestas), si los tres pasan se publica además la imagen
de contenedor. Ver [despliegue](despliegue.md#imágenes-publicadas).

Tres cosas que conviene saber porque en local no se ven:

- **`npm run lint` forma parte de la CI.** Una importación que se queda sin usar
  tras un refactor rompe la rama.
- **`packages/shared/dist` no se versiona**, así que en un clon limpio hay que
  compilar el paquete compartido antes del typecheck y de las pruebas de
  backend. La CI lo hace; si clonas el proyecto en otra máquina, `npm run build`
  antes de nada.
- **El `package-lock.json` se genera en Windows** y npm no guarda en él los
  binarios nativos de otras plataformas (rollup, lightningcss, esbuild). Por eso
  el trabajo que compila el frontend, y también el Dockerfile, resuelven las
  dependencias en lugar de usar `npm ci`. Generar el fichero de bloqueo en Linux
  y versionarlo dejaría volver a `npm ci` en todas partes.

## Traducciones

Tres ficheros en `packages/web/src/i18n/locales/`. El español es la referencia y
el respaldo: si falta una clave en gallego o inglés se muestra la española, no
la clave en crudo.

Las plantillas de aviso del backend están en
`packages/api/src/modules/notifications/templates.ts`, también en los tres
idiomas.

## Estilo

- Prettier y ESLint con la configuración del repositorio.
- Comentarios en castellano, explicando el porqué y no el qué.
- Nada de `any` salvo en las fronteras con librerías que lo obligan.
- Los importes de dinero siempre en enteros de unidades menores.
- Los instantes siempre en ISO-8601 UTC; las horas locales, en minutos desde
  medianoche.

## Depuración

```
LOG_LEVEL=debug
DB_LOG_QUERIES=true
```

Muestra cada consulta con su duración. En desarrollo el log sale con formato
legible; en producción, en JSON.

Para probar los correos sin servidor SMTP, `MAIL_TRANSPORT=json` los escribe en
el log con el cuerpo completo, incluidos los enlaces de verificación.
