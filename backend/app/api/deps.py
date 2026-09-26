"""Dependencias de FastAPI: acceso al grafo contenedor/servicio."""

from typing import Annotated, Optional

from fastapi import Depends, Request

from ..application.indice import IndiceWorkItems
from ..application.services import ServicioBacklog
from ..core.container import Contenedor


def obtener_contenedor(request: Request) -> Contenedor:
    return request.app.state.contenedor  # type: ignore[no-any-return]


def obtener_servicio(contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]) -> ServicioBacklog:
    return contenedor.servicio


def obtener_indice(contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]) -> IndiceWorkItems:
    return contenedor.indice


ServicioDep = Annotated[ServicioBacklog, Depends(obtener_servicio)]
IndiceDep = Annotated[IndiceWorkItems, Depends(obtener_indice)]