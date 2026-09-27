"""Esquemas de respuesta de la API (contrato estable con el frontend).

Reutiliza los modelos de dominio (ya son Pydantic) y añade envoltorios de
listado. Las respuestas jamás contienen credenciales.
"""

from datetime import datetime
from typing import Dict, List

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