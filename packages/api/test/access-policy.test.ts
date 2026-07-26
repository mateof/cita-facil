import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, nextMonday, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import {
  addAllowlistEntries,
  addAllowlistEntry,
  assertLoginMethodEnabled,
  decideRegistration,
  findAllowlistEntry,
  isLoginMethodEnabled,
  normalizeAllowlistValue,
  saveAuthSettings,
} from '../src/modules/settings/access-policy.ts';
import { createAppointment } from '../src/modules/appointments/service.ts';
import { localToInstant } from '../src/lib/dates.ts';

let db: Kysely<Database>;
let fixture: Fixture;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('access_allowlist').execute();
  await saveAuthSettings({
    methods: { password: true, passkey: true, certificate: true, oidc: true, google: true },
    registrationMode: 'open',
    autoProvisionCertificate: true,
    autoProvisionSocial: true,
    allowAnonymousBooking: true,
    allowedEmailDomains: [],
  });
});

describe('métodos de acceso', () => {
  it('un método activado se admite', async () => {
    assert.equal(await isLoginMethodEnabled('google'), true);
  });

  it('un método desactivado deja de admitirse', async () => {
    await saveAuthSettings({
      methods: { password: true, passkey: false, certificate: true, oidc: true, google: false },
    });
    assert.equal(await isLoginMethodEnabled('google'), false);
  });

  it('rechaza el acceso por un método desactivado', async () => {
    await saveAuthSettings({
      methods: { password: true, passkey: false, certificate: true, oidc: true, google: false },
    });
    await assert.rejects(assertLoginMethodEnabled('passkey'), /desactivado/i);
  });

  it('no permite dejar la instalación sin ningún método', async () => {
    await assert.rejects(
      saveAuthSettings({
        methods: { password: false, passkey: false, certificate: false, oidc: false, google: false },
      }),
      /al menos un método/i,
    );
  });
});

describe('modo de registro abierto', () => {
  it('admite a cualquiera', async () => {
    const decision = await decideRegistration({ source: 'password', email: 'nuevo@ejemplo.es' });
    assert.equal(decision.allowed, true);
  });

  it('rechaza un dominio no autorizado cuando hay lista de dominios', async () => {
    await saveAuthSettings({ allowedEmailDomains: ['ejemplo.es'] });
    const decision = await decideRegistration({ source: 'password', email: 'ana@otro.com' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'domain_not_allowed');
  });

  it('admite un dominio de la lista', async () => {
    await saveAuthSettings({ allowedEmailDomains: ['ejemplo.es'] });
    const decision = await decideRegistration({ source: 'password', email: 'ana@ejemplo.es' });
    assert.equal(decision.allowed, true);
  });
});

describe('modo cerrado', () => {
  it('rechaza cualquier alta', async () => {
    await saveAuthSettings({ registrationMode: 'closed' });
    const decision = await decideRegistration({ source: 'password', email: 'ana@ejemplo.es' });
    assert.equal(decision.reason, 'registration_closed');
  });

  it('rechaza también por certificado', async () => {
    await saveAuthSettings({ registrationMode: 'closed' });
    const decision = await decideRegistration({ source: 'certificate', nif: '12345678Z' });
    assert.equal(decision.allowed, false);
  });
});

describe('modo solo invitación', () => {
  it('rechaza el alta por formulario', async () => {
    await saveAuthSettings({ registrationMode: 'invite_only' });
    const decision = await decideRegistration({ source: 'password', email: 'ana@ejemplo.es' });
    assert.equal(decision.allowed, false);
  });

  it('admite la activación de una cuenta creada por el administrador', async () => {
    await saveAuthSettings({ registrationMode: 'invite_only' });
    const decision = await decideRegistration({ source: 'invitation', email: 'ana@ejemplo.es' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, 'invited');
  });
});

describe('lista de autorizados', () => {
  it('rechaza a quien no está en la lista', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist', autoProvisionSocial: false });
    const decision = await decideRegistration({ source: 'password', email: 'ana@ejemplo.es' });
    assert.equal(decision.reason, 'not_allowlisted');
  });

  it('admite a quien está por su correo', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist' });
    await addAllowlistEntry({ type: 'email', value: 'Ana@Ejemplo.ES', platformRole: 'user' }, null);

    const decision = await decideRegistration({ source: 'password', email: 'ana@ejemplo.es' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, 'allowlisted');
  });

  it('admite a quien está por el dominio de su correo', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist' });
    await addAllowlistEntry({ type: 'domain', value: 'ejemplo.es', platformRole: 'user' }, null);

    const decision = await decideRegistration({ source: 'password', email: 'quien.sea@ejemplo.es' });
    assert.equal(decision.allowed, true);
  });

  it('admite por DNI a quien entra con certificado', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist', autoProvisionCertificate: false });
    await addAllowlistEntry({ type: 'nif', value: '12345678z', platformRole: 'user' }, null);

    const decision = await decideRegistration({ source: 'certificate', nif: '12345678Z' });
    assert.equal(decision.allowed, true);
  });

  it('rechaza un DNI que no está en la lista', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist', autoProvisionCertificate: false });
    const decision = await decideRegistration({ source: 'certificate', nif: '99999999R' });
    assert.equal(decision.allowed, false);
  });

  it('el alta automática por certificado se salta la lista cuando está activada', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist', autoProvisionCertificate: true });
    const decision = await decideRegistration({ source: 'certificate', nif: '99999999R' });
    assert.equal(decision.allowed, true);
  });

  it('el rol de la entrada se propaga a la decisión', async () => {
    await saveAuthSettings({ registrationMode: 'allowlist' });
    await addAllowlistEntry(
      { type: 'email', value: 'jefe@ejemplo.es', platformRole: 'superadmin' },
      null,
    );

    const decision = await decideRegistration({ source: 'password', email: 'jefe@ejemplo.es' });
    assert.equal(decision.entry?.platformRole, 'superadmin');
  });

  it('la coincidencia por correo gana a la de dominio', async () => {
    await addAllowlistEntry({ type: 'domain', value: 'ejemplo.es', platformRole: 'user' }, null);
    await addAllowlistEntry(
      { type: 'email', value: 'jefa@ejemplo.es', platformRole: 'superadmin' },
      null,
    );

    const match = await findAllowlistEntry({ email: 'jefa@ejemplo.es' });
    assert.equal(match?.type, 'email');
    assert.equal(match?.platformRole, 'superadmin');
  });

  it('normaliza los valores antes de guardarlos', () => {
    assert.equal(normalizeAllowlistValue('email', '  Ana@Ejemplo.ES '), 'ana@ejemplo.es');
    assert.equal(normalizeAllowlistValue('nif', '12345678-z'), '12345678Z');
    assert.equal(normalizeAllowlistValue('domain', '@Ejemplo.ES'), 'ejemplo.es');
  });

  it('el alta en bloque descarta los duplicados', async () => {
    await addAllowlistEntries({ type: 'email', values: 'a@ejemplo.es, b@ejemplo.es' }, null);
    const result = await addAllowlistEntries(
      { type: 'email', values: 'b@ejemplo.es\nc@ejemplo.es' },
      null,
    );

    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
  });
});

describe('reserva sin cuenta', () => {
  it('se rechaza cuando la instalación no la permite', async () => {
    await saveAuthSettings({ allowAnonymousBooking: false });

    const startsAt = localToInstant(nextMonday(), 9 * 60 + 30, fixture.timezone);
    await assert.rejects(
      createAppointment(
        fixture.organizationId,
        {
          serviceId: fixture.serviceId,
          startsAt,
          partySize: 1,
          guest: { name: 'Invitado', email: 'invitado@ejemplo.es' },
        },
        { isStaff: false },
      ),
      /cuenta para reservar/i,
    );
  });

  it('el personal puede reservar en nombre de alguien sin cuenta igualmente', async () => {
    await saveAuthSettings({ allowAnonymousBooking: false });

    const startsAt = localToInstant(nextMonday(), 11 * 60, fixture.timezone);
    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        startsAt,
        partySize: 1,
        guest: { name: 'Cliente de mostrador' },
      },
      { isStaff: true },
    );

    assert.equal(appointment.customerName, 'Cliente de mostrador');
  });
});
