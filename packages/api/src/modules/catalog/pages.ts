import {
  PAGE_KEYS,
  pickI18n,
  type I18nText,
  type OrganizationPage,
  type PageKey,
  type PublicPage,
  type UpdateOrganizationPageInput,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Páginas de contenido de la organización.
 *
 * Siempre existen las mismas claves (`contact`, `about`): la fila se crea al
 * guardarla por primera vez, y hasta entonces el panel enseña una página vacía
 * sin publicar. Así el editor no necesita un "crear página" que no aporta
 * nada, porque no las elige el usuario.
 */

function parseI18n(json: string | null): I18nText | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as I18nText;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

interface PageRow {
  id: string;
  key: string;
  format: string;
  title_i18n_json: string | null;
  body_i18n_json: string | null;
  published: number;
  sort_order: number;
  updated_at: string;
}

function toPage(row: PageRow): OrganizationPage {
  return {
    id: row.id,
    key: row.key as PageKey,
    format: row.format === 'html' ? 'html' : 'markdown',
    title: parseI18n(row.title_i18n_json),
    body: parseI18n(row.body_i18n_json),
    published: row.published === 1,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

/** Página vacía, para las claves que todavía no se han escrito. */
function emptyPage(key: PageKey, sortOrder: number): OrganizationPage {
  return {
    id: null,
    key,
    format: 'markdown',
    title: null,
    body: null,
    published: false,
    sortOrder,
    updatedAt: null,
  };
}

export async function listPages(organizationId: string): Promise<OrganizationPage[]> {
  const rows = await db()
    .selectFrom('organization_pages')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .execute();

  const stored = new Map(rows.map((row) => [row.key, toPage(row)]));
  return PAGE_KEYS.map((key, index) => stored.get(key) ?? emptyPage(key, index));
}

export async function savePage(
  organizationId: string,
  key: PageKey,
  input: UpdateOrganizationPageInput,
  actorId: string | null,
): Promise<OrganizationPage> {
  const existing = await db()
    .selectFrom('organization_pages')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('key', '=', key)
    .executeTakeFirst();

  const now = isoNow();

  if (!existing) {
    const id = newId();
    await db()
      .insertInto('organization_pages')
      .values({
        id,
        organization_id: organizationId,
        key,
        format: input.format ?? 'markdown',
        title_i18n_json: input.title ? JSON.stringify(input.title) : null,
        body_i18n_json: input.body ? JSON.stringify(input.body) : null,
        published: input.published ? 1 : 0,
        sort_order: input.sortOrder ?? PAGE_KEYS.indexOf(key),
        updated_by: actorId,
        created_at: now,
        updated_at: now,
      })
      .execute();
  } else {
    const changes: Record<string, unknown> = { updated_at: now, updated_by: actorId };
    if (input.format !== undefined) changes.format = input.format;
    if (input.title !== undefined) {
      changes.title_i18n_json = input.title ? JSON.stringify(input.title) : null;
    }
    if (input.body !== undefined) {
      changes.body_i18n_json = input.body ? JSON.stringify(input.body) : null;
    }
    if (input.published !== undefined) changes.published = input.published ? 1 : 0;
    if (input.sortOrder !== undefined) changes.sort_order = input.sortOrder;

    await db()
      .updateTable('organization_pages')
      .set(changes)
      .where('id', '=', existing.id)
      .execute();
  }

  const page = (await listPages(organizationId)).find((item) => item.key === key);
  if (!page) throw new NotFoundError('La página no existe', 'page_not_found');
  return page;
}

/**
 * Páginas publicadas y con contenido.
 *
 * El texto se resuelve al idioma pedido con la degradación de siempre: si no
 * está traducida, se devuelve el idioma que haya, igual que con los nombres de
 * los servicios. Solo se descarta la página que está vacía en todos los
 * idiomas, para no enlazar a una pantalla en blanco.
 */
export async function publishedPages(
  organizationId: string,
  locale: string,
): Promise<PublicPage[]> {
  const rows = await db()
    .selectFrom('organization_pages')
    .selectAll()
    .where('organization_id', '=', organizationId)
    .where('published', '=', 1)
    .orderBy('sort_order')
    .execute();

  return rows
    .map((row) => {
      const page = toPage(row);
      return {
        key: page.key,
        format: page.format,
        title: pickI18n(page.title, locale, ''),
        body: pickI18n(page.body, locale, ''),
      };
    })
    .filter((page) => page.body.trim().length > 0);
}

export async function publishedPage(
  organizationId: string,
  key: PageKey,
  locale: string,
): Promise<PublicPage> {
  const page = (await publishedPages(organizationId, locale)).find((item) => item.key === key);
  if (!page) throw new NotFoundError('La página no existe', 'page_not_found');
  return page;
}
