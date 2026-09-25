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
| GET | `/api/epics/{epic_id}/arbol` | Árbol completo Épica → Features/User Stories → Tasks | estable |
| POST | `/api/epics/refresh` | Invalida la caché de aplicación; la siguiente consulta vuelve a Azure | estable |

> No requiere autenticación propia (aplicación local; el secreto vive en el
> backend). Para exponerla, ver [08-despliegue](08-despliegue.md) y
> [06-seguridad](06-seguridad.md).

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

Árbol jerárquico completo de la épica para el **drill-down**:

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
- `Task` solo se materializa cuando es hija de una `User Story`; los tipos
  no permitidos se descartan durante la construcción del árbol.
- Épica sin features ⇒ `features: []`; sin historias/tareas ⇒ listas vacías.

**Errores**

| Código | Caso | Cuerpo `detail` (ejemplo) |
| ------ | ---- | ------------------------- |
| `409` | Configuración incompleta (organización, proyecto o PAT) | instrucciones de `.env` |
| `404` | la API recibió `None` del repositorio | `"Épica 999999 no encontrada."` |
| `502` | error de red/HTTP/JSON del adaptador, incluidos estados 203/204/3xx | mensaje seguro con estado; no se devuelve el cuerpo upstream |

---

## 6. `POST /api/epics/refresh`

Invalida la caché de aplicación. La **próxima** consulta a `/api/epics` o
`/api/epics/{id}/arbol` vuelve a leer de Azure.

**200 OK**
```json
{
  "ok": true,
  "detalle": "Caché invalidada. La próxima consulta leerá de Azure."
}
```

> La invalidación es global por diseño. Un GET individual de una épica ya
> cacheada no se invalida con query params.

---

## 7. Modelo de errores

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

> Los errores Azure exponen estado y mensajes seguros; no se devuelve el
> cuerpo upstream. Nunca serializar `Settings` completo.

---

## 8. Ejemplos de uso

### PowerShell
```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/epics
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8000/api/epics/5586/arbol
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/epics/refresh
```

### curl
```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/azure/estado
curl http://127.0.0.1:8000/api/epics/5586/arbol
```

### Swagger / OpenAPI
- UI interactiva: `http://127.0.0.1:8000/docs`
- Spec JSON: `http://127.0.0.1:8000/openapi.json`

---

Siguiente lectura: [04 · Frontend](04-frontend.md).