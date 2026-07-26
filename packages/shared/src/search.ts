/**
 * Búsqueda aproximada para los campos que enlazan entidades.
 *
 * Se usa en los dos lados: el backend la aplica sobre los candidatos que saca
 * de la base de datos (personas de una organización) y el frontend sobre las
 * listas que ya tiene en memoria (servicios, recursos, sedes, tipos de bono).
 * Tener una sola implementación evita que un mismo texto ordene distinto según
 * quién filtre.
 *
 * Por qué en JavaScript y no en SQL: la aplicación soporta cinco motores de
 * base de datos y ninguno comparte la misma extensión de similitud
 * (`pg_trgm`, `SOUNDEX`, FTS5...). `LIKE` sirve para acotar, pero no encuentra
 * "Nuria" escribiendo "nuira" ni "Peña" escribiendo "pena".
 */

/**
 * Minúsculas, sin acentos y con los espacios colapsados.
 *
 * La búsqueda tiene que dar igual con "Peña", "peña" o "pena": quien atiende el
 * mostrador escribe deprisa y rara vez pone tildes.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distancia de edición contando la transposición de dos letras contiguas como
 * una sola operación (Damerau-Levenshtein restringida).
 *
 * La transposición es la errata de tecleo más frecuente: "nuira" por "Nuria",
 * "amrta" por "Marta". Con Levenshtein a secas cuenta como dos cambios y se
 * queda fuera del umbral, que es justo lo contrario de lo que hace falta.
 *
 * Las cadenas que se comparan son nombres y correos, así que son cortas y no
 * compensa nada más elaborado.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Tres filas: la transposición necesita mirar dos atrás.
  let anterior2 = new Array<number>(b.length + 1);
  let anterior = Array.from({ length: b.length + 1 }, (_, index) => index);
  let actual = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const sustituir = anterior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      let mejor = Math.min(actual[j - 1]! + 1, anterior[j]! + 1, sustituir);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        mejor = Math.min(mejor, anterior2[j - 2]! + 1);
      }
      actual[j] = mejor;
    }
    [anterior2, anterior, actual] = [anterior, actual, anterior2];
  }

  return anterior[b.length]!;
}

/** Cuántas erratas se toleran en una palabra de esta longitud. */
function toleratedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/**
 * Puntúa de 0 (nada que ver) a 1 (coincidencia exacta) lo bien que `text`
 * responde a `query`.
 *
 * El orden de las reglas es el orden en que la gente espera ver los
 * resultados: primero lo que empieza igual, luego lo que lo contiene y por
 * último lo que se le parece con alguna errata.
 */
export function matchScore(query: string, text: string): number {
  const objetivo = normalizeForSearch(text);
  const buscado = normalizeForSearch(query);
  if (!buscado) return 0;
  if (!objetivo) return 0;

  if (objetivo === buscado) return 1;
  if (objetivo.startsWith(buscado)) return 0.95;

  const palabras = objetivo.split(/[\s@._-]+/).filter(Boolean);
  if (palabras.some((palabra) => palabra.startsWith(buscado))) return 0.9;
  if (objetivo.includes(buscado)) return 0.8;

  // Cada término por separado: "rios marta" encuentra a "Marta Ríos".
  const terminos = buscado.split(' ').filter(Boolean);
  if (terminos.length > 1 && terminos.every((termino) => objetivo.includes(termino))) {
    return 0.75;
  }

  // Erratas: se compara contra cada palabra y contra el texto entero, porque
  // "gimnaso" tiene que encontrar "Gimnasio Central" y "gimnasio centrl"
  // también.
  const candidatos = [objetivo, ...palabras];
  let mejor = 0;
  for (const candidato of candidatos) {
    const distancia = editDistance(buscado, candidato);
    const tolerancia = toleratedTypos(Math.min(buscado.length, candidato.length));
    if (distancia === 0 || distancia > tolerancia) continue;
    mejor = Math.max(mejor, 0.7 - (distancia - 1) * 0.1);
  }

  return mejor;
}

/** Puntuación de un elemento con varios textos buscables: la mejor de todos. */
export function bestScore(query: string, texts: (string | null | undefined)[]): number {
  let mejor = 0;
  for (const texto of texts) {
    if (!texto) continue;
    mejor = Math.max(mejor, matchScore(query, texto));
    if (mejor === 1) break;
  }
  return mejor;
}

/** Por debajo de esto se considera que no tiene nada que ver. */
export const MATCH_THRESHOLD = 0.5;

export interface FuzzySearchOptions<T> {
  /** Textos por los que se busca cada elemento (nombre, correo, teléfono...). */
  fields: (item: T) => (string | null | undefined)[];
  limit?: number;
  threshold?: number;
}

/**
 * Filtra y ordena por parecido. Con la consulta vacía devuelve la lista tal
 * cual, que es lo que hace falta para abrir un desplegable y ver las opciones.
 */
export function fuzzySearch<T>(items: T[], query: string, options: FuzzySearchOptions<T>): T[] {
  const limite = options.limit ?? 20;
  if (!query.trim()) return items.slice(0, limite);

  const umbral = options.threshold ?? MATCH_THRESHOLD;
  return items
    .map((item) => ({ item, score: bestScore(query, options.fields(item)) }))
    .filter((entrada) => entrada.score >= umbral)
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)
    .map((entrada) => entrada.item);
}
