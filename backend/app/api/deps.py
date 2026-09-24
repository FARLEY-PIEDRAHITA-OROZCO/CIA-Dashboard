"""Dependencias de FastAPI: acceso al grafo contenedor/servicio."""

from typing import Annotated, Optional

from fastapi import Depends, Request

from ..application.services import ServicioBacklog
from ..core.container import Contenedor


def obtener_contenedor(request: Request) -> Contenedor:
    return request.app.state.contenedor  # type: ignore[no-any-return]


def obtener_servicio(contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]) -> ServicioBacklog:
    return contenedor.servicio


ServicioDep = Annotated[ServicioBacklog, Depends(obtener_servicio)]