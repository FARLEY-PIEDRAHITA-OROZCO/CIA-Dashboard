"""Composición de dependencias (contenedor simple).

Centraliza la construcción de la cadena transporte -> repositorio -> caché
-> servicio. Quien quiera sustituir un adaptador (p. ej. repositorio fake en
pruebas, caché Redis en producción) lo hace aquí sin tocar las demás capas.
"""

import logging
from dataclasses import dataclass

from ..application.services import ServicioBacklog
from ..config import Settings, obtener_settings
from ..domain.ports import CachePort, RepositorioBacklogPort, TransportePort
from ..infrastructure.azure.repository import AzureBacklogRepositorio
from ..infrastructure.azure.transport import AzureTransporte
from ..infrastructure.cache import CacheMemoria

logger = logging.getLogger("devops")


@dataclass
class Contenedor:
    """Dependencias listas para inyectar en la aplicación."""

    settings: Settings
    transporte: TransportePort
    repositorio: RepositorioBacklogPort
    cache: CachePort
    servicio: ServicioBacklog


def crear_contenedor(settings: Settings | None = None) -> Contenedor:
    """Ensambla el grafo de dependencias a partir de la configuración."""
    cfg = settings or obtener_settings()

    transporte = AzureTransporte(cfg.azure_pat, timeout=cfg.timeout_seg)
    repositorio: RepositorioBacklogPort = AzureBacklogRepositorio(
        org_url=cfg.azure_org_url,
        proyecto=cfg.azure_proyecto,
        area_path=cfg.area_path_efectivo,
        transporte=transporte,
    )
    cache: CachePort = CacheMemoria()
    servicio = ServicioBacklog(
        repositorio=repositorio,
        cache=cache,
        ttl_seg=cfg.cache_ttl_seg,
        configuracion=cfg.configurado,
        organizacion=cfg.azure_org_url,
        proyecto=cfg.azure_proyecto,
        area_path=cfg.area_path_efectivo,
    )
    return Contenedor(
        settings=cfg,
        transporte=transporte,
        repositorio=repositorio,
        cache=cache,
        servicio=servicio,
    )