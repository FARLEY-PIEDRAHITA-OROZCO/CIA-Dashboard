"""Rutas HTTP del dashboard de épicas de Azure DevOps."""

import logging
from typing import Annotated, List

from fastapi import APIRouter, HTTPException, Path, Query

from ..application.services import ServicioBacklog
from ..domain.models import Epic
from ..infrastructure.azure.transport import AzureError
from .deps import IndiceDep, IndicePruebasDep, RegistroDep, ServicioDep
from .schemas import (
    ActivosPrueba,
    BrechaVerificacion,
    CoberturaPruebas,
    DetalleBugs,
    EpicaResumen,
    EstadoAzure,
    Health,
    ItemIndiceOut,
    ListaEpicas,
    ListaItems,
    ListaPersonas,
    ListaPersonasQA,
    ListaSprints,
    Mensaje,
    PersonaOut,
    PersonaQAOut,
    PlanDePrueba,
    RezagoEntreSprints,
    ResumenPruebas,
    ResultadoEscritura,
    RolActualizable,
    SinCubrir,
    SprintOut,
    SugerenciaQA,
    SugerenciasQA,
    TrabajoEstancado,
    a_resumen,
)
from ..domain.models import ActualizacionQA
from ..application.services import EscrituraNoHabilitadaError
from ..infrastructure.azure.escritura import ErrorValidacionEscritura

logger = logging.getLogger("devops")
router = APIRouter()

#: Tope de resultados por página. El índice tiene miles de ítems; sin tope, una
#: consulta sin filtro descargaría el proyecto entero en el navegador.
MAXIMO_ITEMS = 200


def _error_azure(exc: AzureError, *, not_found: bool = False) -> HTTPException:
    logger.warning("Error en lectura de backlog: %s", exc)
    status = 404 if not_found and exc.status_code == 404 else 502
    return HTTPException(status_code=status, detail=str(exc))


def _requiere_configuracion(servicio: ServicioBacklog) -> None:
    if not servicio.configurado:
        raise HTTPException(
            status_code=409,
            detail="Azure DevOps no está configurado. Define organizacion, "
            "proyecto y PAT en el .env del backend.",
        )


@router.get("/api/health", response_model=Health, tags=["Salud"])
async def api_health() -> Health:
    return Health()


@router.get("/api/azure/estado", response_model=EstadoAzure, tags=["Azure"])
async def api_estado_integracion(servicio: ServicioDep) -> EstadoAzure:
    estado = await servicio.estado()
    return EstadoAzure(**estado.model_dump())


@router.get("/api/epics", response_model=ListaEpicas, tags=["Epicas"])
async def api_listar_epicas(
    servicio: ServicioDep,
    incluir_cerradas: bool = False,
) -> ListaEpicas:
    """Lista liviana de épicas del AreaPath.

    Por defecto excluye las épicas cerradas (replica el conteo del backlog
    del equipo). Pasa ``?incluir_cerradas=true`` para incluirlas.
    """
    _requiere_configuracion(servicio)
    try:
        epicas = await servicio.listar_epicas(incluir_cerradas=incluir_cerradas)
    except AzureError as exc:
        raise _error_azure(exc)
    return ListaEpicas(epicas=[a_resumen(e) for e in epicas])


@router.get(
    "/api/epics/{epic_id}/arbol",
    response_model=Epic,
    response_model_exclude_none=True,
    tags=["Epicas"],
)
async def api_arbol_epica(
    servicio: ServicioDep,
    epic_id: Annotated[int, Path(gt=0)],
    incluir_bugs: bool = False,
) -> Epic:
    """Árbol completo Épica -> Features/User Stories -> Bugs/Tasks."""
    _requiere_configuracion(servicio)
    try:
        epica = await servicio.arbol_epica(epic_id, incluir_bugs=incluir_bugs)
    except AzureError as exc:
        raise _error_azure(exc, not_found=True)
    if epica is None:
        raise HTTPException(status_code=404, detail=f"Épica {epic_id} no encontrada.")
    return epica


@router.get("/api/epics/{epic_id}/bugs", response_model=DetalleBugs, tags=["Epicas"])
async def api_bugs_epica(
    servicio: ServicioDep,
    epic_id: Annotated[int, Path(gt=0)],
    incluir_cerradas: bool = False,
) -> DetalleBugs:
    """Bugs relacionados con la épica y métricas agregadas."""
    _requiere_configuracion(servicio)
    try:
        detalle = await servicio.bugs_epica(
            epic_id, incluir_cerradas=incluir_cerradas
        )
    except AzureError as exc:
        raise _error_azure(exc, not_found=True)
    if detalle is None:
        raise HTTPException(status_code=404, detail=f"Épica {epic_id} no encontrada.")
    return detalle


# ---------------------------------------------------------------------- #
# Sprints, personas e índice (Fases 2-3)
# ---------------------------------------------------------------------- #
@router.get("/api/sprints", response_model=ListaSprints, tags=["Sprints"])
async def api_sprints(servicio: ServicioDep, indice: IndiceDep) -> ListaSprints:
    """Catálogo de sprints detectados en los datos, con conteos.

    Los sprints no se consultan a Azure: se derivan del índice local, porque la
    API de iteraciones exige permisos que un PAT de lectura no tiene (401) y
    WIQL no permite enumerar rutas de iteración.
    """
    _requiere_configuracion(servicio)
    sprints = await indice.sprints()
    actual = await indice.sprint_actual() or ""
    # La suma de las columnas NO es el total del proyecto: hay ítems sin sprint
    # asignable. Se expone el total real para que la UI pueda decirlo en lugar
    # de dejar que parezca que la cinta lo cubre todo.
    total_items = len(await indice.todos())
    return ListaSprints(
        sprints=[SprintOut(**s) for s in sprints],
        total=len(sprints),
        sprint_actual=actual,
        total_items=total_items,
        asignados_a_sprint=sum(s["total"] for s in sprints),
    )


@router.get("/api/personas", response_model=ListaPersonas, tags=["Personas"])
async def api_personas(servicio: ServicioDep, indice: IndiceDep) -> ListaPersonas:
    """Personas con su carga actual, ordenadas por volumen."""
    _requiere_configuracion(servicio)
    personas = await indice.personas()
    return ListaPersonas(
        personas=[PersonaOut(**p) for p in personas], total=len(personas)
    )


@router.get("/api/items", response_model=ListaItems, tags=["Sprints"])
async def api_items(
    servicio: ServicioDep,
    indice: IndiceDep,
    sprint: str = "",
    persona: str = "",
    tipo: str = "",
    etiqueta: str = "",
    solo_abiertos: bool = False,
    offset: int = 0,
    limite: int = MAXIMO_ITEMS,
) -> ListaItems:
    """Ítems filtrados del índice local. No genera peticiones a Azure.

    ``offset`` y ``limite`` paginan el resultado. El tope de 200 por página
    existe para no volcar el proyecto entero en el navegador, **no** para
    ocultar ítems: con paginación nada queda fuera de alcance.
    """
    _requiere_configuracion(servicio)
    pagina = max(0, offset)
    paso = max(1, min(limite, MAXIMO_ITEMS))
    encontrados = await indice.filtrar(
        sprint=sprint,
        persona=persona,
        tipo=tipo,
        etiqueta=etiqueta,
        solo_abiertos=solo_abiertos,
    )
    # Orden estable: primero los más recientes, luego por id para desempatar.
    # La estabilidad importa: sin ella, `offset` dejaría de ser coherente entre
    # páginas y la paginación se saltaría o repetiría ítems.
    ordenados = sorted(
        encontrados,
        key=lambda i: (i.modificado is not None, i.modificado or i.creado, i.azure_id),
        reverse=True,
    )
    ventana = ordenados[pagina : pagina + paso]
    return ListaItems(
        items=[ItemIndiceOut(**i.model_dump()) for i in ventana],
        total=len(ordenados),
        offset=pagina,
        limite=paso,
        hay_mas=pagina + len(ventana) < len(ordenados),
        sprint_actual=await indice.sprint_actual() or "",
    )


# ---------------------------------------------------------------------- #
# Analítica QA: señales diferenciales frente a Azure (Fase 4)
# ---------------------------------------------------------------------- #
@router.get(
    "/api/analitica/verificacion",
    response_model=BrechaVerificacion,
    tags=["Analitica"],
)
async def api_analitica_verificacion(
    servicio: ServicioDep, indice: IndiceDep
) -> BrechaVerificacion:
    """Señal ①: qué se cerró sin evidencia de verificación QA.

    Azure no tiene el concepto de «verificado por QA»: obtenerlo allí exige
    cinco queries manuales. Aquí se cruza el estado con la etiqueta
    `verificado-qa` que el propio sistema escribe.
    """
    _requiere_configuracion(servicio)
    return BrechaVerificacion(**await indice.brecha_de_verificacion())


@router.get(
    "/api/analitica/aging", response_model=TrabajoEstancado, tags=["Analitica"]
)
async def api_analitica_aging(
    servicio: ServicioDep,
    indice: IndiceDep,
    dias_inactivo: int = 14,
    dias_en_curso: int = 30,
) -> TrabajoEstancado:
    """Señal ②: ítems abiertos que llevan demasiado tiempo sin moverse."""
    _requiere_configuracion(servicio)
    return TrabajoEstancado(
        **await indice.trabajo_estancado(
            dias_inactivo=max(1, min(dias_inactivo, 365)),
            dias_en_curso=max(1, min(dias_en_curso, 365)),
        )
    )


@router.get(
    "/api/analitica/rezago",
    response_model=RezagoEntreSprints,
    tags=["Analitica"],
)
async def api_analitica_rezago(
    servicio: ServicioDep, indice: IndiceDep
) -> RezagoEntreSprints:
    """Señal ③: deuda que cada sprint anterior dejó sin cerrar.

    Azure guarda un único sprint por ítem, así que este trabajo no es visible
    en su tablero de sprint.
    """
    _requiere_configuracion(servicio)
    return RezagoEntreSprints(**await indice.rezago_entre_sprints())


# ---------------------------------------------------------------------- #
# Gestión del proceso de pruebas (solo lectura)
# ---------------------------------------------------------------------- #
#: Prefijo común. Todas son de solo lectura: no amplían la superficie de
#: escritura, que sigue siendo la de ADR-11 (los campos de QA).
PRUEBAS = "/api/pruebas"


@router.get(f"{PRUEBAS}/resumen", response_model=ResumenPruebas, tags=["Pruebas"])
async def api_pruebas_resumen(
    servicio: ServicioDep, indice: IndicePruebasDep
) -> ResumenPruebas:
    """Inventario de activos, brecha de cobertura, automatización y diseño.

    La primera llamada tras el arranque cuesta ~5,5 s: son 3.932 activos y
    `$expand=relations` sobre 3.431 casos. Después la respuesta es de memoria.
    """
    _requiere_configuracion(servicio)
    return ResumenPruebas(**await indice.resumen())


@router.get(f"{PRUEBAS}/cobertura", response_model=CoberturaPruebas, tags=["Pruebas"])
async def api_pruebas_cobertura(
    servicio: ServicioDep, indice: IndicePruebasDep
) -> CoberturaPruebas:
    """Cobertura de historias con caso de prueba, global y por sprint.

    `resumen.parcial` es `True` si algún lote de relaciones no se pudo leer: en
    ese caso las historias sin caso son **como máximo** las que se indican, y la
    UI lo dice en vez de presentar una cifra completa.
    """
    _requiere_configuracion(servicio)
    return CoberturaPruebas(**await indice.cobertura())


@router.get(f"{PRUEBAS}/sin-cubrir", response_model=SinCubrir, tags=["Pruebas"])
async def api_pruebas_sin_cubrir(
    servicio: ServicioDep,
    indice: IndicePruebasDep,
    sprint: str = "",
    persona: str = "",
    limite: Annotated[int, Query(ge=1, le=MAXIMO_ITEMS)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SinCubrir:
    """Las historias sin ningún caso: la lista de trabajo de QA, paginada.

    El orden es por sprint y luego por id, estable a propósito: con un orden
    cambiante el `offset` repetiría o saltaría historias entre páginas.
    """
    _requiere_configuracion(servicio)
    return SinCubrir(
        **await indice.sin_cubrir(
            persona=persona, sprint=sprint, limite=limite, offset=offset
        )
    )


@router.get(f"{PRUEBAS}/activos", response_model=ActivosPrueba, tags=["Pruebas"])
async def api_pruebas_activos(
    servicio: ServicioDep,
    indice: IndicePruebasDep,
    tipo: str = "",
    estado: str = "",
    persona: str = "",
    sprint: str = "",
    limite: Annotated[int, Query(ge=1, le=MAXIMO_ITEMS)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ActivosPrueba:
    """Los activos de prueba filtrados y paginados, con sus campos editables.

    Es lo que permite editarlos: cada elemento trae `campos_editables`, derivado
    de la tabla que aplica el adaptador de escritura, para que el formulario no
    ofrezca un campo que el tipo no tiene. `Test Plan` y `Test Suite` llegan con
    `["estado"]` y nada más.
    """
    _requiere_configuracion(servicio)
    return ActivosPrueba(
        **await indice.activos(
            tipo=tipo,
            estado=estado,
            persona=persona,
            sprint=sprint,
            limite=limite,
            offset=offset,
        )
    )


@router.get(
    f"{PRUEBAS}/planes", response_model=List[PlanDePrueba], tags=["Pruebas"]
)
async def api_pruebas_planes(
    servicio: ServicioDep, indice: IndicePruebasDep
) -> List[PlanDePrueba]:
    """Los planes como contexto: sprint y responsable de las pruebas de cada uno.

    Deliberadamente **no** es la vista principal. La pertenencia de un caso a un
    plan no es accesible por la API, así que un plan no se puede abrir: solo
    cuenta quién lo lleva y en qué sprint.
    """
    _requiere_configuracion(servicio)
    return [PlanDePrueba(**p) for p in await indice.planes()]


@router.post("/api/epics/refresh", response_model=Mensaje, tags=["Epicas"])
async def api_refrescar(
    servicio: ServicioDep,
    indice: IndiceDep,
    indice_pruebas: IndicePruebasDep,
) -> Mensaje:
    """Invalida la caché para leer datos frescos de Azure en la próxima llamada.

    También invalida los **dos índices** locales: sin esto, los recuentos de
    sprints, personas y cobertura seguirían mostrando los números anteriores al
    refresco. Son cachés distintas con TTL distintos (300 s y 900 s).
    """
    servicio.refrescar()
    indice.invalidar()
    indice_pruebas.invalidar()
    return Mensaje(
        ok=True,
        detalle="Caché invalidada. La próxima consulta leerá de Azure.",
    )


# ---------------------------------------------------------------------- #
# Registro local de pruebas (perfiles de rol)
# ---------------------------------------------------------------------- #
QA = "/api/qa"

#: Explicación de por qué esto no son horas. Se devuelve con la respuesta para
#: que la UI pueda decirlo, en vez de tener el texto metido en el frontend.
NOTA_SIN_HORAS = (
    "El tiempo se cuenta en días laborables desde la asignación, no en horas: "
    "el registro de tiempos de Azure no es accesible con el PAT de lectura "
    "(HTTP 401), así que no hay ninguna fuente de horas."
)


def _error_registro(exc: Exception) -> HTTPException:
    """Traduce los fallos del registro al código que corresponde.

    Tres fallos distintos con tres salidas distintas, y confundirlos manda al
    usuario a la puerta equivocada:

    * :class:`AsignacionInvalida` → **422**: corrige el formulario.
    * :class:`RegistroModificado` → **409**: recarga y reintenta; no se perdió nada.
    * :class:`ErrorRegistro` → **500**: el fichero está mal; es del servidor, no
      de la petición, y no se puede arreglar desde el formulario.
    """
    from ..application.registro import AsignacionInvalida
    from ..infrastructure.registro_json import ErrorRegistro, RegistroModificado

    if isinstance(exc, RegistroModificado):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, AsignacionInvalida):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, ErrorRegistro):
        logger.error("Fallo del registro local de pruebas: %s", exc)
        return HTTPException(status_code=500, detail=str(exc))
    raise exc


@router.get(f"{QA}/personas", response_model=ListaPersonasQA, tags=["QA"])
async def api_qa_personas(servicio: ServicioDep, registro: RegistroDep) -> ListaPersonasQA:
    """Las personas del proyecto con su papel y su carga de pruebas.

    Los roles vienen del **registro local** (`/api/qa/personas` escribe ahí), no
    de Azure, que no tiene ningún campo para esto. `items_backlog` y `bugs` sí
    vienen de Azure: sirven para contrastar lo que el registro afirma con lo que
    el backlog muestra.
    """
    _requiere_configuracion(servicio)
    try:
        filas = await registro.personas()
    except Exception as exc:  # noqa: BLE001 - se traduce abajo
        raise _error_registro(exc) from exc
    return ListaPersonasQA(
        personas=[PersonaQAOut(**f) for f in filas],
        total=len(filas),
        qa=sum(1 for f in filas if f["es_qa"]),
        dev=sum(1 for f in filas if f["es_dev"]),
        sin_rol=sum(1 for f in filas if not f["es_qa"] and not f["es_dev"]),
    )


@router.put(f"{QA}/personas/{{guid}}", response_model=PersonaQAOut, tags=["QA"])
async def api_qa_marcar_rol(
    servicio: ServicioDep,
    registro: RegistroDep,
    guid: Annotated[str, Path(min_length=1)],
    cambios: RolActualizable,
) -> PersonaQAOut:
    """Fija el papel de una persona: QA, dev o ambos.

    Un campo `null` no se toca, `false` quita el rol. Reenviar el formulario tal
    cual no borra nada.
    """
    _requiere_configuracion(servicio)
    if cambios.es_qa is None and cambios.es_dev is None and cambios.forzado is None:
        raise HTTPException(
            status_code=422,
            detail="Indica al menos un campo a actualizar (es_qa, es_dev o forzado).",
        )
    try:
        await registro.marcar_rol(
            guid,
            es_qa=cambios.es_qa,
            es_dev=cambios.es_dev,
            forzado=cambios.forzado,
        )
    except Exception as exc:  # noqa: BLE001 - se traduce abajo
        raise _error_registro(exc) from exc
    for fila in await registro.personas():
        if fila["guid"].lower() == guid.lower():
            return PersonaQAOut(**fila)
    raise HTTPException(status_code=404, detail=f"No hay ninguna persona con el GUID {guid}.")


@router.get(f"{QA}/sugerencia-qa", response_model=SugerenciasQA, tags=["QA"])
async def api_qa_sugerencia(
    servicio: ServicioDep,
    registro: RegistroDep,
    minimo: Annotated[int, Query(ge=0, le=1000)] = 3,
) -> SugerenciasQA:
    """Quién parece hacer QA, según cuántos activos de prueba toca.

    **No guarda nada.** Es una heurística y el backend la devuelve como
    sugerencia: marcarla es una decisión de la persona, y un umbral equivocado
    classificaría mal a alguien con un error que queda en el registro sin que
    nadie lo revise.

    Es el endpoint más caro de la vista: necesita el índice de activos de prueba
    (~5,5 s en frío), así que se pide solo cuando se abre.
    """
    _requiere_configuracion(servicio)
    try:
        sugeridas = await registro.sugerencia_qa(minimo=minimo)
    except Exception as exc:  # noqa: BLE001 - se traduce abajo
        raise _error_registro(exc) from exc
    return SugerenciasQA(
        sugerencias=[SugerenciaQA(**s) for s in sugeridas],
        minimo=minimo,
        nota="Heurística por volumen de activos de prueba tocados. Decide tú.",
    )


# ---------------------------------------------------------------------- #
# Escritura QA (opt-in, ADR-11)
# ---------------------------------------------------------------------- #
@router.patch(
    "/api/workitems/{work_item_id}",
    response_model=ResultadoEscritura,
    tags=["Escritura"],
)
async def api_actualizar_work_item(
    servicio: ServicioDep,
    indice: IndiceDep,
    indice_pruebas: IndicePruebasDep,
    work_item_id: Annotated[int, Path(gt=0)],
    cambios: ActualizacionQA,
    validar: bool = False,
    rev_esperada: int | None = None,
) -> ResultadoEscritura:
    """Actualiza un work item con los campos de QA (tags, estado, notas…).

    Con ``?validar=true`` no escribe nada: Azure comprueba las reglas del
    proyecto y responde si el cambio sería válido (equivale a
    ``validateOnly``). ``rev_esperada`` protege contra sobrescribir la edición
    de otro QA.
    """
    try:
        resultado = await servicio.actualizar_work_item(
            work_item_id,
            cambios,
            validar=validar,
            rev_esperada=rev_esperada,
        )
    except EscrituraNoHabilitadaError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ErrorValidacionEscritura as exc:
        # Validación local: la petición nunca alcanzó Azure.
        raise HTTPException(status_code=422, detail=str(exc))
    except AzureError as exc:
        logger.warning("Error al escribir el work item %s: %s", work_item_id, exc)
        detalle = exc.detalle or "Azure rechazó el cambio."
        raise HTTPException(status_code=409, detail=detalle)
    if not validar:
        # Los índices locales mostrarían el valor anterior del ítem recién
        # escrito. Los dos, no solo el de sprints: los activos de prueba son
        # editables en la Fase 5 y, si no, la cobertura seguiría mostrando
        # números previos a la edición.
        indice.invalidar()
        indice_pruebas.invalidar()
    return ResultadoEscritura(**resultado.model_dump())


@router.get(
    "/api/workitems/{work_item_id}/rev",
    response_model=Mensaje,
    tags=["Escritura"],
)
async def api_revision_work_item(
    servicio: ServicioDep,
    work_item_id: Annotated[int, Path(gt=0)],
) -> Mensaje:
    """Revisión actual del work item, para control de concurrencia."""
    if not servicio.escritura_habilitada:
        raise HTTPException(
            status_code=409,
            detail="La escritura está deshabilitada; no hay revisión que leer.",
        )
    try:
        rev = await servicio.revision_work_item(work_item_id)
    except AzureError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return Mensaje(ok=True, detalle=str(rev))