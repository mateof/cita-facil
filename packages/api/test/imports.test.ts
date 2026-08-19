import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { parseCsv } from '../src/modules/imports/csv.ts';
import { importAppointments, importCustomers } from '../src/modules/imports/service.ts';
import { listCustomers } from '../src/modules/customers/service.ts';

/**
 * Importación desde CSV.
 *
 * Lo que se comprueba: que el ensayo no escribe, que una fila mala no tumba las
 * demás y que a quien ya existe no se le pisan los datos.
 */

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
  await db.deleteFrom('customer_profiles').execute();
  await db.deleteFrom('appointments').execute();
});

const FILTROS = { sort: 'name' as const, page: 1, pageSize: 50 };

describe('lectura del fichero', () => {
  it('reconoce el punto y coma como separador', () => {
    const tabla = parseCsv('nombre;correo\nAna;ana@ejemplo.es');

    assert.equal(tabla.rows[0]?.correo, 'ana@ejemplo.es');
  });

  it('reconoce la coma como separador', () => {
    const tabla = parseCsv('nombre,correo\nAna,ana@ejemplo.es');

    assert.equal(tabla.rows[0]?.correo, 'ana@ejemplo.es');
  });

  it('respeta el separador dentro de un campo entrecomillado', () => {
    const tabla = parseCsv('nombre;notas\nAna;"Corte, barba y cejas"');

    assert.equal(tabla.rows[0]?.notas, 'Corte, barba y cejas');
  });

  it('quita la marca de orden de bytes que pone Excel', () => {
    const tabla = parseCsv('﻿nombre;correo\nAna;ana@ejemplo.es');

    assert.equal(tabla.headers[0], 'nombre');
  });

  it('normaliza los acentos de la cabecera', () => {
    const tabla = parseCsv('Teléfono\n600123123');

    assert.equal(tabla.rows[0]?.telefono, '600123123');
  });
});

describe('clientes', () => {
  const CSV = 'nombre;correo;telefono\nAna Ríos Nuevo;ana-nueva@ejemplo.es;600111222';

  /** El ensayo tiene que poder repetirse sin dejar rastro. */
  it('el ensayo no escribe nada', async () => {
    await importCustomers(fixture.organizationId, CSV, { dryRun: true });

    assert.equal((await listCustomers(fixture.organizationId, FILTROS)).total, 0);
  });

  it('el ensayo informa de lo que haría', async () => {
    const informe = await importCustomers(fixture.organizationId, CSV, { dryRun: true });

    assert.equal(informe.created, 1);
  });

  it('la importación de verdad crea al cliente', async () => {
    await importCustomers(fixture.organizationId, CSV, { dryRun: false });

    assert.equal((await listCustomers(fixture.organizationId, FILTROS)).total, 1);
  });

  it('reconoce por el correo a quien ya existe', async () => {
    await importCustomers(fixture.organizationId, CSV, { dryRun: false });
    const informe = await importCustomers(fixture.organizationId, CSV, { dryRun: false });

    assert.equal(informe.updated, 1);
  });

  it('no duplica a quien ya existe', async () => {
    await importCustomers(fixture.organizationId, CSV, { dryRun: false });
    await importCustomers(fixture.organizationId, CSV, { dryRun: false });

    assert.equal((await listCustomers(fixture.organizationId, FILTROS)).total, 1);
  });

  /** Un fichero viejo no puede machacar lo que la persona actualizó ayer. */
  it('no pisa el teléfono que ya tenía la persona', async () => {
    await importCustomers(
      fixture.organizationId,
      'nombre;correo;telefono\nAna;ana-tel@ejemplo.es;600111222',
      { dryRun: false },
    );
    await importCustomers(
      fixture.organizationId,
      'nombre;correo;telefono\nAna;ana-tel@ejemplo.es;999999999',
      { dryRun: false },
    );

    const usuario = await db
      .selectFrom('users')
      .select(['phone'])
      .where('email_key', '=', 'ana-tel@ejemplo.es')
      .executeTakeFirst();

    assert.equal(usuario?.phone, '600111222');
  });

  it('una fila sin nombre ni correo se anota como error', async () => {
    const informe = await importCustomers(
      fixture.organizationId,
      'nombre;correo;telefono\n;;600111222',
      { dryRun: false },
    );

    assert.equal(informe.errors, 1);
  });

  /** Un fichero real siempre trae tres filas raras; abortar entero no sirve. */
  it('una fila mala no impide importar las buenas', async () => {
    const informe = await importCustomers(
      fixture.organizationId,
      'nombre;correo\n;;\nBea;bea@ejemplo.es',
      { dryRun: false },
    );

    assert.equal(informe.created, 1);
  });

  it('guarda las etiquetas del fichero', async () => {
    await importCustomers(
      fixture.organizationId,
      'nombre;correo;etiquetas\nCarmen;carmen@ejemplo.es;vip,fiel',
      { dryRun: false },
    );

    const lista = await listCustomers(fixture.organizationId, FILTROS);
    assert.deepEqual(lista.items[0]?.tags, ['vip', 'fiel']);
  });
});

describe('citas', () => {
  const cabecera = 'fecha;hora;servicio;cliente;correo';

  it('importa una cita pasada', async () => {
    const informe = await importAppointments(
      fixture.organizationId,
      `${cabecera}\n2026-03-10;10:00;Consulta;Ana;ana-cita@ejemplo.es`,
      { dryRun: false },
    );

    assert.equal(informe.created, 1);
  });

  it('encuentra el servicio aunque el nombre no sea exacto', async () => {
    const informe = await importAppointments(
      fixture.organizationId,
      `${cabecera}\n2026-03-11;10:00;consulta ;Ana;ana-cita2@ejemplo.es`,
      { dryRun: false },
    );

    assert.equal(informe.created, 1);
  });

  it('rechaza una fecha con otro formato', async () => {
    const informe = await importAppointments(
      fixture.organizationId,
      `${cabecera}\n10/03/2026;10:00;Consulta;Ana;ana@ejemplo.es`,
      { dryRun: false },
    );

    assert.equal(informe.errors, 1);
  });

  it('rechaza una hora que no es una hora', async () => {
    const informe = await importAppointments(
      fixture.organizationId,
      `${cabecera}\n2026-03-12;a las diez;Consulta;Ana;ana@ejemplo.es`,
      { dryRun: false },
    );

    assert.equal(informe.errors, 1);
  });

  it('el ensayo no crea ninguna cita', async () => {
    await importAppointments(
      fixture.organizationId,
      `${cabecera}\n2026-03-13;10:00;Consulta;Ana;ana@ejemplo.es`,
      { dryRun: true },
    );

    const citas = await db.selectFrom('appointments').select(['id']).execute();
    assert.equal(citas.length, 0);
  });
});
