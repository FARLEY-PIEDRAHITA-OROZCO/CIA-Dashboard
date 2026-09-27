# `backend/datos/`

## `asignaciones.json`

Vive aquí el **único** registro de qué épica lleva cada persona en el proceso de
pruebas, y qué papel juega cada una (QA, dev).

### Por qué este fichero y no un campo de Azure

Las épicas no las crea el equipo de QA, así que **Azure no tiene dónde anotar a
quién le corresponde probarlas**. No existe ningún campo, ni una etiqueta, ni una
consulta guardada que lo guards. La información solo existe en este fichero.

La consecuencia es directa: si el fichero se pierde, no hay de dónde recuperarlo.
Por eso está **rastreado en git** y no ignorado, a diferencia de `.env` o
`dist/`. El historial da recuperación gratis y hace que un cambio de roles sea
revisable como cualquier otro cambio.

### Qué hacer si se corrompe

El backend **no** lo sobrescribe: leer un JSON inválido es un error explícito,
no un registro vacío. Así que el fichero estará intacto y bastará con arreglarlo a
mano o moverlo a `asignaciones.json.corrupto` para empezar de cero.

### La contrapartida de versionarlo

Un `git checkout` de otra rama puede reemplazar el fichero por una versión
anterior. El backend no lo puede evitar, pero sí lo detecta: antes de escribir
comprueba que el contenido en disco sea el mismo que leyó, y si no, rechaza la
escritura con un 409 en vez de pisar el cambio. Significa que **hay que hacer
commit tras cambiar asignaciones**; si no, el trabajo está solo en tu máquina.
