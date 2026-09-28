# `backend/datos/`

## `asignaciones.json`

Vive aquí el **único** registro de qué épica lleva cada persona en el proceso de
pruebas, y qué papel juega cada una (QA, dev).

### Por qué este fichero y no un campo de Azure

Las épicas no las crea el equipo de QA, así que **Azure no tiene dónde anotar a
quién le corresponde probarlas**. No es una suposición: medido sobre el tipo
`Epic` de este proyecto (2026-09-28), no tiene `System.Tags`, no tiene
`System.HyperLink` y no tiene ningún campo `Custom.*` propio —los dos `Custom.*`
que existen (`Impact` y `Urgency`) son *picklists* de la plantilla CMMI con datos
reales, y usarlos sería corromper información.

Añadir un campo propio es posible, pero eso es **plantilla de proceso**: requiere
permisos de administrador y afecta a todo el proyecto. No es una decisión de una
herramienta.

La consecuencia es directa: si el fichero se pierde, no hay de dónde recuperarlo.

### Ya **no** está en git

Antes sí lo estaba, y por eso había que hacer `git commit` después de cada
asignación. Eso no era una necesidad del dato: era haber atado el
**almacenamiento** con la **copia de seguridad**. Git nunca fue dónde viven los
datos; fue una segunda copia gratis. Atar las dos convertía cada asignación en un
ritual.

Ahora es un fichero de datos, fuera del control de versiones, y se escribe sin ceremony. El respaldo se configura aparte.

### La copia de seguridad

En el `.env` del backend:

```env
REGISTRO_COPIA_RUTA=C:\ruta\absoluta\a\una\carpeta\respaldo\asignaciones.json
```

Vacia por defecto, **a propósito**. Dejarla vacía hace que la ausencia de
respaldo sea visible en la interfaz; poner una ruta equivocada la escondería.
Punto detrás de esta decisión: un `OneDrive` instalado pero **sin sesión
iniciada** tiene la carpeta en disco, y escribir ahí produce un fichero que
*parece* respaldado y no lo está — peor que no tener copia.

Qué hace:

- **Copia** el fichero después de cada guardado. La copia también es atómica, y
  si falla no tumba la escritura: el registro principal ya está guardado, así que
  devolver un error HTTP sería mentir. El fallo se muestra en la interfaz.
- **Restaura** al arrancar si el registro no existe. Solo si **falta**: si está
  corrupto no lo sobrescribe, porque ese contenido quizá todavía se puede
  recuperar a mano.
- **Dice la verdad** en `GET /api/qa/registro`, que la interfaz usa para no
  inventarse el texto.

### Qué hacer si se corrompe

El backend **no** lo sobrescribe: leer un JSON inválido es un error explícito,
no un registro vacío. Así que el fichero estará intacto y bastará con arreglarlo a
mano, o moverlo a `asignaciones.json.corrupto` y dejar que la copia lo restaure en
el siguiente arranque.

### El resto de ficheros de esta carpeta

- `README.md` — este fichero, que sí está en git porque es documentación.
- `*.tmp` — temporales de la escritura atómica. Si aparece uno, fue un proceso
  interrumpido; se puede borrar sin miedo.
