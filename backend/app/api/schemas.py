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
    #: Total de ítems que cumplen los filtros, **antes** de paginar.
    total: int
    #: Desplazamiento de la ventana devuelta.
    offset: int = 0
    #: Tamaño de la ventana devuelta (≤ 200).
    limite: int = 200
    #: Quedan ítems después de esta ventana.
    hay_mas: bool = False
    sprint_actual: str = ""


class SprintOut(BaseModel):
    nombre: str
    ruta: str = ""
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


# --------------------------------------------------------------------- #
# Analítica QA: las señales diferenciales (§6 del plan)
# --------------------------------------------------------------------- #
class MuestraItem(BaseModel):
    azure_id: int
    tipo: str = ""
    titulo: str = ""
    estado: str = ""
    sprint: str = ""
    persona: str = ""
    modificado: str = ""


class ResumenVerificacion(BaseModel):
    bugs: int = 0
    bugs_cerrados_sin_verificar: int = 0
    bugs_verificados_sin_cerrar: int = 0
    historias: int = 0
    historias_sin_evidencia: int = 0
    verificados: int = 0
    generado: str = ""


class BrechaVerificacion(BaseModel):
    resumen: ResumenVerificacion
    cerrados_sin_verificar: List[MuestraItem] = []
    verificados_sin_cerrar: List[MuestraItem] = []
    historias_sin_evidencia: List[MuestraItem] = []


class ResumenAging(BaseModel):
    inactivos: int = 0
    en_curso: int = 0
    dias_inactivo: int = 14
    dias_en_curso: int = 30
    generado: str = ""


class TrabajoEstancado(BaseModel):
    resumen: ResumenAging
    inactivos: List[MuestraItem] = []
    en_curso: List[MuestraItem] = []


class RezagoDeSprint(BaseModel):
    sprint: str
    abiertos: int
    items: List[MuestraItem] = []


class ResumenRezago(BaseModel):
    sprints: int = 0
    sprint_referencia: str = ""
    sprints_con_rezago: int = 0
    rezagados: int = 0
    generado: str = ""


class RezagoEntreSprints(BaseModel):
    resumen: ResumenRezago
    sprints: List[RezagoDeSprint] = []


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