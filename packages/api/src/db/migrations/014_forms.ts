import type { Kysely } from 'kysely';
import {
  boolDefault,
  createTable,
  index,
  intDefault,
  notNull,
  pk,
  strDefault,
  t,
  timestamps,
  type,
} from './helpers.js';

/**
 * Formularios y consentimientos previos a la cita.
 *
 * Dos cosas con la misma forma y distinta intención:
 *
 * - Un **formulario** pregunta lo que el negocio necesita saber antes de
 *   atender (alergias, medicación, talla, matrícula del coche).
 * - Un **consentimiento** enseña un texto y pide una aceptación explícita, con
 *   su fecha y su firma escrita. Es requisito de entrada en el sector clínico y
 *   estético.
 *
 * Los formularios son de la organización y se enganchan a los servicios que los
 * piden, no al revés: la misma hoja de alergias vale para cinco tratamientos y
 * mantenerla en cinco sitios acabaría con cinco versiones distintas.
 *
 * Las respuestas se guardan aparte de la cita, en su propia tabla, porque una
 * respuesta puede sobrevivir a la cita que la originó: el consentimiento que
 * alguien firmó sigue siendo válido aunque esa cita se cancele.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await timestamps(
    pk(createTable(db, 'forms'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('description', type(t.str(500)))
      /** `form` pregunta cosas; `consent` enseña un texto y pide aceptarlo. */
      .addColumn('kind', type(t.str(12)), strDefault('form'))
      /** Definición de los campos: `[{ key, label, type, required, options }]`. */
      .addColumn('fields_json', type(t.json()))
      /** Texto del consentimiento, en el formato enriquecido del editor. */
      .addColumn('consent_text', type(t.text()))
      /** Pide escribir el nombre completo como firma. */
      .addColumn('requires_signature', type(t.bool()), boolDefault(false))
      .addColumn('active', type(t.bool()), boolDefault(true)),
  )
    .addForeignKeyConstraint('fk_forms_org', ['organization_id'], 'organizations', ['id'])
    .execute();

  await index(db, 'forms', ['organization_id', 'active']);

  /** Qué formularios pide cada servicio. */
  await createTable(db, 'service_forms')
    .addColumn('service_id', type(t.id()), notNull)
    .addColumn('form_id', type(t.id()), notNull)
    /** Sin él no se puede reservar por la web. */
    .addColumn('required', type(t.bool()), boolDefault(true))
    /**
     * Se pide una sola vez por persona y no en cada cita. Es lo normal en un
     * consentimiento: se firma la primera vez y vale para las siguientes.
     */
    .addColumn('once_per_customer', type(t.bool()), boolDefault(false))
    .addColumn('sort_order', type(t.int()), intDefault(0))
    .addPrimaryKeyConstraint('pk_service_forms', ['service_id', 'form_id'])
    .addForeignKeyConstraint('fk_service_forms_form', ['form_id'], 'forms', ['id'])
    .execute();

  await pk(createTable(db, 'form_responses'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('form_id', type(t.id()), notNull)
    /** La cita que la pidió. Se conserva la respuesta aunque la cita se borre. */
    .addColumn('appointment_id', type(t.id()))
    .addColumn('customer_id', type(t.id()))
    /** Nombre de quien responde cuando reserva sin cuenta. */
    .addColumn('guest_name', type(t.str(120)))
    .addColumn('answers_json', type(t.json()))
    /** Consentimientos: cuándo se aceptó y con qué nombre se firmó. */
    .addColumn('accepted_at', type(t.instant()))
    .addColumn('signature_name', type(t.str(140)))
    /** Dirección desde la que se firmó, que es parte de la prueba. */
    .addColumn('ip', type(t.str(64)))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_form_responses_form', ['form_id'], 'forms', ['id'])
    .execute();

  await index(db, 'form_responses', ['organization_id', 'customer_id']);
  await index(db, 'form_responses', ['appointment_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('form_responses').execute();
  await db.schema.dropTable('service_forms').execute();
  await db.schema.dropTable('forms').execute();
}
