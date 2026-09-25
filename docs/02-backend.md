# 02 · Backend (Python / FastAPI)

> Referencia archivo por archivo de la API del proyecto. Cada sección explica
> responsabilidad, símbolos públicos y comportamiento. Lee antes
> [Arquitectura](01-arquitectura.md) para el contexto de capas.

Ruta raíz: `backend/`. Se ejecuta con el intérprete del venv
(`backend/.venv/Scripts/python.exe`).

---

## 1. Índice de archivos

| Archivo | Responsabilidad |
| ------- | --------------- |
| `app/config.py` | Configuración tipada leída de variables de entorno / `.env` |
| `app/main.py` | Fábrica `crear_app()`: rutas, CORS, handler de errores Azure, SPA estática |
| `backend/run.py` | Arranque local de uvicorn |
| `app/domain/models.py` | Modelos Pydantic (Epic, Feature, UserStory, Task, EstadoIntegracion) |
| `app/domain/ports.py` | Contratos `Protocol` (Transporte, Repositorio, Caché) |
| `app/application/services.py` | `ServicioBacklog`: listado + árbol + caché |
| `app/infrastructure/azure/transport.py` | Cliente HTTP contra Azure DevOps (única clase que toca red) |
| `app/infrastructure/azure/queries.py` | Constantes WIQL + tipos/campos de Azure |
| `app/infrastructure/azure/repository.py` | Orquesta transporte+queries y mapea a modelos de dominio |
| `app/infrastructure/cache.py` | `CacheMemoria`: diccionario con TTL |
| `app/api/deps.py` | `Depends` para obtener el contenedor y el servicio |
| `app/api/routes.py` | Endpoints HTTP y traducción de errores |
| `app/api/schemas.py` | Esquemas de respuesta de la API |
| `app/core/container.py` | Ensamblado de dependencias reales |
| `app/core/logging.py` | Configuración del logger `devops` |
| `app/__init__.py` etc. | Paquetes vacíos |

---

## 2. Configuración (`config.py`)

Clase `Settings(pydantic.BaseSettings)`. Los campos se llenan **sin distinción
de mayúsculas** desde variables de entorno o el archivo `backend/.env`, cuya
ruta se resuelve respecto al archivo de configuración. Los defaults reales de
organización/proyecto son vacíos.

| Campo | Var. de entorno | Default | Tipo | Uso |
| ----- | --------------- | ------- | ---- | --- |
| `azure_org_url` | `AZURE_ORG_URL` | `""` (plantilla: organización real) | `str` | Organización Azure |
| `azure_proyecto` | `AZURE_PROYECTO` | `""` (plantilla: proyecto real) | `str` | Proyecto donde viven las épicas |
| `azure_pat` | `AZURE_PAT` | `""` | `str` | Personal Access Token (**secreto**) |
| `area_path` | `AREA_PATH` | `""` | `str` | ÁreaPath para filtrar el backlog |
| `host` | `HOST` | `"127.0.0.1"` | `str` | Interfaz de escucha |
| `puerto` | `PUERTO` | `8000` | `int` | Puerto de escucha |
| `origen_cors` | `ORIGEN_CORS` | `"http://localhost:5173"` | `str` (lista separada por comas) | Orígenes CORS extra (propiedad `origenes_cors` los expone como lista) |
| `cache_ttl_seg` | `CACHE_TTL_SEG` | `120` | `int` | TTL de caché en segundos |
| `timeout_seg` | `TIMEOUT_SEG` | `30` | `float` | Timeout HTTP hacia Azure |
| `permitir_externo` | `PERMITIR_EXTERNO` | `false` | `bool` | Permitir binding fuera de loopback; solo con proxy autenticado |
| `log_nivel` | `LOG_NIVEL` | `"INFO"` | `str` | Nivel de logging |

Puntos clave:
- La propiedad `area_path_efectivo` devuelve `AREA_PATH` si viene, si no el
  propio proyecto (el WIQL filtra por área de todas formas).
- `configurado` es `True` solo si hay `org_url` + `proyecto` + `pat`.
- El binding fuera de `127.0.0.1`/`localhost` se rechaza salvo
  `PERMITIR_EXTERNO=true`.
- `azure_pat` se declara con `repr=False` para que no aparezca en `repr`;
  no obstante, un `model_dump()` explícito sí incluiría el valor, así que
  nunca se debe serializar `Settings` completo.
- `origen_cors` es una lista separada por comas; la propiedad
  `origenes_cors` la expone como `list[str]`.

`.env.example` es la plantilla sin secretos; `.env` (con PAT real) está en
el `.gitignore` y **no debe commitearse** (ver [Seguridad](06-seguridad.md)).

---

## 3. Dominio (`domain/`)

### `models.py`

```python
class WorkItemBase(BaseModel):  # campos comunes
                           azure_id: int; titulo: str; estado: str
                           descripcion: str = ""; url: str = ""
class Task(WorkItemBase):    bugs: list[Bug] | None = None
class Bug(WorkItemBase):     prioridad: str = ""; severidad: str = ""
                           asignado_a: str = ""; relacion: str = "hierarchy"
                           tareas: list[Task] = []
class UserStory(WorkItemBase): tareas: list[Task] = []; bugs: list[Bug] | None = None
class Feature(WorkItemBase): hus: list[UserStory] = []
class Epic(WorkItemBase):    features: list[Feature] = []; hus: list[UserStory] = []
class MetricasBug(BaseModel): total: int; abiertos: int; cerrados: int
                           por_estado/prioridad/severidad/relacion: dict[str, int]
class DetalleBugs(BaseModel): bugs: list[Bug]; metricas: MetricasBug
class EstadoIntegracion(BaseModel):
    configurada: bool = False; organizacion: str = ""; proyecto: str = ""
    area_path: str = ""; verificado: bool = False; error: str = ""
```

- `descripcion` es **HTML crudo** entregado por Azure; el frontend lo
  sanitiza con DOMPurify (ver [04-frontend](04-frontend.md) y
  [06-seguridad](06-seguridad.md)). El backend lo entrega sin transformar.
- `url` es el enlace directo al elemento dentro de Azure DevOps; el mapper
  lo completa para épica, Feature, HU y Task, incluido el resumen.

### `ports.py` (contratos)

```python
class TransportePort(Protocol):
    async def get(self, url: str, params: dict | None = None) -> dict
    async def post(self, url: str, body: dict | None = None) -> dict
    async def cerrar(self) -> None

class RepositorioBacklogPort(Protocol):
    async def verificar_proyecto(self) -> dict
    async def listar_epicas(self) -> list[Epic]
    async def obtener_epica(self, epic_id: int, *, incluir_bugs: bool = False) -> Epic | None

class CachePort(Protocol):
    def obtener(self, clave: str) -> Any | None
    def guardar(self, clave: str, valor: Any, ttl_seg: float) -> None
    def limpiar(self) -> None
```

Los protocolos son la frontera de la arquitectura limpia: usar un doble de
cualquiera de ellos en pruebas sustituye la implementación real sin tocar el
caso de uso. `TransportePort` declara `cerrar()` y el lifespan lo invoca en un
`finally`; el repositorio depende del protocolo, no de la clase concreta.

---

## 4. Infraestructura Azure (`infrastructure/azure/`)

### `transport.py` — `AzureTransporte`

| Método | Comportamiento |
| ------ | -------------- |
| `__init__(pat, timeout=30.0)` | Guarda el PAT (nunca se loguea) |
| `async get(url, params)` | `GET` con header `Authorization: Basic base64(":" + pat)` |
| `async post(url, body)` | `POST` con el mismo esquema de auth |
| `async cerrar()` | Cierra el cliente `httpx.AsyncClient` (idempotente) |

- Cliente único `httpx.AsyncClient` reutilizado en todas las llamadas.
- **Traducción de errores**: los errores de red y cualquier estado `>=400` se
  envuelven en `AzureError` con un mensaje seguro según el estado; el cuerpo
  upstream no se devuelve. Los estados HTTP `203`, `204` o redirecciones se
  rechazan como inesperados; también se valida que el JSON sea un objeto.
- Los errores no devuelven el cuerpo upstream y el transporte no registra
  headers ni tiene logging `debug` propio.

### `queries.py` — constantes de Azure

| Constante | Valor / propósito |
| --------- | ----------------- |
| `wiql_epicas(area_path)` | Construye la WIQL de épicas según área (ver [Integración Azure](05-integracion-azure.md)) |
| `TIPOS_HIJOS` / `hijos_permitidos` | Política de descendencia: Epic → Feature/User Story, Feature → User Story, User Story → Task/Bug, Bug → Task |
| `RELACION_HIJO` / `RELACION_RELATED` | Jerarquía `System.LinkTypes.Hierarchy-Forward` y asociación de un salto `System.LinkTypes.Related` |
| `CAMPO_DESCRIPCION` / `CAMPO_TITULO` / `CAMPO_ESTADO` | Nombres de campos canónicos de Azure |
| `CAMPO_PRIORIDAD` / `CAMPO_SEVERIDAD` / `CAMPO_ASIGNADO` | Campos opcionales para métricas y contexto de bugs |

### `repository.py` — `AzureBacklogRepositorio`

Orquesta transporte + queries y **mapea JSON de Azure a modelos Pydantic**:

| Método | Qué hace |
| ------ | -------- |
| `verificar_proyecto()` | `GET /_apis/projects/{proyecto}` → devuelve `{"proyecto": nombre}` |
| `listar_epicas()` | WIQL de épicas → toma IDs → batch de `workitems` (hasta 200) → mapea a `list[Epic]` |
| `obtener_epica(epic_id, incluir_bugs=False)` | BFS de jerarquía; con `incluir_bugs=True` añade Bugs y asociaciones `Related` de un salto. La variante de bugs usa otra clave de caché |

Detalles de robustez:
- El listado usa lotes de hasta **200** IDs, solicita únicamente los campos
  canónicos con `$fields` y no pide relaciones; el árbol sí las expande.
- El BFS procesa todos los hijos de cada nivel en lotes y solo encola IDs que
  Azure devolvió; una respuesta parcial no produce `KeyError`.
- Las rutas de proyecto de Work Items y las URLs de work item usan
  `quote(proyecto, safe='')` mediante un helper único. La verificación de
  proyecto es una operación Core de nivel organización y usa
  `/_apis/projects/{proyecto}` sin anteponer el proyecto.
- El resumen de la lista incluye `url`; también se construyen URLs para
  `Feature`, HU, `Bug` y `Task`.
- El repositorio registra un resumen por carga (`items`, `batches`,
  `hierarchy_edges`, `related_edges`, `bugs`, `duration_ms`) sin incluir el
  PAT ni cuerpos upstream.
- La API exige `epic_id` entero y positivo (`Path(gt=0)`).

---

## 5. Caché (`infrastructure/cache.py`)

`CacheMemoria(CachePort)`:
- Internamente un `dict` con `(clave → (valor, expira_en))`.
- `obtener` devuelve `None` si la clave no existe o está vencida.
- `guardar` recibe `ttl_seg` en segundos y **no copia** el valor; los modelos
  Pydantic son mutables, por lo que un consumidor interno podría alterar una
  entrada cacheada.
- `limpiar` vacía la caché del servicio cuando se llama refresh.

El TTL por defecto del servicio es **120 s** (`CACHE_TTL_SEG`). El repositorio
Azure no mantiene una segunda caché: `ServicioBacklog` es la única capa de
caché en el flujo normal y `refrescar()` la invalida.

---

## 6. Aplicación (`application/services.py`)

`ServicioBacklog` es el **único caso de uso** y **no conoce** azure/HTTP:

```python
async def estado()            -> EstadoIntegracion   # configuración + verificación
async def listar_epicas(incluir_cerradas=False) -> list[Epic]
                              # caché; por defecto excluye estado "Closed"
async def arbol_epica(id, incluir_bugs=False) -> Epic | None
                              # clave "epica:{id}" o "epica:{id}:bugs"
async def bugs_epica(id, incluir_cerradas=False) -> DetalleBugs | None
                              # bugs visibles + métricas del total completo
def    refrescar()            -> None                # caché.limpiar()
```

El filtro de cerradas (`ESTADO_CERRADO = "closed"`, comparado normalizado):

- La caché guarda **siempre la lista completa**; el filtrado se aplica a la
  respuesta, de modo que alternar `incluir_cerradas` no invalida ni re-lee
  de Azure mientras el TTL esté vigente.
- Replica el conteo del backlog del equipo en el portal (120 sin cerradas /
  132 con todo) sin perder la posibilidad de volver a ver las cerradas
  (ver [03-api](03-api.md) y [04-frontend](04-frontend.md)).

Claves de caché normalizadas:

| Clave | Contenido |
| ----- | --------- |
| `CLAVE_EPICAS = "epicas"` | Lista completa de épicas |
| `CLAVE_ARBOL = "epica:{0}"` | Árbol de la épica `{0}` |
| `CLAVE_ARBOL_BUGS = "epica:{0}:bugs"` | Árbol extendido con bugs y tareas de bugs |

- Si el listado aún no está cacheado, la llamada original se hace una vez y
  se vuelca a caché; las siguientes responden desde memoria sin tocar Azure.
- `estado()` nunca rompe: si Azure no responde, devuelve
  `verificado: false` + `error` (para el indicador de la UI).

---

## 7. API (`api/`)

### `deps.py`

- `obtener_contenedor(request) -> Contenedor`: lee `app.state.contenedor`.
- `ServicioDep = Annotated[ServicioBacklog, Depends(...)]`: extrae el servicio
  del contenedor; los tests inyectan fakes vía contenedor de prueba.

### `routes.py` — endpoints

| Endpoint | Método | Respuesta | Error |
| -------- | ------ | --------- | ----- |
| `/api/health` | GET | `Health` | — |
| `/api/azure/estado` | GET | `EstadoAzure` | — |
| `/api/epics` | GET | `ListaEpicas` (query: `incluir_cerradas`, default `false`) | 409 / 502 |
| `/api/epics/{epic_id}/arbol` | GET | `Epic` (query: `incluir_bugs`, default `false`) | 409 / 404 / 502 |
| `/api/epics/{epic_id}/bugs` | GET | `DetalleBugs` (query: `incluir_cerradas`, default `false`) | 409 / 404 / 502 |
| `/api/epics/refresh` | POST | `Mensaje` | — |

Traducción de errores centralizada:
- `_requiere_configuracion`: si `servicio.configurado is False` →
  **HTTP 409** con instrucciones del `.env`.
- `AzureError` → **HTTP 502** con un mensaje seguro (nunca se devuelve el
  cuerpo upstream).
- En el árbol, un 404 de Azure o un resultado `None` se traduce a **HTTP 404**.

### `schemas.py`

| Esquema | Campos |
| ------- | ------ |
| `EpicaResumen` | `azure_id:int, titulo:str, estado:str, url:str` |
| `ListaEpicas` | `epicas: list[EpicaResumen]` |
| `EstadoAzure` | idéntico a `EstadoIntegracion` |
| `DetalleBugs` | `bugs:list[Bug], metricas:MetricasBug` |
| `Mensaje` | `ok:bool, detalle:str` |
| `Health` | `estado:"ok", version:"0.1.0"` |

Nota: las respuestas del listado usan `EpicaResumen` (sin descripción ni
hijos) para no saturar la red — el detalle solo sale en `/arbol`.

---

## 8. Core (`core/`)

### `container.py`

```python
crear_contenedor() -> Contenedor
# 1. Settings
# 2. AzureTransporte(settings.azure_pat, timeout_seg)
# 3. AzureBacklogRepositorio(cfg.azure_org_url, cfg.azure_proyecto, cfg.area_path_efectivo, transporte)
# 4. CacheMemoria()
# 5. ServicioBacklog(repositorio, cache, cfg.cache_ttl_seg, configurado=cfg.configurado, …)
```

`crear_contenedor(settings=…)` acepta settings inyectables para pruebas.
Los tests de API fabrican un `Contenedor` con fakes.

### `logging.py`

- Configura el logger raíz con un nivel y formato con marca de tiempo.
- `main.py` pasa `settings.log_nivel`, por lo que el logger de la aplicación
  y Uvicorn respetan el mismo nivel configurado.
- Logger central: `"devops"`.

---

## 9. Fábrica de la app (`main.py`)

`crear_app(contenedor=None)`:

1. Configura logging y contenedor (por defecto `crear_contenedor()`).
2. `lifespan`: `app.state.contenedor = contenedor`; al apagar cierra el
   `AzureTransporte` si existe (`await transporte.cerrar()`).
3. **CORS**: permite solo `http://{host}:{puerto}` + `origenes_cors`;
   métodos `GET/POST`; headers `Authorization`/`Content-Type`.
4. **Exception handler global de `AzureError`** → `JSONResponse 502`.
   (Las rutas ya traducen los errores; el handler es la red de seguridad.)
5. `include_router(routes.router)`.
6. `_montar_frontend`: si `frontend/dist` existe, lo sirve en `/` como SPA
   estática (`html=True`); en desarrollo (sin `dist`) solo está la API.

`app = crear_app()` a nivel de módulo permite `uvicorn app.main:app`. El cierre
del transporte se ejecuta en un `finally` del lifespan; `TransportePort`
declara `cerrar()` y el repositorio depende del protocolo.

---

## 10. Arranque (`run.py`)

```python
uvicorn.run("app.main:app", host=…, port=…, reload=False)
```

Usa `Settings.host` y `Settings.puerto`. El `.env` se resuelve por ruta
absoluta; ejecutar desde `backend/` sigue siendo la forma documentada. El
proceso no tiene hot reload; para frontend se usa Vite. Un host externo exige
`PERMITIR_EXTERNO=true` y un proxy autenticado.

```powershell
cd backend
.\.venv\Scripts\python run.py
```

---

## 11. Dependencias externas

| Archivo | Contenido |
| ------- | --------- |
| `requirements.txt` | runtime: `fastapi`, `uvicorn[standard]`, `httpx`, `pydantic-settings` |
| `requirements-dev.txt` | fuente de desarrollo: `-r requirements.txt`, `pytest`, `pytest-asyncio`, `pytest-cov`, `pip-audit` |
| `requirements.lock` | resolución reproducible con hashes para CI/instalaciones limpias |

> No hay `ruff`/`black` obligatorios todavía; la suite de pruebas y el
> typechecking de TS son las puertas de calidad actuales.

Siguiente lectura: [03 · API](03-api.md).