/**
 * Lector mínimo de DER (ASN.1), suficiente para recorrer una CRL X.509 y
 * extraer los números de serie revocados.
 *
 * No se usa una librería completa de ASN.1 porque lo que hace falta es una
 * fracción diminuta del estándar, y en el camino de validación de un
 * certificado electrónico conviene tener el menor código de terceros posible.
 */

export interface DerNode {
  tag: number;
  /** `true` para SEQUENCE, SET y los constructed context-specific. */
  constructed: boolean;
  /** Contenido, sin cabecera. */
  value: Buffer;
  /** Nodo completo, con cabecera. Útil para volver a firmar o comparar. */
  raw: Buffer;
}

export const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_ID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
} as const;

/** Lee un nodo DER a partir de `offset`. Devuelve el nodo y el siguiente offset. */
export function readNode(buffer: Buffer, offset = 0): { node: DerNode; next: number } {
  if (offset >= buffer.length) throw new Error('DER truncado');
  const tag = buffer[offset]!;
  let cursor = offset + 1;

  const first = buffer[cursor]!;
  cursor += 1;
  let length: number;

  if ((first & 0x80) === 0) {
    length = first;
  } else {
    const byteCount = first & 0x7f;
    if (byteCount === 0 || byteCount > 4) throw new Error('Longitud DER no soportada');
    length = 0;
    for (let i = 0; i < byteCount; i += 1) {
      length = (length << 8) | buffer[cursor + i]!;
    }
    cursor += byteCount;
  }

  const end = cursor + length;
  if (end > buffer.length) throw new Error('DER truncado');

  return {
    node: {
      tag,
      constructed: (tag & 0x20) !== 0,
      value: buffer.subarray(cursor, end),
      raw: buffer.subarray(offset, end),
    },
    next: end,
  };
}

/** Recorre los hijos de un nodo constructed. */
export function children(node: DerNode): DerNode[] {
  if (!node.constructed) return [];
  const result: DerNode[] = [];
  let offset = 0;
  while (offset < node.value.length) {
    const { node: child, next } = readNode(node.value, offset);
    result.push(child);
    offset = next;
  }
  return result;
}

export function parse(buffer: Buffer): DerNode {
  return readNode(buffer, 0).node;
}

/** Número de serie en hexadecimal mayúsculas, sin ceros a la izquierda. */
export function integerToHex(node: DerNode): string {
  const hex = node.value.toString('hex').toUpperCase().replace(/^0+(?=.)/, '');
  return hex.length % 2 === 1 ? `0${hex}` : hex;
}

/**
 * Extrae los números de serie revocados de una CRL en DER.
 *
 * Estructura recorrida (RFC 5280):
 *   CertificateList ::= SEQUENCE { tbsCertList, signatureAlgorithm, signature }
 *   TBSCertList ::= SEQUENCE { version?, signature, issuer, thisUpdate,
 *                              nextUpdate?, revokedCertificates?, extensions? }
 */
export interface ParsedCrl {
  thisUpdate: Date | null;
  nextUpdate: Date | null;
  revokedSerials: Set<string>;
}

export function parseCrl(der: Buffer): ParsedCrl {
  const list = parse(der);
  const [tbs] = children(list);
  if (!tbs) throw new Error('CRL sin tbsCertList');

  const items = children(tbs);
  const revokedSerials = new Set<string>();
  const times: Date[] = [];
  let seenIssuer = false;

  for (const item of items) {
    if (item.tag === TAG.UTC_TIME || item.tag === TAG.GENERALIZED_TIME) {
      times.push(parseAsn1Time(item));
      continue;
    }
    if (item.tag === TAG.SEQUENCE) {
      // El primer SEQUENCE tras el algoritmo es el nombre del emisor; el que
      // aparece después de las fechas es la lista de revocados.
      if (!seenIssuer && times.length === 0) {
        // Puede ser el AlgorithmIdentifier o el issuer Name; ambos se saltan.
        seenIssuer = children(item).some((child) => child.tag === TAG.SET);
        continue;
      }
      if (times.length > 0) {
        for (const entry of children(item)) {
          const [serial] = children(entry);
          if (serial && serial.tag === TAG.INTEGER) {
            revokedSerials.add(integerToHex(serial));
          }
        }
      }
    }
  }

  return {
    thisUpdate: times[0] ?? null,
    nextUpdate: times[1] ?? null,
    revokedSerials,
  };
}

function parseAsn1Time(node: DerNode): Date {
  const text = node.value.toString('ascii');
  if (node.tag === TAG.UTC_TIME) {
    // YYMMDDHHMMSSZ. Según la RFC, 50-99 son 19xx y 00-49 son 20xx.
    const year = Number(text.slice(0, 2));
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return new Date(
      `${fullYear}-${text.slice(2, 4)}-${text.slice(4, 6)}T${text.slice(6, 8)}:${text.slice(8, 10)}:${text.slice(10, 12)}Z`,
    );
  }
  return new Date(
    `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}Z`,
  );
}
