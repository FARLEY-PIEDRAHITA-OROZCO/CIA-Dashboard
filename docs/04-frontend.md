# 04 · Frontend (React / TypeScript / Vite)

> Referencia completa de la SPA. Stack: **React 18 + TypeScript 5.9 + Vite 6**,
> datos con **TanStack Query 5**, sanitización con **DOMPurify 3.4**,
> pruebas con **Vitest 4 + Testing Library + jsdom**.

La SPA tiene **tres páginas** separadas por **hash**: el dashboard, la página
dedicada de historias y la página dedicada de tareas.

Ruta raíz: `frontend/`.

---

## 1. Scripts

```powershell
npm.cmd ci            # instalar dependencias desde package-lock.json (usar npm.cmd en PowerShell)
npm.cmd run dev       # Vite dev server en http://localhost:5173  (proxy /api → :8000)
npm.cmd run build     # typecheck (tsc -b) + build de producción → frontend/dist
npm.cmd test          # suite de pruebas (vitest run)
npm.cmd test:watch    # vitest en modo watch
npm.cmd run preview   # sirve el build listo para probar
```

> En dev, `vite.config.ts` hace proxy de `/api` hacia el backend; el frontend
> siempre llama a rutas relativas (ver §4), de modo que no hay URLs de
> entorno que configurar.

---

## 2. Estructura de carpetas

```
frontend/src/
├── main.tsx                  # punto de entrada: QueryClientProvider + <App/>
├── App.tsx                   # composición raíz: enruta por hash entre Dashboard, PaginaEpica y PaginaTareas
├── navegacion.ts             # navegación por hash: Destino, irA(), enlaceA(), useVista()
├── styles.css                # diseño global: variables, layout, badges, tablero
├── api/
│   ├── index.ts               # reexports de la costura de API
│   ├── tipos.ts               # interfaces TypeScript (contrato del backend)
│   └── cliente.ts             # única costura de red: fetch tipado + ApiError
├── componentes/              # UI genérica reutilizable
│   ├── ContenidoRico.tsx     # renderizador de texto sanitizado (DOMPurify)
│   ├── EstadoTrabajo.tsx     # badge de estado normalizado (tonos)
│   ├── Kpi.tsx               # tarjeta de métrica simple
│   └── retroalimentacion.tsx # avisos: Cargando / ErrorAlerta / CajaVacia
├── epicas/                   # feature «épicas»
│   ├── hooks.ts              # React Query hooks (estado, lista, árbol, refresh)
│   ├── TablaEpicas.tsx       # tabla de épicas
│   ├── FilaEpica.tsx         # fila expandible que carga el árbol
│   ├── DetalleEpica.tsx      # resumen expandido: descripción + features + acceso a historias/tareas
│   ├── TableroHistorias.tsx  # tablero de historias (cinturón, filtros, densidad)
│   ├── PaginaEpica.tsx       # página dedicada `#/epicas/{id}` con el tablero completo
│   ├── PaginaTareas.tsx      # página dedicada `#/epicas/{id}/tareas`
│   ├── TableroTareas.tsx     # tablero espejo de tareas (filtros y estados)
│   └── index.ts              # barril de exportación
├── pages/
│   └── Dashboard.tsx         # página principal (KPI + tabla)
└── test/
    └── setup.ts              # setUp de Testing Library (jest-dom)
```

`frontend/public/favicon.svg` es un asset estático que Vite copia a la raíz de
`frontend/dist`; `index.html` lo declara para evitar la petición automática a
`/favicon.ico`.

---

## 3. Enrutado (`navegacion.ts`) y árbol de componentes

La SPA tiene **tres páginas** separadas por **hash** (sin dependencia de
router; soporta botón atrás, enlace directo y recarga):

| Hash | Página | Contenido |
| ---- | ------ | --------- |
| `#/dashboard` | `Dashboard` | KPIs + cinturones de épicas + tabla explorable |
| `#/epicas/{id}` | `PaginaEpica` | página dedicada: features + tablero completo de historias |
| `#/epicas/{id}/tareas` | `PaginaTareas` | página dedicada: tablero de tareas de usuario |

API mínima:

```ts
type Destino =
  | { pagina: "dashboard" }
  | { pagina: "epica"; azureId: number }
  | { pagina: "epicaTareas"; azureId: number };
irA(destino);                 // navegar programáticamente
enlaceA(destino);             // href para <a> normal (back/forward funcionan)
useVista(): Destino;          // hash reactivo (escucha hashchange)
```

`App.tsx` solo decide la página; el `QueryClient` es global y la navegación
reutiliza sus entradas cacheadas (el árbol de la épica queda disponible para
volver a entrar sin otra petición inmediata).

```
main.tsx
└── <QueryClientProvider>
    └── App  (useVista)
        ├── #/dashboard -> pages/Dashboard
        │   ├── useEstadoAzure() -> bandera de integración
        │   │           ├── toggle «Incluir cerradas» -> useEpicas(activo, incluirCerradas)
        │   │           ├── Kpi × 4  (épicas activas/totales · estados · en progreso · terminadas)
        │   ├── «Refrescar datos» (useRefrescar)
        │   ├── «cinturones» de épicas por estado
        │   ├── Cargando / ErrorAlerta / CajaVacia
        │   └── TablaEpicas
        │       └── FilaEpica × n
        │           ├── EstadoTrabajo (badge)
        │           ├── botón «Historias ↗» (va a #/epicas/{id})
        │           ├── botón «Explorar / Contraer»
        │           └── (expandida) useArbolEpica(azure_id)
        │               └── DetalleEpica (resumen)
        │                   ├── ContenidoRico (descripción de la épica)
        │                   ├── contador features · historias · tareas
        │                   ├── lista de Features (id, badge, título, descripción, nº historias)
        │                   ├── botón «Ver historias de usuario (N) ↗» -> #/epicas/{id}
        │                   └── botón «Ver tareas de usuario (N) ↗» -> #/epicas/{id}/tareas
        │
        ├── #/epicas/{id} -> epicas/PaginaEpica
        │   ├── «← Volver al backlog» (#/dashboard)
        │   ├── useArbolEpica(id)  (Cargando / ErrorAlerta)
        │   ├── CabeceraEpica: #id · título · badge · «Abrir en Azure ↗» · descripción · contador
        │   └── TableroHistorias
        │       ├── cinturón de estados (chips cliqueables -> aislar columna)
        │       ├── banda de filtros: buscador · chips por feature · densidad · limpiar
        │       └── columnas por estado (tono) × columnas con historia
        │           └── TarjetaHistoria × n
        │               ├── #ID + EstadoTrabajo + botón ampliar (+/−)
        │               ├── título + contexto de Feature
        │               ├── descripción recortada o bajo demanda
        │               └── «Abrir en Azure ↗» al ampliar
        │
        └── #/epicas/{id}/tareas -> epicas/PaginaTareas
            ├── «← Volver a historias» (#/epicas/{id})
            ├── useArbolEpica(id) y aplanarTareas(epica)
            ├── CabeceraEpicaTareas + ContenidoRico
            └── TableroTareas
                ├── filtros combinables: buscador · Feature · HU
                ├── columnas por estado colapsables
                └── TarjetaTarea con descripción y enlace a Azure
```

**Regla de separación**: los componentes de presentación (por debajo de
`FilaEpica`, `PaginaEpica` y `PaginaTareas`) **reciben datos por props** y
**emiten eventos**; los hooks React Query viven en `FilaEpica`,
`PaginaEpica`, `PaginaTareas` y `Dashboard`.

**Aplanado para el tablero**: `aplanarHistorias(epica)` (en
`TableroHistorias.tsx`) convierte el árbol en una lista plana
`HistoriaConContexto[] = { hu, contexto, featureId }` sin bajar nada nuevo
de la red: las `user stories` directas (`epica.hus`) con `contexto: ""` y
las de cada feature (`epica.features[].hus`) con `contexto: feature.titulo`
y `featureId`. El tablero solo pierde la jerarquía visual, nunca el dato.

---

## 4. Cliente API (`api/cliente.ts`)

- `const BASE = "/api"` → siempre relativas (proxy en dev, misma origin en
  producción).
- `peticion<T>(ruta, opciones)`: `fetch`, headers JSON; si `respuesta.ok`
  false lanza `ApiError` con el `detail` del backend (o un fallback). El
  cliente valida la forma JSON de cada respuesta; la política de reintentos
  está en el `QueryClient` (`429`/`5xx`).
- `peticion` propaga `AbortSignal` desde React Query; el `QueryClient` no
  reintenta 4xx deterministas.

```ts
export const api = {
  estadoAzure: (signal) => validarEstadoAzure(await peticion("/azure/estado", { signal })),
  epicas: (incluirCerradas = false, signal) =>
    validarLista(await peticion(`/epics?incluir_cerradas=${incluirCerradas}`, { signal })),
  arbolEpica: (azureId, signal) =>
    validarEpic(await peticion(`/epics/${azureId}/arbol`, { signal })),
  refrescar: () => validarAccion(await peticion("/epics/refresh", { method: "POST" })),
};
```

---

## 5. Tipos (`api/tipos.ts`)

Reflejan el contrato del backend (ver [03-api](03-api.md)):

| Tipo | Campos | Notas |
| ---- | ------ | ----- |
| `EpicResumen` | `azure_id, titulo, estado, url` | fila de la tabla |
| `UserStory` | `azure_id, titulo, estado, descripcion, url?, tareas?` | `tareas` = tareas hijas |
| `Tarea` | `azure_id, titulo, estado, descripcion, url?` | tarea bajo una HU |
| `Feature` | `azure_id, titulo, estado, descripcion, url?, hus[]` | `hus` = user stories hijas |
| `Epic` | `azure_id, titulo, estado, descripcion, features[], hus[], url` | árbol completo |
| `EstadoAzure` | `configurada, organizacion, proyecto, area_path, verificado, error` | |
| `ListaEpicas` | `epicas[]` | |
| `RespuestaAccion` | `ok, detalle?` | refresh |

> `descripcion` es HTML sin sanitizar. **Nunca** se inyecta con
> `dangerouslySetInnerHTML` directo: solo vía `<ContenidoRico>` (ver §7).

---

## 6. Hooks de datos (`epicas/hooks.ts`)

Claves de query y política de caché:

| Hook | Clave | `staleTime` | `gcTime` | Habilitado |
| ---- | ----- | ----------- | -------- | ---------- |
| `useEstadoAzure` | `["azure","estado"]` | 60 s | por defecto | siempre |
| `useEpicas(activo, incluirCerradas)` | `["epicas", incluirCerradas]` | 30 s | por defecto | `activo` (solo si Azure configurado) |
| `useArbolEpica(azureId\|null)` | `["epicas","arbol",id]` | 120 s | 300 s | solo si `id !== null` |
| `useRefrescar()` | — (mutación) | — | — | — |

- **Filtro de cerradas**: `incluirCerradas` forma parte de la query key, así
  que marcar/desmarcar el toggle provoca un refetch (cada clave tiene su propia
  caché). Por defecto `false`; el conteo real depende del backlog.
- **Carga perezosa del árbol**: `useArbolEpica` recibe `null` cuando la fila
  está contraída → la query está *disabled* y no consume red. Al expandir se
  dispara; al contraer, la data queda en caché (300 s) y reexpandir es
  instantáneo.
- **Refrescar**: `useRefrescar` llama a `POST /api/epics/refresh` y luego
  `invalidateQueries()` (invalida todo; las queries activas se re-solicitan).
  El backend limpia su caché de aplicación; el repositorio no mantiene una
  segunda copia y la siguiente consulta vuelve a Azure.
- React Query se encarga de deduplicar, retirar y reutilizar solicitudes:
  expandir dos veces la misma épica no vuelve a llamar a Azure si está fresca.

---

## 7. Renderizado seguro de contenido (`componentes/ContenidoRico.tsx`)

Azure entrega la descripción como **HTML con estilos inline**. Este
componente lo hace legible y seguro:

```ts
export function limpiarHtml(html: string): string {
  return DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "button", "img", "video", "audio", "iframe"],
    FORBID_ATTR: ["style", "srcset", "formaction"],
  });
}
```

- `DOMPurify.sanitize` **elimina** scripts, handlers `on*`, iframes, etc.
- `FORBID_ATTR: ["style", "srcset", "formaction"]` elimina estilos inline y
  atributos de carga/formulario. `FORBID_TAGS` bloquea etiquetas activas y
  recursos externos (`form`, `img`, `video`, `audio`, `iframe`, etc.).
- `<ContenidoRico html={...}>` aplica `dangerouslySetInnerHTML` **solo sobre**
  el resultado sanitizado, dentro de un contenedor `.contenido-rico`.
- Las etiquetas activas/recursos externos (`form`, `img`, `video`, etc.) están
  bloqueadas explícitamente; la suite cubre regresiones en `ContenidoRico.test.tsx`.
- CSS propio (`styles.css`) reconstruye la lectura: `<div>` de Azure →
  párrafo con margen e interlineado; tablas/listas/encabezados estilizados.

---

## 8. Sistema de diseño (`styles.css`)

Principios:

- **Variables CSS** (`:root`) para colores de estado y fondos; tema claro.
- **Layout**: cabecera con título del proyecto, área de KPIs (`display:grid`),
  panel detalle y tableros con scroll horizontal. La tabla usa un wrapper
  responsive con `overflow-x: auto`.
- **Badges de estado** (`.badge-estado` + tonos):
  `estado-nuevo`, `estado-progreso`, `estado-terminado`, `estado-removido`,
  `estado-pendiente`, `estado-neutro`.
- **Clases utilitarias**: `.texto-suave`, `.small`, `.monospace`, `.td-der`.
- **Resumen de features** (panel expandido): `.lista-features`, `.item-feature`
  (borde-izquierdo acento), `.item-feature-cabecera`, `.fila-resumen`; acciones
  de fila con `.acciones-fila`.
- **Tablero de historias en la página dedicada**:
  - `.cinturon-estados` / `.cinturon-chip` + `.punto-tono` (chips cliqueables
    que aislan la columna; colores por tono vía `data-tono`).
  - `.banda-filtros`: `.buscador`, `.cinta-chips` / `.chip`
    (`[aria-pressed]`), `.selector-segmentado` (densidad), `.chip-limpiar`.
  - `.tablero-columnas` (scroll horizontal) / `.hu-columna` (pinta solo
    columnas con contenido; cuerpo con scroll vertical propio ≤ 60vh).
  - `.hu-card` (borde izquierdo por tono), `.hu-card-descripcion[data-recortada]`
    (clamp a ~4.8em), `.hu-contexto` (chip de Feature de origen), `.btn-icono`
    para colapsar columnas/ampliar tarjetas.
- **Avisos**: `.aviso`, `.aviso-info`, `.aviso-error`, `.spinner`.
- **Accesibilidad**: foco visible en botones/links, `aria-expanded`,
  `aria-pressed` (filtros/segmentos), `aria-label` descriptivo, `role="status"`
  en cargas y vacíos de filtro.

---

## 9. Normalización de estados (`componentes/EstadoTrabajo.tsx`)

`tonoEstado(estado: string): TonoEstado` normaliza el **texto libre** de
Azure (mayúsculas/variantes EN/ES) a uno de 6 tonos:

| Tono | Sinónimos reconocidos (subset) |
| ---- | ------------------------------ |
| `nuevo` | new, nuevo, proposed, propuesta, todo, backlog, por hacer |
| `progreso` | in progress, active, activo, en curso, in review, desarrollo, ejecución |
| `terminado` | done, resolved, closed, completed, entregado, certificado, cerrado |
| `removido` | removed, cancelled, cancelado, cut, eliminado |
| `pendiente` | approved, committed, to do, pending, design, planeación |
| `neutro` | cualquier otro (degradación segura) |

La normalización hace `toLowerCase().trim()` y colapsa espacios. Un estado
nuevo **no rompe** la UI: cae en `neutro` (ver ADR 6 en
[01-arquitectura](01-arquitectura.md)).

---

## 10. Tablero de historias (`epicas/TableroHistorias.tsx`)

El tablero nace de la queja de usabilidad: con muchas historias, una sola
lista vertical se convierte en un scroll infinito. Soluciones combinadas:

- **Cinturón de estados**: chips con el conteo por tono (cliqueables) que
  **aislan** la columna correspondiente (foco) en lugar de hacer scroll
  largo; volver a pulsar restaura todas las columnas.
- **Filtros compuestos**: búsqueda por título/id + selección **multi-feature**
  (chips) + toggle de densidad `Detalles | Compacta`. Los contadores del
  cinturón siempre reflejan la épica completa; las columnas reflejan el
  filtrado.
- **Contención vertical**: cada columna tiene scroll propio (≤ 60vh) y se
  puede **colapsar** a solo su cabecera (cuenta + tono). Las tarjetas se
  **amplían** (`+/−`) para revelar la descripción y el enlace a Azure, de
  modo que el modo compacto apenas ocupa alto.
- **Filtrado por estado en el backend**: los estados `Closed` de las épicas
  se controlan desde el dashboard (toggle «Incluir cerradas», §6); el tablero
  opera sobre el árbol ya cargado, sin llamadas extra.

Estado interno (todo local al componente, recibe `historias` + `features`
por props): `busqueda`, `featureSeleccionadas: Set<string>` (claves
`f{id}`/`directas`), `estadoFoco: TonoEstado|null`, `densidad`,
`colapsadas: Set<TonoEstado>`, `abiertas: Set<number>`.

---

## 11. Tablero de tareas (`epicas/TableroTareas.tsx`)

`aplanarTareas(epica)` recorre las HUs directas y las HUs de cada Feature,
convierte sus `tareas` en una lista plana y conserva el contexto de HU/Feature.
No hay endpoint de tareas: la página consume el mismo árbol de
`/api/epics/{id}/arbol`.

- **Filtros combinables**: buscador, Feature y HU; al cambiar Feature se
  recalculan las HUs disponibles.
- **Columnas por estado**: reutiliza `tonoEstado` y permite colapsar la columna;
  la cabecera permanece visible y se puede volver a expandir.
- **Tarjetas**: muestran estado, HU de origen, Feature de origen, descripción
  sanitizada y enlace al work item aunque la descripción esté vacía.

---

## 12. KPIs (`componentes/Kpi.tsx`) y avisos (`retroalimentacion.tsx`)

- `Kpi({ etiqueta, valor, tono?, titulo? })`: tarjeta de indicador; `tono` es
  uno de `"ok" | "alerta" | "acento" | "neutro"` (default `neutro`). El
  dashboard muestra 4 KPIs calculados en `Dashboard` desde el resumen (sin
  bajar los árboles): épicas activas/totales (según el toggle de cerradas),
  estados distintos, en progreso y terminadas. Los dos KPIs de estado usan
  `tonoEstado`, por lo que reconocen `Active`, `Doing` y `Resolved`.
- `PaginaEpica` muestra un enlace visible a la página de tareas cuando existe
  al menos una tarea.
- `Cargando({ texto = "Cargando…" })` usa `role="status"`; `ErrorAlerta` usa
  `role="alert"` y `CajaVacia` `role="status"`.

---

Siguiente lectura: [05 · Integración Azure](05-integracion-azure.md).