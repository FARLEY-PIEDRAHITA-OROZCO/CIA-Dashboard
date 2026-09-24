"""Esquemas de respuesta de la API (contrato estable con el frontend).

Reutiliza los modelos de dominio (ya son Pydantic) y añade envoltorios de
listado. Las respuestas jamás contienen credenciales.
"""

from typing import List

from pydantic import BaseModel

from ..domain.models import Epic, EstadoIntegracion


class EpicaResumen(BaseModel):
    azure_id: int
    titulo: str
    estado: str
    url: str = ""


def a_resumen(epica: Epic) -> EpicaResumen:
    return EpicaResumen(
        azure_id=epica.azure_id,
        titulo=epica.titulo,
        estado=epica.estado,
        url=epica.url,
    )


class ListaEpicas(BaseModel):
    epicas: List[EpicaResumen]


class EstadoAzure(BaseModel):
    configurada: bool
    organizacion: str
    proyecto: str
    area_path: str
    verificado: bool
    error: str = ""


class Mensaje(BaseModel):
    ok: bool = True
    detalle: str = ""


class Health(BaseModel):
    estado: str = "ok"
    version: str = "0.1.0"