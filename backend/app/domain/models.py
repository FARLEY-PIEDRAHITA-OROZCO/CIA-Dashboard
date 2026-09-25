"""Modelos de dominio del Backlog de Azure DevOps.

Son modelos puramente de negocio: no conocen HTTP, WIQL ni la API REST.
Los estados de Azure se representan como texto porque varían según la
plantilla de proceso (Scrum / Agile / CMMI) y deben poder crecer sin
cambiar el modelo (abierto a extensión).
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


class WorkItemBase(BaseModel):
    """Campos comunes de los work items de backlog.

    ``tags`` es el texto crudo de ``System.Tags`` (Azure lo separa por ``;``).
    El backend lo expone para que la UI muestre el valor actual al editar; la
    normalización ocurre en el adaptador de escritura.
    """

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    url: str = ""
    tags: str = ""


class Task(WorkItemBase):
    """Tarea de una historia o de un bug."""

    bugs: Optional[List["Bug"]] = None


class Bug(WorkItemBase):
    """Bug jerárquico o bug relacionado con una HU/tarea."""

    prioridad: str = ""
    severidad: str = ""
    asignado_a: str = ""
    relacion: str = "hierarchy"
    tareas: List[Task] = Field(default_factory=list)


class UserStory(WorkItemBase):
    """Historia de usuario (agrupa tareas y bugs)."""

    tareas: List[Task] = Field(default_factory=list)
    bugs: Optional[List[Bug]] = None


class Feature(WorkItemBase):
    """Feature / MVP: agrupa user stories bajo una épica."""

    hus: List[UserStory] = Field(default_factory=list)


class Epic(WorkItemBase):
    """Épica: raíz del árbol del backlog."""

    features: List[Feature] = Field(default_factory=list)
    hus: List[UserStory] = Field(default_factory=list)


class MetricasBug(BaseModel):
    """Métricas agregadas de bugs de una épica."""

    total: int = 0
    abiertos: int = 0
    cerrados: int = 0
    por_estado: Dict[str, int] = Field(default_factory=dict)
    por_prioridad: Dict[str, int] = Field(default_factory=dict)
    por_severidad: Dict[str, int] = Field(default_factory=dict)
    por_relacion: Dict[str, int] = Field(default_factory=dict)


class DetalleBugs(BaseModel):
    """Proyección de bugs y métricas para la vista de una épica."""

    bugs: List[Bug] = Field(default_factory=list)
    metricas: MetricasBug = Field(default_factory=MetricasBug)


class EstadoIntegracion(BaseModel):
    """Resumen del estado de la integración para la UI (sin secretos)."""

    configurada: bool = False
    organizacion: str = ""
    proyecto: str = ""
    area_path: str = ""
    verificado: bool = False
    error: str = ""


class ActualizacionQA(BaseModel):
    """Campos que QA puede modificar (lista blanca, ADR-11).

    Todos son opcionales y ``None`` significa "no tocar". El adaptador de
    escritura traduce esto a un JSON Patch acotado: cualquier campo fuera de
    este modelo se rechaza antes de llegar a Azure.
    """

    estado: Optional[str] = None
    prioridad: Optional[str] = None
    severidad: Optional[str] = None
    tags: Optional[str] = None
    notas_qa: Optional[str] = None

    @model_validator(mode="after")
    def _exigir_al_menos_un_campo(self) -> "ActualizacionQA":
        if not self.campos_modificados():
            raise ValueError("Indica al menos un campo a actualizar.")
        return self

    def campos_modificados(self) -> List[str]:
        """Nombres de los campos presentes en la actualización."""
        return [
            nombre
            for nombre in ("estado", "prioridad", "severidad", "tags", "notas_qa")
            if getattr(self, nombre) is not None
        ]


class ResultadoActualizacion(BaseModel):
    """Resultado de una escritura (o de su validación en seco)."""

    work_item_id: int
    rev: int
    campos: List[str] = Field(default_factory=list)
    validado: bool = False
    detalle: str = ""
