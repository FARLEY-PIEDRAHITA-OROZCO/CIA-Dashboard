# CIA — Dashboard de Épicas (Azure DevOps)

Dashboard de **solo lectura** (con escritura QA opt-in) que extrae del backlog
de **Azure DevOps** las
épicas del proyecto configurado y las presenta
con cuatro vistas: **tabla de épicas** (KPIs, buscador tolerante a acentos,
filtro de cerradas y drill-down
que muestra sus **Features**), y **página dedicada por épica** con un
**tablero de historias por estado** (cinturón de estados, buscador, filtros
por feature y densidad ajustable). Cada épica ofrece además páginas dedicadas
para sus **tareas** (`#/epicas/{id}/tareas`) y **bugs**
(`#/epicas/{id}/bugs`), con tabler, filtros y métricas propias. Todo con
estados, descripciones, enlaces a Azure y navegación por hash
(`#/dashboard`, `#/epicas/{id}`, `#/epicas/{id}/tareas`,
`#/epicas/{id}/bugs`).

Proyecto independiente, modular, con arquitectura limpia en backend y SPA React.

## Documentación completa

**[docs/00-indice.md](docs/00-indice.md)** es el punto de entrada de la
documentación técnica exhaustiva (arquitectura, backend, API, frontend,
integración Azure, seguridad, pruebas, despliegue y guías de extensión).

| Doc | Tema |
| --- | ---- |
| [01 Arquitectura](docs/01-arquitectura.md) | Capas, SOLID, decisiones de diseño |
| [02 Backend](docs/02-backend.md) | Referencia archivo por archivo (FastAPI) |
| [03 API](docs/03-api.md) | Contrato REST, ejemplos y errores |
| [04 Frontend](docs/04-frontend.md) | React/TS: componentes, hooks, CSS |
| [05 Integración Azure](docs/05-integracion-azure.md) | WIQL, REST, algoritmo del árbol |
| [06 Seguridad](docs/06-seguridad.md) | PAT, XSS, CORS, checklist |
| [07 Pruebas](docs/07-pruebas.md) | Suites y cómo extenderlas |
| [08 Despliegue](docs/08-despliegue.md) | Dev/prod, variables y troubleshooting |
| [09 Extensión](docs/09-guia-extension.md) | Recetas paso a paso |
| [10 Auditoría](docs/10-auditoria.md) | Hallazgos técnicos, riesgos y plan de remediación |

---

## Stack

| Capa | Tecnología | Ubicación |
| ---- | ---------- | --------- |
| Backend | Python 3.14 · FastAPI · httpx · pydantic-settings | `backend/` |
| Frontend | React 18 · TypeScript · Vite · TanStack Query · DOMPurify | `frontend/` |
| Pruebas | pytest (102) · Vitest + Testing Library (104) | `backend/tests/` · `frontend/src/**/*.test.tsx` |

## Puesta en marcha rápida

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock
Copy-Item .env.example .env        # editar organización, proyecto y AZURE_PAT
.\.venv\Scripts\python.exe run.py  # http://127.0.0.1:8000  (Swagger en /docs)
```

El PAT se crea en `https://dev.azure.com/<org>/_usersSettings/tokens` con
scope `WorkItems → Read`. **Nunca commits `.env`** (está en `.gitignore`).

<details>
<summary><b>Escritura QA (opcional, ADR-11)</b></summary>

El sistema es de **solo lectura** por defecto. Para permitir editar tags,
estado, prioridad/severidad y notas QA de un work item:

1. Crea un PAT **dedicado** con scope `WorkItems → Read & Write` (Azure envía un
   correo de notificación al crearlo).
2. En `backend/.env`:
   ```dotenv
   AZURE_PAT_ESCRITURA=<tu-pat-de-escritura>
   ESCRITURA_HABILITADA=true
   ```
3. Reinicia el backend.

Notas importantes:

- El PAT de escritura es **independiente** del de lectura, para poder revocar
  la escritura sin perder la consulta.
- Solo funciona con `HOST` en loopback: el proceso **rechaza** la configuración
  si se habilita escritura con un binding externo, porque esta app no tiene
  autenticación propia.
- El alcance está acotado: solo `tags`, `estado`, `prioridad`, `severidad` y
  notas QA. Las notas se **agregan al final** de la descripción y nunca
  reemplazan el contenido existente.
- Para apagar la escritura basta con dejar `ESCRITURA_HABILITADA=false` y
  reiniciar.

Ver [06-seguridad](docs/06-seguridad.md) para el análisis de riesgo completo.

</details>

### 2. Frontend (desarrollo, hot reload)

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev    # http://localhost:5173  (proxy /api → 127.0.0.1:8000)
```

### Producción manual (un solo proceso, uso local/equipo)

```powershell
cd frontend
npm.cmd run build                  # genera frontend/dist
cd ..\backend
.\.venv\Scripts\python.exe run.py  # sirve API + SPA en :8000
```

> En Windows usa `npm.cmd` (la policy de PowerShell bloquea `npm.ps1`).

---

## API

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/health` | Healthcheck (sin Azure) |
| GET | `/api/azure/estado` | Configuración + conectividad real (sin secretos) |
| GET | `/api/epics` | Lista liviana de épicas del ÁreaPath (por defecto excluye `Closed`; `?incluir_cerradas=true` las incluye) |
| GET | `/api/epics/{id}/arbol?incluir_bugs=true` | Árbol completo; opcionalmente incluye bugs jerárquicos/relacionados |
| GET | `/api/epics/{id}/bugs` | Bugs de la épica + métricas por estado, prioridad, severidad y relación |
| POST | `/api/epics/refresh` | Invalida la caché |
| PATCH | `/api/workitems/{id}` | **Escritura QA** (opt-in): tags, estado, prioridad/severidad, notas. `?validar=true` no escribe |
| GET | `/api/workitems/{id}/rev` | Revisión actual (control de concurrencia) |

Ejemplos y contratos en [03-api.md](docs/03-api.md).

> El refresh limpia la caché de aplicación; la siguiente consulta vuelve a
> Azure. La auditoría completa está en [10-auditoria.md](docs/10-auditoria.md).

---

## Seguridad (resumen)

- **PAT** solo en el entorno backend; `repr=False`; no se envía al frontend ni
  se serializa `Settings` completo. Los errores Azure no devuelven el cuerpo
  upstream.
- **HTTPS obligatorio** para la organización (`config.py` valida `https://`).
- Listener en **127.0.0.1** por defecto; el backend rechaza bindings externos
  salvo `PERMITIR_EXTERNO=true`. CORS acotado (`ORIGEN_CORS`) y headers básicos
  de seguridad. No hay autenticación propia: no exponer sin proxy
  TLS/autenticado/rate limiting.
- Descripciones HTML de Azure **sanitizadas** con DOMPurify; se bloquean
  etiquetas activas/recursos y `style` inline.
- Detalle completo en [06-seguridad.md](docs/06-seguridad.md).

---

## Pruebas

```powershell
# Backend (102): transporte, repositorio/árbol/bugs, caché, servicio, API y regresiones de seguridad
cd backend
.\.venv\Scripts\python.exe -m pytest

# Frontend (104): badges, tablas, tableros, rutas, bugs, navegación global, API, Dashboard y sanitización
cd ..\frontend
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high

# Entorno Python
cd ..\backend
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pip_audit --local
```

Ninguna prueba toca la red: los integradores se sustituyen por fakes vía
inyección de dependencias. La auditoría de seguridad completa y el estado de
`npm audit` están en [10-auditoria.md](docs/10-auditoria.md).