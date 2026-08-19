import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId, shortCode } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';
import {
  exportReport,
  previousRange,
  resolveRange,
  staff,
  summary,
  toCsv,
} from '../src/modules/reports/service.ts';

/**
 * Informes: comparativa, reparto por profesional y exportación.
 *
 * La regla del reparto es la que más importa: la comisión sale de lo cobrado,
 * no de lo agendado. Repartir dinero que todavía no ha entrado es firmar un
 * pagaré, y en un negocio pequeño eso se nota a fin de mes.
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
  await db.deleteFrom('appointments').execute();
  await db
    .updateTable('resources')
    .set({ commission_bp: 0 })
    .where('id', '=', fixture.resourceId)
    .execute();
});

/** Una cita en una fecha local concreta, con su estado de pago. */
async function cita(options: {
  date: string;
  priceCents?: number;
  paymentStatus?: string;
  status?: string;
}): Promise<void> {
  const startsAt = `${options.date}T09:00:00.000Z`;
  await db
    .insertInto('appointments')
    .values({
      id: newId(),
      organization_id: fixture.organizationId,
      location_id: fixture.locationId,
      service_id: fixture.serviceId,
      resource_id: fixture.resourceId,
      customer_id: fixture.customerId,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      guest_locale: null,
      starts_at: startsAt,
      ends_at: startsAt,
      block_starts_at: startsAt,
      block_ends_at: startsAt,
      local_date: options.date,
      local_start_minute: 540,
      duration_minutes: 60,
      timezone: fixture.timezone,
      status: options.status ?? 'completed',
      source: 'admin',
      party_size: 1,
      price_cents: options.priceCents ?? 5000,
      currency: 'EUR',
      payment_status: options.paymentStatus ?? 'paid',
      notes: null,
      internal_notes: null,
      custom_fields_json: null,
      access_code: shortCode(8),
      access_uses: 0,
      attendance_confirmed_at: null,
      no_show_fee_cents: 0,
      checked_in_at: null,
      completed_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      recurrence_id: null,
      rescheduled_from: null,
      waitlist_entry_id: null,
      credit_wallet_id: null,
      hold_expires_at: null,
      reminder_scheduled_at: null,
      created_by: null,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .execute();
}

const RANGO = { from: '2026-03-10', to: '2026-03-16' };

async function rango() {
  return resolveRange(fixture.organizationId, RANGO);
}

describe('comparativa con el periodo anterior', () => {
  it('coge el mismo número de días justo antes', async () => {
    const anterior = previousRange(await rango());

    assert.deepEqual({ from: anterior.from, to: anterior.to }, { from: '2026-03-03', to: '2026-03-09' });
  });

  it('cuenta las citas del periodo anterior', async () => {
    await cita({ date: '2026-03-12' });
    await cita({ date: '2026-03-05' });
    await cita({ date: '2026-03-06' });

    const informe = await summary(fixture.organizationId, await rango());

    assert.equal(informe.previous.total, 2);
  });

  it('no mezcla lo anterior con lo actual', async () => {
    await cita({ date: '2026-03-12' });
    await cita({ date: '2026-03-05' });

    const informe = await summary(fixture.organizationId, await rango());

    assert.equal(informe.total, 1);
  });
});

describe('reparto por profesional', () => {
  it('calcula la comisión sobre lo cobrado', async () => {
    await db
      .updateTable('resources')
      .set({ commission_bp: 2000 })
      .where('id', '=', fixture.resourceId)
      .execute();
    await cita({ date: '2026-03-12', priceCents: 5000, paymentStatus: 'paid' });

    const informe = await staff(fixture.organizationId, await rango());

    assert.equal(informe.items[0]?.commissionCents, 1000);
  });

  /** Lo agendado sin cobrar todavía no es dinero de nadie. */
  it('no reparte lo que aún no se ha cobrado', async () => {
    await db
      .updateTable('resources')
      .set({ commission_bp: 2000 })
      .where('id', '=', fixture.resourceId)
      .execute();
    await cita({ date: '2026-03-12', priceCents: 5000, paymentStatus: 'pending' });

    const informe = await staff(fixture.organizationId, await rango());

    assert.equal(informe.items[0]?.commissionCents, 0);
  });

  it('lo pendiente de cobro sí aparece como facturado', async () => {
    await cita({ date: '2026-03-12', priceCents: 5000, paymentStatus: 'pending' });

    const informe = await staff(fixture.organizationId, await rango());

    assert.equal(informe.items[0]?.billedCents, 5000);
  });

  it('una agenda sin comisión no genera comisión', async () => {
    await cita({ date: '2026-03-12', priceCents: 5000, paymentStatus: 'paid' });

    const informe = await staff(fixture.organizationId, await rango());

    assert.equal(informe.items[0]?.commissionCents, 0);
  });
});

describe('exportación a CSV', () => {
  it('separa las columnas con punto y coma', () => {
    const csv = toCsv([{ servicio: 'Corte', citas: 3 }]);

    assert.ok(csv.includes('servicio;citas'));
  });

  /** Con punto decimal, Excel en español parte "1234.50" en dos columnas. */
  it('escribe los decimales con coma', () => {
    const csv = toCsv([{ importe: 12.5 }]);

    assert.ok(csv.includes('12,5'));
  });

  it('entrecomilla lo que lleva el separador dentro', () => {
    const csv = toCsv([{ servicio: 'Corte; barba' }]);

    assert.ok(csv.includes('"Corte; barba"'));
  });

  /** Sin marca de orden de bytes, Excel abre el fichero como ANSI. */
  it('empieza con la marca de orden de bytes', () => {
    assert.ok(toCsv([{ a: 1 }]).startsWith('﻿'));
  });

  it('exporta el reparto por profesional con su comisión', async () => {
    await db
      .updateTable('resources')
      .set({ commission_bp: 1500 })
      .where('id', '=', fixture.resourceId)
      .execute();
    await cita({ date: '2026-03-12', priceCents: 10_000, paymentStatus: 'paid' });

    const csv = await exportReport(fixture.organizationId, 'staff', await rango());

    assert.ok(csv.includes('comision'));
  });
});
