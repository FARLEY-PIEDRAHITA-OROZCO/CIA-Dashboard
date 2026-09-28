"""Dependencias de FastAPI: acceso al grafo contenedor/servicio."""

from typing import Annotated, Optional

from fastapi import Depends, Request

from ..application.actividad import ServicioActividad
from ..application.indice import IndiceWorkItems
from ..application.indice_pruebas import IndicePruebas
from ..application.registro import ServicioRegistro
from ..application.services import ServicioBacklog
from ..core.container import Contenedor
from ..infrastructure.registro_copia import RegistroConCopia


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


def obtener_actividad(
    contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]
) -> ServicioActividad:
    return contenedor.actividad


def obtener_registro_copia(
    contenedor: Annotated[Contenedor, Depends(obtener_contenedor)]
) -> RegistroConCopia:
    """El decorador de copia, no el puerto.

    Vive aparte de `RegistroDep` a propósito: `RegistroAsignacionesPort` es un
    contrato de persistencia y no tiene nada que decir de dónde se guarda. El
    estado del almacenamiento es información del adaptador concreto, y es el
    frontend quien lo necesita para no inventarse un mensaje sobre el respaldo.
    """
    return contenedor.registro_copia


ServicioDep = Annotated[ServicioBacklog, Depends(obtener_servicio)]
IndiceDep = Annotated[IndiceWorkItems, Depends(obtener_indice)]
IndicePruebasDep = Annotated[IndicePruebas, Depends(obtener_indice_pruebas)]
RegistroDep = Annotated[ServicioRegistro, Depends(obtener_registro)]
ActividadDep = Annotated[ServicioActividad, Depends(obtener_actividad)]
RegistroCopiaDep = Annotated[RegistroConCopia, Depends(obtener_registro_copia)]