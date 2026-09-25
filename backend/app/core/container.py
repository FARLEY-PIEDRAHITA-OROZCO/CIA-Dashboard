"""Composición de dependencias (contenedor simple).

Centraliza la construcción de la cadena transporte -> repositorio -> caché
-> servicio. Quien quiera sustituir un adaptador (p. ej. repositorio fake en
pruebas, caché Redis en producción) lo hace aquí sin tocar las demás capas.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from ..application.services import ServicioBacklog
from ..config import Settings, obtener_settings
from ..domain.ports import (
    CachePort,
    EscrituraBacklogPort,
    RepositorioBacklogPort,
    TransportePort,
)
from ..infrastructure.azure.escritura import AzureEscrituraRepositorio
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
    escritura: Optional[EscrituraBacklogPort] = None
    transporte_escritura: Optional[TransportePort] = None


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

    # --- Escritura (opt-in, ADR-11) ------------------------------------- #
    # Solo se construye si está habilitada y hay PAT dedicado. El adaptador
    # usa un transporte PROPIO con el PAT de escritura: así el permiso de
    # modificar nunca se mezcla con el de lectura y se puede revocar de forma
    # independiente. Sin este bloque el sistema es idéntico al de solo lectura.
    escritura: Optional[EscrituraBacklogPort] = None
    transporte_escritura: Optional[TransportePort] = None
    if cfg.configurado_escritura:
        transporte_escritura = AzureTransporte(
            cfg.azure_pat_escritura, timeout=cfg.timeout_seg
        )
        escritura = AzureEscrituraRepositorio(
            org_url=cfg.azure_org_url,
            proyecto=cfg.azure_proyecto,
            transporte=transporte_escritura,
        )
        logger.info("Escritura QA habilitada (PAT dedicado, %s)", cfg.host)
    elif cfg.escritura_habilitada:
        logger.warning(
            "ESCRITURA_HABILITADA está activo pero falta AZURE_PAT_ESCRITURA: "
            "el sistema queda en modo solo lectura."
        )

    servicio = ServicioBacklog(
        repositorio=repositorio,
        cache=cache,
        escritura=escritura,
        escritura_habilitada=cfg.configurado_escritura,
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
        escritura=escritura,
        transporte_escritura=transporte_escritura,
    )