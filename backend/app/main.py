"""Fábrica de la aplicación FastAPI.

Responsabilidades: montar las rutas de la API, aplicar CORS acotado al
origen del frontend, servir el build estático del SPA (si existe) y traducir
:class:`AzureError` a respuestas HTTP 502 con detalle útil (sin secretos).
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .core.container import Contenedor, crear_contenedor
from .core.logging import configurar_logging
from .infrastructure.azure.transport import AzureError

VERSION = "0.1.0"
logger = logging.getLogger("devops")


def _montar_frontend(app: FastAPI, ruta_raiz: Path) -> None:
    """Sirve el build de Vite si existe; mantiene disponible /api."""
    dist = ruta_raiz.parents[1] / "frontend" / "dist"
    if not dist.is_dir():
        return
    app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")
    logger.info("Sirviendo frontend desde %s", dist)


def crear_app(contenedor: Contenedor | None = None) -> FastAPI:
    container = contenedor or crear_contenedor()
    cfg = container.settings
    configurar_logging(cfg.log_nivel)

    @asynccontextmanager
    async def _lifespan(_: FastAPI):
        app.state.contenedor = container
        try:
            yield
        finally:
            await container.transporte.cerrar()
            if container.transporte_escritura is not None:
                await container.transporte_escritura.cerrar()

    app = FastAPI(
        title="Dashboard de Épicas — Azure DevOps",
        description="Lector de solo lectura del backlog de épicas de Azure "
        "DevOps (CIA), con drill-down Épica -> Feature -> User Story.",
        version=VERSION,
        lifespan=_lifespan,
    )
    app.state.contenedor = container

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"http://{cfg.host}:{cfg.puerto}"] + cfg.origenes_cors,
        # PATCH está presente para la escritura QA (ADR-11); sin él el
        # navegador bloquearía /api/workitems/{id} en desarrollo.
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(AzureError)
    async def _azure_error(_: Request, exc: AzureError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    app.include_router(router)
    _montar_frontend(app, Path(__file__).parent)
    return app


app = crear_app()