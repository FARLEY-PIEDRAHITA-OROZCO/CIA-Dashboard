# 10 · Auditoría técnica y operativa

> **Fecha:** 2026-09-24; **actualizado:** 2026-09-25
> **Alcance:** backend FastAPI, integración Azure DevOps, SPA React/Vite, pruebas, dependencias, seguridad, despliegue y documentación.
> **Regla de evidencia:** el código ejecutable, los manifiestos y los comandos de verificación prevalecen sobre la documentación existente.

## Actualización 2026-09-25

- Se corrigió `verificar_proyecto()` para usar el endpoint Core de organización
  `/_apis/projects/{proyecto}`; la ruta anterior duplicaba el proyecto y Azure
  respondía 401. Se añadió una prueba de regresión de URL.
- Se verificó la integración real: `/api/azure/estado` devuelve
  `verificado: true` con la configuración local.
- Se actualizaron las acciones de CI a versiones con runtime Node 24.
- Se añadió `frontend/public/favicon.svg` y su declaración en `index.html`.
- Se incorporó el grafo de bugs: `Bug` puede ser hijo de una HU y padre de
  tareas; también se cargan asociaciones `Related` de un salto. La API ofrece
  `incluir_bugs` y un endpoint de métricas.
- Se añadió **buscador de épicas** al dashboard: filtrado local por título, ID
  y estado, tolerante a acentos y mayúsculas, con resaltado `<mark>`, contador
  de resultados, atajo `/` y limpieza con `Escape`. No genera peticiones a
  Azure: opera sobre la lista ya cargada.
- Se sustituyeron los enlaces sueltos por una **barra de navegación global**
  (`NavegacionGlobal`) presente en todas las páginas: acceso a épica,
  historias, tareas y bugs con `aria-current`, refresco global, salud y API.
  El botón de refresco se unificó (ya no se duplica en el dashboard).
- Se añadió la **escritura QA opt-in** (ADR-11): `PATCH /api/workitems/{id}`
  para tags, estado, prioridad/severidad y notas QA. Sigue siendo de solo
  lectura por defecto (`ESCRITURA_HABILITADA=false`), exige un PAT dedicado y
  se niega a arrancar con binding externo. Notas QA son append-only y el texto
  se escapa antes de incrustarse en el HTML de Azure.
- La documentación y las fixtures usan ahora organización/proyecto de ejemplo;
  el repositorio es público y no contiene credenciales.

## 1. Dictamen ejecutivo

El sistema tiene una base sólida para su uso local: la separación de capas es consistente, el PAT no sale del backend, el HTML de Azure pasa por DOMPurify y las suites locales pasan sin acceder a la red. La remediación progresiva ya resolvió los defectos funcionales de mayor impacto y las vulnerabilidades del tooling frontend. Sin embargo, **no está listo para exposición directa en una red externa** porque todavía no existe autenticación/rate limiting y quedan controles de operación pendientes.

Estado actual prioritario:

1. `vite`/`vitest` actualizados; `npm audit` completo queda en cero.
2. BFS, URLs de resumen/features, refresh de caché, validación de respuestas, logging y lifecycle fueron corregidos con pruebas de regresión.
3. El colapso del tablero, KPIs, estados de carga, enlaces sin descripción, parser de hash, cancelación, retry selectivo y etiquetas HTML activas fueron corregidos.
4. Python ya tiene lockfile con hashes y el binding externo exige opt-in; no hay readiness, autenticación ni rate limiting externo configurados.
5. La verificación real contra Azure se comprobó el 2026-09-25; las pruebas
   automatizadas siguen siendo sin red por diseño.

La documentación tiene deriva histórica que esta remediación corrige: rutas,
árbol, defaults, conteos de pruebas, caché, errores, toolchain y operación
describen el código ejecutable. Los puntos abiertos y criterios de aceptación
están debajo.

## 2. Método y límites

Se leyeron `README.md`, `AGENTS.md`, todos los documentos de `docs/`, manifiestos/lockfiles, configuración de Vite/TypeScript/Pytest y los entrypoints y adaptadores principales. Se inspeccionaron también las pruebas y los puntos de integración Azure/React Query.

Comandos ejecutados:

```powershell
# Backend
cd backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pip_audit --local

# Frontend
cd frontend
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
npm.cmd audit --audit-level=moderate
npm.cmd ls --depth=0
npm.cmd outdated --depth=0
```

Se ejecutó una llamada real controlada a Azure DevOps el 2026-09-25 para
verificar la operación de `/api/azure/estado`; las pruebas automatizadas siguen
sustituyendo transporte/repositorio y no dependen de un PAT real. `pip-audit` ya
está incluido en el lockfile y pasa; `ruff`/`mypy` siguen sin configurarse. El
repositorio tiene metadata Git y CI está definido en
`.github/workflows/ci.yml`.

## 3. Mapa técnico confirmado

### Backend

```text
run.py → app.main:app
  API (routes/schemas/Depends)
    → ServicioBacklog
      → puertos Protocol
        → AzureBacklogRepositorio → AzureTransporte → Azure DevOps
        → CacheMemoria
```

- `app/config.py` carga variables de entorno y `backend/.env` mediante una ruta absoluta.
- `app/main.py` ensambla el contenedor, configura CORS, monta `frontend/dist` si existe y cierra el transporte en el lifespan.
- `app/infrastructure/azure/repository.py` hace WIQL, lotes de hasta 200 work items, BFS de relaciones y mapeo a Pydantic.
- El árbol efectivo es `Epic → Feature/User Story → Task`; las HUs directas de la épica también se soportan.
- Hay una única caché de aplicación (`CachePort`, TTL configurable); el
  repositorio no mantiene una segunda copia.

### Frontend

- `src/main.tsx` crea el `QueryClient` y monta `App`.
- La navegación es por hash, sin `react-router`.
- `src/api/cliente.ts` es la única costura de red y usa rutas relativas `/api`.
- `epicas/hooks.ts` contiene las queries de estado, lista, árbol y refresh.
- Las vistas actuales son `Dashboard`, `PaginaEpica` y `PaginaTareas`.
- `ContenidoRico` es la única frontera permitida para descriptions HTML.

## 4. Verificación reproducible

| Comprobación | Resultado | Observación |
| --- | --- | --- |
| Backend pytest | **102 passed** | Sin red; aparece un warning de deprecación de Starlette/httpx en `TestClient`. |
| Frontend Vitest | **104 passed / 17 files** | Incluye regresiones de Dashboard, API, rutas, navegación global, tareas, bugs y sanitización. |
| Frontend build | **PASS** | `tsc -b` y `vite build`; bundle generado correctamente. |
| `pip check` | **PASS** | No hay requisitos Python rotos en el entorno auditado. |
| `pip-audit --local` | **PASS** | Sin vulnerabilidades conocidas en el lockfile instalado. |
| `npm audit --omit=dev` | **0 vulnerabilidades** | No se observan vulnerabilidades en dependencias de producción. |
| `npm audit --audit-level=high` | **0 vulnerabilidades** | Vite/Vitest actualizados; la auditoría de producción también queda en cero. |
| CI/lint/format/typecheck Python | **CI parcial** | CI ejecuta pytest, auditorías, tests y build; aún no hay lint/typecheck Python. |

### Alineación aplicada

- Se añadió este informe y se enlazó desde `README.md` y `docs/00-indice.md`.
- Se actualizaron las referencias de rutas, árbol `Task`, pruebas, defaults, caché, logging, CORS y despliegue en `docs/01`–`docs/09`.
- Se añadió `backend/requirements.lock` con hashes y `pip-audit`; CI instala
  ese lockfile y ejecuta la auditoría.
- Se añadió el patrón `*.tsbuildinfo` y se ampliaron las reglas de `.env` en `.gitignore`, conservando `.env.example`.
- `AGENTS.md` apunta a este informe y refleja el estado actual de logging, caché y la falta de cobertura.
- Se aplicaron correcciones funcionales y de seguridad en backend/frontend:
  toolchain, BFS, URLs, caché, errores, lifecycle, headers, validación,
  cancelación/retry, tareas, KPIs y sanitización; se añadieron regresiones.
  Permanecen abiertos controles de exposición, lint/typecheck Python,
  readiness y cobertura browser/real.
- Se actualizaron las páginas de arquitectura, backend, API, frontend, Azure,
  seguridad, pruebas, despliegue y extensión para reflejar el código ya
  remediado.

## 5. Hallazgos

### Prioridad alta

#### AUD-01 — Vulnerabilidades en Vite/Vitest/esbuild

**Estado:** resuelto. `vite@6.4.3` y `vitest@4.1.11` están en el
manifiesto/lockfile; `npm audit` completo queda en cero.

La auditoría original de `npm audit` reportó:

- `vitest` / `@vitest/mocker`: `GHSA-5xrq-8626-4rwp` y `GHSA-82fw-gwwq-j7x9`.
- `vite`: `GHSA-fx2h-pf6j-xcff` y `GHSA-67mh-4wv8-2f99`, más la
  dependencia vulnerable de `esbuild`.

El riesgo principal estaba en el servidor de desarrollo y el tooling de
pruebas. La actualización se validó con las 102 y 104 pruebas y el build actuales;
el servidor de Vite debe seguir enlazado a loopback.

#### AUD-02 — BFS falla si Azure omite una relación hija

**Estado:** resuelto. El BFS procesa por niveles, encola únicamente IDs
recibidos y tiene una prueba para hijos omitidos.

#### AUD-03 — El listado de épicas pierde la URL

**Estado:** resuelto. Existe un helper único de URL, el resumen incluye
`url`, `Feature` tiene `url` y todos los niveles usan el proyecto codificado.

#### AUD-04 — Collapse irreversible en `TableroTareas`

**Estado:** resuelto. La cabecera permanece montada y solo se oculta el
cuerpo; existe una prueba de colapso y expansión.

### Prioridad media

#### AUD-05 — Refresh no invalida la caché del repositorio

**Estado:** resuelto. Se eliminó la caché interna del repositorio; el
servicio es la única capa de caché y `refrescar()` invalida la lectura siguiente.

#### AUD-06 — Configuración depende del directorio actual

**Estado:** resuelto. `config.py` resuelve `backend/.env` mediante una ruta
absoluta y las pruebas verifican el comportamiento.

#### AUD-07 — KPIs no usan la normalización de estados

**Estado:** resuelto. Los KPIs usan `tonoEstado` y `Dashboard.test.tsx` cubre
`Active`, `Doing` y `Resolved`.

#### AUD-08 — Enlace a Swagger roto en desarrollo

**Estado:** resuelto. Vite proxya `/docs` y `/openapi.json` al backend.

#### AUD-09 — Las URLs de proyecto no se codifican de forma uniforme

**Estado:** resuelto. `AzureBacklogRepositorio` centraliza el segmento de
proyecto con `quote(..., safe="")` para Work Items y usa el endpoint Core de
organización para verificar el proyecto.

#### AUD-10 — El batch “liviano” solicita más campos de los necesarios

**Estado:** resuelto. El listado usa `$fields` y no solicita relaciones;
el árbol solicita únicamente los campos canónicos y relaciones.

#### AUD-11 — Detalles upstream se devuelven al cliente

**Estado:** resuelto. El transporte ya no devuelve el cuerpo upstream; los
errores públicos incluyen estado y mensajes seguros.

#### AUD-12 — La aplicación no tiene control de acceso propio

**Estado:** parcial; la autenticación, TLS y rate limiting siguen abiertos y
son bloqueantes para exposición externa.

La API y Swagger están abiertos a cualquier cliente que alcance el proceso. El
listener local, CORS, headers básicos y el guard `PERMITIR_EXTERNO` reducen
riesgo, pero CORS no es autenticación. `HOST=0.0.0.0` sin proxy, TLS,
OIDC/Basic y rate limiting expone el backlog.

Esto es un **bloqueante de despliegue externo**, no un defecto para el modo local. Mantener el bind local como default y documentar el proxy como requisito de producción.

#### AUD-13 — Dependencias Python no están bloqueadas

**Estado:** parcial. `requirements.lock` fija resolución y hashes y
`pip-audit --local` pasa; todavía faltan lint y typecheck Python como gates.

#### AUD-14 — Cobertura de pruebas incompleta para superficies de alto riesgo

**Estado:** parcial.

Se añadieron regresiones para BFS con hijos omitidos, URLs, IDs,
respuestas no JSON/203, lifecycle, headers, Dashboard, API client, cancelación,
parser, tareas (incluida la página integrada), CORS y errores de estado sin
exposición de detalles. Todavía faltan readiness, axe/browser y un entorno
Azure real.

#### AUD-15 — Clasificación de errores Azure y logging insuficientes

**Estado:** resuelto. El transporte clasifica estados y forma JSON, la API
mapea 404 de árbol, `LOG_NIVEL` se aplica al logger y existen regresiones.

#### AUD-16 — Cleanup y contratos de puertos incompletos

**Estado:** resuelto. `TransportePort` declara `cerrar()`, el lifespan usa
`try/finally` y el repositorio depende del protocolo.

#### AUD-17 — Estados de carga, retry y cancelación del frontend

**Estado:** resuelto. El cliente valida el contrato, propaga `AbortSignal`,
React Query reintenta solo errores transitorios y Dashboard distingue carga de
configuración no disponible.

#### AUD-18 — Enlaces, navegación y accesibilidad incompletos

**Estado:** parcial. Se corrigieron enlaces sin descripción, navegación a
tareas, parser, roles, contraste, `caption/scope`, saltos de línea, scroll de
la tabla y el foco al cambiar de hash; falta una auditoría axe/browser que
confirme teclado y lector de pantalla.

#### AUD-19 — Contenido activo permitido por DOMPurify

**Estado:** resuelto. La configuración bloquea etiquetas activas y recursos
externos, y hay una prueba específica para evitar regresiones.

#### AUD-20 — Bugs y tareas bajo bugs no se representaban

**Estado:** resuelto. La política de descendencia incluye `User Story → Bug →
Task`; las asociaciones `Related` se cargan de un solo salto, se deduplican
y no siguen backlinks. La API conserva `incluir_bugs=false` por defecto y
ofrece una proyección con métricas.

### Riesgo operativo y mantenimiento

- `npm outdated` muestra actualizaciones mayores disponibles; no se aplican automáticamente porque pueden cambiar la API de Vite/Vitest.
- Pytest emite un warning de deprecación de `starlette.testclient` respecto a
  la recomendación de `httpx2`.
- CI instala el lock, ejecuta `pip check`, `pip-audit`, pytest, `npm ci`, tests,
  build y `npm audit`; no hay pre-commit, Dockerfile, migraciones ni
  configuración de despliegue.
- Las cachés son locales a cada proceso; con múltiples workers no hay invalidación compartida.
- El healthcheck es de proceso, no de conectividad Azure; no usarlo como readiness de Azure.
- El repositorio es público; la documentación, `.env.example` y las fixtures
  usan datos de ejemplo. No se versionaron PATs ni otros secretos.

## 6. Controles que sí están bien alineados

- El PAT se declara con `repr=False`, se configura en el entorno backend (normalmente `backend/.env` ignorado) y solo se usa en el transporte.
- La organización Azure exige `https://`; el PAT es de solo lectura y no se transforma en credencial de navegador.
- `httpx.RequestError`, estados HTTP y formas JSON inválidas se traducen a
  `AzureError` sin imprimir headers ni cuerpos upstream.
- DOMPurify se aplica antes del único `dangerouslySetInnerHTML`; se bloquean
  etiquetas activas/recursos y `FORBID_ATTR: ["style", "srcset", "formaction"]`
  está cubierto por pruebas.
- Las pruebas no llaman a Azure: usan `SabanaTransporte`, `FakeRepositorio` y `TestClient`.
- El frontend no contiene URLs de API absolutas ni llamadas `fetch` fuera de `api/cliente.ts`.
- El listado de épicas es perezoso para los árboles y el BFS batchea IDs de hasta 200.
- `npm audit` y `pip-audit --local` pasan en el entorno auditado.

## 7. Plan de remediación

### Pendientes antes de exponer o depender operativamente

1. Añadir autenticación/TLS/rate limiting mediante el reverse proxy o definir
   una arquitectura de autenticación propia.
2. Añadir lint y typecheck Python como gates.
3. Añadir readiness separada de liveness y una prueba de despliegue real.

### Pendientes de calidad

1. Ejecutar auditoría axe/browser y validar el foco al cambiar de hash.
2. Probar SPA estático y readiness; CORS ya tiene regresión de origen permitido/rechazado.
3. Resolver los warnings de deprecación de Starlette/httpx.

## 8. Criterios de cierre recomendados

- `backend`: `pytest`, `pip check` y auditoría de dependencias en verde.
- `frontend`: `npm ci`, `npm.cmd test`, `npm.cmd run build` y `npm audit` completo en verde.
- Pruebas de regresión para todos los hallazgos P1/P2 cerrados.
- Documentación, `AGENTS.md` y README describen el comportamiento real, incluyendo limitaciones conocidas.
- El procedimiento de despliegue exige reverse proxy con TLS/autenticación si el listener no permanece en `127.0.0.1`.

Para el detalle operativo de la corrección de caché, refresh y dependencias, consultar el código y la documentación de este repositorio; no asumir que una prueba verde cubre una integración Azure real.
