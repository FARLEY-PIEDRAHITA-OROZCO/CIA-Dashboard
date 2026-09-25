# 09 · Guía de extensión

> Recetas paso a paso para agregar funcionalidad **sin romper la
> arquitectura** (capas backend, puertos, React Query y componentes). Cada
> receta indica los archivos a tocar y qué pruebas agregar.

Índice:
1. [Nuevo campo de Azure (p. ej. `Effort`)](#1-nuevo-campo-de-azure)
2. [Nuevo nivel del árbol (p. ej. `Test Plan`)](#2-nuevo-nivel-del-árbol)
3. [Nuevo endpoint en el backend](#3-nuevo-endpoint-en-el-backend)
4. [Nuevo KPI / métrica en el dashboard](#4-nuevo-kpi--métrica)
5. [Nueva página o sección (hash navigation)](#5-nueva-página-o-sección)
6. [Swap de caché a Redis](#6-swap-de-caché-a-redis)
7. [Autenticación propia en el backend](#7-autenticación-propia)
8. [Más niveles / tipos de work item (Ej.: `Test Plan`)](#8-más-tipos-de-work-item)

---

## 1. Nuevo campo de Azure

Ejemplo: traer `Microsoft.VSTS.Scheduling.Effort` al modelo.

**Backend**
1. `queries.py`: añadir constantes
   ```python
   CAMPO_ESFUERZO = "Microsoft.VSTS.Scheduling.Effort"
   ```
   e incluir el campo en `wiql_epicas` (cuando toque filtrar/ordenar) o en
   `CAMPOS_LISTADO`/`CAMPOS_ARBOL` para el batch. El repositorio usa `$fields`
   explícito y solo añade `$expand=relations` al árbol.
2. `domain/models.py`: añadir el atributo al modelo (con default seguro):
   ```python
   class Feature(BaseModel):
       ...
       esfuerzo: float = 0.0
   ```
3. `repository.py`: mapearlo en `_a_epica` / `_construir_arbol`
   (`queries.campo(...)` o parseo numérico tolerante).

**Frontend**
4. `frontend/src/api/tipos.ts`: añadir `esfuerzo?: number` a las interfaces.
5. `frontend/src/api/cliente.ts`: actualizar los validadores runtime; las
   interfaces por sí solas no protegen el contrato.
6. Mostrarlo donde aplique (p. ej. en `DetalleEpica`/`FilaEpica`).

**Pruebas**
7. `test_repositorio.py`: en `item_azure`/caso verificar que el campo se
   mapea; frontend: caso de render con el nuevo valor.

---

## 2. Nuevo nivel del árbol

El soporte de `Task` bajo cada `User Story` y `Bug` bajo cada `User Story` ya
está implementado. Para añadir un tipo adicional (por ejemplo `Test Plan`):

1. `queries.py`: añadir el tipo a `TIPOS_HIJOS` y, si hace falta, una función
   de extracción de relaciones/campos.
2. `domain/models.py`: crear el modelo de dominio con defaults seguros y
   anidarlo bajo el nivel correspondiente.
3. `repository.py`: construir/mapear el nodo en `_construir_arbol` y `_a_epica`.
4. `frontend/src/api/tipos.ts`, `frontend/src/api/cliente.ts` (validadores
   runtime) y el tablero/componente correspondiente: reflejar el nuevo
   contrato sin hacer fetch desde componentes de presentación.
5. Pruebas: ampliar `_backlog_completo()` y añadir un caso frontend de la
   nueva ruta/columna.

> **Advertencia**: cada nivel +1 puede multiplicar llamadas/JSON. El BFS por
> lotes de 200 procesa niveles completos y encola solo IDs recibidos; al
> añadir un tipo, conserva esa protección y añade una prueba de respuesta
> parcial.

---

## 3. Nuevo endpoint en el backend

1. `api/routes.py`:
   ```python
   @router.get("/api/epics/estadisticas", response_model=Estadisticas, tags=["Epicas"])
   async def api_estadisticas(servicio: ServicioDep) -> Estadisticas:
       _requiere_configuracion(servicio)
       try:
           return await servicio.estadisticas()
       except AzureError as exc:
           raise _error_azure(exc)
   ```
2. Si agrega lógica de negocio (no solo transformar datos), añadirlo a
   `ServicioBacklog` (caso de uso), **no** a la ruta (mantiene el flujo de
   dependencias → dominio).
3. `api/schemas.py`: nuevo modelo de respuesta.
4. `frontend/src/api/tipos.ts` y `frontend/src/api/cliente.ts` (validadores
   runtime) para el nuevo contrato; `epicas/hooks.ts` si requiere otra query.
5. Pruebas: `test_api.py` (status + contrato) y, si hay lógica, `test_servicio.py`.

---

## 4. Nuevo KPI / métrica

Los KPIs viven en `pages/Dashboard.tsx` (cálculo a partir de
`useEpicas().data.epicas`).

```tsx
const enCurso = epicas.filter((e) => tonoEstado(e.estado) === "progreso").length;
<Kpi etiqueta="En curso" valor={enCurso} />
```

1. Calcular la métrica en `Dashboard` (componente, no hook nuevo salvo que
   requiera más datos).
2. Si la métrica es compleja/agrega estado, moverla a un helper puro y
   probarlo (frontend `*.test.ts` junto al campo del cálculo).
3. `Kpi` acepta `etiqueta, valor, tono? ("ok"|"alerta"|"acento"|"neutro"),
   titulo?`.

---

## 5. Nueva página o sección

El proyecto navega por **hash** (`navegacion.ts`): `Destino` incluye
`dashboard`, `epica` y `epicaTareas`. Para sumar una página nueva:

1. En `navegacion.ts`, ampliar el tipo unión y `parsearHash`:
   ```ts
   export type Destino =
     | { pagina: "dashboard" }
     | { pagina: "epica"; azureId: number }
     | { pagina: "epicaTareas"; azureId: number }
     | { pagina: "azur" };
   // parsearHash: if (partes[0] === "azur") return { pagina: "azur" };
   ```
   `irA`/`enlaceA` se derivan de `aRuta` (añadir el caso del hash).
2. En `App.tsx`, decidir la página:
   ```tsx
   vista.pagina === "azur" ? <EstadoAzurePage /> : <Dashboard />
   ```
   Las páginas nuevas van en `src/pages/`; si comparten datos, la caché de
   React Query ya los resuelve.
3. `src/pages/Dashboard.tsx`, que al agregar una sección propia,
   recalcula los KPIs (ver §4).
4. Pruebas: `navegacion.test.tsx` (parsing del nuevo hash) + un caso de
   render en el archivo de la página nueva.

---

## 6. Swap de caché a Redis

La caché está detrás del puerto `CachePort` → sustituir no toca el dominio.
El puerto actual es síncrono; una implementación Redis async necesita un
adaptador síncrono seguro o una decisión explícita para hacer el puerto async.
Redis no está implementado ni conectado en el contenedor actual.

1. Crear `backend/app/infrastructure/redis_cache.py`:
   ```python
   class CacheRedis:
       def __init__(self, client): ...  # redis.asyncio
       def obtener(self, clave):
           # get + deserializar (JSON: usar .model_dump_json() de pydantic)
       def guardar(self, clave, valor, ttl_seg): ...  # redis.setex
       def limpiar(self): ...                          # redis.flushdb
   ```
2. `core/container.py`: instanciar `CacheRedis` (si `REDIS_URL`), si no,
   `CacheMemoria` (fallback). Propiedad `REDIS_URL` en `config.py`.
3. Las claves (`epicas`, `epica:{id}`) se reutilizan; **último cambio**:
   serializar/deserializar `Epic` con pydantic (`model_dump_json` /
   `model_validate_json`).
4. Pruebas: doble/live de `CacheRedis` fuera de red; el `test_servicio.py`
   sigue verde porque `ServicioBacklog` solo ve el puerto.

---

## 7. Autenticación propia

La app hoy depende del PAT del backend (ver [06-seguridad](06-seguridad.md)).
Para usuarios del dashboard:

1. En el reverse proxy (nginx/Caddy): OIDC o Basic + TLS con lista de
   usuarios, o…
2. En la app: middleware FastAPI antes de `include_router`:
   ```python
   @app.middleware("http")
   async def auth(request: Request, call_next):
       # validar header Authorization / cookie de sesión
       # → 401/403 si no es válido
   ```
   Usar `HTTPBearer`+`Depends` en `deps.py` si se prefiere atar a rutas.
3. NUNCA reutilizar `AZURE_PAT` del backend como credencial de usuario.

Pruebas: `test_api.py` con y sin credenciales.

---

## 8. Más tipos de work item

Ejemplo: traer `Test Plan` como hoja de la épica además de Features.

1. `queries.py`: `TIPOS_HIJOS = {"Epic": ("Feature", "User Story", "Test Plan")}`.
2. `_construir_arbol`: agregar una rama `test_plans` si `"Test Plan"`
   pertenece a `permitidos`.
3. `epica_canonica()`/`_backlog_completo()` en pruebas: incluir un `Test Plan`
   y verificar que se incorpora (y que los `Task` existentes siguen incluidos).

> Regla general: cualquier tipo nuevo se agrega con los mismos 3 pasos
> (constante de permisos, construcción del nodo, mapeo/UI) sin tocar el
> dominio abstracto.

---

## Checklist de extensión

- [ ] El cambio no rompe el flujo de dependencias (capas hacia adentro).
- [ ] Los nuevos campos tienen default seguro (backend no debe reventar ante
      work items incompletos).
- [ ] La UI sanitiza cualquier contenido HTML nuevo (`ContenidoRico`).
- [ ] No se commitearon `.env`/secretos.
- [ ] Backend `pytest`, frontend `npm.cmd test` y `npm.cmd run build` verdes.
- [ ] Se consultó `docs/10-auditoria.md` y se actualizó cualquier supuesto afectado.