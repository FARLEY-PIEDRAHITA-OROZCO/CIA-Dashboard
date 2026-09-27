"""Modelos de dominio del Backlog de Azure DevOps.

Son modelos puramente de negocio: no conocen HTTP, WIQL ni la API REST.
Los estados de Azure se representan como texto porque varían según la
plantilla de proceso (Scrum / Agile / CMMI) y deben poder crecer sin
cambiar el modelo (abierto a extensión).
"""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, model_validator


#: Estados terminales habituales en plantillas Scrum/Agile/Basic. Azure trata
#: el estado como texto abierto, así que la lista es un conjunto de trabajo y
#: no un enum cerrado.
ESTADOS_CERRADOS = frozenset(
    {
        "closed",
        "done",
        "resolved",
        "removed",
        "canceled",
        "cancelled",
        "descartado",
    }
)


class Persona(BaseModel):
    """Persona asignada a un work item (``IdentityRef`` de Azure).

    ``guid`` es el identificador estable: los ``nombre`` cambian cuando alguien
    se renombra o cambia de cuenta, el GUID no. Se filtra por GUID y se muestra
    el nombre.
    """

    guid: str
    nombre: str = ""
    url: str = ""


class WorkItemBase(BaseModel):
    """Campos comunes de los work items de backlog.

    ``tags`` es el texto crudo de ``System.Tags`` (Azure lo separa por ``;``).
    El backend lo expone para que la UI muestre el valor actual al editar; la
    normalización ocurre en el adaptador de escritura.

    ``sprint`` guarda la ruta completa de iteración
    (``Proyecto\\Sprint 35``) porque es lo que acepta el filtro WIQL de Azure.
    ``asignado_a`` es ``None`` cuando el ítem no tiene responsable.
    """

    azure_id: int
    titulo: str = ""
    estado: str = ""
    descripcion: str = ""
    url: str = ""
    tags: str = ""
    sprint: str = ""
    asignado_a: Optional[Persona] = None
    creado: Optional[datetime] = None
    modificado: Optional[datetime] = None


class Task(WorkItemBase):
    """Tarea de una historia o de un bug."""

    bugs: Optional[List["Bug"]] = None


class Bug(WorkItemBase):
    """Bug jerárquico o bug relacionado con una HU/tarea."""

    prioridad: str = ""
    severidad: str = ""
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


class ItemIndice(BaseModel):
    """Proyección plana de un work item para el índice de sprints y personas.

    Es deliberadamente **plana** (sin `tareas` ni `bugs` anidados): el índice
    alimenta listados y métricas, no la vista de árbol. El repositorio es el
    único que traduce los nombres de campo de Azure; el índice razona en
    términos de dominio.
    """

    azure_id: int
    tipo: str = ""
    titulo: str = ""
    estado: str = ""
    tags: str = ""
    sprint: str = ""
    persona: Optional[Persona] = None
    creado: Optional[datetime] = None
    modificado: Optional[datetime] = None

    @property
    def cerrado(self) -> bool:
        """True si el estado es terminal en Scrum/Agile/Basic."""
        return (self.estado or "").strip().lower() in ESTADOS_CERRADOS

    @property
    def etiquetas(self) -> List[str]:
        """Tags normalizados como lista.

        Azure los separa con ``;``; el formulario de escritura QA los envía con
        ``,``. Se aceptan ambos para no depender del formato.
        """
        if not self.tags:
            return []
        return [
            t.strip()
            for t in self.tags.replace(";", ",").split(",")
            if t.strip()
        ]


class ItemPrueba(BaseModel):
    """Un activo de pruebas: Test Plan, Test Suite o Test Case.

    Modelo **plano y propio**, separado de :class:`ItemIndice`. Un caso de
    prueba no es un ítem de trabajo: tiene estado de diseño (`Design`, `Ready`),
    estado de automatización (que no es un estado) y, sobre todo, el vínculo a
    los requisitos que prueba. Mezclarlos en el índice de sprints obligaría a
    pagar 3.932 ítems que nadie consulta al abrir los sprints.

    ``descripcion`` y los ``pasos`` de prueba **no** están aquí a propósito: son
    la causa de errores HTTP 500 al leer los 3.431 casos en lote, y no aportan a
    gestionar el proceso. Si hacen falta, van en un endpoint de detalle.
    """

    azure_id: int
    tipo: str = ""
    titulo: str = ""
    estado: str = ""
    sprint: str = ""
    persona: Optional[Persona] = None
    tags: str = ""
    #: `Microsoft.VSTS.Common.Priority`. Ojo: **no** es `System.Priority`, que no
    #: existe en esta plantilla y salía vacío en los 3.431 casos medidos.
    prioridad: str = ""
    #: `Not Automated` / `Planned` / `Automated`. Eje independiente del estado.
    automatizacion: str = ""
    ragon: str = ""
    creado: Optional[datetime] = None
    modificado: Optional[datetime] = None
    #: Requisitos que este caso prueba, leídos de `TestedBy-Reverse`.
    requisitos: List[int] = Field(default_factory=list)

    @property
    def automatizado(self) -> bool:
        """True solo si Azure lo marca como automatizado de verdad.

        `Planned` **no** cuenta: un caso «planificado» para automatizar sigue
        siendo manual hoy, y contarlo como automatizado inflaría la métrica.
        """
        return (self.automatizacion or "").strip().lower() == "automated"

    @property
    def cierra_en_este_sprint(self) -> bool:
        """El Sprint hoja es un nombre real, no la raíz de la jerarquía."""
        return bool(self.sprint) and "\\" in self.sprint


class CargaPruebas(BaseModel):
    """Resultado de leer el inventario de activos de prueba.

    ``lotes_con_error`` no es un detalle de logging. Un lote caído deja fuera
    hasta 200 casos, y si eso se pasa por alto la cobertura cuenta como
    «descubierta» una historia que sí tiene caso: **el número mentiría hacia el
    lado que blames al equipo**. Por eso el error viaja con los datos y la
    respuesta lo declara como cobertura parcial.
    """

    items: List[ItemPrueba] = Field(default_factory=list)
    lotes_con_error: int = 0
    lotes_totales: int = 0

    @property
    def parcial(self) -> bool:
        """True si algún lote de relaciones no se pudo leer."""
        return self.lotes_con_error > 0


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
