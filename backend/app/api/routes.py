"""Rutas HTTP del dashboard de épicas de Azure DevOps."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from ..application.services import ServicioBacklog
from ..domain.models import Epic
from ..infrastructure.azure.transport import AzureError
from .deps import ServicioDep
from .schemas import (
    EpicaResumen,
    EstadoAzure,
    Health,
    ListaEpicas,
    Mensaje,
    a_resumen,
)

logger = logging.getLogger("devops")
router = APIRouter()


def _error_azure(exc: AzureError, *, not_found: bool = False) -> HTTPException:
    logger.warning("Error en lectura de backlog: %s", exc)
    status = 404 if not_found and exc.status_code == 404 else 502
    return HTTPException(status_code=status, detail=str(exc))


def _requiere_configuracion(servicio: ServicioBacklog) -> None:
    if not servicio.configurado:
        raise HTTPException(
            status_code=409,
            detail="Azure DevOps no está configurado. Define organizacion, "
            "proyecto y PAT en el .env del backend.",
        )


@router.get("/api/health", response_model=Health, tags=["Salud"])
async def api_health() -> Health:
    return Health()


@router.get("/api/azure/estado", response_model=EstadoAzure, tags=["Azure"])
async def api_estado_integracion(servicio: ServicioDep) -> EstadoAzure:
    estado = await servicio.estado()
    return EstadoAzure(**estado.model_dump())


@router.get("/api/epics", response_model=ListaEpicas, tags=["Epicas"])
async def api_listar_epicas(
    servicio: ServicioDep,
    incluir_cerradas: bool = False,
) -> ListaEpicas:
    """Lista liviana de épicas del AreaPath.

    Por defecto excluye las épicas cerradas (replica el conteo del backlog
    del equipo). Pasa ``?incluir_cerradas=true`` para incluirlas.
    """
    _requiere_configuracion(servicio)
    try:
        epicas = await servicio.listar_epicas(incluir_cerradas=incluir_cerradas)
    except AzureError as exc:
        raise _error_azure(exc)
    return ListaEpicas(epicas=[a_resumen(e) for e in epicas])


@router.get("/api/epics/{epic_id}/arbol", response_model=Epic, tags=["Epicas"])
async def api_arbol_epica(
    servicio: ServicioDep,
    epic_id: Annotated[int, Path(gt=0)],
) -> Epic:
    """Árbol completo Épica -> Features -> User Stories -> Tasks."""
    _requiere_configuracion(servicio)
    try:
        epica = await servicio.arbol_epica(epic_id)
    except AzureError as exc:
        raise _error_azure(exc, not_found=True)
    if epica is None:
        raise HTTPException(status_code=404, detail=f"Épica {epic_id} no encontrada.")
    return epica


@router.post("/api/epics/refresh", response_model=Mensaje, tags=["Epicas"])
async def api_refrescar(servicio: ServicioDep) -> Mensaje:
    """Invalida la caché para leer datos frescos de Azure en la próxima llamada."""
    servicio.refrescar()
    return Mensaje(
        ok=True,
        detalle="Caché invalidada. La próxima consulta leerá de Azure.",
    )