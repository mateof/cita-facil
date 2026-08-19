/**
 * Lector de CSV.
 *
 * Se escribe aquí en lugar de traer una dependencia por la misma razón que el
 * resto del proyecto habla HTTP a mano con las pasarelas: son cuarenta líneas,
 * el formato lleva treinta años sin cambiar y una dependencia más es una
 * actualización más que vigilar.
 *
 * Cubre lo que sale de una hoja de cálculo: comillas dobles, comas o puntos y
 * comas como separador, saltos de línea dentro de un campo entrecomillado y la
 * marca de orden de bytes que pone Excel al principio del fichero.
 */

/** Separador: el que más veces aparezca en la cabecera. */
function detectDelimiter(text: string): string {
  const primeraLinea = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const puntoYComa = (primeraLinea.match(/;/g) ?? []).length;
  const comas = (primeraLinea.match(/,/g) ?? []).length;
  const tabuladores = (primeraLinea.match(/\t/g) ?? []).length;

  if (tabuladores > puntoYComa && tabuladores > comas) return '\t';
  return puntoYComa >= comas ? ';' : ',';
}

export function parseCsvRows(text: string): string[][] {
  const limpio = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(limpio);

  const filas: string[][] = [];
  let campo = '';
  let fila: string[] = [];
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const caracter = limpio[i]!;

    if (entreComillas) {
      if (caracter === '"') {
        // Dos comillas seguidas dentro del campo son una comilla literal.
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === delimiter) {
      fila.push(campo);
      campo = '';
    } else if (caracter === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (caracter !== '\r') {
      campo += caracter;
    }
  }

  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Las líneas vacías del final de un fichero no son filas.
  return filas.filter((linea) => linea.some((valor) => valor.trim().length > 0));
}

/**
 * Normaliza el nombre de una columna: sin acentos, en minúsculas y con guion
 * bajo. Así "Teléfono", "telefono" y "TELEFONO" son la misma columna.
 */
export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvTable {
  const filas = parseCsvRows(text);
  if (filas.length === 0) return { headers: [], rows: [] };

  const headers = filas[0]!.map(normalizeHeader);

  return {
    headers,
    rows: filas.slice(1).map((linea) => {
      const registro: Record<string, string> = {};
      headers.forEach((header, indice) => {
        registro[header] = (linea[indice] ?? '').trim();
      });
      return registro;
    }),
  };
}

/**
 * Busca el valor de una columna admitiendo varios nombres.
 *
 * Un fichero exportado de otra aplicación trae "Correo electrónico", "email" o
 * "e_mail" según de dónde venga, y obligar a renombrar la cabecera a mano es la
 * mejor manera de que nadie importe nada.
 */
export function pick(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const valor = row[normalizeHeader(name)];
    if (valor !== undefined && valor !== '') return valor;
  }
  return '';
}
