"""Modelos de dominio del Backlog de Azure DevOps.

Son modelos puramente de negocio: no conocen HTTP, WIQL ni la API REST.
Los estados de Azure se representan como texto porque varían según la
plantilla de proceso (Scrum / Agile / CMMI) y deben poder crecer sin
cambiar el modelo (abierto a extensión).
"""

from typing import List

from pydantic import BaseModel, Field


class Task(BaseModel):
    """Tarea de una historia de usuario."""

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    url: str = ""


class UserStory(BaseModel):
    """Historia de usuario (agrupa tareas)."""

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    url: str = ""
    tareas: List[Task] = Field(default_factory=list)


class Feature(BaseModel):
    """Feature / MVP: agrupa user stories bajo una épica."""

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    url: str = ""
    hus: List[UserStory] = Field(default_factory=list)


class Epic(BaseModel):
    """Épica: raíz del árbol del backlog."""

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    features: List[Feature] = Field(default_factory=list)
    hus: List[UserStory] = Field(default_factory=list)
    url: str = ""


class EstadoIntegracion(BaseModel):
    """Resumen del estado de la integración para la UI (sin secretos)."""

    configurada: bool = False
    organizacion: str = ""
    proyecto: str = ""
    area_path: str = ""
    verificado: bool = False
    error: str = ""