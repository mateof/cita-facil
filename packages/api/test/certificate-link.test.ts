import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { createUser, findUserById } from '../src/modules/users/repository.ts';
import { linkVerifiedCertificate } from '../src/modules/auth/service.ts';
import type { CertificateIdentity } from '../src/modules/auth/certificate.ts';

/**
 * Vincular el DNIe a una cuenta.
 *
 * Lo que se comprueba no es la criptografía, que ya la hace `X509Certificate`,
 * sino a quién se le deja quedarse con qué documento. Importa porque el acceso
 * por certificado busca cuenta por NIF: si el documento se pudiera poner en
 * cualquier cuenta, el dueño del DNI acabaría entrando en la del impostor.
 */

let db: Kysely<Database>;

/** Un certificado ya comprobado, que es lo que recibe la función bajo prueba. */
function certificado(nif: string): CertificateIdentity {
  return {
    nif,
    name: 'Persona de prueba',
    givenName: 'Persona',
    familyName: 'De Prueba',
    email: null,
    issuer: 'AC FNMT Usuarios',
    serialNumber: 'ABC123',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2030-01-01T00:00:00.000Z',
    fingerprint: 'f'.repeat(64),
  };
}

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('identities').execute();
  await db.deleteFrom('users').execute();
});

describe('vincular un certificado a la cuenta', () => {
  it('una cuenta sin documento se queda con el del certificado', async () => {
    const user = await createUser({ email: 'sin-dni@ejemplo.es', name: 'Sin documento' });
    assert.equal(user.nif, null);

    const actualizado = await linkVerifiedCertificate(user, certificado('12345678Z'));

    assert.equal(actualizado.nif, '12345678Z');
    const guardado = await findUserById(user.id);
    assert.equal(guardado?.nif, '12345678Z');
    assert.equal(guardado?.nif_key, '12345678Z');
  });

  it('queda una identidad de certificado con la que volver a entrar', async () => {
    const user = await createUser({ email: 'identidad@ejemplo.es', name: 'Con identidad' });
    await linkVerifiedCertificate(user, certificado('12345678Z'));

    const identidad = await db
      .selectFrom('identities')
      .selectAll()
      .where('provider', '=', 'certificate')
      .where('subject', '=', '12345678Z')
      .executeTakeFirst();

    assert.equal(identidad?.user_id, user.id);
    assert.equal(identidad?.issuer, 'AC FNMT Usuarios');
  });

  it('vincular dos veces el mismo no se queja', async () => {
    const user = await createUser({ email: 'repetido@ejemplo.es', name: 'Repetido' });
    const primera = await linkVerifiedCertificate(user, certificado('12345678Z'));
    const segunda = await linkVerifiedCertificate(primera, certificado('12345678Z'));

    assert.equal(segunda.nif, '12345678Z');
    const identidades = await db
      .selectFrom('identities')
      .selectAll()
      .where('subject', '=', '12345678Z')
      .execute();
    assert.equal(identidades.length, 1, 'no debería duplicar la identidad');
  });

  /*
   * El caso que justifica que el documento no sea un campo de texto: si la
   * cuenta de otra persona ya lleva ese DNI, este certificado no se lo quita ni
   * se cuela en ella.
   */
  it('un documento que ya tiene otra cuenta se rechaza', async () => {
    await createUser({ email: 'dueña@ejemplo.es', name: 'Dueña', nif: '12345678Z' });
    const otro = await createUser({ email: 'otro@ejemplo.es', name: 'Otro' });

    await assert.rejects(
      () => linkVerifiedCertificate(otro, certificado('12345678Z')),
      (error: { code?: string }) => error.code === 'nif_taken',
    );

    const sinTocar = await findUserById(otro.id);
    assert.equal(sinTocar?.nif, null);
  });

  it('un documento ya vinculado como identidad de otra cuenta se rechaza', async () => {
    const primera = await createUser({ email: 'primera@ejemplo.es', name: 'Primera' });
    await linkVerifiedCertificate(primera, certificado('12345678Z'));
    // Se le quita el NIF a la primera para que solo quede la identidad: así se
    // comprueba que la identidad basta para bloquear, sin apoyarse en el NIF.
    await db.updateTable('users').set({ nif: null, nif_key: primera.id }).where('id', '=', primera.id).execute();

    const segunda = await createUser({ email: 'segunda@ejemplo.es', name: 'Segunda' });

    await assert.rejects(
      () => linkVerifiedCertificate(segunda, certificado('12345678Z')),
      (error: { code?: string }) => error.code === 'nif_taken',
    );
  });

  it('una cuenta que ya lleva otro documento no admite un certificado distinto', async () => {
    const user = await createUser({ email: 'con-dni@ejemplo.es', name: 'Con documento', nif: '11111111H' });

    await assert.rejects(
      () => linkVerifiedCertificate(user, certificado('12345678Z')),
      (error: { code?: string }) => error.code === 'nif_mismatch',
    );

    const sinTocar = await findUserById(user.id);
    assert.equal(sinTocar?.nif, '11111111H');
  });
});
