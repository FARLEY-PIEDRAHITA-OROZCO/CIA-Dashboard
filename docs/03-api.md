# 03 · API REST

> Contrato HTTP de la API. Endpoints, parámetros, ejemplos de respuesta y
> códigos de error. Interactivo en **Swagger** → `http://localhost:8000/docs`
> (abierto al iniciar el backend).

**Base URL**: `http://127.0.0.1:8000` (configurable con `HOST`/`PUERTO`).

Todos los endpoints devuelven **JSON** (`application/json`).

---

## 1. Resumen

| Método | Ruta | Descripción | Estabilidad |
| ------ | ---- | ----------- | ----------- |
| GET | `/api/health` | Healthcheck sin dependencias | estable |
| GET | `/api/azure/estado` | Estado de la integración con Azure | estable |
| GET | `/api/epics` | Listado de épicas (resumen, sin hijos). Por defecto excluye las `Closed`; `?incluir_cerradas=true` las incluye | estable |
| GET | `/api/epics/{epic_id}/arbol` | Árbol completo. `?incluir_bugs=true` añade bugs jerárquicos/relacionados y tareas de bugs | estable |
| GET | `/api/epics/{epic_id}/bugs` | Bugs de la épica + métricas; `?incluir_cerradas=true` incluye cerrados | estable |
| GET | `/api/sprints` | Catálogo de sprints detectados, con conteos y cuál es el actual | estable |
| GET | `/api/personas` | Personas con su carga, ordenadas por volumen | estable |
| GET | `/api/items` | Ítems del índice local, filtrados en memoria (sin llamar a Azure) | estable |
| GET | `/api/analitica/verificacion` | Señal ① brechas de verificación QA | experimental |
| GET | `/api/analitica/aging` | Señal ② trabajo estancado | experimental |
| GET | `/api/analitica/rezago` | Señal ③ rezago entre sprints | experimental |
| GET | `/api/pruebas/resumen` | Inventario de activos de prueba, brecha, automatización y diseño | experimental |
| GET | `/api/pruebas/cobertura` | Cobertura de historias con caso, global y por sprint | experimental |
| GET | `/api/pruebas/sin-cubrir` | Historias sin caso de prueba, paginadas (la lista de trabajo de QA) | experimental |
| GET | `/api/pruebas/planes` | Los planes como contexto: sprint y responsable | experimental |
| GET | `/api/pruebas/activos` | Activos de prueba filtrados, con los campos que QA puede editar en su tipo | experimental |
| GET | `/api/qa/personas` | Perfiles con su papel en pruebas y su carga | experimental |
| PUT | `/api/qa/personas/{guid}` | Fija el papel. `null` = «no lo toques», `false` = «quítaselo» | experimental |
| GET | `/api/qa/sugerencia-qa?minimo=N` | Quién **parece** hacer QA, por volumen de activos tocados | experimental |
| GET | `/api/qa/asignaciones` | Asignaciones de épicas; filtros `epica`, `persona`, `rol` | experimental |
| PUT | `/api/qa/asignaciones` | Asigna (idempotente) | experimental |
| DELETE | `/api/qa/asignaciones/{epica}/{persona}/{rol}` | Quita (idempotente) | experimental |
| GET | `/api/qa/carga` | Quién lleva qué épicas, por volumen | experimental |
| GET | `/api/qa/epicas/{id}/actividad` | Revisiones por persona y tipo. **No son horas**; 1 llamada a Azure por ítem | experimental |
| GET | `/api/monitor/azure` | Contador de llamadas a Azure (peticiones, errores, latencia, concurrencia). 404 si `MONITOR_HABILITADA=false` | experimental |
| GET | `/api/configuracion/ruta-onedrive` | Estado de la ruta base de OneDrive | experimental |
| PUT | `/api/configuracion/ruta-onedrive` | Actualiza la ruta base de OneDrive (body JSON: `{"ruta": "..."}`) | experimental |
| GET | `/api/iniciativas` | Lista de iniciativas a cargo con su carpeta | experimental |
| POST | `/api/iniciativas/{epica_id}/crear?nombre=...` | Crea la estructura de carpetas (numeración automática) | experimental |
| DELETE | `/api/iniciativas/{epica_id}` | Elimina la carpeta y el registro | experimental |
| GET | `/api/iniciativas/{epica_id}/archivos?carpeta=...` | Lista archivos de una subcarpeta | experimental |
| POST | `/api/iniciativas/{epica_id}/archivos?carpeta=...` | Sube un archivo (multipart/form-data) | experimental |
| DELETE | `/api/iniciativas/{epica_id}/archivos/{nombre}?carpeta=...` | Elimina un archivo | experimental |
| GET | `/api/iniciativas/{epica_id}/abrir` | Abre la carpeta en el explorador de archivos | experimental |
| PATCH | `/api/workitems/{id}` | Escritura QA (opt-in, ADR-11) | experimental |
| GET | `/api/workitems/{id}/rev` | Revisión actual, para control de concurrencia | experimental |
| POST | `/api/epics/refresh` | Invalida la caché **y los dos índices locales** | estable |

> No requiere autenticación propia (aplicación local; el secreto vive en el
> backend). Para exponerla, ver [08-despliegue](08-despliegue.md) y
> [06-seguridad](06-seguridad.md).

### Índice local

`/api/sprints`, `/api/personas`, `/api/items` y `/api/analitica/*` no ejecutan una
consulta por petición: se apoyan en un **índice en memoria** de los work items de
trabajo (`User Story`, `Task`, `Bug`, `Issue`) que se construye una vez por TTL
(`INDEX_TTL_SEG`, 300 s por defecto) y se filtra en memoria. Es la única
arquitectura viable: WIQL no devuelve los valores de los campos, la API de
iteraciones responde 401 con un PAT de lectura y los tags **no** se pueden
filtrar en el servidor. Ver [05-integracion-azure](05-integracion-azure.md).

`/api/pruebas/*` usa un **segundo índice**, no el mismo ampliado. Los activos de
prueba son 3.932 ítems (`Test Plan`, `Test Suite`, `Test Case`) que nadie
consulta al abrir la vista de sprints, así que meterlos en el índice de sprints
duplicaría su tiempo en frío sin ganar nada. Tiene su propio TTL
(`INDEX_PRUEBAS_TTL_SEG`, 900 s) y se carga **de forma perezosa**: `#/sprints` no lo
toca nunca.

`/api/qa/*` **no lee nada de Azure salvo para resolver nombres**: las
asignaciones, los roles y las notas viven en `backend/datos/asignaciones.json`,
que está **rastreado en git** porque es el único sitio donde existen. Y
`/api/qa/epicas/{id}/actividad` es la excepción: lee el historial de revisiones de
Azure, **una llamada por ítem del árbol**, y por eso es por épica y bajo demanda.
Ver [§12](#12-registro-local-de-pruebas-apiqua).

La cobertura de pruebas cruza los dos índices: los requisitos a los que apunta
cada caso (relación `TestedBy-Reverse`) con las historias del índice de trabajo.
Por eso `/api/pruebas/cobertura` no puede responder si el índice de sprints
todavía no se ha construido.

---

## 2. `GET /api/health`

Estado del proceso **sin** tocar Azure (útil para healthchecks de orquestación).

**200 OK**
```json
{ "estado": "ok", "version": "0.1.0" }
```

| Campo | Tipo | Significado |
| ----- | ---- | ----------- |
| `estado` | string | siempre `"ok"` si el proceso responde |
| `version` | string | versión de la API |

---

## 3. `GET /api/azure/estado`

Estado de configuración y conectividad real con Azure DevOps.

| Campo | Tipo | Descripción |
| ----- | ---- | ----------- |
| `configurada` | bool | ¿Están organización, proyecto y PAT configurados en `.env`? |
| `organizacion` | string | `AZURE_ORG_URL` (sin `/` final) |
| `proyecto` | string | nombre del proyecto |
| `area_path` | string | ÁreaPath configurado (puede ser `""`) |
| `verificado` | bool | `true` si la llamada de verificación a Azure fue exitosa |
| `error` | string | detalle del fallo cuando `verificado=false` |

**Ejemplo — todo OK**
```json
{
  "configurada": true,
  "organizacion": "https://dev.azure.com/<organizacion>",
  "proyecto": "<proyecto>",
  "area_path": "<area-path>",
  "verificado": true,
  "error": ""
}
```

**Ejemplo — PAT no configurado**
```json
{
  "configurada": false,
  "organizacion": "",
  "proyecto": "",
  "area_path": "",
  "verificado": false,
  "error": ""
}
```

- `configurada: false` ⇒ `GET /api/epics*` devuelve **409**.
- Si Azure devuelve un error durante la verificación, el endpoint de estado
  responde 200 con `verificado: false` y un mensaje de error de la aplicación
  (sin exponer el cuerpo upstream); los endpoints de backlog traducen el
  `AzureError` a **502** con un detalle seguro.

---

## 4. `GET /api/epics`

Listado de épicas del backlog (resumen: **sin** descripción ni hijos).

**Parámetro de consulta**

| Parámetro | Tipo | Default | Descripción |
| --------- | ---- | ------- | ----------- |
| `incluir_cerradas` | bool | `false` | Si es `false` (default) se **excluyen** las épicas con estado `Closed`, replicando el conteo visible del backlog del equipo en Azure (120 épicas). Con `true` se incluyen (132 épicas) |

**200 OK**
```json
{
  "epicas": [
    { "azure_id": 5586, "titulo": "Epic- IA Mundial Express",
      "estado": "Active", "url": "https://dev.azure.com/<organizacion>/<proyecto>/_workitems/edit/5586" },
    { "azure_id": 5587, "titulo": "Epic- Banca Digital", "estado": "Active", "url": "…" }
  ]
}
```

| Campo | Tipo | Descripción |
| ----- | ---- | ----------- |
| `epicas[]` | array | orden del backlog devuelto por Azure |
| `azure_id` | int | ID de Azure DevOps |
| `titulo` | string | `System.Title` |
| `estado` | string | `System.State` (**texto libre**, ej.: `Active`, `Resolved`, `Closed`) |
| `url` | string | enlace directo al work item; el listado lo construye con el proyecto codificado |

- En el entorno observado había **120** activas por defecto y **132** incluyendo las 12 cerradas. (El portal del backlog del equipo oculta las épicas `Closed`; nuestro WIQL lee todo el proyecto — ver [05-integracion-azure](05-integracion-azure.md).)
- Si el backlog está vacío: `{ "epicas": [] }` (200, no error).
- La lista NO viene ordenada por fecha de creación; el orden lo define Azure.
- **Error 409** si falta organización, proyecto o PAT; **502** si Azure
  devuelve un error de red/HTTP o una respuesta con estado/forma inesperada.

---

## 5. `GET /api/epics/{epic_id}/arbol`

Árbol jerárquico completo de la épica para el **drill-down**. El parámetro
`incluir_bugs` es opcional y por defecto mantiene el contrato anterior.

| Parámetro | Tipo | Default | Descripción |
| --------- | ---- | ------- | ----------- |
| `incluir_bugs` | bool | `false` | Incluye bugs jerárquicos, bugs relacionados con un salto y tareas que están debajo de bugs |

```
Épica ──► Features ──► User Stories ──► Tasks
       └────► User Stories directas ──► Tasks
```

**200 OK**
```json
{
  "azure_id": 5586,
  "titulo": "Epic- IA Mundial Express",
  "estado": "Active",
  "url": "https://dev.azure.com/<organizacion>/<proyecto>/_workitems/edit/5586",
  "descripcion": "<div><div style=\"font-family:Arial;font-size:13.3333px\">Desarrollar un sistema IA…</div></div>",
  "features": [
    {
      "azure_id": 22408,
      "titulo": "Feature- OCR y Text Mining",
      "estado": "Active",
      "descripcion": "<div>…</div>",
      "url": "https://…/_workitems/edit/22408",
      "hus": [
        { "azure_id": 22480, "titulo": "Implementar extracción de texto", "estado": "New", "descripcion": "<div>…</div>", "url": "https://…/edit/22480",
          "tareas": [
            { "azure_id": 22481, "titulo": "Crear pruebas", "estado": "New", "descripcion": "<div>…</div>", "url": "https://…/edit/22481" }
          ] }
      ]
    }
  ]
}
```

Detalles:
- `descripcion` es **HTML crudo de Azure** (divs con estilos inline). El
  backend NO lo transforma; el frontend lo **sanitiza** antes de renderizar.
- `features[].hus[]` son las User Stories. Si una Feature no tiene HUs,
  `hus` viene `[]`. Cada HU lleva `url` y `tareas[]` (también puede estar vacía).
- `epica.hus[]` contiene HUs directamente bajo la épica; cada una también
  puede contener `tareas[]`.
- `Task` se materializa como hija de una `User Story` o de un `Bug`; los tipos
  no permitidos se descartan durante la construcción del árbol.
- Épica sin features ⇒ `features: []`; sin historias/tareas ⇒ listas vacías.

**Errores**

| Código | Caso | Cuerpo `detail` (ejemplo) |
| ------ | ---- | ------------------------- |
| `409` | Configuración incompleta (organización, proyecto o PAT) | instrucciones de `.env` |
| `404` | la API recibió `None` del repositorio | `"Épica 999999 no encontrada."` |
| `502` | error de red/HTTP/JSON del adaptador, incluidos estados 203/204/3xx | mensaje seguro con estado; no se devuelve el cuerpo upstream |

---

## 6. `GET /api/epics/{epic_id}/bugs`

Proyección de bugs y métricas de la épica. Reutiliza el árbol extendido que
ya carga el backend; no duplica la lectura de Azure.

| Parámetro | Tipo | Default | Descripción |
| --------- | ---- | ------- | ----------- |
| `incluir_cerradas` | bool | `false` | Excluye estados cerrados (`Closed`, `Resolved`, `Done`, `Removed`, etc.) de `bugs`; las métricas siempre describen el total completo |

**200 OK**
```json
{
  "bugs": [
    {
      "azure_id": 10,
      "titulo": "Error de validación",
      "estado": "Active",
      "descripcion": "<div>…</div>",
      "url": "https://dev.azure.com/…/_workitems/edit/10",
      "prioridad": "1",
      "severidad": "Critical",
      "asignado_a": { "guid": "a1b2…", "nombre": "Persona", "url": "https://…" },
      "relacion": "hierarchy",
      "tareas": []
    }
  ],
  "metricas": {
    "total": 1,
    "abiertos": 1,
    "cerrados": 0,
    "por_estado": { "Active": 1 },
    "por_prioridad": { "1": 1 },
    "por_severidad": { "Critical": 1 },
    "por_relacion": { "hierarchy": 1 }
  }
}
```

- `relacion` es `hierarchy` o `related`.
- Las métricas se calculan en backend y son la fuente para la vista de bugs.
- Un bug puede aparecer en más de un contexto; el servicio lo deduplica por ID.
- `asignado_a` es un **objeto** `{"guid", "nombre", "url"}` o `null` si el ítem no
  tiene responsable. El `guid` es estable; el nombre puede cambiar.

---

## 7. `PATCH /api/workitems/{work_item_id}` (escritura QA, opt-in)

Actualiza los campos de QA de un work item **directamente en Azure DevOps**.
Solo está disponible si el backend se inició con `ESCRITURA_HABILITADA=true` y
`AZURE_PAT_ESCRITURA` (ADR-11). Sin eso responde `409`.

| Parámetro | Tipo | Default | Descripción |
| --------- | ---- | ------- | ----------- |
| `validar` | bool | `false` | Valida contra las reglas del proyecto **sin escribir** (`validateOnly`) |
| `rev_esperada` | int | — | Si el work item tiene otra revisión, aborta para no sobrescribir a otro QA |

**Cuerpo (JSON)** — todos los campos son opcionales; un campo ausente significa
"no tocar". Se exige **al menos uno**.

| Campo | Tipo | Notas |
| ----- | ---- | ----- |
| `estado` | string | Se valida contra las reglas de Azure |
| `prioridad` | string | 1–4 |
| `severidad` | string | `1 - Critical` … `4 - Low` |
| `tags` | string | Lista separada por comas. Se rechazan `;` y `*` |
| `notas_qa` | string | Se **agregan al final** de la descripción; nunca la reemplazan |

```json
{ "estado": "Verificado", "tags": "verificado-qa, reproducible" }
```

**200 OK**
```json
{
  "work_item_id": 300,
  "rev": 6,
  "campos": ["estado", "tags"],
  "validado": false,
  "detalle": "Cambio aplicado en Azure DevOps."
}
```

### Errores

| Código | Causa | Significado |
| ------ | ----- | ----------- |
| `409` | Escritura deshabilitada | Falta el flag o el PAT dedicado |
| `409` | Regla de Azure | El `detail` incluye el mensaje de regla (ej. `TF401321: …`) |
| `422` | Validación local | Campo vacío, tags con `;`/`*`, conflicto de `rev`, o cuerpo sin campos |
| `502` | Error de red/upstream | Fallo genérico de Azure |

> La invalidación de caché tras guardar es **dirigida**: solo se borran la lista
> de épicas y el árbol del work item modificado.

### `GET /api/workitems/{id}/rev`

Devuelve la revisión actual en `detalle`, para el control de concurrencia.
También responde `409` si la escritura está deshabilitada.

---

## 8. `POST /api/epics/refresh`

Invalida la caché de aplicación **y el índice local**. La **próxima** consulta a
`/api/epics`, `/api/epics/{id}/arbol` o `/api/sprints` vuelve a leer de Azure.

**200 OK**
```json
{
  "ok": true,
  "detalle": "Caché invalidada. La próxima consulta leerá de Azure."
}
```

> La invalidación es global por diseño. Un GET individual de una épica ya
> cacheada no se invalida con query params.
> `PATCH /api/workitems/{id}` también invalida el índice, para que los recuentos
> no muestren el valor anterior al cambio.

---

## 9. Sprints, personas e ítems

Los tres endpoints leen del **índice local** (§1). No generan peticiones a Azure
salvo en la carga del índice, y esa se cachea por TTL.

### `GET /api/sprints`

Detecta los sprints recorriendo el índice: **no** consulta la API de iteraciones
(responde 401 con un PAT de lectura) ni usa WIQL (no permite enumerar rutas de
iteración).

**200 OK**
```json
{
  "sprints": [
    {
      "nombre": "Sprint 45",
      "ruta": "<proyecto>\\Sprint 45",
      "total": 83, "abiertos": 67, "cerrados": 16,
      "personas": 16,
      "ultimo_cambio": "2026-09-26T15:30:00+00:00"
    }
  ],
  "total": 37,
  "sprint_actual": "Sprint 45",
  "total_items": 5651,
  "asignados_a_sprint": 5483
}
```

| Campo | Descripción |
| ----- | ----------- |
| `nombre` | hoja de la ruta de iteración; es el nombre real del sprint |
| `ruta` | ruta completa, que es lo que acepta `?sprint=` de `/api/items` |
| `personas` | personas distintas con ítems en el sprint |
| `ultimo_cambio` | `System.ChangedDate` más reciente del sprint; `""` si no hay fechas |
| `sprint_actual` | sprint con el cambio más reciente |
| `total_items` | ítems del índice local, incluidos los que no tienen sprint |
| `asignados_a_sprint` | ítems que sí están en algún sprint |

> `total_items - asignados_a_sprint` son los ítems **sin sprint asignable**. En el
> proyecto medido: 5.651 en total, 5.483 en sprints y 168 sin sprint. La UI dice
> ambos porque la suma de las columnas no es el total del proyecto, y presentarla
> como tal sería una mentira silenciosa.

- El orden es **numérico y tolerante**: `Sprint 9` antes que `Sprint 10`, y el
  legado `Sprint_001-HUB` conserva su posición. Los nombres sin número van al
  final, alfabéticamente.
- Se **excluye la raíz** de la jerarquía de iteración. En este proyecto las
  épicas y features apuntan a `<proyecto>`, que no es un sprint; aparecería como
  un «sprint» más.
- `sprint_actual` es una **heurística**, no el calendario de Azure: sin fechas de
  sprint no hay forma de saberlo. Se toma el último sprint *tocado*. Si no hay
  ninguna fecha, cae al último del catálogo.

### `GET /api/personas`

**200 OK**
```json
{
  "personas": [
    { "guid": "a1b2…", "nombre": "Kelly Johana Rincón Céspedes",
      "total": 514, "abiertos": 67, "bugs": 115,
      "bugs_abiertos": 12, "verificados": 0 }
  ],
  "total": 35
}
```

Ordenado por volumen y luego por nombre. `verificados` cuenta los ítems con la
etiqueta `verificado-qa`.

### `GET /api/items`

Proyección plana filtrada y paginada. Todos los parámetros son opcionales y se
combinan con AND.

| Parámetro | Tipo | Default | Descripción |
| --------- | ---- | ------- | ----------- |
| `sprint` | string | — | Ruta completa de iteración **o** nombre corto (`Sprint 45`) |
| `persona` | string | — | `guid` (exacto) o fragmento del nombre (sin distinguir mayúsculas) |
| `tipo` | string | — | `Task`, `User Story`, `Bug`, `Issue` |
| `etiqueta` | string | — | etiqueta exacta, sin distinguir mayúsculas |
| `solo_abiertos` | bool | `false` | excluye los estados terminales |
| `offset` | int | `0` | desplazamiento de la ventana |
| `limite` | int | `200` | tamaño de la ventana; se recorta a 200 |

**200 OK**
```json
{
  "items": [
    { "azure_id": 501, "tipo": "Bug", "titulo": "Error de cálculo",
      "estado": "Active", "tags": "verificado-qa;qa",
      "sprint": "<proyecto>\\Sprint 45",
      "persona": { "guid": "a1b2…", "nombre": "Ana Pérez", "url": "https://…" },
      "creado": "2026-09-01T10:00:00+00:00",
      "modificado": "2026-09-20T10:00:00+00:00",
      "cerrado": false }
  ],
  "total": 83,
  "offset": 0,
  "limite": 200,
  "hay_mas": false,
  "sprint_actual": "Sprint 45"
}
```

- El tope de **200 por respuesta** existe para no volcar el proyecto entero en
  el navegador, **no** para ocultar ítems: con `offset`/`limite` nada queda
  fuera de alcance. `total` es el total real antes de paginar y `hay_mas` indica
  si queda algo después de la ventana.
- El orden es `(modificado desc, azure_id desc)`. Esa estabilidad es lo que hace
  coherente el `offset`: sin un orden total y determinista, paginar repetiría o
  saltaría ítems entre páginas.
- `offset` y `limite` se corrigen en servidor: `?offset=-1&limite=5000` devuelve
  una ventana válida en lugar de un error o el proyecto entero.
- `cerrado` viene calculado con la lista de estados terminales de
  Scrum/Agile/Basic; `System.State` es texto libre en Azure.
- `sprint` acepta el nombre corto además de la ruta porque Azure solo acepta la
  ruta completa en sus filtros, pero una URL compartida o escrita a mano con
  `?sprint=Sprint 45` debe devolver los ítems y no cero en silencio. La
  comparación es local y no añade llamadas a Azure.

---

## 10. Analítica QA

Las tres señales que el sistema calcula y Azure DevOps no expone. Todas son de
solo lectura y salen del índice local.

> `historias_sin_evidencia` significa **sin la etiqueta `verificado-qa`**, no «sin
> notas». Las notas de QA se agregan a la descripción, que el índice no carga por
> peso; indexar descripciones es una mejora futura, no un atajo.

Cada lista trae como máximo **50** ejemplos, mientras que los conteos del
`resumen` son completos. La UI lo dice: el botón de una tarjeta promete los casos
que se van a **ver**, y la nota indica cuántos son en total. Un botón que
promete 136 y abre 50 filas es peor que no tener botón.

La página presenta cada señal como una tarjeta con un número grande y una frase
de contexto, y los ejemplos bajo demanda. Antes eran tres filas de KPIs más
seis listas de veinte elementos, todas a la vez.

### Vista de sprint en el frontend

La página `#/sprints` mantiene filtros y hoja **en el hash**, no en estado
local, para que la URL sea compartible. Reglas:

- La hoja se serializa como `?pagina=N` y **se omite cuando es la 1**, para no
  llenar el historial de entradas que no cambian nada.
- La hoja **no cuenta** como filtro activo (el badge dice «Limpiar N
  filtros»).
- Cualquier cambio de filtro **vuelve a la hoja 1**: quedarse en la 7 con un
  filtro nuevo mostraría una lista vacía sin explicación.
- El texto libre de persona se escribe en la URL con 300 ms de retardo: una
  entrada de historial y una petición por palabra, no por pulsación. Los
  desplegables se aplican al instante, porque elegir es una decisión
  deliberada.

### Cómo se presenta

La vista tiene **tres niveles de revelado**, no una pantalla con todo desplegado.
Abrirla mostraba unas 1.900 celdas de tabla: 4 tarjetas de KPIs, un catálogo de
37 filas y una tabla de 200 ítems. Y los KPIs no informaban de nada sin filtro
(37 · 5.651 · 35 · «Sprint 45» fueran cuales fueran las constantes).

| Nivel | Qué se ve | Cuándo |
| ----- | --------- | ------ |
| 1 | Una línea de veredicto y la cinta de sprints | Al abrir |
| 2 | La tabla de ítems filtrada | Con un filtro activo, o con `?desplegado=1` |
| 3 | La ficha del ítem | Al abrir un ítem (vista de épica) |

La **cinta** sustituye a la tabla de catálogo porque 37 sprints son una
*secuencia*, no un conjunto: una tabla obliga a leer fila por fila para comparar
y 37 barras se leen de un vistazo. Altura = volumen, relleno = porcentaje
cerrado, marca en la base = ítems que ese sprint dejó sin cerrar. La marca no
cuesta ninguna petición extra: el rezago de un sprint histórico es exactamente su
número de ítems abiertos.

La cinta también es el selector de sprint, así que el desplegable de 37 opciones
desapareció. Con scroll horizontal en lugar de agrupar: si el proyecto llegara a
150 sprints, se desplaza, que es mejor que agregar en silencio sprints que
alguien puede querer abrir uno a uno.

### `GET /api/analitica/verificacion` — señal ①

Cruza el estado con la etiqueta `verificado-qa`.

**200 OK**
```json
{
  "resumen": {
    "bugs": 143,
    "bugs_cerrados_sin_verificar": 136,
    "bugs_verificados_sin_cerrar": 0,
    "historias": 601,
    "historias_sin_evidencia": 410,
    "verificados": 0,
    "generado": "2026-09-26T12:00:00+00:00"
  },
  "cerrados_sin_verificar": [ { "azure_id": 700, "tipo": "Bug", "…": "…" } ],
  "verificados_sin_cerrar": [],
  "historias_sin_evidencia": [ { "azure_id": 800, "…": "…" } ]
}
```

Cada lista trae como máximo 50 ítems (`azure_id`, `tipo`, `titulo`, `estado`,
`sprint`, `persona`, `modificado`); los conteos del `resumen` sí son completos.

### `GET /api/analitica/aging` — señal ②

| Parámetro | Default | Rango |
| --------- | ------- | ----- |
| `dias_inactivo` | `14` | 1–365 |
| `dias_en_curso` | `30` | 1–365 |

Separa lo inactivo de lo que lleva demasiado tiempo *en curso*, y **excluye los
ítems cerrados**: terminado no es estancado. Se apoya en `System.ChangedDate`, con
`System.CreatedDate` como respaldo.

```json
{ "resumen": { "inactivos": 84, "en_curso": 578,
               "dias_inactivo": 14, "dias_en_curso": 30, "generado": "…" },
  "inactivos": [ … ], "en_curso": [ … ] }
```

### `GET /api/analitica/rezago` — señal ③

Deuda que arrastra cada sprint anterior. Azure guarda un único sprint por work
item, así que este trabajo no aparece en su tablero de sprint.

```json
{ "resumen": { "sprints": 37, "sprint_referencia": "Sprint 45",
               "sprints_con_rezago": 32, "rezagados": 594, "generado": "…" },
  "sprints": [ { "sprint": "Sprint 2", "abiertos": 41, "items": [ … ] } ] }
```

Ordenado por cantidad de deuda descendente. `sprint_referencia` es el último del
catálogo; los anteriores son los históricos.

### Errores comunes

| Código | Caso |
| ------ | ---- |
| `409` | Falta organización, proyecto o PAT (igual que el resto de `/api/epics*`) |
| `502` | Azure falló al **construir el índice**; las consultas ya cacheadas no fallan |

---

## 11. Gestión del proceso de pruebas

Capa de **solo lectura** (la escritura sobre activos de prueba es la Fase 5 del
plan y no forma parte de este contrato). Responde tres preguntas: cuántas
historias no tienen ningún caso que las pruebe, en qué sprint, y quién lleva las
pruebas.

### Qué se puede medir y qué no

La pertenencia de un caso a un plan **no es accesible**: los work items
`Test Plan` no tienen relaciones de pertenencia y
`GET …/_apis/testplan/Plans/{id}/TestCaseList` responde **404** en todas las
versiones probadas. Por eso no hay endpoint para «abrir un plan», y `/planes`
solo devuelve sprint y responsable.

Lo que sí existe es el vínculo **caso → requisito** (`TestedBy-Reverse`), que
aparece en 2.014 de 3.431 casos. De ahí sale la cobertura.

### `GET /api/pruebas/resumen`

Inventario, brecha, automatización y diseño de casos.

```json
{
  "inventario": { "planes": 44, "suites": 457, "casos": 3431, "total": 3932 },
  "estados": { "Test Case": { "Design": 1577, "Closed": 1722, "Ready": 132 } },
  "automatizacion": {
    "casos": 3431, "automatizados": 0, "planificados": 53,
    "manuales": 3378, "pct_automatizado": 0.0
  },
  "diseno": { "en_diseno": 1577, "sin_mover": 624, "dias": 180 },
  "brecha": {
    "historias": 601, "cubiertas": 240, "sin_cubrir": 361,
    "pct_cubiertas": 39.9, "parcial": false, "requisitos_cubiertos_total": 352
  },
  "parcial": false,
  "generado": "2026-09-27T16:48:34Z"
}
```

Tres decisiones que no son obvias:

- **`automatizados` cuenta solo `Automated` exacto.** `Planned` va aparte porque
  un caso planificado para automatizar **hoy sigue siendo manual**; sumarlo
  inflaría la métrica.
- **`automatizacion` es un eje independiente del estado.** Un caso `Closed` puede
  no estar automatizado y uno `Design` puede estarlo, así que no es un tono de
  estado.
- **`diseno` separa trabajo en curso de deuda.** 1.577 casos en `Design` no son
  todos deuda: `sin_mover` son los que no se tocan desde hace más de `dias`.

### `GET /api/pruebas/cobertura`

Cobertura global y por sprint. `resumen` tiene **la misma forma** que `brecha`
del endpoint anterior: son el mismo dato y divergirían al primer cambio.

```json
{
  "resumen": {
    "historias": 601, "cubiertas": 240, "sin_cubuir": 361, "pct_cubiertas": 39.9,
    "requisitos_cubiertos_total": 352, "parcial": false, "lotes_con_error": 0,
    "generado": "2026-09-27T16:48:34Z"
  },
  "sprints": [
    { "nombre": "Sprint 45", "ruta": "…\\Sprint 45",
      "historias": 39, "cubiertas": 5, "sin_cubrir": 34, "pct_cubiertas": 12.8 }
  ]
}
```

Una historia cuenta como cubierta si **algún** caso la prueba, sin mirar en qué
sprint está el caso: el sprint de un caso es dónde se planificó ejecutarlo, no
dónde está el requisito. La raíz de la iteración se excluye con la misma
detección que el índice de sprints (la ruta que es prefijo de otras): 46
historias apuntan a `CIA (Centro de Inteligencia Artificial)` y esa no es un
sprint.

> **Por qué 240 y no 241.** Una `User Story` (17548) está enlazada por
> `TestedBy` a cuatro **Tasks** del proceso de QA («Creación de casos de
> pruebas», «Ejecución», «Evidencias») y a ningún caso. Tiene proceso de QA
> documentado, no un caso de prueba, así que cuenta como descubierta.

### `GET /api/pruebas/sin-cubrir`

Las historias sin ningún caso: la lista de trabajo de QA, paginada.

| Parámetro | Por defecto | Notas |
| --------- | ----------- | ----- |
| `sprint` | — | Ruta completa **o** nombre corto (`Sprint 45`) |
| `persona` | — | GUID o fragmento del nombre |
| `limite` | `50` | 1–200 |
| `offset` | `0` | ≥ 0 |

El orden es por sprint (los que no tienen sprint van primero, porque son la deuda
más difícil de situar) y luego por id, **estable a propósito**: con un orden
cambiante el `offset` repetiría o saltaría historias entre páginas.

```json
{
  "resumen": {
    "total": 361, "offset": 0, "limite": 50, "hay_mas": true,
    "parcial": false, "lotes_con_error": 0
  },
  "items": [
    { "azure_id": 1, "titulo": "…", "estado": "Active",
      "sprint": "Sprint 45", "persona": "…", "modificado": "2026-02-01T…" }
  ]
}
```

`sprint` vacío significa «no está en ninguna iteración», no «el filtro la ocultó».

### `GET /api/pruebas/planes`

```json
[
  { "azure_id": 6776, "titulo": "Auditorias tecnicas", "estado": "Active",
    "sprint": "Sprint 1", "persona": "…", "modificado": "2026-02-01T…" }
]
```

### `GET /api/pruebas/activos`

Los activos filtrados y paginados, para **editarlos**.

| Parámetro | Por defecto | Notas |
| --------- | ----------- | ----- |
| `tipo` | — | `Test Plan`, `Test Suite` o `Test Case` |
| `estado` | — | Texto exacto |
| `persona` | — | GUID o fragmento del nombre |
| `sprint` | — | Ruta completa **o** nombre corto |
| `limite` | `50` | 1–200 |
| `offset` | `0` | ≥ 0 |

```json
{
  "resumen": { "total": 3431, "offset": 0, "limite": 50, "hay_mas": true,
               "parcial": false, "lotes_con_error": 0 },
  "items": [
    { "azure_id": 5733, "tipo": "Test Case", "titulo": "Validar…",
      "estado": "Design", "sprint": "Sprint 45", "persona": "…",
      "tags": "smoke", "prioridad": "2", "automatizacion": "Not Automated",
      "modificado": "2026-02-01T…",
      "campos_editables": ["estado", "notas_qa", "prioridad", "tags"] }
  ],
  "estados": { "Test Case": ["Design", "Ready", "Closed"],
               "Test Plan": ["Active"] }
}
```

Dos campos que existen por una razón concreta:

- **`campos_editables`** lo envía el backend desde `CAMPOS_POR_TIPO`, la **misma**
  tabla que aplica el adaptador de escritura. El frontend no decide qué
  controles mostrar. No es una comodidad: Azure acepta en silencio escribir un
  campo que el tipo no tiene (ver la enmienda a ADR-11 en
  [02-backend](02-backend.md)), así que un control de más deja un campo huérfano
  sin dar error. `Test Plan` y `Test Suite` llegan con `["estado"]`.
- **`estados`** son los estados que el tipo **usa**, no el catálogo de la
  plantilla, que no se puede leer. Azure rechaza con HTTP 400 un estado
  inexistente, así que ofrecer el catálogo completo sería ofrecer transiciones
  que siempre fallan.

### Cobertura parcial

`parcial: true` significa que **algún lote de relaciones no se pudo leer**. Es
una límite de la lectura, no un dato de la calidad: los casos ausentes cuentan
historias cubiertas como descubiertas, así que `sin_cubrir` es una **cota
superior** — puede haber más, nunca menos.

Se declara en las tres respuestas de cobertura (`resumen.brecha.parcial`,
`cobertura.resumen.parcial` y `sin-cubrir.resumen.parcial`) y la UI lo dice pegado
al veredicto. Publicar la cifra como total sería peor que no publicarla: alguien
decidiría escribir 361 casos cuando hacen falta 400.

La coincidencia entre las dos direcciones del cruce (casos e historias) se exige
en las pruebas, no en producción: contrastarla allí duplicaría las lecturas. Ver
`backend/tests/test_indice_pruebas.py::test_cobertura_coincide_en_las_dos_direcciones`.

### Códigos

| Código | Caso |
| ------ | ---- |
| `200` | OK, incluso sin datos (listas vacías y ceros) |
| `409` | Falta organización, proyecto o PAT |
| `422` | `limite` fuera de 1–200 u `offset` negativo |
| `502` | Azure falló al construir el índice de pruebas |

La primera llamada tras el arranque o un refresco cuesta **~15 s**, no 5: la
cobertura necesita **los dos índices**. Medido en frío, contra el proyecto real:

| Paso | Coste |
| ---- | ----- |
| Índice de trabajo (5.651 ítems) — lo necesitan las historias | **~10,4 s** |
| Índice de pruebas (3.932 activos, `$expand=relations`, 18 lotes) | **~5,4 s** |
| Consultas posteriores | 9–22 ms |

Los 5,4 s del segundo índice son el precio de `$expand=relations`; sin él no hay
cobertura. La primera vez que se abre `#/pruebas` tras un arranque hay que
esperar. Ver [10-auditoria](10-auditoria.md).

---

## 12. Registro local de pruebas (`/api/qa/*`)

Azure no tiene dónde anotar **a quién le corresponde probar una épica**: las
épicas no las crea el equipo de QA, y `System.AssignedTo` significa otra cosa.
Esa información solo existe en un fichero local
(`backend/datos/asignaciones.json`, **rastreado en git**), y por eso estos
endpoints son los únicos que escriben algo que Azure no puede devolver.

**Todo lo que hay aquí no es Azure.** Los nombres de las personas se resuelven
del índice, pero las asignaciones, los roles y las notas son locales. Si el
fichero se pierde, esa información se pierde.

### `GET /api/qa/personas`

Perfiles con su papel en pruebas y su carga. `es_qa` / `es_dev` / `forzado`
vienen del registro; `items_backlog` y `bugs` vienen del índice de Azure, y son
el contraste entre lo declarado y lo real.

```json
{
  "personas": [
    {
      "guid": "75712602-99c0-6599-96e8-9f8847c0f673",
      "nombre": "Lina Vanessa Salazar",
      "es_qa": true, "es_dev": false, "forzado": true,
      "epicas": 7, "epicas_qa": 7, "epicas_dev": 0,
      "mas_antigua": "2026-03-02",
      "dias_laborables": 142,
      "items_backlog": 210, "bugs": 4
    }
  ],
  "total": 35, "qa": 6, "dev": 21, "sin_rol": 8
}
```

> **`dias_laborables` no son horas.** El registro de tiempos de Azure responde
> 401 con el PAT de lectura, así que no hay ninguna fuente de horas en este
> sistema. Es días laborables desde la asignación más antigua, contados de lunes
> a viernes (`work/teamSettings.workingDays` devuelve `monday..friday`).

### `PUT /api/qa/personas/{guid}`

Fija el papel. `es_qa`, `es_dev` y `forzado` aceptan `true`, `false` o `null`;
**`null` es "no lo toques"**, que no es lo mismo que `false` ("quítaselo"). Por eso
el cliente quita los `null` del cuerpo en vez de mandarlos: JSON no distingue
"ausente" de "nulo" una vez serializado, y mandarlos borraría el rol que no se
quería cambiar.

`forzado: true` marca que la decisión fue humana y no el valor por defecto, que
es como la sugerencia se distingue de una afirmación.

### `GET /api/qa/sugerencia-qa?minimo=3`

Quién **parece** hacer QA, por volumen de activos de prueba tocados. Es una
heurística, no un dato: no guarda nada y la decisión es de quien la ve. Por eso
el campo `ya_es_qa` existe —para no repetir la sugerencia de alguien que ya
está marcado— y la respuesta trae su propia `nota`.

### `GET /api/qa/asignaciones`

Filtros opcionales `epica`, `persona`, `rol`. Cada fila trae `titulo` resuelto
desde el índice y **`titulo_conocido`**: `false` significa que la épica ya no
está en Azure. La asignación **sigue existiendo y se muestra** —ocultarla sería
perderla de la vista sin aviso— y la respuesta declara `epicas_desconocidas`
para poder limpiarlas.

### `PUT` y `DELETE /api/qa/asignaciones[/{epica}/{persona}/{rol}]`

Idempotentes. `desde` es opcional (por defecto, hoy) y no admite fechas futuras.

### `GET /api/qa/carga`

Quién lleva qué épicas, ordenado por volumen. Es la lectura que responde «en qué
está trabajando cada QA».

### `GET /api/qa/epicas/{epic_id}/actividad`

**Actividad registrada**: revisiones por persona, por tipo y rango de fechas, de
la épica y de **todo** su árbol.

```json
{
  "epica": 5716,
  "titulo": "Epic- IA Buzón de requerimientos jurídicos",
  "items_analizados": 232, "items_totales": 232,
  "parcial": false, "items_sin_actividad": 2,
  "revisiones": 1938, "personas": 12,
  "primera": "2024-10-21T20:01:41.183000+00:00",
  "ultima": "2026-08-05T19:59:29.187000+00:00",
  "por_persona": [
    { "guid": "…", "nombre": "Brian Ferney Rojas Medina", "revisiones": 629 }
  ],
  "por_tipo": { "Epic": 1, "Feature": 5, "User Story": 35, "Task": 191 },
  "nota": "Actividad registrada = número de revisiones, no horas. …"
}
```

Cuatro cosas que hay que leer antes que el número:

1. **No son horas.** `work/previewUpdates` (el registro de tiempos) responde
   **401** con el PAT de lectura. No hay ninguna fuente de horas en este sistema,
   y por eso el campo se llama `revisiones` y no `horas` ni `esfuerzo`: un nombre
   de medida sobre un número no medido es peor que no tener el campo.

2. **`parcial` es una cota _inferior_.** Si un historial no se pudo leer, el
   recuento **resta** actividad. Es lo contrario que la cobertura de pruebas,
   donde perder relaciones produce una cota _superior_ de la brecha (ver §11).
   `items_analizados` frente a `items_totales` es lo que revela el hueco.

3. **La revisión de creación no cuenta.** Llega con `revisedDate` centinela
   (`9999-01-01T00:00:00Z`, medido en el 100 % de las revisiones actuales) y
   `rev=1`. Sin filtrar el centinela, `ultima` sería el año 9999 en **todas** las
   épicas; sin descartar la revisión 1, quien solo abrió el ítem aparecería
   como quien trabajó en él.

4. **Compara solo épicas de antigüedad parecida.** Los ítems antiguos tienen una
   revisión y los recientes muchas (historias nuevas: mediana 79 revisiones;
   las más antiguas: 1). Una épica con 1.938 revisiones y otra con 300 no se
   comparan sin mirar cuándo existen.

#### Coste, y por qué no hay vista global

**Una llamada a Azure por ítem del árbol**: `workitems/{id}/updates` es de un solo
ítem y no existe endpoint por lotes (medido). Medido en el proyecto real:

| Épica | Ítems | Tiempo | Revisiones |
| ----- | ----- | ------ | ---------- |
| #5716 | 232 | 4,8 s | 1.938 |
| #12915 | 254 | 5,8 s | 1.811 |
| #32350 | 63 | 1,9 s | 300 |
| #29773 | 29 | 1,2 s | 148 |
| #19174 | 4 | 0,7 s | 25 |
| #31253 | 1 | 0,3 s | 8 |

Mediana de 26 ítems y 1,2 s. La segunda petición sale de caché en ~0 s (TTL
900 s).

Por eso **no hay vista global de actividad**: leer el historial de los 5.651
ítems del proyecto serían 5.651 peticiones. Eso no es una vista, es un ataque a
la API. La actividad es por épica y bajo demanda, y el panel del frontend no
pide nada hasta que alguien lo abre.

### Errores de `/api/qa/*`

Tres fallos distintos con tres códigos distintos, porque confundirlos manda a la
puerta equivocada:

| Código | Cuándo | Quién puede arreglarlo |
| ------ | ------ | ---------------------- |
| `422` | Asignación inválida (GUID que no existe, fecha futura, rol desconocido) | quien está en el formulario |
| `409` | `RegistroModificado`: el fichero cambió en disco desde que se leyó | recargar y reintentar; no se perdió nada |
| `500` | `ErrorRegistro`: el JSON está corrupto | el servidor; **no** se arregla desde el formulario |

Un fichero **ausente** devuelve un registro vacío sin error: es el primer
arranque. Un fichero **corrupto** sí es un error, y lo dice, porque «no hay
asignaciones» y «no se pudo leer el fichero» llevan a decisiones opuestas.

La actividad usa además los del upstream: **404** si la épica ya no existe en
Azure (traducido desde el 404 de Azure, no un 502), **502** si Azure falla por
otra causa, y **422** si el `epic_id` no es un entero positivo.

---

## 13. `GET /api/monitor/azure`

Contador de peticiones HTTP hacia Azure DevOps. Es una herramienta de
diagnóstico para entender el coste real de cada vista.

**Parámetros**: ninguno.

**200 OK** (con `MONITOR_HABILITADA=true`)
```json
{
  "activa": true,
  "total": 42,
  "por_categoria": { "wit/wiql": 20, "wit/workitems": 22 },
  "por_estado": { "200": 40, "404": 2 },
  "errores": 2,
  "tasa_error": 0.048,
  "latencia_p50_ms": 250,
  "latencia_p95_ms": 1200,
  "latencia_max_ms": 3400,
  "concurrentes": 0,
  "concurrentes_pico": 3,
  "limite_concurrentes": 300,
  "llamadas_recientes": [
    {
      "hora": "2026-09-29T12:34:56.000Z",
      "metodo": "POST",
      "categoria": "wit/wiql",
      "estado": 200,
      "duracion_ms": 350,
      "error": ""
    }
  ],
  "avisos": []
}
```

| Campo | Tipo | Significado |
| ----- | ---- | ----------- |
| `activa` | bool | `true` si el monitor está encendido |
| `total` | int | peticiones totales desde el último reinicio |
| `por_categoria` | object | peticiones por recurso (WIQL, Lote, Work item, Historial, Proyecto) |
| `por_estado` | object | peticiones por código de estado HTTP |
| `errores` | int | peticiones con estado ≥ 400 o error de red |
| `tasa_error` | float | `errores / total` (0 si `total == 0`) |
| `latencia_p50_ms` | int | percentil 50 de duración |
| `latencia_p95_ms` | int | percentil 95 de duración |
| `latencia_max_ms` | int | duración máxima |
| `concurrentes` | int | peticiones simultáneas ahora mismo |
| `concurrentes_pico` | int | pico de peticiones simultáneas |
| `limite_concurrentes` | int | límite de Azure DevOps (300) |
| `llamadas_recientes` | array | últimas 200 peticiones (con tope de memoria) |
| `avisos` | array | avisos de umbral (tasa de error, 429, concurrencia, latencia) |

**Errores**

| Código | Caso | Cuerpo `detail` |
| ------ | ---- | --------------- |
| `404` | `MONITOR_HABILITADA=false` | instrucciones para activarlo |

- El monitor está **apagado por defecto** (`MONITOR_HABILITADA=false`). Un
  contador a cero apagado parece «todo va bien»; un 404 no.
- El monitor es un **observador pasivo**: no reescribe, reintenta ni corta
  una petición. Si pudiera, estaría midiendo algo distinto de lo que se envió.
- Los errores de red también se cuentan (con `estado: 0` y el nombre de la
  excepción en `error`). Sin esto, la tasa de error quedaría por debajo de la
  real.
- La concurrencia se libera con `finally`, no solo en los errores de red: si
  una petición levanta una excepción que no es de red, el contador baja
  igualmente.
- Los avisos disparan por umbral, no son números sueltos: tasa de error > 10 %,
  presencia de 429, concurrencia ≥ 80 % del límite, o latencia p95 > 5 s.

---

## 14. Modelo de errores

Todos los errores siguen el contrato de FastAPI: respuesta JSON con campo
`detail` (string, o array de detalles de validación).

```json
{ "detail": "Azure DevOps no está configurado. Define organizacion, proyecto y PAT en el .env del backend." }
```

### Códigos posibles

| Código | Significado | Origen |
| ------ | ----------- | ------ |
| `200` | OK | — |
| `409` | Configuración ausente (organización, proyecto o PAT), o `RegistroModificado` | rutas |
| `404` | La raíz no existe o no se encuentra | rutas |
| `422` | Validación de `{epic_id}` (no entero o no positivo) | FastAPI/pydantic |
| `500` | Error inesperado (bug), o `ErrorRegistro` (JSON corrupto) | FastAPI |
| `502` | Error upstream de Azure; 203/204/3xx o JSON inválido | transporte + rutas |

> Los endpoints del índice y de la analítica devuelven **listas vacías** en vez
> de error cuando no hay datos (`sprints: []`, `items: []`, `sprints: []` en
> rezago). Un proyecto sin sprints no es un fallo.

> Los errores Azure exponen estado y mensajes seguros; no se devuelve el
> cuerpo upstream. Nunca serializar `Settings` completo.

---

## 14. Ejemplos de uso

### PowerShell
```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/epics
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/epics/5586/arbol
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/api/epics/5586/bugs?incluir_cerradas=true"
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/sprints
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/personas
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/api/analitica/verificacion"
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/epics/refresh
```

### curl
```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/azure/estado
curl http://127.0.0.1:8000/api/epics/5586/arbol
# Registro local de pruebas
curl http://127.0.0.1:8000/api/qa/personas
curl http://127.0.0.1:8000/api/qa/carga
# Actividad de una épica: 1 llamada a Azure por ítem del árbol (~1-6 s)
curl http://127.0.0.1:8000/api/qa/epicas/5716/actividad
# Filtros combinables; la ruta del sprint debe ir codificada
curl -G http://127.0.0.1:8000/api/items \
  --data-urlencode 'sprint=<proyecto>\Sprint 45' \
  --data-urlencode 'persona=Ana' \
  --data-urlencode 'solo_abiertos=true'

# Paginación: recorrer el resultado entero
curl -G http://127.0.0.1:8000/api/items \
  --data-urlencode 'sprint=Sprint 45' \
  --data-urlencode 'offset=200' --data-urlencode 'limite=200'
```

### Swagger / OpenAPI
- UI interactiva: `http://127.0.0.1:8000/docs`
- Spec JSON: `http://127.0.0.1:8000/openapi.json`

---

Siguiente lectura: [04 · Frontend](04-frontend.md).