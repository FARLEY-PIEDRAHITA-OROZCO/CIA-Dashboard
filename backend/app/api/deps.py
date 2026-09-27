"""Dependencias de FastAPI: acceso al grafo contenedor/servicio."""

from typing import Annotated, Optional

from fastapi import Depends, Request

from ..application.indice import IndiceWorkItems
from ..application.indice_pruebas import IndicePruebas
from ..application.registro import ServicioRegistro
from ..application.services import ServicioBacklog
from ..core.container import Contenedor


def obtener_contenedor(request: Request) -> Contenedor:
    return request.app.state.contenedor  # type: ignore[no-any-return]


def obtener_servicio(contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]) -> ServicioBacklog:
    return contenedor.servicio


def obtener_indice(contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]) -> IndiceWorkItems:
    return contenedor.indice


def obtener_indice_pruebas(
    contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]
) -> IndicePruebas:
    return contenedor.indice_pruebas


def obtener_registro(
    contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]
) -> ServicioRegistro:
    return contenedor.servicio_registro


ServicioDep = Annotated[ServicioBacklog, Depends(obtener_servicio)]
IndiceDep = Annotated[IndiceWorkItems, Depends(obtener_indice)]
IndicePruebasDep = Annotated[IndicePruebas, Depends(obtener_indice_pruebas)]
RegistroDep = Annotated[ServicioRegistro, Depends(obtener_registro)]