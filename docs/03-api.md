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
| PATCH | `/api/workitems/{id}` | Escritura QA (opt-in, ADR-11) | experimental |
| GET | `/api/workitems/{id}/rev` | Revisión actual, para control de concurrencia | experimental |
| POST | `/api/epics/refresh` | Invalida la caché **y el índice local** | estable |

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
  "sprint_actual": "Sprint 45"
}
```

| Campo | Descripción |
| ----- | ----------- |
| `nombre` | hoja de la ruta de iteración; es el nombre real del sprint |
| `ruta` | ruta completa, que es lo que acepta `?sprint=` de `/api/items` |
| `personas` | personas distintas con ítems en el sprint |
| `ultimo_cambio` | `System.ChangedDate` más reciente del sprint; `""` si no hay fechas |
| `sprint_actual` | sprint con el cambio más reciente |

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

## 11. Modelo de errores

Todos los errores siguen el contrato de FastAPI: respuesta JSON con campo
`detail` (string, o array de detalles de validación).

```json
{ "detail": "Azure DevOps no está configurado. Define organizacion, proyecto y PAT en el .env del backend." }
```

### Códigos posibles

| Código | Significado | Origen |
| ------ | ----------- | ------ |
| `200` | OK | — |
| `409` | Configuración ausente (organización, proyecto o PAT) | rutas |
| `404` | La raíz no existe o no se encuentra | rutas |
| `422` | Validación de `{epic_id}` (no entero o no positivo) | FastAPI/pydantic |
| `502` | Error upstream de Azure; 203/204/3xx o JSON inválido | transporte + rutas |
| `500` | Error inesperado (bug) | FastAPI |

> Los endpoints del índice y de la analítica devuelven **listas vacías** en vez
> de error cuando no hay datos (`sprints: []`, `items: []`, `sprints: []` en
> rezago). Un proyecto sin sprints no es un fallo.

> Los errores Azure exponen estado y mensajes seguros; no se devuelve el
> cuerpo upstream. Nunca serializar `Settings` completo.

---

## 12. Ejemplos de uso

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