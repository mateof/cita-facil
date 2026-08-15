import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { isoNow } from '../../lib/dates.js';
import { hashPassword } from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import { createUser, findUserByEmail, linkIdentity } from './repository.js';

/**
 * Crea o promueve al administrador de la instalación.
 *
 * Es la vía de rescate: sirve para arrancar una instalación nueva y también
 * para recuperar el control si nadie puede entrar al panel. Se invoca desde la
 * consola del servidor, que es un sitio al que solo llega quien ya tiene acceso
 * a la máquina, así que no añade una superficie de ataque nueva.
 */
export interface PromoteResult {
  userId: string;
  created: boolean;
  passwordSet: boolean;
  activationUrl: string | null;
}

export async function promoteToPlatformAdmin(
  email: string,
  password?: string,
): Promise<PromoteResult> {
  const normalized = email.trim().toLowerCase();
  const existing = await findUserByEmail(normalized);

  if (existing) {
    const patch: Record<string, unknown> = {
      platform_role: 'superadmin',
      status: 'active',
      updated_at: isoNow(),
    };

    if (password) {
      patch.password_hash = await hashPassword(password);
      patch.failed_login_count = 0;
      patch.locked_until = null;
    }

    await db().updateTable('users').set(patch).where('id', '=', existing.id).execute();

    if (password) {
      await linkIdentity({
        userId: existing.id,
        provider: 'password',
        subject: existing.email_key,
      });
    }

    logger.info({ email: normalized }, 'Usuario promovido a administrador de la instalación');
    return {
      userId: existing.id,
      created: false,
      passwordSet: Boolean(password),
      activationUrl: null,
    };
  }

  const user = await createUser({
    email: normalized,
    name: 'Administrador',
    locale: env.DEFAULT_LOCALE,
    timezone: env.DEFAULT_TIMEZONE,
    platformRole: 'superadmin',
    // Sin contraseña, la cuenta queda pendiente de activar y solo se puede
    // usar con el enlace que se genera a continuación.
    status: password ? 'active' : 'pending',
    emailVerified: true,
    passwordHash: password ? await hashPassword(password) : null,
  });

  if (password) {
    await linkIdentity({ userId: user.id, provider: 'password', subject: user.email_key });
    logger.info({ email: normalized }, 'Administrador de la instalación creado');
    return { userId: user.id, created: true, passwordSet: true, activationUrl: null };
  }

  const { resendActivation } = await import('../auth/service.js');
  const activation = await resendActivation(user.id);

  logger.info({ email: normalized }, 'Administrador creado, pendiente de activar');
  return {
    userId: user.id,
    created: true,
    passwordSet: false,
    activationUrl: activation.activationUrl,
  };
}
