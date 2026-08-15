import { defineConfig, devices } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

/**
 * Cada ejecución usa su propia base de datos.
 *
 * El aislamiento lo da el nombre único, no el borrado: Playwright vuelve a
 * cargar este fichero en cada proceso de trabajo, y para entonces el servidor
 * ya tiene la base abierta, así que intentar borrarla falla en Windows. La
 * limpieza es solo un mantenimiento que se salta sin ruido si no se puede.
 */
try {
  rmSync(resolve(repoRoot, 'data/e2e'), { recursive: true, force: true, maxRetries: 2 });
} catch {
  // Hay una ejecución en marcha usando ese directorio; el nombre único basta.
}

const dbFile = `./data/e2e/cita-facil-${process.env.E2E_RUN_ID ?? Date.now()}.sqlite`;

/**
 * Pruebas end-to-end sobre la aplicación real.
 *
 * Se levanta el binario compilado, no el servidor de desarrollo: lo que se
 * verifica es exactamente lo que se despliega, incluido el frontend servido por
 * Fastify en el mismo puerto que el API. La base de datos es un fichero SQLite
 * aparte que se borra antes de cada ejecución y que se siembra con los datos de
 * ejemplo, así que las pruebas parten siempre del mismo estado.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  // Las pruebas comparten una única base de datos, así que se ejecutan en serie
  // para que una no vea a medias lo que está haciendo otra.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    // El idioma de la interfaz se detecta del navegador; se fija para que las
    // aserciones por texto sean estables.
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'node packages/api/dist/main.js',
    cwd: repoRoot,
    url: `${baseURL}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      APP_URL: baseURL,
      APP_SECRET: 'secreto-de-pruebas-end-to-end-suficientemente-largo-123456',
      LOG_LEVEL: 'warn',
      DB_CLIENT: 'sqlite',
      DB_FILE: dbFile,
      DB_AUTO_MIGRATE: 'true',
      // Siembra los datos de ejemplo si la base está vacía, que es siempre.
      DB_AUTO_SEED: 'true',
      SERVE_WEB: 'true',
      WEB_DIST_PATH: resolve(repoRoot, 'packages/web/dist'),
      MAIL_TRANSPORT: 'none',
      // El planificador no aporta nada aquí y solo añade ruido en los registros.
      SCHEDULER_ENABLED: 'false',
      BACKUP_ENABLED: 'false',
      BACKUP_DIR: './data/e2e/backups',
      AUTH_METHODS: 'password,passkey,certificate',
      REGISTRATION_MODE: 'open',
      ALLOW_ANONYMOUS_BOOKING: 'true',
      COOKIE_SECURE: 'false',
      // Toda la suite ataca desde la misma IP y en serie, así que el límite de
      // producción (300 por minuto) se agota a mitad de la tirada y empieza a
      // devolver 429. Se sube aquí, no se quita: el limitador sigue montado.
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '10000',
    },
  },
});
