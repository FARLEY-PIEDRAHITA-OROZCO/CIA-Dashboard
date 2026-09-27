"""Esquemas de respuesta de la API (contrato estable con el frontend).

Reutiliza los modelos de dominio (ya son Pydantic) y añade envoltorios de
listado. Las respuestas jamás contienen credenciales.
"""

from datetime import date, datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from ..domain.models import ROLES, Bug, Epic, EstadoIntegracion, MetricasBug, Persona


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
    #: Ítems del índice local, incluidos los que no tienen sprint asignable.
    total_items: int = 0
    #: Ítems que sí están en algún sprint. `total_items - asignados` son los que
    #: no tienen sprint, y decirlo evita que la suma de las columnas se lea como
    #: el total del proyecto.
    asignados_a_sprint: int = 0


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


# ---------------------------------------------------------------------- #
# Gestión del proceso de pruebas (solo lectura)
# ---------------------------------------------------------------------- #
class InventarioPruebas(BaseModel):
    planes: int = 0
    suites: int = 0
    casos: int = 0
    total: int = 0


class AutomatizacionPruebas(BaseModel):
    """Eje **independiente** del estado: un caso `Closed` puede no estar
    automatizado, y uno `Design` puede estarlo. Por eso no es un tono de estado.
    """

    casos: int = 0
    automatizados: int = 0
    planificados: int = 0
    manuales: int = 0
    pct_automatizado: float = 0.0


class DisenoPruebas(BaseModel):
    """Casos en `Design`, separados entre trabajo reciente y caso abandonado.

    La separación importa: 1.577 casos en diseño no son todos deuda. Los que no
    se tocan desde hace más de `dias` no son trabajo en curso, son otra cosa.
    """

    en_diseno: int = 0
    sin_mover: int = 0
    dias: int = 0


class BrechaCobertura(BaseModel):
    historias: int = 0
    cubiertas: int = 0
    sin_cubrir: int = 0
    pct_cubiertas: float = 0.0
    parcial: bool = False
    requisitos_cubiertos_total: int = 0


class ResumenPruebas(BaseModel):
    inventario: InventarioPruebas
    estados: Dict[str, Dict[str, int]] = {}
    automatizacion: AutomatizacionPruebas
    diseno: DisenoPruebas
    brecha: BrechaCobertura
    parcial: bool = False
    generado: str = ""


class ResumenCobertura(BrechaCobertura):
    """Cobertura global. Comparte forma con `BrechaCobertura` a propósito.

    Hereda en vez de repetir los campos: el mismo objeto (`brecha` en
    `/resumen`, `resumen` en `/cobertura`) tiene que ser **el mismo tipo** en los
    dos endpoints. Con dos literales paralelos, cambiar uno y olvidar el otro
    rompe el frontend con «no es numérico» en un campo que sí existe en el otro.
    """

    lotes_con_error: int = 0
    generado: str = ""


class CoberturaDeSprint(BaseModel):
    nombre: str
    ruta: str = ""
    historias: int = 0
    cubiertas: int = 0
    sin_cubrir: int = 0
    pct_cubiertas: float = 0.0


class CoberturaPruebas(BaseModel):
    resumen: ResumenCobertura
    sprints: List[CoberturaDeSprint] = []


class PlanDePrueba(BaseModel):
    azure_id: int
    titulo: str = ""
    estado: str = ""
    sprint: str = ""
    persona: str = ""
    modificado: str = ""


class ResumenSinCubrir(BaseModel):
    total: int = 0
    offset: int = 0
    limite: int = 0
    hay_mas: bool = False
    parcial: bool = False
    lotes_con_error: int = 0


class HistoriaSinCubrir(BaseModel):
    """Historia sin caso de prueba.

    Modelo propio y no `MuestraItem`: reutilizar el de los ítems del índice
    obligaría a rellenar `tipo` con un valor inventado o a dejar el campo vacío,
    y un `tipo` en blanco en una lista de historias es un dato que no existe.
    """

    azure_id: int
    titulo: str = ""
    estado: str = ""
    sprint: str = ""
    persona: str = ""
    modificado: str = ""


class SinCubrir(BaseModel):
    resumen: ResumenSinCubrir
    items: List[HistoriaSinCubrir] = []


class ActivoDePrueba(BaseModel):
    """Activo de prueba en la lista editable.

    `campos_editables` lo envía el backend desde `CAMPOS_POR_TIPO`, la misma tabla
    que aplica el adaptador de escritura. El frontend **no** calcula qué controles
    ofrecer: si lo hiciera, bastaría con que los dos se equivocaran para ofrecer
    un campo que el tipo no tiene, y Azure lo aceptaría en silencio.
    """

    azure_id: int
    tipo: str
    titulo: str = ""
    estado: str = ""
    sprint: str = ""
    persona: str = ""
    tags: str = ""
    prioridad: str = ""
    automatizacion: str = ""
    modificado: str = ""
    campos_editables: List[str] = []


class ResumenActivos(BaseModel):
    total: int = 0
    offset: int = 0
    limite: int = 0
    hay_mas: bool = False
    parcial: bool = False
    lotes_con_error: int = 0


class ActivosPrueba(BaseModel):
    resumen: ResumenActivos
    items: List[ActivoDePrueba] = []
    #: Estados observados por tipo, para los selectores de transición.
    estados: Dict[str, List[str]] = {}


# ---------------------------------------------------------------------- #
# Registro local de pruebas (perfiles de rol)
# ---------------------------------------------------------------------- #
class PersonaQAOut(BaseModel):
    """Una persona del proyecto con su papel en el proceso de pruebas.

    `es_qa` y `es_dev` vienen del **registro local**, no de Azure: no existe
    ningún campo para esto. `forzado` dice si la decisión fue humana o si el
    campo está sin tocar.

    `dias_laborables` se llama así a propósito y no `horas`: el registro de
    tiempos de Azure responde 401 y **no hay fuente de horas** en ninguna parte.
    Contar días desde la asignación es un dato medido; estimar horas sería
    inventarlas, y un número inventado se usa para decidir.
    """

    guid: str
    nombre: str = ""
    es_qa: bool = False
    es_dev: bool = False
    forzado: Optional[bool] = None
    epicas: int = 0
    epicas_qa: int = 0
    epicas_dev: int = 0
    """Fecha de la asignación más antigua, o `""` si no tiene ninguna."""
    mas_antigua: str = ""
    dias_laborables: int = 0
    #: Carga real del backlog, para contrastar con lo declarado en el registro.
    items_backlog: int = 0
    bugs: int = 0


class ListaPersonasQA(BaseModel):
    personas: List[PersonaQAOut] = []
    total: int = 0
    #: Quantas tienen el rol de QA marcado en el registro.
    qa: int = 0
    dev: int = 0
    sin_rol: int = 0


class RolActualizable(BaseModel):
    """Cuerpo de `PUT /api/qa/personas/{guid}`. Los tres campos son opcionales.

    Un campo `null` significa "no lo toques"; `false` significa "quítaselo". La
    diferencia importa: si `es_qa` fuera obligatorio, no se podría quitar el rol
    sin mandar también el resto.
    """

    es_qa: Optional[bool] = None
    es_dev: Optional[bool] = None
    #: Marca la decisión como humana, para que la sugerencia no la replantee.
    forzado: Optional[bool] = None


class SugerenciaQA(BaseModel):
    """Personas que más tocan activos de prueba.

    Es una **sugerencia**, y se devuelve como tal: el backend no la guarda
    sola. Clasificar mal a alguien en el registro es peor que no proponer nada,
    porque el error queda y nadie lo revisa.
    """

    guid: str
    nombre: str = ""
    activos: int = 0
    #: `True` si esa persona ya está marcada como QA en el registro.
    ya_es_qa: bool = False


class SugerenciasQA(BaseModel):
    sugerencias: List[SugerenciaQA] = []
    #: Umbral aplicado, para que la UI pueda explicar por qué se propone esto.
    minimo: int = 0
    nota: str = ""


class AsignacionActualizable(BaseModel):
    """Cuerpo de `PUT /api/qa/asignaciones`. Es un *upsert* idempotente.

    Reenviar la misma pareja (épica, persona, rol) actualiza fecha y nota en vez
    de duplicar. Duplicar rompería «cuántas épicas lleva esta persona», que es
    justo el número que la vista quiere enseñar.
    """

    epica: int = Field(gt=0)
    persona: str = Field(min_length=1)
    rol: str = "qa"
    #: Opcional: si no viene, se usa hoy. No puede estar en el futuro.
    desde: Optional[date] = None
    nota: str = ""

    @field_validator("rol")
    @classmethod
    def _rol_conocido(cls, valor: str) -> str:
        if valor not in ROLES:
            raise ValueError(f"Rol desconocido: {valor!r}. Admitidos: {', '.join(ROLES)}.")
        return valor


class AsignacionOut(BaseModel):
    epica: int
    titulo: str = ""
    #: `False` si la épica ya no está en Azure. La asignación sigue existiendo,
    #: así que se muestra igual: ocultarla sería perderla de la vista sin aviso.
    titulo_conocido: bool = False
    persona: str
    nombre_persona: str = ""
    rol: str = "qa"
    desde: str = ""
    dias_laborables: int = 0
    nota: str = ""


class ListaAsignaciones(BaseModel):
    asignaciones: List[AsignacionOut] = []
    total: int = 0
    #: Épicas del registro que ya no existen en Azure. Se declaran en vez de
    #: ocultarlas: son trabajo registrado que alguien tiene que limpiar.
    epicas_desconocidas: int = 0


class AsignacionDePersona(BaseModel):
    guid: str
    nombre: str = ""
    es_qa: bool = False
    es_dev: bool = False
    epicas: int = 0
    #: Días de la asignación más antigua. **No son horas**: el registro de
    #: tiempos de Azure responde 401 y no hay fuente de horas.
    dias_laborables: int = 0
    desde: str = ""
    items_backlog: int = 0
    asignaciones: List[AsignacionOut] = []


class RevisionPorPersona(BaseModel):
    """Revisiones que hizo una persona, por GUID estable.

    El GUID va en la respuesta aunque no se use como clave: es lo que permite
    enlazar con `#/dashboard?qa=<guid>` sin volver a buscar por nombre, que no
    es único ni estable.
    """

    guid: str
    nombre: str = ""
    revisiones: int = 0


class ActividadEpicaOut(BaseModel):
    """Actividad registrada en una épica y su árbol.

    Los nombres de los campos son deliberados: `revisiones` y **no** `horas`.
    El registro de tiempos de Azure responde 401 con el PAT de lectura, así que
    no hay ninguna fuente de horas en este sistema, y un campo `horas` aquí
    sería un número inventado con nombre de medida.
    """

    epica: int
    titulo: str = ""
    items_analizados: int = 0
    items_totales: int = 0
    #: `True` si algún historial no se pudo leer. El recuento es entonces una
    #: **cota inferior** (pierde actividad), al revés que la cobertura de pruebas
    #: donde perder relaciones produce una cota superior de la brecha.
    parcial: bool = False
    #: Ítems del árbol en los que ninguna revisión cuenta como actividad: solo
    #: tienen la de creación, o no tienen historial. Es «abierto y nunca tocado».
    items_sin_actividad: int = 0
    revisiones: int = 0
    personas: int = 0
    primera: str = ""
    ultima: str = ""
    por_persona: List[RevisionPorPersona] = []
    por_tipo: dict[str, int] = {}
    nota: str = ""


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