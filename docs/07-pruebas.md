# 07 · Pruebas

> Estrategia y referencia de las suites del proyecto. Meta: **verificar
> comportamiento sin depender de la red**, con la menor fricción posible.

Estado actual: **Backend 102 pruebas ✓ · Frontend 82 pruebas ✓**

---

## 1. Principios

1. **Sin red**: ninguna prueba toca Azure ni internet. La integración con
   Azure se ejercita con *doubles* de los protocolos/puertos (y un doble de
   `httpx.AsyncClient` para probar el transporte aislado).
2. **Aislamiento por capa**: cada suite cubre una capa y sustituye solo la
   dependencia inmediata (transporte → repositorio → servicio → API).
3. **Comportamiento observable**: se verifican contratos públicos (respuestas
   HTTP, campos de dominio), no internals.
4. **Rapidez**: la suites corren en segundos.

---

## 2. Backend (pytest)

### Ejecutar

```powershell
cd backend
& ".\\.venv\\Scripts\\python.exe" -m pytest -v      # detalle por prueba
& ".\\.venv\\Scripts\\python.exe" -m pytest          # resumen compacto
```

> Las dependencias de prueba vienen de `requirements.lock` (generado desde
> `requirements-dev.txt`); `pytest-asyncio` habilita los tests `async`.

### Estructura y qué cubre cada archivo

| Archivo | #tests | Qué valida |
| ------- | ------ | ---------- |
| `test_transporte.py` | 15 | Auth Basic, errores HTTP seguros, errores de red, JSON inválido/inesperado, estados 203/204/3xx, **PATCH / JSON Patch** (content-type, payload, revisión) y extracción acotada del mensaje de regla |
| `test_repositorio.py` | 15 | Verificación de proyecto, listado liviano, árbol Task/Bug, caching inexistente en adaptador, hijos omitidos, URLs codificadas, bugs jerárquicos/relacionados, carga perezosa, rechazo de no-épica, **exposición de `tags` en HU/tarea/bug** y su presencia en el lote de campos |
| `test_config.py` | 8 | Ruta de `.env`, configuración completa, split CORS, HTTPS, opt-in de exposición externa y **escritura QA**: apagada por defecto, exige flag + PAT propio, PAT fuera de `repr` y rechazo fuera de loopback |
| `test_servicio.py` | 12 | Caché del listado (2.ª llamada no relee repo) + invalidación de `CachePort`; caché por épica y variante con bugs; `estado()`; métricas de bugs, incluyendo HUs dentro de Features; **filtro de cerradas**: excluye `Closed` por defecto, los incluye con `incluir_cerradas=True`, el filtrado no rompe la caché completa (1 sola lectura), y un estado vacío no se cuenta como cerrada. El repositorio real ya no tiene caché interna |
| `test_api.py` | 25 | Contrato HTTP, headers de seguridad, CORS permitido/rechazado, árbol con/sin bugs, endpoint y métricas de bugs, validación de ID positivo, 404 de árbol/upstream, refresh, 409 y 502; más **escritura QA**: 409 sin habilitación, resultado, dry-run, `rev_esperada`, 422 de cuerpo vacío e ID no positivo, 422 de validación local, 409 con detalle de regla y lectura de `rev` |
| `test_escritura.py` | 16 | Adaptador de escritura: lista blanca de campos, `PATCH` + `validateOnly`, **notas QA append-only y escapado de HTML**, normalización/rechazo de tags, control de concurrencia por `rev` y validación de estado |
| `test_servicio_escritura.py` | 11 | Servicio: flag deshabilitado, bandera sin adaptador, delegación, `validar`/`rev_esperada`, propagación de errores de Azure con detalle de regla, **invalidación dirigida de caché** (otras épicas siguen cacheadas) y dry-run que no invalida |

**Total: 102.**

### Base compartida (`conftest.py`)

| Doble | Rol |
| ----- | --- |
| `item_azure(...)` | Fabrica un JSON de work item Azure (fields + relations) |
| `SabanaTransporte` | Transporte fake que responde según la URL (proyecto, `workitems?ids=`, `workitems/{id}`), registra llamadas |
| `epica_canonica()` | Épica con 2 features y HUs de ejemplo |
| `FakeRepositorio` | Implementa `RepositorioBacklogPort` en memoria, con `sintoma` para inyectar fallos |
| `FakeEscritura` | Implementa `EscrituraBacklogPort` en memoria; registra llamadas y permite inyectar `AzureError` o `ErrorValidacionEscritura` |
| `contenedor_con(repo, configurado, escritura=)` | Contenedor real pero con `ttl=0` (caché neutral) para pruebas de la API |
| `cliente_fake` | `fastapi.testclient.TestClient(crear_app(contenedor))` |

> Detalle deliberado: `contenedor_con` usa **TTL 0** para que la caché no
> contamine los tests de la capa API (cada consulta pasa por el repo fake).

---

## 3. Frontend (Vitest + Testing Library)

### Ejecutar

```powershell
cd frontend
npm.cmd test          # una pasada
npm.cmd test:watch    # modo watch
```

Config en `vite.config.ts` (sección `test`): entorno `jsdom`, setup
`src/test/setup.ts` (importa `@testing-library/jest-dom`).

### Qué cubre cada archivo

| Archivo | #tests | Qué valida |
| ------- | ------ | ---------- |
| `componentes/EstadoTrabajo.test.tsx` | 4 | `tonoEstado`: mapea estados conocidos normalizando texto; **fallback neutro** para desconocidos; render con la clase de tono correcta; tolera estados vacíos |
| `componentes/NavegacionGlobal.test.tsx` | 6 | Barra global: acceso base en el dashboard, contexto de épica con `aria-current`, disparo del refresco, estado pendiente/bloqueo, deshabilitado sin Azure y aviso de error |
| `epicas/TablaEpicas.test.tsx` | 3 | Lista las épicas del backlog; expande una fila y muestra **Features** + botón de acceso a historias; contrae la fila expandida |
| `epicas/TableroHistorias.test.tsx` | 13 | Agrupación/aplanado, render, filtros, densidad, colapso, enlace Azure sin descripción y avisos |
| `epicas/PaginaEpica.test.tsx` | 2 | Carga la página, navegación de historias, tareas y enlaces Azure |
| `epicas/PaginaTareas.test.tsx` | 1 | Carga integrada de la ruta de tareas, contador, tablero y navegación de regreso |
| `epicas/TableroTareas.test.tsx` | 9 | Aplanado, agrupación, filtros, tarjetas, tareas bajo bugs, enlaces sin descripción, colapso restaurable y estados vacíos |
| `navegacion.test.tsx` | 4 | `parsearHash` estricto (incluidas `epicaTareas` y `epicaBugs`), `enlaceA` y `useVista` |
| `componentes/ContenidoRico.test.tsx` | 8 | Sanitización de scripts, handlers, estilos, protocolos peligrosos, etiquetas activas/recursos y render seguro |
| `pages/Dashboard.test.tsx` | 2 | KPIs normalizados y estado de carga del listado |
| `api/cliente.test.ts` | 3 | Validación runtime del contrato, bugs/métricas y propagación de `AbortSignal` |
| `epicas/TableroBugs.test.tsx` | 5 | Filtros de severidad, tarjetas sanitizadas, apertura del formulario QA, alternancia de tags, aviso de solo lectura y envío del PATCH con los campos tocados |
| `epicas/PaginaBugs.test.tsx` | 1 | Carga de métricas y tablero de bugs |
| `epicas/EdicionInline.test.tsx` | 11 | Solo emite campos modificados, no guarda sin cambios, alterna tags QA, valida sin guardar, notas QA separadas, error de mutación, estado guardando, aviso de solo lectura y selector de estados |
| `epicas/edicionHistoriasTareas.test.tsx` | 10 | **Fase 5**: edición QA en historias y tareas, ocultación de prioridad/severidad donde Azure no las soporta, tags precargados, desplegable de estados, PATCH con solo campos modificados, dry-run y avisos de solo lectura |

**Total: 82 en el frontend (15 archivos) y 102 en el backend.**

---

## 4. Cómo agregar pruebas nuevas

### Backend — un endpoint nuevo

Sigue la plantilla de `test_api.py`: fabrica un contenedor con
`contenedor_con(FakeRepositorio(...))` y verifica **status code + campos
clave**:

```python
def test_mi_endpoint(cliente_fake):
    r = cliente_fake.get("/api/mis-datos")
    assert r.status_code == 200
    assert r.json()["dato"] == "esperado"
```

Si lo que cambia es el repositorio, cubre el mapeo en `test_repositorio.py`
(con `SabanaTransporte` alimentando JSON de Azure); si cambia el caso de uso,
en `test_servicio.py` con `FakeRepositorio` + `CacheMemoria`.

### Frontend — un componente nuevo

```tsx
import { render, screen } from "@testing-library/react";
import { MiComponente } from "./MiComponente";

it("muestra el dato", () => {
  render(<MiComponente dato="hola" />);
  expect(screen.getByText("hola")).toBeInTheDocument();
});
```

- Usa roles/`getByRole` para accesibilidad cuando aplique.
- Si el componente requiere React Query, envuélvelo en un
  `QueryClientProvider` de prueba (los hooks de datos ya están aislados).

---

## 5. Cobertura que aún falta

- Falta una prueba de navegador/axe para foco, teclado y cambios de hash.
- Falta probar SPA estático y la aplicación bajo un lifespan real con un
  `AsyncClient` de producción.
- Falta una prueba de despliegue/readiness y una validación con Azure real; las
  pruebas actuales siguen siendo deliberadamente network-free.
- Faltan gates Python de lint/typecheck; `pip-audit`, `pytest` y el build
  frontend sí están automatizados.

## 6. Verificación previa a merge (mínimo aceptable)

```powershell
# backend
& ".\.venv\Scripts\python.exe" -m pip check
& ".\.venv\Scripts\python.exe" -m pip_audit --local
& ".\.venv\Scripts\python.exe" -m pytest

# frontend
npm.cmd test
npm.cmd run build        # typecheck tsc -b + bundle
npm.cmd audit --audit-level=high
```

Correr las tres debe terminar con 0 fallos. El `git diff` no debe incluir
`.env` ni secretos (ver [06-seguridad](06-seguridad.md)).

> CI ejecuta el lockfile, `pip check`, `pip-audit`, pytest, `npm ci`, tests,
> build y `npm audit` en `.github/workflows/ci.yml`; localmente son la puerta
> mínima equivalente.

---

Siguiente lectura: [08 · Despliegue y operación](08-despliegue.md).