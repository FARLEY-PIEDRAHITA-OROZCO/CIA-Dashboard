# 05 · Integración con Azure DevOps

> Cómo el backend lee el backlog real del proyecto y área configurados en
> `backend/.env`. Aplica para cualquiera que toque
> `infrastructure/azure/*` o diagnostique problemas de datos.

---

## 1. Datos del entorno (plantilla sin datos reales)

| Dato | Valor |
| ---- | ----- |
| Organización (org) | `https://dev.azure.com/<organizacion>` |
| Proyecto | `<proyecto>` |
| ÁreaPath por defecto | igual al proyecto (si `AREA_PATH` está vacío el repositorio lo deriva del proyecto) |
| URL del backlog vista en el portal | `https://dev.azure.com/<organizacion>/<proyecto-codificado>/_backlogs/backlog/Épicas` |
| Autenticación | PAT (Personal Access Token) en `backend/.env` → `AZURE_PAT` (ambito `Work Items → Read`) |
| API de Work Item Tracking | versión **7.1** (`API_VERSION`) |

El doble uso de **proyecto** y **ÁreaPath** es clave: el proyecto es el
contenedor de nivel superior de Azure; el ÁreaPath filtra el subconjunto
deseado dentro del proyecto.

---

## 2. Llamadas REST utilizadas

Todas pasan por `AzureTransporte` (`transport.py`), el único punto con red,
con `api-version=7.1` (cuando el endpoint es de WIT).

| Operación | Método y ruta | Uso |
| --------- | ------------- | --- |
| Verificar proyecto | `GET {org}/_apis/projects/{proyecto}?api-version=7.1` | `verificar_proyecto()` — confirmar existencia + permisos de lectura |
| Ejecutar WIQL | `POST {org}/{proyecto}/_apis/wit/wiql?api-version=7.1` body `{"query": "…"}` | `listar_epicas()` — buscar épicas |
| Detallar lote (listado) | `GET {org}/{proyecto}/_apis/wit/workitems?ids=...&$fields=...&api-version=7.1` | resumen sin relaciones (lote de hasta **200** ids) |
| Detallar lote (árbol) | `GET {org}/{proyecto}/_apis/wit/workitems?ids=...&$expand=relations&$fields=...&api-version=7.1` | construcción del árbol (lote de hasta **200** ids) |
| Obtener uno | `GET {org}/{proyecto}/_apis/wit/workitems/{id}?$expand=relations&api-version=7.1` | árbol de una épica (raíz) |

- `verificar_proyecto()` usa el endpoint Core de nivel organización
  (`{org}/_apis/projects/{proyecto}`); no debe anteponerse el proyecto con
  `_ruta_proyecto()` porque esa ruta duplicada responde 401.
- Las rutas de Work Items usan `_ruta_proyecto()`, que aplica
  `urllib.parse.quote(proyecto, safe='')` al segmento del proyecto. El mismo
  helper construye los enlaces editables de los work items.
- `$expand=relations` trae el bloque `relations[]` con los enlaces
  **`System.LinkTypes.Hierarchy-Forward`** que permiten caminar el árbol
  (ver §4).

---

## 3. Consulta WIQL de épicas (`queries.py`)

```sql
SELECT [System.Id], [System.Title], [System.WorkItemType],
       [System.State], [System.Description]
FROM WorkItems
WHERE [System.TeamProject] = @project
  AND [System.WorkItemType] = 'Epic'
  AND [System.AreaPath] UNDER '{area_path}'
ORDER BY [System.Id]
```

Detalles de implementación:

- `@project` lo resuelve la propia WIQL desde el contexto de la URL (por eso
  se hace `POST …/{proyecto}/_apis/wit/wiql`).
- `UNDER '{area}'` trae épicas del área y sus **subáreas**.
- **Escape de comillas simples** (`'` → `''`) en `area_path` para evitar
  inyección WIQL (el área puede contener apóstrofos).
- `ORDER BY [System.Id]` da orden estable.
- La WIQL selecciona cinco campos. El listado usa `$fields` sin relaciones;
  el árbol usa los mismos campos y `$expand=relations`.

---

## 4. Algoritmo del árbol (BFS por lotes)

`AzureBacklogRepositorio.obtener_epica(epic_id)` construye el árbol:

```
raíz = GET workitems/{epic_id}?$expand=relations
por_id = { epic_id: raíz }
pendientes = [epic_id]

mientras pendientes no vacío:
    nivel = extrae todos los IDs pendientes
    nuevos = hijos de cada item del nivel, no vistos
    recibidos = GET workitems?ids=nuevos&$expand=relations&$fields=...
    añadir solo IDs recibidos a por_id
    pendientes.extend(ids que están en por_id)

árbol = _construir_arbol(por_id, epic_id)
```

`_construir_arbol` recorre recursivamente desde la raíz y **solo admite los
tipos permitidos** por `TIPOS_HIJOS`:

| Tipo | Hijos permitidos |
| ---- | ---------------- |
| `Epic` | `Feature`, `User Story` |
| `Feature` | `User Story` |
| `User Story` | `Task` |

Consecuencia directa del diseño:

- Una **Feature** puede tener **User Stories** hijas (`hus`).
- Una **Épica** puede tener **Features** y, además, **User Stories directas**
  (`epic.hus`) — compatibles con backlogs que cuelgan HUs directamente de la
  épica.
- Cada **User Story** puede tener **Tasks** (`hu.tareas`); los tipos no
  permitidos se descartan al construir la salida.
- El recorrido procesa todos los hijos de un nivel en lotes de hasta 200 y
  encola únicamente IDs que Azure devolvió; una respuesta parcial no produce
  `KeyError`.

---

## 5. Mapeo de campos de Azure → dominio

| Campo Azure | Modelo de dominio |
| ----------- | ----------------- |
| `System.Id` | `azure_id: int` |
| `System.Title` | `titulo: str` |
| `System.State` | `estado: str` — **se conserva tal cual** (texto libre; el frontend lo normaliza a tonos) |
| `System.Description` | `descripcion: str` — **HTML crudo**, entregado sin transformar (sanitiza el frontend) |
| relations `Hierarchy-Forward` | `features[]` / `hus[]` / `tareas[]` |
| — | URL local para épica, Feature, HU y Task; el resumen también la incluye |

`queries.campo(item, nombre)` devuelve siempre texto (vacío si el campo no
existe), lo que hace el mapeo robusto ante work items sin descripción.

---

## 6. Discrepancia de conteo con el portal (120 vs 132)

En el entorno observado (snapshot de 2026-09-24), el portal del backlog de
equipo muestra 120 épicas y el sistema 132. Son datos de un entorno concreto,
no un contrato estable: vuelve a medir antes de usarlos como expectativa.

- La WIQL lee **todas** las épicas del proyecto (cualquier estado, cualquier
  iteración): 52 `Active` + 25 `New` + 9 `Doing` + 34 `Resolved` + 12
  `Closed` = **132**.
- El backlog *del equipo* que ves en Azure **oculta las épicas `Closed`** de
  su conteo: **132 − 12 = 120**.
- Las áreas **coinciden** al 100% (las 132 están en
  `<proyecto>`), así que esa hipótesis quedó
  descartada; el mecanismo es el filtro de estado.

Comportamiento del dashboard (configurable):
- Por defecto `GET /api/epics` **excluye** `Closed` (replica el 120).
- Con `GET /api/epics?incluir_cerradas=true` se incluyen (132).
- El frontend expone un toggle «Incluir cerradas» para alternar sin reiniciar
  (ver [03-api](03-api.md) y [04-frontend](04-frontend.md)).

---

## 7. Robustez y límites conocidos

| Situación | Comportamiento |
| --------- | -------------- |
| 0 épicas en el WIQL | lista vacía `200` (la UI muestra "sin datos"), no es error |
| Épica inexistente | un 404 de la raíz se traduce a API 404 |
| Work item no es `Epic` | `AzureError` → `502` ("no es una épica") |
| Área vacía | se usa el proyecto como área (todo el proyecto) |
| Lote mayor a 200 | se parte en bloques de 200 automáticamente |
| Descripción larga HTML | llega completa; la UI la recorta visualmente con CSS (`max-height`) |
| Timeout de Azure | `AzureError` "No se pudo contactar a Azure" → `502` |

---

## 8. Errores HTTP de Azure más comunes (operacional)

| Código de Azure | Causa típica | Acción |
| --------------- | ------------ | ------ |
| `401 Unauthorized` | PAT inválido, vencido o mal seteado en `.env` | regenerar PAT con scope **Work Items: Read**, actualizar `AZURE_PAT` |
| `203 NonexistentField` / `TF401215` | WIQL referencia un campo o proyecto erróneo | revisar campos en `queries.py` y el nombre del proyecto |
| `403 Forbidden` | PAT sin permiso sobre el proyecto | pedir scope de organización/proyecto |
| `404` de proyecto | `AZURE_PROYECTO` mal escrito | verificar en `GET /_apis/projects` |
| Red/SSL | firewall o proxy corporativo | verificar conectividad a `*.visualstudio.com` + puertos |

> El frontend muestra un `detail` seguro con el estado del error; el cuerpo
> upstream no se devuelve. Los logs `devops` no emiten automáticamente un
> detalle DEBUG de cada petición.

---

Siguiente lectura: [06 · Seguridad](06-seguridad.md).