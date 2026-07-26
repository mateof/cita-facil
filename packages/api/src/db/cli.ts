/**
 * Herramienta de línea de comandos para operar sobre la base de datos sin
 * levantar el servidor: migraciones, datos de ejemplo y copias de seguridad.
 *
 *   npm run migrate            # aplica las migraciones pendientes
 *   npm run migrate:down       # deshace la última
 *   npm run migrate:status     # muestra el estado
 *   npm run seed               # carga datos de ejemplo
 *   npm run backup             # crea una copia de seguridad
 */
import { closeDatabase, initDatabase, db } from './index.js';
import { migrateDown, migrateToLatest, migrationStatus } from './migrator.js';
import { ensureBootstrapAdmin, seedDemoData } from './seed.js';
import { logger } from '../lib/logger.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const args = process.argv.slice(3);

  await initDatabase({ migrate: false });

  switch (command) {
    case 'up': {
      const applied = await migrateToLatest(db());
      logger.info(
        applied === 0 ? 'No había migraciones pendientes' : `${applied} migración(es) aplicada(s)`,
      );
      break;
    }

    case 'down': {
      await migrateDown(db());
      break;
    }

    case 'status': {
      const status = await migrationStatus(db());
      for (const item of status) {
        const state = item.executedAt ? `aplicada el ${item.executedAt}` : 'pendiente';
        process.stdout.write(`${item.name.padEnd(20)} ${state}\n`);
      }
      break;
    }

    case 'seed': {
      await migrateToLatest(db());
      await ensureBootstrapAdmin(db());
      await seedDemoData(db());
      break;
    }

    case 'backup': {
      const { createBackup } = await import('../modules/backups/service.js');
      const record = await createBackup({ trigger: 'cli' });
      process.stdout.write(`Copia creada: ${record.filename} (${record.sizeBytes} bytes)\n`);
      break;
    }

    case 'admin': {
      // Crea o promueve al administrador de la instalación. Es la vía de
      // rescate cuando no queda nadie con acceso al panel.
      const email = args[0];
      if (!email) {
        throw new Error('Uso: admin <correo> [contraseña]');
      }

      await migrateToLatest(db());
      const { promoteToPlatformAdmin } = await import('../modules/users/admin.js');
      const result = await promoteToPlatformAdmin(email, args[1]);

      process.stdout.write(
        result.created
          ? `Administrador creado: ${email}\n`
          : `Usuario promovido a administrador: ${email}\n`,
      );
      if (result.passwordSet) {
        process.stdout.write('Contraseña establecida.\n');
      } else if (result.activationUrl) {
        process.stdout.write(`Enlace de activación: ${result.activationUrl}\n`);
      } else {
        process.stdout.write(
          'La cuenta conserva su contraseña actual. Usa "recuperar contraseña" si no la recuerdas.\n',
        );
      }
      break;
    }

    case 'restore': {
      const filename = args[0];
      if (!filename) throw new Error('Uso: restore <fichero> [--truncate]');
      const { restoreBackup } = await import('../modules/backups/service.js');
      const result = await restoreBackup(filename, { truncate: args.includes('--truncate') });
      process.stdout.write(`Restauradas ${result.rows} filas en ${result.tables} tablas\n`);
      break;
    }

    default:
      throw new Error(`Comando desconocido: ${command}`);
  }
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error({ err: error }, 'Error ejecutando el comando');
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
