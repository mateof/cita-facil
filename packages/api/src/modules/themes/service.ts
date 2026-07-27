import type {
  CreateThemeInput,
  Theme,
  ThemeFile,
  ThemeHeader,
  UpdateThemeInput,
} from '@cita-facil/shared';
import {
  THEME_FILE_VERSION,
  THEME_PRESETS,
  THEME_TOKENS,
  defaultThemeTokens,
  sanitizeCustomCss,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';

/**
 * Temas de una organización: crear, editar, activar y llevarlos de un negocio a
 * otro en un fichero.
 *
 * Solo puede haber un tema activo por organización. Activar uno desactiva el
 * resto en la misma transacción, para que no quede ninguno a medias si algo
 * falla entre las dos escrituras.
 */

interface ThemeRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  tokens_json: string | null;
  custom_css: string | null;
  header_json: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function parse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Deja fuera los ajustes que no están en el catálogo.
 *
 * Hace falta al importar un fichero de otra instalación, que puede traer
 * ajustes de una versión más nueva o ya retirados. Se descartan en vez de
 * rechazar el fichero: lo que se reconozca vale, y lo demás no molesta.
 */
function knownTokens(tokens: Record<string, unknown>): Record<string, string> {
  const validos: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const valor = tokens[token.key];
    if (typeof valor === 'string') validos[token.key] = valor;
  }
  return validos;
}

function toTheme(row: ThemeRow): Theme {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    tokens: { ...defaultThemeTokens(), ...parse<Record<string, string>>(row.tokens_json, {}) },
    customCss: row.custom_css,
    header: parse<ThemeHeader | null>(row.header_json, null),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listThemes(organizationId: string): Promise<Theme[]> {
  const rows = await db()
    .selectFrom('themes')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .orderBy('active', 'desc')
    .orderBy('name')
    .execute();
  return rows.map(toTheme);
}

export async function getTheme(organizationId: string, id: string): Promise<Theme> {
  const row = await db()
    .selectFrom('themes')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('El tema no existe', 'theme_not_found');
  return toTheme(row);
}

/** El tema en uso, o `null` si la organización no ha activado ninguno. */
export async function activeTheme(organizationId: string): Promise<Theme | null> {
  const row = await db()
    .selectFrom('themes')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('active', '=', 1)
    .executeTakeFirst();
  return row ? toTheme(row) : null;
}

export async function createTheme(
  organizationId: string,
  input: CreateThemeInput,
  actorId: string | null,
): Promise<Theme> {
  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('themes')
    .values({
      id,
      organization_id: organizationId,
      name: input.name,
      description: input.description ?? null,
      tokens_json: JSON.stringify(knownTokens(input.tokens ?? {})),
      custom_css: input.customCss ? sanitizeCustomCss(input.customCss) : null,
      header_json: input.header ? JSON.stringify(input.header) : null,
      active: 0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'theme.create',
    entityType: 'theme',
    entityId: id,
    changes: { name: input.name },
  });

  return getTheme(organizationId, id);
}

export async function updateTheme(
  organizationId: string,
  id: string,
  input: UpdateThemeInput,
  actorId: string | null,
): Promise<Theme> {
  await getTheme(organizationId, id);

  const changes: Record<string, unknown> = { updated_at: isoNow() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description ?? null;
  if (input.tokens !== undefined) changes.tokens_json = JSON.stringify(knownTokens(input.tokens));
  if (input.customCss !== undefined) {
    changes.custom_css = input.customCss ? sanitizeCustomCss(input.customCss) : null;
  }
  if (input.header !== undefined) {
    changes.header_json = input.header ? JSON.stringify(input.header) : null;
  }

  await db().updateTable('themes').set(changes).where('id', '=', id).execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'theme.update',
    entityType: 'theme',
    entityId: id,
    changes: { name: input.name },
  });

  return getTheme(organizationId, id);
}

export async function deleteTheme(organizationId: string, id: string): Promise<void> {
  await getTheme(organizationId, id);
  await db().deleteFrom('themes').where('id', '=', id).execute();
}

/**
 * Pone un tema en uso y quita el que hubiera.
 *
 * Las dos escrituras van en la misma transacción: si se quedara a medias, la
 * organización acabaría con dos temas activos o con ninguno, y la página
 * pública elegiría al azar.
 */
export async function activateTheme(
  organizationId: string,
  id: string,
  actorId: string | null,
): Promise<Theme> {
  await getTheme(organizationId, id);

  await db()
    .transaction()
    .execute(async (trx) => {
      await trx
        .updateTable('themes')
        .set({ active: 0, updated_at: isoNow() })
        .where('organization_id', '=', organizationId)
        .where('active', '=', 1)
        .execute();

      await trx
        .updateTable('themes')
        .set({ active: 1, updated_at: isoNow() })
        .where('id', '=', id)
        .execute();
    });

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'theme.activate',
    entityType: 'theme',
    entityId: id,
  });

  return getTheme(organizationId, id);
}

/** Deja a la organización sin tema propio: vuelve a verse el aspecto de serie. */
export async function deactivateThemes(organizationId: string): Promise<void> {
  await db()
    .updateTable('themes')
    .set({ active: 0, updated_at: isoNow() })
    .where('organization_id', '=', organizationId)
    .execute();
}

/* -------------------------------------------------------------------------- */
/* Intercambio                                                                 */
/* -------------------------------------------------------------------------- */

export async function exportTheme(organizationId: string, id: string): Promise<ThemeFile> {
  const tema = await getTheme(organizationId, id);
  return {
    format: 'cita-facil-theme',
    version: THEME_FILE_VERSION,
    name: tema.name,
    description: tema.description,
    tokens: knownTokens(tema.tokens),
    customCss: tema.customCss,
    header: tema.header,
  };
}

/** Crea un tema a partir de un fichero exportado, aquí o en otra instalación. */
export async function importTheme(
  organizationId: string,
  file: ThemeFile,
  actorId: string | null,
): Promise<Theme> {
  return createTheme(
    organizationId,
    {
      name: file.name,
      description: file.description ?? null,
      tokens: knownTokens(file.tokens),
      customCss: file.customCss ?? null,
      header: file.header ?? null,
    },
    actorId,
  );
}

/**
 * Copia uno de los temas de ejemplo a la organización.
 *
 * Los ejemplos no se pueden editar: se copian y se retoca la copia, que es lo
 * que permite volver a un punto de partida conocido.
 */
export async function copyPreset(
  organizationId: string,
  presetKey: string,
  actorId: string | null,
): Promise<Theme> {
  const preset = THEME_PRESETS.find((tema) => tema.key === presetKey);
  if (!preset) throw new NotFoundError('Ese tema de ejemplo no existe', 'theme_preset_not_found');

  return createTheme(
    organizationId,
    { name: preset.name, description: null, tokens: preset.tokens, customCss: null, header: null },
    actorId,
  );
}
