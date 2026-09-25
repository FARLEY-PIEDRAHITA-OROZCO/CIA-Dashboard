# 08 · Despliegue y operación

> Cómo levantar el proyecto en desarrollo y en producción (monolito backend +
> SPA), variables de entorno, healthcheck y solución de problemas.

---

## 1. Requisitos

| Dependencia | Versión probada |
| ----------- | --------------- |
| Python | 3.14 (recomendable; 3.11+ funciona con FastAPI moderno) |
| Node.js | 24 (usar `npm.cmd` en PowerShell) |
| Windows | entorno objetivo actual (`win32`) |

---

## 2. Modo desarrollo (2 procesos)

```powershell
# Terminal 1 — backend
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock
Copy-Item .env.example .env            # ← luego editar .env: organización, proyecto y AZURE_PAT
.\.venv\Scripts\python.exe run.py       # http://127.0.0.1:8000

# Terminal 2 — frontend (con hot reload)
cd frontend
npm.cmd ci
npm.cmd run dev                         # http://localhost:5173 (proxy /api → :8000)
```

- El API queda en `:8000` (Swagger en `/docs`).
- Vite sirve la SPA en `:5173` y hace proxy de `/api`, `/docs` y
  `/openapi.json` hacia el backend.
- El `.env` se resuelve por ruta absoluta desde `config.py`; ejecutar desde
  `backend/` sigue siendo la forma documentada.
- El proceso rechaza `HOST` externo mientras `PERMITIR_EXTERNO=false`; activar
  el opt-in solo detrás de TLS/autenticación/rate limiting.
- `requirements.lock` se genera desde `requirements-dev.txt` con
  `pip-compile --generate-hashes --output-file=requirements.lock requirements-dev.txt`;
  no editarlo manualmente.
- Si cambia `PUERTO`, actualizar también el proxy de Vite o usar el puerto 8000
  durante desarrollo.
- **IPv4 en localhost**: si `run.py` falla por resolución IPv6 en tu máquina,
  usa `http://127.0.0.1:8000`. (opcionalmente configurar `HOST=127.0.0.1`).

---

## 3. Modo producción manual (1 proceso)

> Este es un modo local/equipo, no un despliegue production-ready. No hay
> Dockerfile, reverse proxy, autenticación, rate limiting ni gestión de
> secretos integrada; CI solo valida tests/build.

El backend sirve el build estático del frontend si existe `frontend/dist`:

```powershell
cd frontend
npm.cmd run build                       # crea frontend/dist (tsc -b + vite)
cd ..\backend
.\.venv\Scripts\python.exe run.py       # http://127.0.0.1:8000 → dashboard completo
```

En este modo **no hace falta** CORS (mismo origen); `main.py` monta el SPA en
`/` con `StaticFiles(html=True)` y la API sigue en `/api/*`.

---

## 4. Variables de entorno (referencia completa)

Van en `backend/.env` (o como env vars). Los valores de organización/proyecto
de `.env.example` son de ejemplo; los defaults del código son cadenas vacías.

| Variable | Default | Descripción |
| -------- | ------- | ----------- |
| `AZURE_ORG_URL` | `""` (plantilla con valor real) | Organización Azure |
| `AZURE_PROYECTO` | `""` (plantilla con valor real) | Proyecto |
| `AREA_PATH` | `""` | ÁreaPath para filtrar; vacío = todo el proyecto |
| `AZURE_PAT` | `""` (vacío = deshabilitado) | **Secreto**. Scope `Work Items: Read` |
| `HOST` | `127.0.0.1` | Interfaz de escucha; un binding externo requiere `PERMITIR_EXTERNO=true` |
| `PUERTO` | `8000` | Puerto HTTP |
| `PERMITIR_EXTERNO` | `false` | Opt-in explícito para proxy externo autenticado |
| `ORIGEN_CORS` | `http://localhost:5173` | Orígenes CORS extra, separados por comas (p. ej. `https://a.com,https://b.com`) |
| `CACHE_TTL_SEG` | `120` | TTL de caché de listas/árboles |
| `TIMEOUT_SEG` | `30` | timeout HTTP hacia Azure |
| `LOG_NIVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`… |

> `configurada: true` requiere organización, proyecto y PAT no vacíos. Sin esa
> configuración, los endpoints `/api/epics*` responden 409 y el dashboard
> muestra el aviso (no rompe, orienta).

---

## 5. Healthcheck y monitorización simple

- `GET /api/health` → `{"estado":"ok","version":"0.1.0"}` (sin Azure).
- `GET /api/azure/estado` → `configurada` + `verificado` (conectividad real).
  No es un readiness completo: solo verifica el endpoint de proyecto y no la
  lectura de WIQL/relaciones.
- `GET /api/epics/{id}/bugs` → bugs y métricas; por defecto excluye cerrados.
- Logs unificados bajo logger `devops`; `LOG_NIVEL` se aplica tanto a Uvicorn
  como a la aplicación. El transporte no registra bodies ni headers Azure.

Script de comprobación rápida (PowerShell):

```powershell
(Invoke-RestMethod http://127.0.0.1:8000/api/health).estado
(Invoke-RestMethod http://127.0.0.1:8000/api/azure/estado).verificado
```

---

## 6. Troubleshooting

| Síntoma | Causa probable | Solución |
| ------- | -------------- | -------- |
| `/api/epics` → **409** | `AZURE_PAT` vacío/incompleto | completar `.env` y reiniciar |
| `/api/epics` → **502** `401` | PAT inválido/vencido o sin scope | regenerar PAT con scope `Work Items: Read` |
| `/api/azure/estado` → `verificado: false` | el proceso puede tener código o variables antiguas; `run.py` no recarga | reiniciar el backend y volver a comprobar la llamada |
| `/api/epics/{id}/bugs` → 200 sin bugs visibles | los bugs están en estados cerrados o no existen en el AreaPath | usar `?incluir_cerradas=true` y revisar la relación en Azure |
| `/api/epics` → **502** con `203`/`TF401215` | campo/proyecto erróneo o respuesta no JSON | verificar `queries.py`, `AZURE_PROYECTO` y el manejo de respuestas no exitosas |
| 0 épicas aunque existen | `AZURE_PROYECTO` vs ÁreaPath | revisar `AREA_PATH` (vacío = proyecto entero) |
| Dashboard en blanco tras build | `frontend/dist` viejo o ausente | `npm.cmd run build` y reiniciar backend |
| Proxy `/api` no responde en dev | backend caído o puerto distinto | levantar `run.py` en `127.0.0.1:8000` |
| `npm.ps1` ejecución bloqueada | Execution Policy de PowerShell | usar `npm.cmd` |
| Escritura de `.env` rastreada por git | `.env` no estaba en `.gitignore` (versión vieja) | añadirlo e ignorar; **rotar PAT** |
| Swagger `/docs` queremos ocultarlo | exposición pública | configurar FastAPI con `docs_url=None`/`openapi_url=None`; CORS no oculta la ruta |

---

## 7. Docker (recomendación futura, no implementado)

No hay `Dockerfile` todavía. Cuando se necesite, el empaquetado natural es un
solo proceso:

1. **Stage build**: `node` → `npm run build` en `frontend/` (en Linux no usar
   `npm.cmd`).
2. **Stage runtime**: `python:slim` con `backend/`, `.venv`, y `COPY --from` de
   `frontend/dist` → la SPA queda servida por el backend (sin Nginx).
3. No exponer con `HOST=0.0.0.0` sin auth/tls (ver [06-seguridad](06-seguridad.md)).

---

Siguiente lectura: [09 · Guía de extensión](09-guia-extension.md).