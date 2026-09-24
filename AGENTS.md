# CIA Dashboard — agent instructions

## Repository shape

- `backend/` and `frontend/` are independent projects; there is no root package manifest or workspace/task runner.
- The backend entrypoint is `backend/run.py`, which serves `app.main:app`; the frontend entrypoint is `frontend/src/main.tsx`.
- The SPA uses hash routing (no router): `#/dashboard`, `#/epicas/{id}`, and `#/epicas/{id}/tareas`.
- FastAPI serves the SPA from `frontend/dist` when that build exists; development without `dist` requires the Vite server separately.
- La documentación está alineada con el código para las rutas y superficies actuales; consulta `docs/10-auditoria.md` para los límites aún abiertos.
- The dated technical audit and prioritized remediation backlog are in `docs/10-auditoria.md`; read it before changing Azure caching, routes, or deployment assumptions.

## Commands

Run backend commands from `backend/`; run frontend commands from `frontend/`.

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock
Copy-Item .env.example .env  # first setup only; then add AZURE_PAT
.\.venv\Scripts\python.exe run.py
```

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m pytest tests/test_api.py
.\.venv\Scripts\python.exe -m pytest -k "cache"
```

### Frontend

Use `npm.cmd` in PowerShell because the local execution policy blocks `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd test -- src/epicas/TableroTareas.test.tsx
npm.cmd test -- -t "nombre de la prueba"
npm.cmd run build
```

`build` runs `tsc -b` followed by `vite build`; there are no lint or formatter scripts. `backend/requirements.lock` is generated with `pip-compile --generate-hashes`; do not hand-edit it. Before handoff, run backend `pytest`, `pip check`, `pip_audit --local`, frontend `npm.cmd test`, `npm.cmd run build`, and `npm.cmd audit`.

## Architecture boundaries

- Keep backend dependencies flowing inward: API routes → application service → domain `Protocol` ports. Compose concrete Azure/cache adapters in `backend/app/core/container.py`.
- Keep Azure HTTP/WIQL code under `backend/app/infrastructure/azure/`; keep business orchestration in `application/services.py` and HTTP translation in `api/`.
- The backlog tree supports `Epic → Feature/User Story → Task`; tasks are nested in `UserStory.tareas`. Update backend models, mapper, TypeScript types, UI, and tests together when changing its shape.
- In the frontend, `src/api/cliente.ts` is the only network seam. Put query/mutation logic in `epicas/hooks.ts`; presentational components should receive data through props and emit events.
- Do not assume the task route has full integration/accessibility coverage; `docs/10-auditoria.md` records the remaining gaps and open deployment risks.

## Security and operational gotchas

- The backend now resolves `backend/.env` by an absolute path, though the documented commands still run from `backend/`. The PAT is backend-only (normally ignored `backend/.env` or a secret manager); never log, commit, expose, or copy it to frontend code.
- Without `AZURE_PAT`, backlog endpoints return HTTP 409; `/api/health` remains usable. Vite proxies relative `/api` requests to `http://127.0.0.1:8000`. The backend refuses non-loopback `HOST` unless `PERMITIR_EXTERNO=true` is explicitly set.
- Azure descriptions are raw HTML. Render them only through `ContenidoRico`/DOMPurify; preserve `FORBID_ATTR: ["style"]` and the active/resource tag denylist, and never inject them with unsanitized `dangerouslySetInnerHTML`.
- Azure work-item states are open text values; preserve the safe unknown-state fallback in `tonoEstado` when adding states.
- `run.py` currently uses `reload=False`; use Vite for frontend hot reload. `LOG_NIVEL` is applied to Uvicorn and the application logger.
- `POST /api/epics/refresh` clears the application `CachePort`; the repository no longer keeps a second cache, so the next service read goes to Azure.

## Testing constraints

- Tests must not call Azure or the internet. Use the protocol fakes in `backend/tests/conftest.py` and component/query fakes in frontend tests.
- The shared API fixture deliberately uses a zero-second cache so service cache state does not contaminate HTTP tests.
- CI is defined in `.github/workflows/ci.yml`; it installs the hashed Python lock, runs `pip-audit`, tests/builds both stacks and audits npm. There is no codegen, migration, or Docker pipeline.

## Git workflow

- `CIA-Dashboard` is an independent Git repository; never stage or commit sibling projects from the parent directory.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for every change: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`, or `perf:` followed by a concise imperative subject.
- Keep one logical change per commit; do not mix functional code, dependency updates and unrelated documentation.
- Before committing, inspect `git status`, `git diff --cached` and verify that `.env`, PATs, `node_modules`, `.venv`, `dist` and build artifacts are absent.
- Run the relevant tests before committing; for cross-stack changes run backend pytest, `pip check`, `pip_audit --local`, frontend tests, build and `npm.cmd audit`.
- Never amend, reset, force-push or push without explicit user authorization.
