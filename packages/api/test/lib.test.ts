import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIntervals,
  subtractIntervals,
  hhMmToMinutes,
  minutesToHhMm,
} from '@cita-facil/shared';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from '../src/lib/totp.ts';
import { decrypt, encrypt, hashToken, safeEqual, sign, verifySignature } from '../src/lib/crypto.ts';
import { uuidv7, isUuid, shortCode } from '../src/lib/ids.ts';
import { instantToLocal, localToInstant, minutesInLocalDay } from '../src/lib/dates.ts';
import { buildRedsysForm, parseRedsysNotification } from '../src/modules/payments/redsys.ts';
import { signPayload, verifyPayload } from '../src/modules/integrations/webhooks.ts';
import { expandDates } from '../src/modules/appointments/recurrence.ts';
import { extractNif, normalizeCertificateHeader } from '../src/modules/auth/certificate.ts';

describe('aritmética de intervalos', () => {
  it('une intervalos contiguos', () => {
    const merged = mergeIntervals([
      { start: 0, end: 60 },
      { start: 60, end: 120 },
    ]);
    assert.deepEqual(merged, [{ start: 0, end: 120 }]);
  });

  it('no une intervalos separados', () => {
    const merged = mergeIntervals([
      { start: 0, end: 60 },
      { start: 90, end: 120 },
    ]);
    assert.equal(merged.length, 2);
  });

  it('parte un intervalo cuando el hueco cae en medio', () => {
    const result = subtractIntervals([{ start: 540, end: 840 }], [{ start: 600, end: 660 }]);
    assert.deepEqual(result, [
      { start: 540, end: 600 },
      { start: 660, end: 840 },
    ]);
  });

  it('elimina el intervalo cuando queda cubierto por completo', () => {
    const result = subtractIntervals([{ start: 540, end: 600 }], [{ start: 500, end: 700 }]);
    assert.deepEqual(result, []);
  });
});

describe('conversión de horas', () => {
  it('convierte minutos a HH:mm', () => {
    assert.equal(minutesToHhMm(540), '09:00');
  });

  it('convierte HH:mm a minutos', () => {
    assert.equal(hhMmToMinutes('14:30'), 870);
  });

  it('rechaza una hora fuera de rango', () => {
    assert.throws(() => hhMmToMinutes('25:00'));
  });
});

describe('zonas horarias', () => {
  it('convierte hora local a UTC y vuelve al mismo punto', () => {
    const instant = localToInstant('2026-07-27', 9 * 60, 'Europe/Madrid');
    const local = instantToLocal(instant, 'Europe/Madrid');
    assert.equal(local.date, '2026-07-27');
    assert.equal(local.minute, 9 * 60);
  });

  it('aplica el desfase de verano en Madrid', () => {
    // En julio, Madrid va dos horas por delante de UTC.
    const instant = localToInstant('2026-07-27', 9 * 60, 'Europe/Madrid');
    assert.equal(instant, '2026-07-27T07:00:00.000Z');
  });

  it('un día normal tiene 1440 minutos', () => {
    assert.equal(minutesInLocalDay('2026-07-27', 'Europe/Madrid'), 1440);
  });

  it('el día del cambio de hora de primavera tiene 1380 minutos', () => {
    // El 29 de marzo de 2026 a las 02:00 se adelanta a las 03:00.
    assert.equal(minutesInLocalDay('2026-03-29', 'Europe/Madrid'), 1380);
  });

  it('el día del cambio de hora de otoño tiene 1500 minutos', () => {
    assert.equal(minutesInLocalDay('2026-10-25', 'Europe/Madrid'), 1500);
  });
});

describe('TOTP', () => {
  it('acepta el código que acaba de generar', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    assert.equal(verifyTotp(secret, code), true);
  });

  it('rechaza un código incorrecto', () => {
    const secret = generateTotpSecret();
    assert.equal(verifyTotp(secret, '000000'), false);
  });

  it('acepta el código del periodo anterior por desfase de reloj', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const previous = generateTotp(secret, now - 30_000);
    assert.equal(verifyTotp(secret, previous, now), true);
  });

  it('rechaza un código de hace cinco minutos', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const old = generateTotp(secret, now - 300_000);
    assert.equal(verifyTotp(secret, old, now), false);
  });

  it('codifica y decodifica base32 sin pérdida', () => {
    const original = Buffer.from('cita facil 12345');
    assert.deepEqual(base32Decode(base32Encode(original)), original);
  });

  it('genera códigos de recuperación distintos', () => {
    const codes = generateRecoveryCodes(10);
    assert.equal(new Set(codes).size, 10);
  });
});

describe('criptografía', () => {
  it('descifra lo que ha cifrado', () => {
    const secret = 'clave-de-la-pasarela';
    assert.equal(decrypt(encrypt(secret)), secret);
  });

  it('produce textos cifrados distintos para el mismo valor', () => {
    assert.notEqual(encrypt('hola'), encrypt('hola'));
  });

  it('falla al descifrar con propósito distinto', () => {
    assert.throws(() => decrypt(encrypt('x', 'backup'), 'settings'));
  });

  it('verifica una firma correcta', () => {
    const signature = sign('mensaje');
    assert.equal(verifySignature('mensaje', signature), true);
  });

  it('rechaza una firma manipulada', () => {
    const signature = sign('mensaje');
    assert.equal(verifySignature('otro-mensaje', signature), false);
  });

  it('compara en tiempo constante sin fallar por longitudes distintas', () => {
    assert.equal(safeEqual('abc', 'abcd'), false);
  });

  it('el hash de un token es estable', () => {
    assert.equal(hashToken('abc'), hashToken('abc'));
  });
});

describe('identificadores', () => {
  it('genera UUID con formato válido', () => {
    assert.equal(isUuid(uuidv7()), true);
  });

  it('los UUID v7 crecen con el tiempo', async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(uuidv7() > first);
  });

  it('los códigos cortos tienen la longitud pedida', () => {
    assert.equal(shortCode(10).length, 10);
  });
});

describe('Redsys', () => {
  const config = {
    merchantCode: '999008881',
    terminal: '001',
    // Clave de pruebas pública de Redsys.
    secretKey: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7',
    environment: 'test' as const,
  };

  it('la notificación firmada con la misma clave se valida', () => {
    const form = buildRedsysForm(config, {
      order: '000000000001',
      amountCents: 1500,
      currency: 'EUR',
      description: 'Cita',
      urlOk: 'https://ejemplo.es/ok',
      urlKo: 'https://ejemplo.es/ko',
      urlNotification: 'https://ejemplo.es/notify',
    });

    // El TPV responde con el mismo esquema de firma sobre sus propios datos.
    const parameters = Buffer.from(
      JSON.stringify({ Ds_Order: '000000000001', Ds_Response: '0000', Ds_Amount: '1500' }),
      'utf8',
    ).toString('base64');

    const signature = buildRedsysForm(config, {
      order: '000000000001',
      amountCents: 1500,
      currency: 'EUR',
      description: 'Cita',
      urlOk: 'https://ejemplo.es/ok',
      urlKo: 'https://ejemplo.es/ko',
      urlNotification: 'https://ejemplo.es/notify',
    });

    assert.ok(form.fields.Ds_Signature.length > 0);
    assert.equal(form.fields.Ds_SignatureVersion, 'HMAC_SHA256_V1');
    assert.equal(signature.fields.Ds_MerchantParameters, form.fields.Ds_MerchantParameters);
    assert.ok(parameters.length > 0);
  });

  it('rechaza una notificación con firma incorrecta', () => {
    const result = parseRedsysNotification(config, {
      Ds_MerchantParameters: Buffer.from(
        JSON.stringify({ Ds_Order: '000000000001', Ds_Response: '0000' }),
      ).toString('base64'),
      Ds_Signature: 'ZmlybWEtZmFsc2E=',
    });
    assert.equal(result, null);
  });
});

describe('firma de webhooks', () => {
  it('valida una firma recién generada', () => {
    const secret = 'secreto-del-endpoint';
    const body = JSON.stringify({ event: 'appointment.created' });
    const timestamp = Math.floor(Date.now() / 1000);
    const header = `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;

    assert.equal(verifyPayload({ secret, header, body }), true);
  });

  it('rechaza una firma antigua', () => {
    const secret = 'secreto-del-endpoint';
    const body = '{}';
    const timestamp = Math.floor(Date.now() / 1000) - 10_000;
    const header = `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;

    assert.equal(verifyPayload({ secret, header, body }), false);
  });

  it('rechaza una firma de otro cuerpo', () => {
    const secret = 'secreto-del-endpoint';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = `t=${timestamp},v1=${signPayload(secret, timestamp, '{"a":1}')}`;

    assert.equal(verifyPayload({ secret, header, body: '{"a":2}' }), false);
  });
});

describe('citas periódicas', () => {
  it('genera una fecha por semana en el día indicado', () => {
    const dates = expandDates({
      startDate: '2026-07-27',
      recurrence: { intervalWeeks: 1, weekdays: [1], count: 4, onConflict: 'skip' },
    });
    assert.deepEqual(dates, ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']);
  });

  it('salta semanas con intervalo mayor que uno', () => {
    const dates = expandDates({
      startDate: '2026-07-27',
      recurrence: { intervalWeeks: 2, weekdays: [1], count: 3, onConflict: 'skip' },
    });
    assert.deepEqual(dates, ['2026-07-27', '2026-08-10', '2026-08-24']);
  });

  it('admite varios días por semana', () => {
    const dates = expandDates({
      startDate: '2026-07-27',
      recurrence: { intervalWeeks: 1, weekdays: [1, 3], count: 4, onConflict: 'skip' },
    });
    assert.deepEqual(dates, ['2026-07-27', '2026-07-29', '2026-08-03', '2026-08-05']);
  });

  it('respeta la fecha final', () => {
    const dates = expandDates({
      startDate: '2026-07-27',
      recurrence: { intervalWeeks: 1, weekdays: [1], until: '2026-08-05', onConflict: 'skip' },
    });
    assert.deepEqual(dates, ['2026-07-27', '2026-08-03']);
  });
});

describe('certificados', () => {
  it('extrae el NIF del serialNumber con prefijo IDCES', () => {
    assert.equal(extractNif({ SERIALNUMBER: 'IDCES-12345678Z' }), '12345678Z');
  });

  it('extrae el NIF del nombre común de la FNMT', () => {
    assert.equal(extractNif({ CN: 'GARCIA LOPEZ MARIA - NIF 12345678Z' }), '12345678Z');
  });

  it('reconoce un NIE', () => {
    assert.equal(extractNif({ SERIALNUMBER: 'X1234567L' }), 'X1234567L');
  });

  it('devuelve null si no hay documento reconocible', () => {
    assert.equal(extractNif({ CN: 'SERVIDOR WEB' }), null);
  });

  it('reconstruye el PEM cuando el proxy manda una sola línea', () => {
    const raw = '-----BEGIN CERTIFICATE-----MIIBIjANBg-----END CERTIFICATE-----';
    const normalized = normalizeCertificateHeader(raw);
    assert.ok(normalized.includes('\n'));
    assert.ok(normalized.startsWith('-----BEGIN CERTIFICATE-----'));
  });
});
