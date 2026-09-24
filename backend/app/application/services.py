"""Caso de uso del backlog para el dashboard.

Orquesta el repositorio y la caché sin conocer los detalles de transporte
(solo depende de los puertos del dominio).
"""

import logging
from typing import List, Optional

from ..domain.models import Epic, EstadoIntegracion
from ..domain.ports import CachePort, RepositorioBacklogPort

logger = logging.getLogger("devops")

CLAVE_EPICAS = "epicas"
CLAVE_ARBOL = "epica:{0}"

# Estado cerrado en Azure (Scrum/Basic suelen usar "Closed"; se compara
# normalizado). Las épicas cerradas se ocultan por defecto para replicar la
# vista del backlog del equipo (el conteo del portal), pero se pueden incluir
# de forma configurable vía `incluir_cerradas=True`.
ESTADO_CERRADO = "closed"


def _es_cerrada(epica: Epic) -> bool:
    return (epica.estado or "").strip().lower() == ESTADO_CERRADO


class ServicioBacklog:
    """Servicio de aplicación: listado de épicas y árbol con caché TTL."""

    def __init__(
        self,
        repositorio: RepositorioBacklogPort,
        cache: CachePort,
        *,
        ttl_seg: int = 120,
        configuracion: bool = False,
        organizacion: str = "",
        proyecto: str = "",
        area_path: str = "",
    ) -> None:
        self._repo = repositorio
        self._cache = cache
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

    async def arbol_epica(self, epic_id: int) -> Optional[Epic]:
        """Árbol completo de una épica, con caché por épica."""
        clave = CLAVE_ARBOL.format(epic_id)
        cached = self._cache.obtener(clave)
        if cached is not None:
            return cached
        epica = await self._repo.obtener_epica(epic_id)
        if epica is not None:
            self._cache.guardar(clave, epica, self._ttl_seg)
        return epica

    def refrescar(self) -> None:
        """Invalida la caché para forzar una lectura fresca de Azure."""
        self._cache.limpiar()
        logger.info("Caché del backlog invalidada")