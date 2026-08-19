# Importación desde CSV

Nadie migra a una aplicación nueva si tiene que teclear mil clientes. En
**Panel → Clientes → Importar** se lee lo que exporta la hoja de cálculo del
negocio o la aplicación anterior.

## Siempre se ensaya primero

El botón que aparece de entrada es **Probar sin escribir**: hace todo el
trabajo (leer, buscar duplicados, validar fila a fila) y devuelve el mismo
informe, pero no toca la base de datos. El botón que escribe de verdad solo
aparece después de un ensayo.

Importar mal mil filas se arregla mucho peor que revisarlas antes.

**Una fila mala no tumba la importación.** Se salta, se anota por qué y se
sigue. Un fichero real siempre trae tres filas raras, y abortar entero
obligaría a limpiarlo a ciegas.

## Formato

La primera fila son los nombres de las columnas. Se admite punto y coma, coma o
tabulador como separador (se detecta solo), comillas dobles alrededor de los
campos que llevan el separador dentro, y la marca de orden de bytes que pone
Excel al guardar en UTF-8.

Los nombres de columna se comparan sin acentos ni mayúsculas, así que
"Teléfono", "telefono" y "TELEFONO" son la misma columna.

### Clientes

| Columna | Alternativas | Notas |
| --- | --- | --- |
| `nombre` | `name`, `cliente` | Obligatorio si no hay correo. |
| `correo` | `email`, `correo_electronico` | Con él se reconoce a quien ya existe. |
| `telefono` | `phone`, `movil` | |
| `nif` | `dni`, `documento` | Segundo criterio para reconocer a alguien. |
| `notas` | `notes`, `observaciones` | Se añaden a la ficha de la organización. |
| `etiquetas` | `tags` | Separadas por comas, puntos y comas o barras. |

**A quién ya existe se le reconoce por correo y por NIF, en ese orden.** Con el
teléfono no se identifica a nadie: en una familia se comparte, y unir dos fichas
por error es mucho peor que dejar dos separadas.

**Lo que ya está no se pisa**: solo se rellena lo que falte. Un fichero viejo no
puede machacar el teléfono que la persona actualizó ayer en su perfil. Las notas
se añaden debajo de las que hubiera, no las sustituyen.

### Citas

| Columna | Alternativas | Notas |
| --- | --- | --- |
| `fecha` | `date`, `dia` | En formato `AAAA-MM-DD`. |
| `hora` | `time`, `start` | En formato `HH:MM`, hora local de la sede. |
| `servicio` | `service`, `tratamiento` | Se busca por parecido, tolerando erratas. |
| `cliente` | `nombre`, `customer` | |
| `correo` | `email` | Si existe, la cita se enlaza a esa persona. |
| `profesional` | `recurso`, `resource` | Se busca por parecido. |
| `duracion` | `duration`, `minutos` | Sin ella, la del servicio. |
| `precio` | `price`, `importe` | En euros, con coma o punto decimal. |
| `estado` | `status` | Sin él: `completed` si es pasada, `confirmed` si es futura. |

**Las citas futuras comprueban solape; las pasadas no.** Importar histórico es
contar lo que ya ocurrió, aunque dos cosas se pisaran; meter una cita futura
encima de otra es prometer dos veces la misma hora.

## Límites

Hasta **2000 filas por tirada**. Un fichero mayor se parte en varios, y así
ninguna petición se eterniza ni deja a medias una importación.

## API

```
POST /organizations/:id/import/customers      { csv, dryRun }
POST /organizations/:id/import/appointments   { csv, dryRun }
```

`dryRun` viene activado de fábrica: quien llame sin pensarlo recibe un ensayo,
no mil filas escritas. Piden `customer:write` y `appointment:write`
respectivamente.

La respuesta trae el recuento y el detalle fila a fila, con el número de línea
del fichero para poder corregirlo sin adivinar.
