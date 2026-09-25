"""Rutas HTTP del dashboard de épicas de Azure DevOps."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from ..application.services import ServicioBacklog
from ..domain.models import Epic
from ..infrastructure.azure.transport import AzureError
from .deps import ServicioDep
from .schemas import (
    DetalleBugs,
    EpicaResumen,
    EstadoAzure,
    Health,
    ListaEpicas,
    Mensaje,
    ResultadoEscritura,
    a_resumen,
)
from ..domain.models import ActualizacionQA
from ..application.services import EscrituraNoHabilitadaError
from ..infrastructure.azure.escritura import ErrorValidacionEscritura

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


@router.get(
    "/api/epics/{epic_id}/arbol",
    response_model=Epic,
    response_model_exclude_none=True,
    tags=["Epicas"],
)
async def api_arbol_epica(
    servicio: ServicioDep,
    epic_id: Annotated[int, Path(gt=0)],
    incluir_bugs: bool = False,
) -> Epic:
    """Árbol completo Épica -> Features/User Stories -> Bugs/Tasks."""
    _requiere_configuracion(servicio)
    try:
        epica = await servicio.arbol_epica(epic_id, incluir_bugs=incluir_bugs)
    except AzureError as exc:
        raise _error_azure(exc, not_found=True)
    if epica is None:
        raise HTTPException(status_code=404, detail=f"Épica {epic_id} no encontrada.")
    return epica


@router.get("/api/epics/{epic_id}/bugs", response_model=DetalleBugs, tags=["Epicas"])
async def api_bugs_epica(
    servicio: ServicioDep,
    epic_id: Annotated[int, Path(gt=0)],
    incluir_cerradas: bool = False,
) -> DetalleBugs:
    """Bugs relacionados con la épica y métricas agregadas."""
    _requiere_configuracion(servicio)
    try:
        detalle = await servicio.bugs_epica(
            epic_id, incluir_cerradas=incluir_cerradas
        )
    except AzureError as exc:
        raise _error_azure(exc, not_found=True)
    if detalle is None:
        raise HTTPException(status_code=404, detail=f"Épica {epic_id} no encontrada.")
    return detalle


@router.post("/api/epics/refresh", response_model=Mensaje, tags=["Epicas"])
async def api_refrescar(servicio: ServicioDep) -> Mensaje:
    """Invalida la caché para leer datos frescos de Azure en la próxima llamada."""
    servicio.refrescar()
    return Mensaje(
        ok=True,
        detalle="Caché invalidada. La próxima consulta leerá de Azure.",
    )


# ---------------------------------------------------------------------- #
# Escritura QA (opt-in, ADR-11)
# ---------------------------------------------------------------------- #
@router.patch(
    "/api/workitems/{work_item_id}",
    response_model=ResultadoEscritura,
    tags=["Escritura"],
)
async def api_actualizar_work_item(
    servicio: ServicioDep,
    work_item_id: Annotated[int, Path(gt=0)],
    cambios: ActualizacionQA,
    validar: bool = False,
    rev_esperada: int | None = None,
) -> ResultadoEscritura:
    """Actualiza un work item con los campos de QA (tags, estado, notas…).

    Con ``?validar=true`` no escribe nada: Azure comprueba las reglas del
    proyecto y responde si el cambio sería válido (equivale a
    ``validateOnly``). ``rev_esperada`` protege contra sobrescribir la edición
    de otro QA.
    """
    try:
        resultado = await servicio.actualizar_work_item(
            work_item_id,
            cambios,
            validar=validar,
            rev_esperada=rev_esperada,
        )
    except EscrituraNoHabilitadaError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ErrorValidacionEscritura as exc:
        # Validación local: la petición nunca alcanzó Azure.
        raise HTTPException(status_code=422, detail=str(exc))
    except AzureError as exc:
        logger.warning("Error al escribir el work item %s: %s", work_item_id, exc)
        detalle = exc.detalle or "Azure rechazó el cambio."
        raise HTTPException(status_code=409, detail=detalle)
    return ResultadoEscritura(**resultado.model_dump())


@router.get(
    "/api/workitems/{work_item_id}/rev",
    response_model=Mensaje,
    tags=["Escritura"],
)
async def api_revision_work_item(
    servicio: ServicioDep,
    work_item_id: Annotated[int, Path(gt=0)],
) -> Mensaje:
    """Revisión actual del work item, para control de concurrencia."""
    if not servicio.escritura_habilitada:
        raise HTTPException(
            status_code=409,
            detail="La escritura está deshabilitada; no hay revisión que leer.",
        )
    try:
        rev = await servicio.revision_work_item(work_item_id)
    except AzureError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return Mensaje(ok=True, detalle=str(rev))