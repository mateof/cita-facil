import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bestScore, editDistance, fuzzySearch, matchScore, normalizeForSearch } from '@cita-facil/shared';

/**
 * Búsqueda aproximada de los campos que enlazan entidades.
 *
 * Lo que se comprueba aquí es el comportamiento que ve quien escribe en el
 * buscador: que encuentre con acentos o sin ellos, con el apellido primero y
 * con alguna errata, y que lo más parecido salga antes.
 */

describe('normalización para buscar', () => {
  it('quita los acentos', () => {
    assert.equal(normalizeForSearch('Peña'), 'pena');
  });

  it('pasa a minúsculas', () => {
    assert.equal(normalizeForSearch('MARTA'), 'marta');
  });

  it('colapsa los espacios de sobra', () => {
    assert.equal(normalizeForSearch('  Marta   Ríos '), 'marta rios');
  });
});

describe('distancia de edición', () => {
  it('es cero entre cadenas iguales', () => {
    assert.equal(editDistance('marta', 'marta'), 0);
  });

  it('cuenta una letra cambiada', () => {
    assert.equal(editDistance('marta', 'marte'), 1);
  });

  /** La errata de tecleo más común, y la que más importa reconocer. */
  it('cuenta dos letras traspuestas como una sola operación', () => {
    assert.equal(editDistance('nuria', 'nuira'), 1);
  });
});

describe('puntuación de una coincidencia', () => {
  it('da la máxima al texto idéntico', () => {
    assert.equal(matchScore('marta ríos', 'Marta Ríos'), 1);
  });

  it('puntúa más el comienzo que el interior', () => {
    assert.ok(matchScore('mar', 'Marta Ríos') > matchScore('mar', 'Ana Marín'));
  });

  it('encuentra por el apellido', () => {
    assert.ok(matchScore('rios', 'Marta Ríos') >= 0.9);
  });

  it('encuentra con los términos en otro orden', () => {
    assert.ok(matchScore('rios marta', 'Marta Ríos') >= 0.5);
  });

  it('encuentra por el correo', () => {
    assert.ok(matchScore('marta', 'marta.rios@ejemplo.es') >= 0.9);
  });

  it('tolera una errata', () => {
    assert.ok(matchScore('nuira', 'Nuria') >= 0.5);
  });

  it('no da por buena una palabra distinta', () => {
    assert.equal(matchScore('carlos', 'Marta Ríos'), 0);
  });

  /** Con dos o tres letras cualquier cosa está a una errata de cualquier otra. */
  it('no tolera erratas en palabras muy cortas', () => {
    assert.equal(matchScore('ana', 'ena'), 0);
  });

  it('devuelve cero con la consulta vacía', () => {
    assert.equal(matchScore('', 'Marta Ríos'), 0);
  });
});

describe('puntuación con varios campos', () => {
  it('se queda con el campo que mejor encaja', () => {
    assert.equal(bestScore('marta', ['Ana Marín', 'marta@ejemplo.es']), 0.95);
  });

  it('ignora los campos vacíos', () => {
    assert.ok(bestScore('marta', [null, undefined, 'Marta']) === 1);
  });
});

describe('búsqueda sobre una lista', () => {
  const gente = [
    { name: 'Marta Ríos', email: 'marta@ejemplo.es' },
    { name: 'Ana Marín', email: 'ana@ejemplo.es' },
    { name: 'Carlos Vidal', email: 'carlos@ejemplo.es' },
  ];
  const campos = { fields: (persona: (typeof gente)[number]) => [persona.name, persona.email] };

  it('deja fuera lo que no se parece', () => {
    const encontrados = fuzzySearch(gente, 'mar', campos);
    assert.deepEqual(
      encontrados.map((persona) => persona.name),
      ['Marta Ríos', 'Ana Marín'],
    );
  });

  it('pone primero lo que más se parece', () => {
    assert.equal(fuzzySearch(gente, 'mar', campos)[0]?.name, 'Marta Ríos');
  });

  it('devuelve la lista entera cuando no se ha escrito nada', () => {
    assert.equal(fuzzySearch(gente, '', campos).length, 3);
  });

  it('respeta el límite pedido', () => {
    assert.equal(fuzzySearch(gente, '', { ...campos, limit: 2 }).length, 2);
  });
});
