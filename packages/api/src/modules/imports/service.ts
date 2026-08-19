import { fuzzySearch } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { isoNow, localToInstant } from '../../lib/dates.js';
import { newId, shortCode } from '../../lib/ids.js';
import { BadRequestError } from '../../lib/errors.js';
import { createUser, findUserByEmail, findUserByNif } from '../users/repository.js';
import { parseCsv, pick, type CsvTable } from './csv.js';

/**
 * Importación desde CSV.
 *
 * Nadie migra a una aplicación si tiene que teclear mil clientes. Esto lee lo
 * que exporta la hoja de cálculo del negocio o la aplicación anterior y lo mete
 * dentro, diciendo fila a fila qué ha pasado.
 *
 * Dos decisiones que gobiernan todo lo demás:
 *
 * 1. **Siempre se puede ensayar.** La misma llamada con `dryRun` hace todo el
 *    trabajo menos escribir, y devuelve el mismo informe. Importar mal mil
 *    filas se arregla mucho peor que revisarlas antes.
 * 2. **Una fila mala no tumba la importación.** Se salta, se anota por qué y se
 *    sigue. Un fichero real siempre trae tres filas raras, y abortar entero
 *    obligaría a limpiarlo a ciegas.
 */

export interface RowResult {
  /** Número de fila en el fichero, contando la cabecera como la 1. */
  row: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  message?: string;
  name?: string;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  results: RowResult[];
}

function emptyReport(dryRun: boolean): ImportReport {
  return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, dryRun, results: [] };
}

function record(report: ImportReport, result: RowResult): void {
  report.results.push(result);
  report.total += 1;
  if (result.status === 'created') report.created += 1;
  if (result.status === 'updated') report.updated += 1;
  if (result.status === 'skipped') report.skipped += 1;
  if (result.status === 'error') report.errors += 1;
}

/** Tope por tirada. Un fichero mayor se parte, y así ninguna petición se eterniza. */
const MAX_ROWS = 2000;

function table(csv: string): CsvTable {
  const parsed = parseCsv(csv);
  if (parsed.rows.length === 0) {
    throw new BadRequestError('El fichero no tiene filas', 'csv_empty');
  }
  if (parsed.rows.length > MAX_ROWS) {
    throw new BadRequestError(
      `El fichero tiene más de ${MAX_ROWS} filas; pártelo en varios`,
      'csv_too_large',
    );
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Clientes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Importa personas y las deja como clientas de esta organización.
 *
 * Se busca a quién ya existe por correo y por NIF, en ese orden, porque son los
 * dos datos únicos de verdad. Con el teléfono no se identifica a nadie: en una
 * familia se comparte, y unir dos fichas por error es mucho peor que dejar dos
 * separadas.
 *
 * Quien ya existe no se pisa: se completa lo que le falte. Un fichero viejo no
 * puede machacar el teléfono que la persona actualizó ayer en su perfil.
 */
export async function importCustomers(
  organizationId: string,
  csv: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const dryRun = options.dryRun !== false;
  const report = emptyReport(dryRun);
  const { rows } = table(csv);

  for (const [indice, row] of rows.entries()) {
    const numero = indice + 2;
    const nombre = pick(row, 'nombre', 'name', 'cliente', 'nombre_completo', 'full_name');
    const correo = pick(row, 'correo', 'email', 'correo_electronico', 'e_mail').toLowerCase();
    const telefono = pick(row, 'telefono', 'phone', 'movil', 'mobile');
    const nif = pick(row, 'nif', 'dni', 'documento', 'id_number').toUpperCase();
    const notas = pick(row, 'notas', 'notes', 'observaciones');
    const etiquetas = pick(row, 'etiquetas', 'tags')
      .split(/[,;|]/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!nombre && !correo) {
      record(report, { row: numero, status: 'error', message: 'Sin nombre ni correo' });
      continue;
    }

    const existente =
      (correo ? await findUserByEmail(correo) : undefined) ??
      (nif ? await findUserByNif(nif) : undefined);

    if (dryRun) {
      record(report, {
        row: numero,
        status: existente ? 'updated' : 'created',
        name: nombre || correo,
      });
      continue;
    }

    try {
      const userId = existente
        ? existente.id
        : (
            await createUser({
              name: nombre || correo,
              email: correo || null,
              phone: telefono || null,
              nif: nif || null,
            })
          ).id;

      if (existente) {
        // Solo se rellena lo que falta: lo que la persona tenga puesto manda.
        const parche: Record<string, string> = {};
        if (!existente.phone && telefono) parche.phone = telefono;
        if (!existente.nif && nif) parche.nif = nif;
        if (Object.keys(parche).length > 0) {
          await db()
            .updateTable('users')
            .set({ ...parche, updated_at: isoNow() })
            .where('id', '=', userId)
            .execute();
        }
      }

      await upsertProfile(organizationId, userId, notas, etiquetas);

      record(report, {
        row: numero,
        status: existente ? 'updated' : 'created',
        name: nombre || correo,
      });
    } catch (error) {
      record(report, {
        row: numero,
        status: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  return report;
}

/**
 * La ficha de la organización.
 *
 * Crearla es lo que convierte a una persona en clienta de este negocio aunque
 * todavía no haya reservado nada: sin ella, quien se importa no aparecería en
 * ninguna lista hasta su primera cita.
 */
async function upsertProfile(
  organizationId: string,
  userId: string,
  notas: string,
  etiquetas: string[],
): Promise<void> {
  const existente = await db()
    .selectFrom('customer_profiles')
    .select(['id', 'notes', 'tags_json'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const now = isoNow();

  if (!existente) {
    await db()
      .insertInto('customer_profiles')
      .values({
        id: newId(),
        organization_id: organizationId,
        user_id: userId,
        notes: notas || null,
        tags_json: etiquetas.length > 0 ? JSON.stringify(etiquetas) : null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return;
  }

  const previas = existente.tags_json ? (JSON.parse(existente.tags_json) as string[]) : [];
  const unidas = [...new Set([...previas, ...etiquetas])];

  await db()
    .updateTable('customer_profiles')
    .set({
      // Las notas del fichero se añaden debajo de las que ya había: sustituir
      // borraría lo que escribió el mostrador.
      notes: notas && existente.notes ? `${existente.notes}\n${notas}` : notas || existente.notes,
      tags_json: unidas.length > 0 ? JSON.stringify(unidas) : null,
      updated_at: now,
    })
    .where('id', '=', existente.id)
    .execute();
}

/* -------------------------------------------------------------------------- */
/* Citas                                                                       */
/* -------------------------------------------------------------------------- */

const HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Importa citas, normalmente el histórico de la aplicación anterior.
 *
 * El servicio y el profesional se buscan por nombre con la misma comparación
 * aproximada que usa el resto de la aplicación: un fichero exportado trae
 * "Corte de pelo " con espacio o "corte pelo", y exigir el nombre exacto haría
 * que no entrara casi nada.
 *
 * **Las citas futuras sí comprueban solape**; las pasadas no. Importar
 * histórico es contar lo que ya ocurrió, aunque dos cosas se pisaran; meter una
 * cita futura encima de otra es prometer dos veces la misma hora.
 */
export async function importAppointments(
  organizationId: string,
  csv: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const dryRun = options.dryRun !== false;
  const report = emptyReport(dryRun);
  const { rows } = table(csv);

  const [servicios, recursos, sedes] = await Promise.all([
    db()
      .selectFrom('services')
      .select(['id', 'name', 'duration_minutes', 'price_cents', 'currency', 'location_id'])
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .execute(),
    db()
      .selectFrom('resources')
      .select(['id', 'name', 'location_id'])
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .execute(),
    db()
      .selectFrom('locations')
      .select(['id', 'name', 'timezone'])
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .execute(),
  ]);

  if (sedes.length === 0) {
    throw new BadRequestError('La organización no tiene sedes', 'location_not_found');
  }

  for (const [indice, row] of rows.entries()) {
    const numero = indice + 2;

    try {
      const fecha = pick(row, 'fecha', 'date', 'dia');
      const hora = pick(row, 'hora', 'time', 'hora_inicio', 'start');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        throw new Error('La fecha tiene que ser AAAA-MM-DD');
      }
      if (!HORA.test(hora)) throw new Error('La hora tiene que ser HH:MM');

      const nombreServicio = pick(row, 'servicio', 'service', 'tratamiento');
      const servicio =
        fuzzySearch(servicios, nombreServicio, { fields: (item) => [item.name] })[0] ??
        (servicios.length === 1 ? servicios[0] : undefined);
      if (!servicio) throw new Error(`No hay ningún servicio parecido a "${nombreServicio}"`);

      const nombreRecurso = pick(row, 'profesional', 'recurso', 'resource', 'staff');
      const recurso = nombreRecurso
        ? fuzzySearch(recursos, nombreRecurso, { fields: (item) => [item.name] })[0]
        : undefined;

      const sede = sedes.find((item) => item.id === (servicio.location_id ?? sedes[0]!.id)) ?? sedes[0]!;

      const correo = pick(row, 'correo', 'email', 'correo_cliente').toLowerCase();
      const nombreCliente = pick(row, 'cliente', 'nombre', 'customer', 'name');
      const cliente = correo ? await findUserByEmail(correo) : undefined;
      if (!cliente && !nombreCliente) throw new Error('Sin cliente: falta el correo o el nombre');

      const duracion = Number(pick(row, 'duracion', 'duration', 'minutos')) || servicio.duration_minutes;
      const [horas, minutos] = hora.split(':').map(Number);
      const minutoLocal = horas! * 60 + minutos!;
      const startsAt = localToInstant(fecha, minutoLocal, sede.timezone);
      const endsAt = new Date(Date.parse(startsAt) + duracion * 60_000).toISOString();

      const futura = Date.parse(startsAt) > Date.now();
      if (futura && recurso) {
        const solapa = await db()
          .selectFrom('appointments')
          .select(['id'])
          .where('organization_id', '=', organizationId)
          .where('resource_id', '=', recurso.id)
          .where('status', 'in', ['pending', 'confirmed', 'checked_in', 'in_progress'])
          .where('starts_at', '<', endsAt)
          .where('ends_at', '>', startsAt)
          .executeTakeFirst();
        if (solapa) throw new Error('Se solapa con una cita que ya existe');
      }

      const estado =
        pick(row, 'estado', 'status') ||
        (futura ? 'confirmed' : 'completed');

      if (dryRun) {
        record(report, { row: numero, status: 'created', name: `${fecha} ${hora}` });
        continue;
      }

      const clienteId =
        cliente?.id ??
        (correo
          ? (await createUser({ name: nombreCliente || correo, email: correo })).id
          : null);

      if (clienteId) await upsertProfile(organizationId, clienteId, '', []);

      const now = isoNow();
      await db()
        .insertInto('appointments')
        .values({
          id: newId(),
          organization_id: organizationId,
          location_id: sede.id,
          service_id: servicio.id,
          resource_id: recurso?.id ?? null,
          customer_id: clienteId,
          guest_name: clienteId ? null : nombreCliente,
          guest_email: null,
          guest_phone: null,
          guest_locale: null,
          starts_at: startsAt,
          ends_at: endsAt,
          block_starts_at: startsAt,
          block_ends_at: endsAt,
          local_date: fecha,
          local_start_minute: minutoLocal,
          duration_minutes: duracion,
          timezone: sede.timezone,
          status: estado,
          source: 'api',
          party_size: 1,
          price_cents: Number(pick(row, 'precio', 'price', 'importe').replace(',', '.')) * 100 || servicio.price_cents,
          currency: servicio.currency,
          payment_status: pick(row, 'pagado', 'paid') ? 'paid' : 'not_required',
          notes: pick(row, 'notas', 'notes') || null,
          internal_notes: null,
          custom_fields_json: null,
          access_code: shortCode(10),
          access_uses: 0,
          attendance_confirmed_at: null,
          no_show_fee_cents: 0,
          checked_in_at: null,
          completed_at: estado === 'completed' ? startsAt : null,
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
          created_at: now,
          updated_at: now,
        })
        .execute();

      record(report, { row: numero, status: 'created', name: `${fecha} ${hora}` });
    } catch (error) {
      record(report, {
        row: numero,
        status: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  return report;
}
