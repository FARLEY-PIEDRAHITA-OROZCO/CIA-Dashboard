# 01 · Arquitectura

> **Resumen**: proyecto independiente de solo lectura que extrae las épicas
> del backlog de **Azure DevOps** (proyecto *CIA — Centro de Inteligencia
> Artificial*) y las presenta en un **dashboard web** con **drill-down**
> completo `Épica → Feature/User Story → Task`.

---

## 1. Stack tecnológico

| Capa | Tecnología | Versión mínima |
| ---- | ---------- | -------------- |
| Backend | Python + FastAPI + httpx + pydantic-settings | Python 3.14 · FastAPI 0.141 · httpx 0.28 · pydantic 2.13 |
| Frontend | React + TypeScript + Vite + TanStack Query + DOMPurify | React 18.3 · TS 5.9 · Vite 5.4 · Query 5.x · DOMPurify 3.4 |
| Pruebas backend | pytest + pytest-asyncio | pytest 9.x |
| Pruebas frontend | Vitest + Testing Library + jsdom | Vitest 2.1 · jsdom 25 |

El backend expone una **API REST** (`/api/*`), sirve el **build estático del
frontend** cuando existe (`frontend/dist`) y documenta la API en
`/docs` (Swagger UI).

---

## 2. Estructura del repositorio

```
CIA-Dashboard/                      # raíz del proyecto
├── README.md                       # hub: guía rápida + acceso a docs/
├── .gitignore                      # excluye .env, .venv, node_modules, dist…
├── docs/                           # ←  esta documentación
│   ├── 00-indice.md … 10-auditoria.md
├── backend/                        # API + lógica de negocio (Python)
│   ├── app/
│   │   ├── main.py                 # fábrica de la app FastAPI
│   │   ├── config.py               # Settings (.env / variables de entorno)
│   │   ├── run.py                  # arranque local (uvicorn)
│   │   ├── domain/                 # modelos + puertos (sin dependencias técnicas)
│   │   ├── application/            # caso de uso ServicioBacklog (caché)
│   │   ├── infrastructure/         # adaptadores: Azure DevOps + caché
│   │   ├── api/                    # routers, esquemas, inyección FastAPI
│   │   └── core/                   # contenedor de dependencias + logging
│   ├── tests/                      # 42 pruebas (sin red)
│   ├── requirements*.txt           # dependencias runtime / dev
│   ├── .env.example                # plantilla de configuración (sin secretos)
│   └── .env                        # secreto local (gitignore; nunca se commitea)
└── frontend/                       # SPA React
    ├── src/
    │   ├── api/                    # cliente HTTP tipado + tipos de dominio
    │   ├── componentes/            # UI genérica (badges, KPI, avisos, sanitizer)
    │   ├── epicas/                 # feature «épicas» (tabla, historias, tareas, páginas, hooks)
    │   ├── navegacion.ts           # enrutado por hash (#/dashboard, #/epicas/{id}, #/epicas/{id}/tareas)
    │   ├── pages/                  # Dashboard (página principal)
    │   └── test/                   # setup de vitest
    └── vite.config.ts              # proxy /api en dev, config de tests; `/docs` no está proxied
```

---

## 3. Diagrama de capas (arquitectura limpia)

La regla de oro: **el flujo de dependencias siempre apunta hacia adentro**
(hacia el dominio). Las capas internas no conocen HTTP, WIQL ni React.

```
                    ┌──────────────────────────────────────────┐
                    │               API (FastAPI)              │
                    │  routes.py · schemas.py · deps.py        │
                    └─────────────▲────────────────────────────┘
                                  │ inyección de dependencias (Depends)
                    ┌─────────────┴────────────────────────────┐
                    │         APLICACIÓN (caso de uso)         │
                    │  ServicioBacklog: listar/árbol + caché    │
                    │  depende de PUERTOS (Protocol), no de…    │
                    └─────────────▲────────────────────────────┘
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        │                    DOMINIO                         │
        │  models.py (Epic/Feature/UserStory/Task)           │
        │  ports.py (Transporte·Repositorio·Cache)  ←contratos│
        └─────────────────────────▲─────────────────────────┘
                                  │ implementación
        ┌─────────────────────────┴─────────────────────────┐
        │             INFRAESTRUCTURA (adaptadores)          │
        │  azure/transport.py  -> HTTP + auth PAT            │
        │  azure/queries.py    -> WIQL + campos              │
        │  azure/repository.py -> árbol del backlog          │
        │  cache.py            -> caché TTL en memoria       │
        │  [futuro] redis.py, auth.py, etc.                  │
        └──────────────────────────────────────────────────┘
```

- **Dominio**: defines el *qué* (modelos) y los *contratos* (puertos).
- **Aplicación**: orquesta los contratos (caché, reglas de negocio).
- **Infraestructura**: implementa los contratos (Azure, caché).
- **API**: traduce HTTP ↔ casos de uso (DTOs, códigos de error).

> La app FastAPI no se inyecta directamente en el dominio: `main.py` solo
> "ensambla" dependencias reales en el **contenedor** (`core/container.py`) y
> se las pasa al servicio. En pruebas se sustituye el contenedor entero por
> uno con doubles.

---

## 4. Flujo de una petición (end-to-end)

```
Browser (React)
   │ 1. GET /api/epics
   ▼
FastAPI route  api_listar_epicas()
   │ 2. ¿configurado?  no → HTTP 409 {detail}
   │ 3. ServicioBacklog.listar_epicas()
   │      ├─ 3a. Caché: ¿hay clave "epicas"?  sí → devolver
   │      └─ 3b. RepositorioAzure.listar_epicas()
   ▼
AzureTransporte.get/post(url)          ← único punto que hace HTTP
   │ 4. POST .../_apis/wit/wiql  (WIQL de épicas)
   │ 5. GET  .../_apis/wit/workitems?ids=…&$expand=relations
   ▼
RepositorioAzure → mapea a Epic/Feature/UserStory/Task (Pydantic)
   ▼
ServicioBacklog → guarda en caché
   ▼
route → ListaEpicas (esquema) → JSON 200
```

El **drill-down** (`GET /api/epics/{id}/arbol`) sigue el mismo camino pero
con el algoritmo de relaciones jerárquicas (ver [Integración Azure](05-integracion-azure.md#4-algoritmo-del-árbol)).

---

## 5. Principios SOLID y cómo se cumplen

| Principio | Aplicación concreta |
| --------- | ------------------- |
| **S** Responsabilidad única | `transport.py` solo hace HTTP; `queries.py` solo WIQL/campos; `repository.py` solo orquesta y mapea; `services.py` solo orquesta caché; `cache.py` solo TTL. En frontend, cada componente hace una sola cosa. |
| **O** Abierto/Cerrado | Los **estados** de Azure son texto libre: un estado nuevo no rompe ni el modelo ni la UI (el badge mapea sinónimos EN/ES y degrada a *neutro*). Para añadir un campo/canal/caché no se modifica el núcleo: se implementa un puerto (ver [Guía de extensión](09-guia-extension.md)). |
| **L** Sustitución de Liskov | Todo adaptador real (`AzureBacklogRepositorio`, `CacheMemoria`, `AzureTransporte`) cumple su `Protocol`; los fakes de prueba son intercambiables y comportan igual. |
| **I** Segregación de interfaces | Puertos pequeños y específicos: `TransportePort`, `RepositorioBacklogPort`, `CachePort`. No existe una interfaz gigante. |
| **D** Inversión de dependencias | `ServicioBacklog` depende de *protocolos*, nunca de httpx/requests/Azure. `main.py` inyecta las implementaciones en el contenedor. |

---

## 6. Decisiones de diseño (ADRs resumidos)

| # | Decisión | Justificación |
| - | -------- | ------------- |
| 1 | **Proyecto independiente** (no módulo de CIA-Gestor) | Aislamiento de ciclos de despliegue, dependencias y pruebas; integración por API. |
| 2 | **Solo lectura** de Azure | El dashboard no muta el backlog: elimina riesgo de corrupción de datos y reduce permisos del PAT a `WorkItems: Read`. |
| 3 | **WIQL + batch de workitems + `$expand=relations`** | Mantiene el árbol real del backlog (jerarquía), sin depender de widgets/analytics de Azure. |
| 4 | **Carga perezosa** (lista sin hijos, árbol bajo demanda) | Listado rápido incluso con cientos de épicas; el árbol solo se paga al expandir. |
| 5 | **Caché TTL por defecto en memoria** | Satisfactorio para uso local; puerto `CachePort` permite swap a Redis sin tocar el dominio (ver [09](09-guia-extension.md#swap-caché-a-redis)). |
| 6 | **Estados como texto abierto** | Las plantillas de proceso de Azure varían (Scrum/Agile/Basic); un enum rompería ante estados nuevos. |
| 7 | **Descripciones HTML sanitizadas con DOMPurify** | Azure guarda la descripción como HTML; se renderiza seguro (XSS) con estilo propio (ver [06-seguridad](06-seguridad.md#3-sanitización-de-contenido)). |
| 8 | **Tres páginas separadas por hash** (`#/dashboard`, `#/epicas/{id}`, `#/epicas/{id}/tareas`) | Las historias y las tareas merecen vistas dedicadas con espacio y filtros propios; el hash no requiere router ni reconfiguración del backend y preserva atrás/compartir. |
| 9 | **Respuestas JSON de dominio = contrato** | Los modelos Pydantic del dominio se reutilizan como esquemas de salida; el mapper construye URLs de todos los niveles y el cliente frontend valida la forma en runtime. |

> **Caché:** el servicio usa `CachePort` como única capa de caché del flujo
> normal; el repositorio ya no mantiene una segunda copia. Refresh invalida
> la caché de aplicación y la siguiente consulta vuelve a Azure.

---

## 7. Mapa de dependencias

### Backend (Python)

```
config.Settings ──► core.container.crear_contenedor()
                        ├─► AzureTransporte(pat)          [ports.TransportePort]
                        ├─► AzureBacklogRepositorio(...)  [ports.RepositorioBacklogPort]
                        ├─► CacheMemoria()                [ports.CachePort]
                        └─► ServicioBacklog(ports...)
main.crear_app(contenedor) ──► api.routes ──► ServicioBacklog
                                   ▲
                                   └── Depends(obtener_contenedor)
```

### Frontend (React/TypeScript)

```
main.tsx ──► QueryClientProvider
  └─► App ──► pages/Dashboard
                ├─► hooks (React Query): useEstadoAzure, useEpicas, useRefrescar
                ├─► componentes: Kpi, EstadoTrabajo, Cargando/ErrorAlerta/CajaVacia
                └─► epicas/TablaEpicas
                      └─► epicas/FilaEpica ──► useArbolEpica(expandida) ──► DetalleEpica
                            ├─► #/epicas/{id} → PaginaEpica → TableroHistorias
                            └─► #/epicas/{id}/tareas → PaginaTareas → TableroTareas
                              Componentes de dominio solo reciben props y devuelven eventos.
```

---

## 8. Convenciones del proyecto

- **Idioma**: nombres de módulos, clases y variables en español (dominios de negocio también). Identificadores de librerías en inglés.
- **Backend**: `async/await` en todo transporte; *type hints* completos; *docstrings* con la responsabilidad de cada símbolo; `Protocol` para puertos.
- **Frontend**: componentes con *props* tipadas; lógica de datos en hooks de React Query; *presentación pura* (los componentes no llaman a `fetch`).
- **Pruebas**: sin red (doubles); cada suite aísla una capa.
- `format` / `lint`: ninguno impuesto todavía; el *typecheck* de TS (`tsc -b`) y la corrección de Python los verifica la suite. (Ver [07-pruebas](07-pruebas.md)).

---

Siguiente lectura: [02 · Backend](02-backend.md) o [03 · API](03-api.md).