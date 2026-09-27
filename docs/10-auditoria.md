# 10 · Auditoría técnica y operativa

> **Fecha:** 2026-09-24; **actualizado:** 2026-09-26
> **Alcance:** backend FastAPI, integración Azure DevOps, SPA React/Vite, pruebas, dependencias, seguridad, despliegue y documentación.
> **Regla de evidencia:** el código ejecutable, los manifiestos y los comandos de verificación prevalecen sobre la documentación existente.

## Actualización 2026-09-26 — Sprints, personas y analítica QA

Se añadió una segunda superficie de producto, toda de **solo lectura**, servida
por un índice local de work items. Plan completo y trazabilidad en
`~/.opencode/plan/sprints-personas-analitica-qa.md`.

- Se expuso `System.IterationPath`, `System.AssignedTo`, `System.CreatedDate` y
  `System.ChangedDate` en el árbol, el listado y el índice. `WorkItemBase` lleva
  ahora `sprint`, `asignado_a` (`Persona` por GUID, no por nombre), `creado` y
  `modificado`. **Cambio de contrato:** `Bug.asignado_a` pasa de `string` a
  `Persona | null`, y `tipos.ts`, los validadores y los componentes se
  actualizaron en el mismo commit.
- `RepositorioBacklogPort.listar_work_items(tipos)` hace la lectura en dos pasos
  (WIQL para los ids, lotes de 200 con `$fields`) y devuelve modelos de dominio.
  `IndiceWorkItems` cachea la proyección con `asyncio.Lock` y filtra en memoria.
- Endpoints nuevos: `GET /api/sprints`, `/api/personas`, `/api/items`,
  `/api/analitica/verificacion`, `/api/analitica/aging`,
  `/api/analitica/rezago`. `POST /api/epics/refresh` y
  `PATCH /api/workitems/{id}` invalidan también el índice.
- Vistas nuevas: `#/sprints` (catálogo + filtros combinables) y `#/analitica`
  (las tres señales). Los filtros viajan en la query del hash, así que la URL
  filtrada es compartible sin usar las queries guardadas de Azure DevOps.
- **Restricciones de la API verificadas, no supuestas:** la API de iteraciones
  responde **401** con un PAT de lectura (no hay fechas de sprint);
  `[System.IterationPath] <> ''` devuelve 0 e `IS NOT EMPTY` da error 400 (no se
  pueden enumerar sprints); `[System.Tags] CONTAINS 'x'` devuelve 0 (los tags no
  se filtran en el servidor); WIQL no devuelve valores de campo, solo ids. De ahí
  que el índice local no sea una optimización sino la única arquitectura posible.
- **Medido sobre el proyecto real:** 5.651 ítems indexados, carga en frío 7,4–10 s,
  consultas posteriores 11–31 ms, 37 sprints, 35 personas. ① 136 de 143 bugs
  cerrados sin verificación QA, 410 historias cerradas sin evidencia, ② 84
  inactivos y 578 en curso, ③ 594 ítems rezagados de 32 de 37 sprints.

**Corrección posterior de la misma fecha.** La primera entrega de la vista de
sprints tenía tres defectos que solo aparecieron al medir contra el proyecto
real, no al leer el código:

- El tope de 200 ítems era un **callejón sin salida**: 5.451 de 5.651 (96 %)
  inalcanzables. Ahora hay paginación real y nada queda fuera de alcance.
- El filtro de sprint exigía la ruta completa, así que una URL compartida con
  `?sprint=Sprint 45` devolvía cero en silencio. Ahora acepta el nombre corto.
- El campo de persona escribía el hash por pulsación. Ahora escribe con retardo.

Los tres están documentados como bugs 7–10 en la tabla siguiente. El patrón que
los destapó fue medir el alcance real de lo entregado (cuántos ítems son
alcanzables) en vez de asumir que un tope de resultados cumplía su función.

Riesgos nuevos que quedan abiertos:

- **La carga en frío son ~10 s.** Aceptable en local con TTL de 300 s, pero un
  reinicio del backend hace que la primera pantalla de sprints tarde. Si molesta,
  la salida es precargar el índice en el lifespan, no subir el TTL.
- **`sprint_actual` es una heurística** (el último sprint tocado), no el
  calendario: no hay fechas disponibles. Si algún día las hay, hay que reemplazar
  el criterio, no acumular otro.
- **Las señales ①③ dependen de la adopción.** Con `verificado-qa` en cero
  ítems, «cerrados sin verificar» es hoy el 95 % de los bugs: es la línea base,
  no un defecto del cálculo.
- **Índice en memoria sin cota de tamaño.** Medido en 5.651 ítems. El riesgo 6 del
  plan (escala ×10) sigue sin medir; el log `Índice: items=… duration_ms=…` es la
  señal a vigilar.
- **Los tres endpoints nuevos comparten el índice**: si Azure falla al
  construirlo, los tres devuelven 502 a la vez. No es un fallo parcial Acceptable
  por diseño, pero conviene saberlo al diagnosticar.

Bugs reales encontrados y corregidos durante la ejecución (detalle en el plan):

| # | Bug | Corrección |
| - | --- | --------- |
| 1 | `clave_orden_sprint` solo leía dígitos al inicio, así que ningún sprint era numérico (`Sprint 10` empieza por `S`) | Extraer el primer grupo de dígitos en toda la cadena |
| 2 | La raíz de iteración se detectaba como «la ruta más corta» → descartaba `Sprint 1` (más corta que `Sprint 10`) | La raíz es la ruta que es **prefijo** de otras |
| 3 | El índice se escribió síncrono con `threading.Lock` en una app 100 % async | `async` + `asyncio.Lock` |
| 4 | El catálogo no exponía la ruta completa, que es lo que necesita el filtro | Añadir `ruta` al catálogo y a `SprintOut` |
| 5 | Un helper de prueba usó `{ name }` sin binding local, que resolvía a `window.name` (vacío en jsdom): la búsqueda no fallaba, no encontraba nada | `{ name: nombre }` explícito |
| 6 | `parsearHash` devolvía `soloAbiertos: false` junto a claves `undefined`, generando claves de caché distintas para el mismo filtro | Normalizar: solo claves activas |
| 7 | El tope de 200 ítems sin paginación dejaba **5.451 de 5.651 inalcanzables** (96 %). La tabla decía «mostrando 200 de 856» sin forma de ver los otros 656 | `offset`/`limite` en `/api/items` + `hay_mas`; medido: los 856 en 5 hojas, los 5.651 en 29, sin repeticiones |
| 8 | `?sprint=Sprint 45` devolvía **0** en silencio: solo funcionaba la ruta completa | `filtrar()` acepta también la hoja de la ruta, sin distinguir mayúsculas |
| 9 | El campo de persona escribía el hash en cada pulsación: 4 teclas = 4 entradas de historial y 4 peticiones a `/api/items` | Efecto con retardo de 300 ms; el `onChange` solo actualiza estado local |
| 10 | El efecto con retardo se **añadió junto a** la llamada inmediata del `onChange`, sin reemplazarla: el retardo era un no-op | Se quitó la llamada inmediata. Lo detectó la traza de pila de una escritura de hash |
| 11 | `TarjetaSenal` solo renderizaba sus hijos si estaba abierta, así que **el mensaje de error de una señal caída nunca se veía** | Los hijos se renderizan siempre; quien llama decide qué pasa (la lista solo si está abierta, el error siempre) |
| 12 | La suma de las columnas de la cinta (5.483) se tomaba como el total del proyecto (5.651): 168 ítems no tienen sprint asignable | `GET /api/sprints` devuelve `total_items` y `asignados_a_sprint`, y el veredicto dice ambos |
| 13 | El botón de una tarjeta de analítica prometía el total (410 casos) y abría la lista recortada a 50 | El botón promete lo que se ve; la nota dice cuántos hay en total |

### Rediseño de la vista de sprints (2026-09-26)

El diagnóstico no fue «falta una librería de UI» sino «todo está desplegado a la
vez». Contando lo que había en pantalla al abrir: 4 tarjetas de KPIs, 37 filas ×
7 columnas de catálogo y 200 filas × 8 de ítems, unas **1.900 celdas**. Y los 4
KPIs mostraban las mismas constantes sin filtro, así que no informaban de nada en
el estado por defecto.

Decisión: **no** adoptar MUI/Ant/shadcn. El problema no son los componentes sino
la jerarquía de información, y un framework habría añadido ~100 KB para pintar lo
mismo que ya se pintaba. Se implementaron tres primitivas nuevas y se
reutilizaron las existentes:

| Primitiva | Qué resuelve |
| --------- | ------------ |
| `CintaSprints` | 37 sprints son una **secuencia**: la tabla obliga a leer fila a fila, la barra se lee de un vistazo. Fusiona catálogo y rezago en un visual |
| `LineaVeredicto` | Una frase en vez de cuatro tarjetas constantes. Responde la pregunta real |
| `Embudo` | Los filtros activos como pastillas quitables, no una frase que solo los describe |
| `TarjetaSenal` | Una señal = un número y una frase; los ejemplos bajo demanda |

Con tres niveles de revelado, el estado por defecto pasó de ~1.900 celdas a 37
barras y una frase.

**Lo que no se resolvió y conviene revisar:**

1. **Sin verificación visual.** No había navegador conectado en esta sesión. La
   cobertura es de pruebas de componentes y de API real; el juicio de «¿se ve
   bien?» queda pendiente de que alguien abra la vista.
2. **La cinta crece sin agrupar.** Con 37 sprints cabe; con 150 se desplazará en
   horizontal. Se prefirió desplazar antes que agregar en silencio sprints que el
   usuario puede querer abrir uno a uno, pero es una decisión revisable.
3. **200 filas siguen renderizándose** con el detalle desplegado. Aceptable para
   el navegador; si molesta, virtualización.

| 14 | `TablaItems` duplicaba el mapeo de estado → tono y la copia se contradecía: «Removed» salía verde como cerrado y «Testing» gris como sin empezar | Usa `EstadoTrabajo`, la regla única; regresión que la fija |
| 15 | El relleno verde de la cinta iba con `opacity: 0.55`, que sobre fondo claro se mezclaba a `rgb(122,200,153)` — un verde que se lee gris | Rellenos sólidos por tono; el sprint actual conserva el azul por tono, no por una regla de opacidad aparte |
| 16 | `resaltar()` generaba **claves de React duplicadas** al partir el texto: usaba `clave` en los índices impares y `clave + indice` en los pares, así que el índice 0 daba `clave + 0 === clave` | Clave por índice: `${clave}-${indice}`. Aviso de React «Encountered two children with the same key» al buscar una épica |

### El bug de claves duplicadas, y por qué la suite no lo vio

Avisó el usuario al usar el buscador de épicas. `resaltar()` divide el texto con
una captura, así que los índices impares son las coincidencias y los pares el
texto normal. Las claves se calculaban así:

```tsx
indice % 2 === 1 ? <mark key={clave}>       //  → clave
                 : <span key={clave + indice}>  //  → clave + 0 = clave   ← colisión
```

Con una coincidencia (`"Epic- IA Mundial Express"`, consulta `IA`) el array es
`["Epic- ", "IA", " Mundial Express"]` y las claves `[2, 2, 4]`: dos nodos con
clave `2`. Con dos coincidencias eran `[2, 2, 4, 2, 6]`, tres nodos con la misma.

**Por qué no lo detectaron las pruebas:** las tres que cubrían `resaltar`
comprobaban *qué* se dibujaba (`<mark>` presente, no fallar con metacaracteres,
respetar el caso). El resaltado se veía correcto y las claves seguían
repetidas: una suite entera puede quedar verde con el bug dentro si solo mira el
contenido. La regresión ahora espía `console.error` y falla ante cualquier aviso
de «same key», con cuatro casos: una coincidencia, varias, las dos celdas de
una misma fila y dos llamadas con la misma base.

Se comprobó que los cuatro casos **fallan** revirtiendo el arreglo, para
asegurarse de que la prueba guarda algo y no pasa por casualidad.

**Alcance:** es el único sitio de la app que calcula una clave con aritmética;
las demás usan valores de dominio (`azure_id`, `ruta`, `clave`). No afectaba a
Azure ni a los datos: era un defecto de reconciliación, con el riesgo de que el
resaltado quedara pegado donde ya no correspondía y con React declarando que
ese comportamiento no está soportado.

### Tonos de estado: `verificacion` y `bloqueado` (2026-09-26)

Al revisar los colores se vio que dos estados del proyecto no tenían tono
propio. Reparto real de los 5.651 ítems tras el cambio:

| Tono | Ítems | Estados del proyecto |
| ---- | ----- | -------------------- |
| `terminado` | 4.881 | Closed (4.752), Done (78), Resolved (51) |
| `nuevo` | 392 | New |
| `progreso` | 294 | Doing (163), Active (131) |
| `pendiente` | 32 | To do (27), Pendiente (5) |
| `removido` | 25 | Removed |
| **`verificacion`** | **19** | Testing |
| **`bloqueado`** | **4** | Bloqueado |
| `neutro` | 4 | `tested` |

- **`verificacion`** (turquesa) va aparte de `progreso` porque en una
  herramienta de QA «en pruebas» es una cola con dueño, no «siguiendo».
- **`bloqueado`** (rojo) va aparte de `pendiente` (naranja): *en cola* y *parado
  sin avanzar* son cosas distintas, y un ítem atascado pasaba por trabajo normal.
- `bloqueado` se coloca después de `terminado` y antes de `removido`, para formar
  grupo con lo que está fuera del flujo y necesita a alguien.
- `tested` (4 ítems) sigue en `neutro` a propósito: puede significar «probado y
  aprobado» o «probado y fallido», y mapearlo a `terminado` inflaría el recuento
  de cerrados. Mejor un gris honesto que un verde falso.

**Los tres tableros ya no pueden divergir.** Tenían listas literales de columnas
y añadir un tono a uno olvidándolo en otro era un fallo silencioso. Ahora
`columnasDesdeOrden(ORDEN_TONOS, …)` los deriva del mismo orden, y el tipo
`Record<TonoEstado, string>` convierte un título ausente en un error de compilación.

**Inconsistencia conocida que NO se cambió:** el backend cuenta `removed` y
`canceled` como cerrados en `ESTADOS_CERRADOS` (y por tanto en el `cerrados` de
cada sprint y en la señal ①), mientras que la UI los muestra como `removido`.
Excluirlos del recuento «cerrado» subiría la señal ①, así que es una decisión de
producto, no un arreglo: queda pendiente de decidir.

---

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
  repositorio no mantiene una segunda copia. El índice local de sprints y
  personas es una **tercera** capa, con TTL propio (`INDEX_TTL_SEG`, 300 s).

### Frontend

- `src/main.tsx` crea el `QueryClient` y monta `App`.
- La navegación es por hash, sin `react-router`.
- `src/api/cliente.ts` es la única costura de red y usa rutas relativas `/api`.
- `epicas/hooks.ts` contiene las queries de estado, lista, árbol, refresh, sprints,
  personas, ítems y señales de analítica.
- Las vistas actuales son `Dashboard`, `PaginaEpica`, `PaginaTareas`,
  `PaginaBugs`, `PaginaSprints` y `PaginaAnalitica`.
- `ContenidoRico` es la única frontera permitida para descriptions HTML.
- `sprints/fechas.ts` es lógica pura (fechas relativas, porcentajes, resumen de
  filtros, orden) y se prueba sin React ni red; el mismo patrón que
  `epicas/busquedaEpicas.tsx`.

## 4. Verificación reproducible

| Comprobación | Resultado | Observación |
| --- | --- | --- |
| Backend pytest | **175 passed** | Sin red; aparece un warning de deprecación de Starlette/httpx en `TestClient`. |
| Frontend Vitest | **215 passed / 20 files** | Incluye regresiones de Dashboard, API, rutas, navegación global, tareas, bugs, cinta de sprints, analítica, tonos de estado, claves de React y sanitización. |
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
- Las cachés son locales a cada proceso; con múltiples workers no hay invalidación compartida. Esto afecta también al índice: cada worker construiría el suyo y multiplicaría los lotes contra Azure por el número de workers.
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
4. Precargar el índice en el lifespan si la carga en frío de ~10 s resulta
   molesta; hoy se carga bajo demanda.
5. Indexar `System.Description` si se quiere una señal de «notas de QA» real en
   lugar del proxy por etiqueta. Antes hay que medir el coste en memoria.
6. Vigilar `Índice: items=… duration_ms=…` y medir el comportamiento al escalar
   el proyecto; el índice no tiene cota de tamaño.
7. Vigilar también `Índice de pruebas: items=… lotes_con_error=… duration_ms=…`.
   La cobertura necesita **los dos** índices: abrir `#/pruebas` en frío cuesta
   **~15 s** (10,4 s del índice de trabajo + 5,4 s del de pruebas), no 5 s. Los
   5,4 s son el precio de `$expand=relations`, sin el cual no hay cobertura. Si
   molesta, el índice de pruebas ya tiene TTL propio (900 s) y se puede precargar
   en el lifespan como el de sprints.
8. Si algún día se activan escrituras sobre activos de prueba, la lista blanca
   pasa a ser **por tipo** (`Microsoft.VSTS.Common.Priority` en test items y
   `System.Priority` en Bug; `severidad` solo donde existe) y hay que enmendar
   ADR-11, que hoy fija tres tipos editables.

### Límites conocidos de la capa de pruebas

| Límite | Consecuencia |
| ------ | ------------ |
| La pertenencia de un caso a un plan no es accesible (404 en todas las `api-version`; 0 relaciones en el work item del plan) | No hay «abrir plan» ni pass/fail por plan. `/api/pruebas/planes` solo da sprint y responsable |
| No hay fechas de sprint (`_apis/iterations` → 401) ni ejecuciones de prueba legibles | Sin burndown ni tendencia de la cobertura |
| Un lote de relaciones ilegible hace parecer descubiertas historias que sí tienen caso | La respuesta lo declara (`parcial: true`) y el recuento es una cota superior |
| `TestedBy` entre tipos: una HU (17548) apunta a Tasks del proceso de QA, no a casos | Cuenta como descubierta: 240 con caso frente a 241 enlazadas |
| `Microsoft.VSTS.TCM.Steps` no se pide (causa los HTTP 500) | La vista no muestra los pasos de un caso; irían en un endpoint de detalle |
| 98,5 % de los casos no está automatizado | Se presenta como dato, sin tono rojo/verde: es una mide el proceso, no juzga al equipo |

## 8. Criterios de cierre recomendados

- `backend`: `pytest`, `pip check` y auditoría de dependencias en verde.
- `frontend`: `npm ci`, `npm.cmd test`, `npm.cmd run build` y `npm audit` completo en verde.
- Pruebas de regresión para todos los hallazgos P1/P2 cerrados.
- Documentación, `AGENTS.md` y README describen el comportamiento real, incluyendo limitaciones conocidas.
- El procedimiento de despliegue exige reverse proxy con TLS/autenticación si el listener no permanece en `127.0.0.1`.

Para el detalle operativo de la corrección de caché, refresh y dependencias, consultar el código y la documentación de este repositorio; no asumir que una prueba verde cubre una integración Azure real.
