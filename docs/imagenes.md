# Imágenes e iconos de las entidades

Las organizaciones, las sedes, los servicios, los recursos, las categorías, los
tipos de bono y las personas se enseñan siempre con algo al lado del nombre.
Hay tres formas de decidir qué, y se pueden combinar:

1. una **imagen** subida al servidor,
2. un **icono** de la librería,
3. las **iniciales** del nombre sobre un color.

Manda la de más arriba: si hay imagen se enseña la imagen, si no el icono, y si
tampoco, las iniciales. Quitar la imagen deja ver el icono otra vez, sin tener
que volver a elegirlo.

Las iniciales **no se guardan**: se calculan del nombre, saltándose las
preposiciones ("Corte de pelo" da "CP"). El color, si no se elige uno, también
sale del nombre, así que dos entidades se ven distintas sin configurar nada y
el mismo nombre da siempre el mismo color.

## Dónde se configura

En el formulario de cada entidad, en el bloque **Imagen o icono**. Las tres
pestañas trabajan sobre la misma entidad:

| Pestaña | Qué hace |
| --- | --- |
| Imagen | Sube un fichero desde el ordenador y lo deja como imagen de la entidad. |
| Icono | Busca entre los iconos de la librería y elige uno. |
| Iniciales | Elige el color de fondo, o lo deja en automático. |

El buscador de iconos entiende el nombre en inglés de la librería
(`scissors`) y también unas cuantas palabras en castellano de los casos más
habituales: "tijeras", "gimnasio", "veterinario", "dentista", "bono"...

## Cómo se guardan las imágenes

Los ficheros van al **volumen de datos**, junto a la base de datos, en
`<DATA_DIR>/uploads/<organización>/<nombre>.<ext>`, y los sirve el propio API en
`/api/v1/uploads/...`. No hay almacenamiento externo a propósito: la aplicación
se despliega autogestionada y un bucket obligaría a configurar credenciales
para guardar cuatro logotipos.

- Formatos: **PNG, JPEG, WebP y GIF**. Hasta **2 MB**.
- El tipo se comprueba **por el contenido**, no por la extensión ni por lo que
  diga la petición.
- **SVG no se admite**, y es deliberado: es un documento que puede llevar
  `<script>` y estas imágenes se sirven desde el mismo dominio que la
  aplicación, así que uno malicioso se llevaría la sesión de quien lo viera.
- El nombre del fichero lo pone el servidor, nunca quien sube, así que no hay
  forma de escaparse de la carpeta con un `../`.
- Las imágenes **entran en las copias de seguridad** y vuelven al restaurarlas.
  Sin eso, una copia restaurada dejaría a los negocios sin logotipo.

La dirección se guarda **relativa** (`/api/v1/uploads/...`), no absoluta, para
que siga funcionando si el negocio cambia de dominio.

Las imágenes se sirven con caché de un año: la dirección cambia cada vez que se
sube una nueva, así que nunca hay que invalidar nada.

## Permisos

Subir una imagen exige el permiso de aquello que se va a ilustrar: quien puede
editar servicios sube la imagen de un servicio, y eso no le abre la puerta a
cambiar el logotipo del negocio.

| Destino | Permiso |
| --- | --- |
| `organization` | `org:update` |
| `location` | `location:write` |
| `service` | `service:write` |
| `resource` | `resource:write` |
| `category` | `service:write` |
| `credit_pack` | `credit:write` |

La **entrega** es pública y no comprueba nada: son logotipos y fotos de
servicios que se enseñan en la página de reservas, a la que se llega sin
identificarse. El nombre del fichero es aleatorio, así que no se puede adivinar
el de otra organización.

## Sobre el peso de los iconos

La librería trae unos 1750 iconos. Meterlos en la descarga inicial penalizaría
a quien solo entra a pedir cita, así que se cargan **aparte y solo cuando hacen
falta**: mientras llegan se enseñan las iniciales, que es lo que se vería
igualmente si el icono no existiera. En una instalación donde nadie use iconos,
ese paquete no se descarga nunca.

## Endpoints

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `POST /organizations/:organizationId/uploads` | según el destino | Sube una imagen. Multipart con `file` y `target`. |
| `GET /uploads/:scope/:filename` | público | Devuelve la imagen. |

Los campos `imageUrl`, `icon` y `color` se guardan con el resto de la entidad,
en su propio `POST`/`PATCH`; la subida solo devuelve la dirección.
