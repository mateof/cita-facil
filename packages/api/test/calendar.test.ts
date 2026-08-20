import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { parseIcalBusy } from '../src/modules/integrations/ical.ts';
import {
  assertSafeCalendarUrl,
  calendarFeedUrl,
  feedForToken,
  rotateCalendarToken,
} from '../src/modules/integrations/calendar.ts';

/**
 * Calendario del profesional.
 *
 * Lo importante aquí es el lector de iCalendar (lo que entra de fuera y hay que
 * interpretar bien) y la comprobación de la dirección, que es lo que impide
 * convertir el servidor en una ventana a su propia red.
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
  await db.deleteFrom('time_off').execute();
});

const VENTANA = { from: '2026-03-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' };

function calendario(cuerpo: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', cuerpo, 'END:VCALENDAR'].join('\r\n');
}

describe('lectura de iCalendar', () => {
  it('lee un evento con horas en UTC', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:uno@ejemplo',
          'SUMMARY:Dentista',
          'DTSTART:20260310T090000Z',
          'DTEND:20260310T100000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos[0]?.startsAt, '2026-03-10T09:00:00.000Z');
  });

  it('entiende una zona horaria en el propio campo', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:dos@ejemplo',
          'DTSTART;TZID=Europe/Madrid:20260310T090000',
          'DTEND;TZID=Europe/Madrid:20260310T100000',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    // Marzo, antes del cambio de hora: Madrid va una hora por delante de UTC.
    assert.equal(eventos[0]?.startsAt, '2026-03-10T08:00:00.000Z');
  });

  /** "Disponible" en el calendario personal no puede bloquear la agenda. */
  it('descarta lo marcado como que no ocupa', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:tres@ejemplo',
          'DTSTART:20260310T090000Z',
          'DTEND:20260310T100000Z',
          'TRANSP:TRANSPARENT',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos.length, 0);
  });

  it('descarta los eventos cancelados', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:cuatro@ejemplo',
          'DTSTART:20260310T090000Z',
          'DTEND:20260310T100000Z',
          'STATUS:CANCELLED',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos.length, 0);
  });

  it('expande una repetición semanal', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:cinco@ejemplo',
          'SUMMARY:Reunión',
          'DTSTART:20260302T090000Z',
          'DTEND:20260302T100000Z',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos.length, 4);
  });

  it('respeta el fin de una repetición', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:seis@ejemplo',
          'DTSTART:20260302T090000Z',
          'DTEND:20260302T100000Z',
          'RRULE:FREQ=WEEKLY;UNTIL=20260316T000000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos.length, 2);
  });

  it('deja fuera lo que cae después de la ventana', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:siete@ejemplo',
          'DTSTART:20270310T090000Z',
          'DTEND:20270310T100000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.equal(eventos.length, 0);
  });

  it('recompone las líneas partidas', () => {
    const eventos = parseIcalBusy(
      calendario(
        [
          'BEGIN:VEVENT',
          'UID:ocho@ejemplo',
          'SUMMARY:Una reunión con un nombre muy largo que el',
          '  calendario ha partido en dos',
          'DTSTART:20260310T090000Z',
          'DTEND:20260310T100000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      VENTANA,
    );

    assert.match(eventos[0]?.summary ?? '', /partido en dos/);
  });
});

describe('dirección del calendario externo', () => {
  /** El servidor va a pedir esa dirección: es una ventana a su propia red. */
  it('rechaza una dirección de la red interna', () => {
    assert.throws(() => assertSafeCalendarUrl('http://localhost:6379/'), /red interna/);
  });

  it('rechaza el rango de los metadatos de la nube', () => {
    assert.throws(() => assertSafeCalendarUrl('http://169.254.169.254/latest/'), /red interna/);
  });

  it('rechaza lo que no es http', () => {
    assert.throws(() => assertSafeCalendarUrl('file:///etc/passwd'), /http/);
  });

  it('admite una dirección normal', () => {
    assert.equal(assertSafeCalendarUrl('https://calendar.google.com/x.ics').protocol, 'https:');
  });

  /** `webcal://` es lo que copia y pega la gente desde su calendario. */
  it('entiende webcal como https', () => {
    assert.equal(assertSafeCalendarUrl('webcal://calendar.ejemplo.es/x.ics').protocol, 'https:');
  });
});

describe('agenda publicada', () => {
  it('la dirección lleva el identificador secreto', async () => {
    const token = await rotateCalendarToken(fixture.organizationId, fixture.resourceId);

    assert.ok(calendarFeedUrl(token).includes(token));
  });

  it('rotar el identificador invalida el anterior', async () => {
    const primero = await rotateCalendarToken(fixture.organizationId, fixture.resourceId);
    await rotateCalendarToken(fixture.organizationId, fixture.resourceId);

    await assert.rejects(feedForToken(primero), /ninguna agenda/);
  });

  it('una agenda sin citas devuelve un calendario vacío pero válido', async () => {
    const token = await rotateCalendarToken(fixture.organizationId, fixture.resourceId);

    assert.match(await feedForToken(token), /BEGIN:VCALENDAR/);
  });
});
