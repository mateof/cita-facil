import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import { findUserByEmail, findUserById, linkIdentity, type UserRow } from '../users/repository.js';
import { consumeChallenge, createChallenge } from './challenges.js';
import { finishLogin, type AuthenticatedResult, type RequestContext } from './service.js';
import type { LoginResponse } from '@cita-facil/shared';

/**
 * Passkeys (WebAuthn).
 *
 * Sirven para dos cosas distintas y aquí están las dos: como método de entrada
 * completo sin contraseña, y como segundo factor de una cuenta con contraseña.
 * El `rpId` sale del dominio de `APP_URL`; si se sirve la aplicación desde
 * varios dominios hay que fijar `WEBAUTHN_RP_ID` al dominio principal, porque
 * una credencial creada en un dominio no vale en otro.
 */

const RP = {
  name: env.webauthn.rpName,
  id: env.webauthn.rpId,
  origin: env.webauthn.origin,
};

interface RegistrationChallengePayload {
  challenge: string;
  userId: string;
}

interface AuthenticationChallengePayload {
  challenge: string;
  userId: string | null;
}

export async function startPasskeyRegistration(userId: string): Promise<{
  challengeId: string;
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');

  const existing = await db()
    .selectFrom('webauthn_credentials')
    .select(['credential_id', 'transports'])
    .where('user_id', '=', userId)
    .execute();

  const options = await generateRegistrationOptions({
    rpName: RP.name,
    rpID: RP.id,
    userID: Buffer.from(user.id, 'utf8'),
    userName: user.email ?? user.name,
    userDisplayName: user.name,
    attestationType: 'none',
    // Impide registrar dos veces la misma llave en la misma cuenta.
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: row.transports ? (JSON.parse(row.transports) as never) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const challengeId = await createChallenge<RegistrationChallengePayload>({
    kind: 'webauthn_registration',
    userId,
    payload: { challenge: options.challenge, userId },
    ttlSeconds: 300,
  });

  return { challengeId, options };
}

export async function finishPasskeyRegistration(params: {
  challengeId: string;
  response: RegistrationResponseJSON;
  deviceName?: string;
}): Promise<{ credentialId: string }> {
  const challenge = await consumeChallenge<RegistrationChallengePayload>(
    params.challengeId,
    'webauthn_registration',
  );

  const verification = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: challenge.payload.challenge,
    expectedOrigin: RP.origin,
    expectedRPID: RP.id,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new BadRequestError('No se pudo verificar la passkey', 'passkey_verification_failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await db()
    .insertInto('webauthn_credentials')
    .values({
      id: newId(),
      user_id: challenge.payload.userId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp ? 1 : 0,
      device_name: params.deviceName?.slice(0, 120) ?? null,
      last_used_at: null,
      created_at: isoNow(),
    })
    .execute();

  await linkIdentity({
    userId: challenge.payload.userId,
    provider: 'passkey',
    subject: credential.id,
  });

  return { credentialId: credential.id };
}

/**
 * Inicia la autenticación. Si se indica el correo se limitan las credenciales
 * admitidas a las de ese usuario; si no, se deja que el navegador ofrezca las
 * passkeys detectables que tenga (entrada sin escribir nada).
 */
export async function startPasskeyAuthentication(email?: string): Promise<{
  challengeId: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}> {
  let user: UserRow | undefined;
  let allowCredentials: { id: string; transports?: never }[] | undefined;

  if (email) {
    user = await findUserByEmail(email);
    if (user) {
      const rows = await db()
        .selectFrom('webauthn_credentials')
        .select(['credential_id', 'transports'])
        .where('user_id', '=', user.id)
        .execute();
      allowCredentials = rows.map((row) => ({
        id: row.credential_id,
        transports: row.transports ? (JSON.parse(row.transports) as never) : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP.id,
    userVerification: 'preferred',
    allowCredentials,
  });

  const challengeId = await createChallenge<AuthenticationChallengePayload>({
    kind: 'webauthn_authentication',
    userId: user?.id ?? null,
    payload: { challenge: options.challenge, userId: user?.id ?? null },
    ttlSeconds: 300,
  });

  return { challengeId, options };
}

export async function finishPasskeyAuthentication(
  params: { challengeId: string; response: AuthenticationResponseJSON },
  context: RequestContext = {},
): Promise<LoginResponse & { result?: AuthenticatedResult }> {
  const challenge = await consumeChallenge<AuthenticationChallengePayload>(
    params.challengeId,
    'webauthn_authentication',
  );

  const stored = await db()
    .selectFrom('webauthn_credentials')
    .selectAll()
    .where('credential_id', '=', params.response.id)
    .executeTakeFirst();

  if (!stored) throw new UnauthorizedError('Passkey desconocida', 'passkey_unknown');
  if (challenge.payload.userId && challenge.payload.userId !== stored.user_id) {
    throw new UnauthorizedError('La passkey no pertenece a esta cuenta', 'passkey_mismatch');
  }

  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: challenge.payload.challenge,
    expectedOrigin: RP.origin,
    expectedRPID: RP.id,
    requireUserVerification: false,
    credential: {
      id: stored.credential_id,
      publicKey: Buffer.from(stored.public_key, 'base64url'),
      counter: stored.counter,
      transports: stored.transports ? (JSON.parse(stored.transports) as never) : undefined,
    },
  });

  if (!verification.verified) {
    throw new UnauthorizedError('No se pudo verificar la passkey', 'passkey_verification_failed');
  }

  // El contador creciente detecta clonados del autenticador. Algunos
  // dispositivos siempre devuelven 0; en ese caso no aporta y se ignora.
  await db()
    .updateTable('webauthn_credentials')
    .set({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: isoNow(),
    })
    .where('id', '=', stored.id)
    .execute();

  const user = await findUserById(stored.user_id);
  if (!user) throw new UnauthorizedError('La cuenta ya no existe', 'account_missing');

  // Una passkey verificada con el usuario presente cubre ya dos factores
  // (posesión del dispositivo y biometría o PIN), así que no se pide otro.
  return finishLogin(user, 'passkey', undefined, undefined, context);
}

export async function listPasskeys(userId: string) {
  const rows = await db()
    .selectFrom('webauthn_credentials')
    .select(['id', 'device_name', 'device_type', 'backed_up', 'created_at', 'last_used_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function deletePasskey(userId: string, id: string): Promise<void> {
  const result = await db()
    .deleteFrom('webauthn_credentials')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (Number(result.numDeletedRows ?? 0) === 0) {
    throw new NotFoundError('Passkey no encontrada');
  }
}
