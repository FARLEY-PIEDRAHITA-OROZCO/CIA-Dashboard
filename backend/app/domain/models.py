"""Modelos de dominio del Backlog de Azure DevOps.

Son modelos puramente de negocio: no conocen HTTP, WIQL ni la API REST.
Los estados de Azure se representan como texto porque varían según la
plantilla de proceso (Scrum / Agile / CMMI) y deben poder crecer sin
cambiar el modelo (abierto a extensión).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Dict, FrozenSet, List, Optional

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


#: Tipos de work item que QA puede editar, con los campos que admiten.
#:
#: **Fuente única de verdad** de la lista blanca (ADR-11, Fase 5). Un tipo
#: ausente de esta tabla no es editable; un campo ausente de la lista de un tipo
#: no se puede escribir en él. La tabla sustituye a dos listas paralelas
#: (tipos editables + campos por tipo) que divergirían en silencio, y la consulta
#: la usan tanto el adaptador de escritura como la API que informa al frontend de
#: qué controles ofrecer.
#:
#: Medido contra el proyecto real el 2026-09-27 leyendo qué campos devuelve Azure
#: por tipo, **sin asumir el nombre del campo**:
#:
#: ============  =========  =========  ========  ======  ========
#: Tipo         Prioridad  Severidad  Tags      Notas   Campos
#: ============  =========  =========  ========  ======  ========
#: Bug               sí        sí       sí       sí      32
#: Issue             sí        no       sí       sí      32
#: User Story        sí        no       sí       sí      36
#: Task              sí        no       sí       sí      33
#: Epic              sí        no       sí       sí      38
#: Feature           sí        no       sí       sí      36
#: Test Plan         **no**    **no**   **no**   **no**   27
#: Test Suite        **no**    **no**   **no**   **no**   28
#: Test Case         sí        no       sí       sí      33
#: ============  =========  =========  ========  ======  ========
#:
#: El dato que obliga a esto: **``Test Plan`` y ``Test Suite`` no tienen ninguno
#: de los cuatro campos**. En los 44 planes y 457 suites del proyecto, Tags,
#: Description y Priority salen a 0, y los campos ni siquiera aparecen en la
#: respuesta de Azure (27 y 28 campos frente a los 33 de un caso). Quedan
#: editables **solo en su estado**, que es lo único que su tipo tiene: no es una
#: limitación de la herramienta, es la forma del tipo en la plantilla.
#:
#: .. warning:: **Azure no nos ayuda a impedirlo, y por eso esta tabla importa.**
#:    Comprobado con ``validateOnly=true`` el 2026-09-27: escribir ``Severity``
#:    en un ``Test Case``, o ``Tags`` y ``Description`` en un ``Test Plan``,
#:    **pasa la validación de Azure**. Lo que Azure sí comprueba es el *valor*
#:    (una severidad inventada o un estado inexistente dan HTTP 400), no la
#:    *existencia del campo en el tipo*. Escribir un campo que el tipo no tiene
#:    crea un campo huérfano que nadie lee, o se descarta en silencio. Ninguna de
#:    las dos cosas es un error visible, así que la única forma de evitarlo es no
#:    ofrecer el campo: de ahí la lista blanca por tipo.
#:
#: ``Epic`` y ``Feature`` no aparecen y por eso quedan rechazados: es la decisión
#: de ADR-11 que hasta ahora solo vivía en que la UI no ofrecía el formulario.
#: ``Issue`` tampoco, por lo mismo: el campo existiría, pero no hay formulario.
CAMPOS_POR_TIPO: Dict[str, FrozenSet[str]] = {
    "Bug": frozenset({"estado", "prioridad", "severidad", "tags", "notas_qa"}),
    "User Story": frozenset({"estado", "prioridad", "tags", "notas_qa"}),
    "Task": frozenset({"estado", "prioridad", "tags", "notas_qa"}),
    "Test Plan": frozenset({"estado"}),
    "Test Suite": frozenset({"estado"}),
    "Test Case": frozenset({"estado", "prioridad", "tags", "notas_qa"}),
}

#: Campos de :class:`ActualizacionQA` en el orden en que se reportan.
CAMPOS_QA = ("estado", "prioridad", "severidad", "tags", "notas_qa")

#: Tipos con un único campo editable, con el mensaje que lo explica.
_ESTADO_UNICO = ("Test Plan", "Test Suite")


def campos_admitidos(tipo: str) -> FrozenSet[str]:
    """Campos que QA puede escribir en un tipo, o conjunto vacío si no es editable."""
    return CAMPOS_POR_TIPO.get((tipo or "").strip(), frozenset())


#: Rol que alguien tiene en el proceso de pruebas de una épica.
#:
#: Texto y no `Enum`: es parte del contrato del fichero de registro y de la API,
#: y un `Enum` obliga a migrar el JSON cada vez que se renombra un rol. La lista
#: de valores válidos está en `ROLES`.
ROLES = ("qa", "dev")


class PerfilPersona(BaseModel):
    """Qué papel juega una persona en el proceso de pruebas.

    Vive **en el registro local**, no en Azure: no existe ningún campo de Azure
    para esto, y por eso esta información se perdería si se guardara solo allí.
    Se identifica por GUID porque el nombre de una persona cambia cuando se
    renombra o cambia de cuenta, y una asignación no debe romperse por eso.
    """

    guid: str
    es_qa: bool = False
    es_dev: bool = False
    #: Rol forzado a mano. `None` significa «sin criterio», que no es lo mismo
    #: que `False`: la sugerencia automática nunca sobrescribe una decisión.
    forzado: Optional[bool] = None

    @property
    def es_ambos(self) -> bool:
        """Alguien que hace de QA y de desarrollo a la vez.

        Es habitual en equipos pequeños y tratarlo como error obligaría a elegir
        un rol que no es cierto.
        """
        return self.es_qa and self.es_dev


class Asignacion(BaseModel):
    """Una épica asignada a una persona, con su rol y desde cuándo.

    `desde` es **la** fecha que sostiene el «tiempo invertido»: días laborables
    entre ese día y hoy. No se puede poner en el futuro, porque una diferencia
    negativo no significa nada y delataría que la fecha es una estimativa.
    """

    epica: int
    persona: str
    rol: str = "qa"
    desde: date
    nota: str = ""

    @model_validator(mode="after")
    def _comprobar_rol(self) -> "Asignacion":
        if self.rol not in ROLES:
            raise ValueError(f"Rol desconocido: {self.rol!r}. Admitidos: {', '.join(ROLES)}.")
        if self.epica <= 0:
            raise ValueError("El id de la épica debe ser un entero positivo.")
        if not (self.persona or "").strip():
            raise ValueError("La asignación necesita el GUID de una persona.")
        return self


class Instantanea(BaseModel):
    """Contenido del registro junto al hash de lo que se leyó del disco.

    El hash es lo que permite **no pisar cambios ajenos**: al guardar se vuelve
    a calcular el del fichero y, si no coincide con el que traía esta
    instantánea, la escritura se rechaza.

    Sin esto, dos pestañas abiertas —o un `git checkout` de otra rama—
    se sobrescriben en silencio. Y aquí no hay red de seguridad: la información de
    qué épica lleva cada persona no existe en Azure, así que lo que se pisa está
    perdido.
    """

    #: `perfiles` y `asignaciones`, ya validados.
    perfiles: Dict[str, PerfilPersona] = Field(default_factory=dict)
    asignaciones: List[Asignacion] = Field(default_factory=list)
    #: Hash SHA-256 del fichero leído. Vacío si no existía.
    hash: str = ""
    #: `True` cuando el fichero no existía y se devolvió un registro vacío.
    #: No es un error: es el primer arranque.
    recien_creado: bool = False


class ResultadoActualizacion(BaseModel):
    """Resultado de una escritura (o de su validación en seco)."""

    work_item_id: int
    rev: int
    campos: List[str] = Field(default_factory=list)
    validado: bool = False
    detalle: str = ""
