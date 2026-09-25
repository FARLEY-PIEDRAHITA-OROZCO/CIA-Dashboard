"""Caso de uso del backlog para el dashboard.

Orquesta el repositorio y la caché sin conocer los detalles de transporte
(solo depende de los puertos del dominio).
"""

import logging
from collections import Counter
from typing import Dict, List, Optional

from ..domain.models import (
    ActualizacionQA,
    Bug,
    DetalleBugs,
    Epic,
    EstadoIntegracion,
    MetricasBug,
    ResultadoActualizacion,
)
from ..domain.ports import CachePort, EscrituraBacklogPort, RepositorioBacklogPort

logger = logging.getLogger("devops")

CLAVE_EPICAS = "epicas"
CLAVE_ARBOL = "epica:{0}"
CLAVE_ARBOL_BUGS = "epica:{0}:bugs"

# Estado cerrado en Azure (Scrum/Basic suelen usar "Closed"; se compara
# normalizado). Las épicas cerradas se ocultan por defecto para replicar la
# vista del backlog del equipo (el conteo del portal), pero se pueden incluir
# de forma configurable vía `incluir_cerradas=True`.
ESTADO_CERRADO = "closed"
ESTADOS_CERRADOS_BUG = {
    "closed",
    "resolved",
    "done",
    "removed",
    "canceled",
    "cancelled",
}


def _es_cerrada(epica: Epic) -> bool:
    return (epica.estado or "").strip().lower() == ESTADO_CERRADO


def _es_bug_cerrado(bug: Bug) -> bool:
    return (bug.estado or "").strip().lower() in ESTADOS_CERRADOS_BUG


class EscrituraNoHabilitadaError(RuntimeError):
    """Se intentó escribir con la capacidad de escritura apagada.

    Es un error de configuración, no de Azure: la API lo traduce a 409 para
    que sea evidente que la operación nunca llegó a la red.
    """


def _bugs_de_epica(epica: Epic) -> List[Bug]:
    """Recorre el árbol y deduplica bugs por ID, sin duplicar asociaciones."""
    encontrados: Dict[int, Bug] = {}

    def visitar(nodo: object) -> None:
        for bug in getattr(nodo, "bugs", None) or []:
            encontrados.setdefault(bug.azure_id, bug)
            visitar(bug)
        for tarea in getattr(nodo, "tareas", None) or []:
            visitar(tarea)

    visitar(epica)
    for feature in epica.features:
        visitar(feature)
        for historia in feature.hus:
            visitar(historia)
    for historia in epica.hus:
        visitar(historia)
    return sorted(encontrados.values(), key=lambda bug: bug.azure_id)


def _metricas_bugs(bugs: List[Bug]) -> MetricasBug:
    por_estado = Counter((bug.estado or "sin estado").strip() or "sin estado" for bug in bugs)
    por_prioridad = Counter(
        (bug.prioridad or "sin prioridad").strip() or "sin prioridad" for bug in bugs
    )
    por_severidad = Counter(
        (bug.severidad or "sin severidad").strip() or "sin severidad" for bug in bugs
    )
    por_relacion = Counter(bug.relacion or "hierarchy" for bug in bugs)
    cerrados = sum(1 for bug in bugs if _es_bug_cerrado(bug))
    return MetricasBug(
        total=len(bugs),
        abiertos=len(bugs) - cerrados,
        cerrados=cerrados,
        por_estado=dict(sorted(por_estado.items())),
        por_prioridad=dict(sorted(por_prioridad.items())),
        por_severidad=dict(sorted(por_severidad.items())),
        por_relacion=dict(sorted(por_relacion.items())),
    )


class ServicioBacklog:
    """Servicio de aplicación: listado de épicas, árbol, bugs y caché TTL."""

    def __init__(
        self,
        repositorio: RepositorioBacklogPort,
        cache: CachePort,
        *,
        escritura: Optional[EscrituraBacklogPort] = None,
        escritura_habilitada: bool = False,
        ttl_seg: int = 120,
        configuracion: bool = False,
        organizacion: str = "",
        proyecto: str = "",
        area_path: str = "",
    ) -> None:
        self._repo = repositorio
        self._cache = cache
        self._escritura = escritura
        self.escritura_habilitada = bool(escritura_habilitada and escritura)
        self._ttl_seg = float(ttl_seg)
        self.configurado = configuracion
        self._organizacion = (organizacion or "").strip().rstrip("/")
        self._proyecto = proyecto or ""
        self._area_path = area_path or ""

    # ------------------------------------------------------------------ #
    # Estado de la integración
    # ------------------------------------------------------------------ #
    async def estado(self) -> EstadoIntegracion:
        if not self.configurado:
            return EstadoIntegracion(area_path=self._area_path)
        try:
            proyecto = await self._repo.verificar_proyecto()
        except Exception as exc:  # noqa: BLE001 - se reporta como estado
            logger.warning(
                "Fallo al verificar Azure (%s)", type(exc).__name__
            )
            return EstadoIntegracion(
                configurada=True,
                organizacion=self._organizacion,
                proyecto=self._proyecto,
                area_path=self._area_path,
                verificado=False,
                error=f"No se pudo verificar Azure ({type(exc).__name__}).",
            )
        return EstadoIntegracion(
            configurada=True,
            organizacion=self._organizacion,
            proyecto=proyecto.get("proyecto") or self._proyecto,
            area_path=self._area_path,
            verificado=True,
        )

    # ------------------------------------------------------------------ #
    # Datos del dashboard
    # ------------------------------------------------------------------ #
    async def listar_epicas(self, incluir_cerradas: bool = False) -> List[Epic]:
        """Épicas del backlog, con caché y preferencia a la copia guardada.

        Por defecto excluye las épicas cerradas (estado ``Closed``) para
        replicar el conteo visible del backlog del equipo en Azure. La caché
        guarda siempre la lista COMPLETA, de modo que alternar
        ``incluir_cerradas`` no requiere invalidar ni re-leer de Azure
        mientras el TTL esté vigente.
        """
        cached = self._cache.obtener(CLAVE_EPICAS)
        if cached is None:
            epicas = await self._repo.listar_epicas()
            self._cache.guardar(CLAVE_EPICAS, epicas, self._ttl_seg)
            cached = epicas
        if incluir_cerradas:
            return cached
        return [e for e in cached if not _es_cerrada(e)]

    async def arbol_epica(
        self,
        epic_id: int,
        *,
        incluir_bugs: bool = False,
    ) -> Optional[Epic]:
        """Árbol de una épica; la variante con bugs usa otra clave de caché."""
        clave = (CLAVE_ARBOL_BUGS if incluir_bugs else CLAVE_ARBOL).format(epic_id)
        cached = self._cache.obtener(clave)
        if cached is not None:
            return cached
        epica = await self._repo.obtener_epica(epic_id, incluir_bugs=incluir_bugs)
        if epica is not None:
            self._cache.guardar(clave, epica, self._ttl_seg)
        return epica

    async def bugs_epica(
        self,
        epic_id: int,
        *,
        incluir_cerradas: bool = False,
    ) -> Optional[DetalleBugs]:
        """Proyección de bugs y métricas, reutilizando el árbol cacheado."""
        epica = await self.arbol_epica(epic_id, incluir_bugs=True)
        if epica is None:
            return None
        todos = _bugs_de_epica(epica)
        metricas = _metricas_bugs(todos)
        bugs = todos if incluir_cerradas else [bug for bug in todos if not _es_bug_cerrado(bug)]
        return DetalleBugs(bugs=bugs, metricas=metricas)

    def refrescar(self) -> None:
        """Invalida la caché para forzar una lectura fresca de Azure."""
        self._cache.limpiar()
        logger.info("Caché del backlog invalidada")

    # ------------------------------------------------------------------ #
    # Escritura (opt-in, ADR-11)
    # ------------------------------------------------------------------ #
    def _invalidar_work_item(self, work_item_id: int) -> None:
        """Invalidación dirigida tras editar un work item.

        Solo se borran las claves que realmente pueden contener el elemento
        modificado; el resto del backlog sigue servido desde caché.
        """
        self._cache.eliminar(CLAVE_EPICAS)
        for prefijo in (CLAVE_ARBOL, CLAVE_ARBOL_BUGS):
            self._cache.eliminar(prefijo.format(work_item_id))
        logger.info("Caché invalidada para el work item %s", work_item_id)

    async def revision_work_item(self, work_item_id: int) -> int:
        """Revisión actual del work item (control de concurrencia)."""
        if not self.escritura_habilitada or self._escritura is None:
            raise EscrituraNoHabilitadaError(
                "La escritura está deshabilitada; no hay revisión que leer."
            )
        return await self._escritura.obtener_revision(work_item_id)

    async def actualizar_work_item(
        self,
        work_item_id: int,
        cambios: ActualizacionQA,
        *,
        validar: bool = False,
        rev_esperada: Optional[int] = None,
    ) -> ResultadoActualizacion:
        """Aplica cambios de QA a un work item de Azure.

        Es el único camino de escritura del sistema. Delega en el adaptador
        dedicado, que garantiza la lista blanca de campos, y tras guardar
        invalida únicamente las claves de caché afectadas.
        """
        if not self.escritura_habilitada or self._escritura is None:
            raise EscrituraNoHabilitadaError(
                "La escritura está deshabilitada. Define "
                "ESCRITURA_HABILITADA=true y AZURE_PAT_ESCRITURA en el .env "
                "del backend para habilitarla."
            )
        resultado = await self._escritura.actualizar_work_item(
            work_item_id,
            cambios,
            validar=validar,
            rev_esperada=rev_esperada,
        )
        if not validar:
            self._invalidar_work_item(work_item_id)
        return resultado
