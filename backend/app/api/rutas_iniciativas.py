"""Endpoints de gestión de carpetas de iniciativas."""

import logging
from pathlib import Path
from typing import Annotated, List

from fastapi import APIRouter, HTTPException, Query, UploadFile, File

from ..application.iniciativas import (
    SUBCARPETAS,
    ServicioIniciativas,
)
from .deps import IniciativasDep

logger = logging.getLogger("devops")

router = APIRouter()


# ---------------------------------------------------------------------- #
# Configuración
# ---------------------------------------------------------------------- #

@router.get("/api/configuracion/ruta-onedrive")
async def obtener_ruta_onedrive(servicio: IniciativasDep) -> dict:
    """Estado actual de la ruta base de OneDrive."""
    estado = servicio.estado_ruta()
    return {
        "ruta": estado.ruta,
        "existe": estado.existe,
        "escribible": estado.escribible,
        "total_iniciativas": estado.total_iniciativas,
    }


@router.put("/api/configuracion/ruta-onedrive")
async def actualizar_ruta_onedrive(
    servicio: IniciativasDep,
    cuerpo: dict,
) -> dict:
    """Actualiza la ruta base de OneDrive."""
    ruta = cuerpo.get("ruta", "")
    if not ruta:
        raise HTTPException(
            status_code=422,
            detail="El campo 'ruta' es obligatorio",
        )
    estado = servicio.actualizar_ruta(ruta)
    return {
        "ruta": estado.ruta,
        "existe": estado.existe,
        "escribible": estado.escribible,
        "total_iniciativas": estado.total_iniciativas,
    }


# ---------------------------------------------------------------------- #
# Iniciativas
# ---------------------------------------------------------------------- #

@router.get("/api/iniciativas")
async def listar_iniciativas(servicio: IniciativasDep) -> dict:
    """Lista de iniciativas a cargo con su carpeta."""
    iniciativas = servicio.listar_iniciativas()
    return {
        "iniciativas": [
            {
                "epica_id": i.epica_id,
                "numero": i.numero,
                "nombre": i.nombre,
                "ruta": i.ruta,
                "creada": i.creada,
            }
            for i in iniciativas
        ],
        "subcarpetas": SUBCARPETAS,
    }


@router.post("/api/iniciativas/{epica_id}/crear")
async def crear_estructura(
    servicio: IniciativasDep,
    epica_id: int,
    nombre: Annotated[str, Query(min_length=1)],
) -> dict:
    """Crea la estructura de carpetas para una iniciativa."""
    try:
        iniciativa = servicio.crear_estructura(epica_id, nombre)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "epica_id": iniciativa.epica_id,
        "numero": iniciativa.numero,
        "nombre": iniciativa.nombre,
        "ruta": iniciativa.ruta,
        "creada": iniciativa.creada,
    }


@router.delete("/api/iniciativas/{epica_id}")
async def eliminar_estructura(
    servicio: IniciativasDep,
    epica_id: int,
) -> dict:
    """Elimina la carpeta y el registro de una iniciativa."""
    try:
        eliminado = servicio.eliminar_estructura(epica_id)
    except Exception as exc:
        logger.error(
            "Error al eliminar estructura de iniciativa %d: %s",
            epica_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo eliminar la estructura: {exc}",
        ) from exc

    if not eliminado:
        raise HTTPException(
            status_code=404,
            detail=f"No existe estructura para la iniciativa {epica_id}",
        )
    return {"ok": True, "detalle": "Estructura eliminada"}


# ---------------------------------------------------------------------- #
# Archivos
# ---------------------------------------------------------------------- #

@router.get("/api/iniciativas/{epica_id}/archivos")
async def listar_archivos(
    servicio: IniciativasDep,
    epica_id: int,
    carpeta: Annotated[str, Query(min_length=1)],
) -> dict:
    """Lista los archivos de una subcarpeta."""
    try:
        archivos = servicio.listar_archivos(epica_id, carpeta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"carpeta": carpeta, "archivos": archivos}


@router.post("/api/iniciativas/{epica_id}/archivos")
async def subir_archivo(
    servicio: IniciativasDep,
    epica_id: int,
    carpeta: Annotated[str, Query(min_length=1)],
    archivo: UploadFile = File(...),
) -> dict:
    """Sube un archivo a una subcarpeta."""
    try:
        contenido = await archivo.read()
        resultado = servicio.subir_archivo(
            epica_id, carpeta, archivo.filename or "archivo", contenido
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except OSError as exc:
        logger.error(
            "Error al subir archivo a iniciativa %d: %s", epica_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo subir el archivo: {exc}",
        ) from exc

    return resultado


@router.delete("/api/iniciativas/{epica_id}/archivos/{nombre}")
async def eliminar_archivo(
    servicio: IniciativasDep,
    epica_id: int,
    carpeta: Annotated[str, Query(min_length=1)],
    nombre: str,
) -> dict:
    """Elimina un archivo de una subcarpeta."""
    try:
        eliminado = servicio.eliminar_archivo(epica_id, carpeta, nombre)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not eliminado:
        raise HTTPException(
            status_code=404,
            detail=f"Archivo no encontrado: {nombre}",
        )
    return {"ok": True, "detalle": "Archivo eliminado"}


@router.get("/api/iniciativas/{epica_id}/abrir")
async def abrir_en_explorador(
    servicio: IniciativasDep,
    epica_id: int,
) -> dict:
    """Devuelve la ruta para abrir en el explorador de archivos."""
    try:
        ruta = servicio.abrir_en_explorador(epica_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {"ruta": ruta}
