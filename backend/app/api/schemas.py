"""Esquemas de respuesta de la API (contrato estable con el frontend).

Reutiliza los modelos de dominio (ya son Pydantic) y añade envoltorios de
listado. Las respuestas jamás contienen credenciales.
"""

from datetime import datetime
from typing import List

from pydantic import BaseModel

from ..domain.models import Bug, Epic, EstadoIntegracion, MetricasBug, Persona


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


class DetalleBugs(BaseModel):
    bugs: List[Bug]
    metricas: MetricasBug


# --------------------------------------------------------------------- #
# Sprints, personas e índice (Fases 2-3)
# --------------------------------------------------------------------- #
class ItemIndiceOut(BaseModel):
    azure_id: int
    tipo: str = ""
    titulo: str = ""
    estado: str = ""
    tags: str = ""
    sprint: str = ""
    persona: Persona | None = None
    creado: datetime | None = None
    modificado: datetime | None = None
    cerrado: bool = False


class ListaItems(BaseModel):
    items: List[ItemIndiceOut]
    total: int
    sprint_actual: str = ""


class SprintOut(BaseModel):
    nombre: str
    total: int
    abiertos: int
    cerrados: int
    personas: int
    ultimo_cambio: str = ""


class ListaSprints(BaseModel):
    sprints: List[SprintOut]
    total: int
    sprint_actual: str = ""


class PersonaOut(BaseModel):
    guid: str
    nombre: str
    total: int
    abiertos: int
    bugs: int
    bugs_abiertos: int
    verificados: int


class ListaPersonas(BaseModel):
    personas: List[PersonaOut]
    total: int


class ResultadoEscritura(BaseModel):
    """Resultado de una escritura de QA (o de su validación en seco)."""

    work_item_id: int
    rev: int
    campos: List[str] = []
    validado: bool = False
    detalle: str = ""


class Mensaje(BaseModel):
    ok: bool = True
    detalle: str = ""


class Health(BaseModel):
    estado: str = "ok"
    version: str = "0.1.0"