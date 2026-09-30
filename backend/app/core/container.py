"""Composición de dependencias (contenedor simple).

Centraliza la construcción de la cadena transporte -> repositorio -> caché
-> servicio. Quien quiera sustituir un adaptador (p. ej. repositorio fake en
pruebas, caché Redis en producción) lo hace aquí sin tocar las demás capas.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..application.actividad import ServicioActividad
from ..application.indice import IndiceWorkItems
from ..application.indice_pruebas import IndicePruebas
from ..application.registro import ServicioRegistro
from ..application.services import ServicioBacklog
from ..config import Settings, obtener_settings
from ..domain.ports import (
    CachePort,
    EscrituraBacklogPort,
    RegistroAsignacionesPort,
    RepositorioBacklogPort,
    TransportePort,
)
from ..infrastructure.azure.escritura import AzureEscrituraRepositorio
from ..infrastructure.azure.monitor import MonitorAzure
from ..infrastructure.azure.repository import AzureBacklogRepositorio
from ..infrastructure.azure.transport import AzureTransporte
from ..infrastructure.cache import CacheMemoria
from ..infrastructure.registro_copia import RegistroConCopia
from ..infrastructure.registro_json import RegistroJson

logger = logging.getLogger("devops")


@dataclass
class Contenedor:
    """Dependencias listas para inyectar en la aplicación."""

    settings: Settings
    transporte: TransportePort
    monitor: Optional[MonitorAzure]
    repositorio: RepositorioBacklogPort
    cache: CachePort
    servicio: ServicioBacklog
    indice: IndiceWorkItems
    indice_pruebas: IndicePruebas
    registro_principal: RegistroAsignacionesPort
    registro_copia: RegistroConCopia
    servicio_registro: ServicioRegistro
    actividad: ServicioActividad
    escritura: Optional[EscrituraBacklogPort] = None
    transporte_escritura: Optional[TransportePort] = None


def crear_contenedor(settings: Settings | None = None) -> Contenedor:
    """Ensambla el grafo de dependencias a partir de la configuración."""
    cfg = settings or obtener_settings()

    transporte = AzureTransporte(
        cfg.azure_pat,
        timeout=cfg.timeout_seg,
        monitor=MonitorAzure() if cfg.monitor_habilitada else None,
    )
    monitor = MonitorAzure() if cfg.monitor_habilitada else None
    if monitor is not None:
        logger.info("Monitor de llamadas a Azure activado")
    repositorio: RepositorioBacklogPort = AzureBacklogRepositorio(
        org_url=cfg.azure_org_url,
        proyecto=cfg.azure_proyecto,
        area_path=cfg.area_path_efectivo,
        transporte=transporte,
        monitor=monitor,
    )
    cache: CachePort = CacheMemoria()

    # --- Índice local de sprints y personas (Fase 1) ------------------ #
    # Proyección plana cacheada de los work items. Solo lectura: el índice no
    # escribe en Azure, y las búsquedas del usuario no generan peticiones
    # remotas (ver `test_filtrar_no_llama_a_azure`).
    indice = IndiceWorkItems(repositorio, cache, ttl_seg=cfg.index_ttl_seg)

    # --- Índice local de activos de prueba (segundo índice) --------------- #
    # No amplía el anterior: son 3.932 ítems que nadie consulta al abrir la
    # vista de sprints. Recibe el `indice` porque la cobertura se cruza con las
    # historias, y esas ya están en memoria. Solo lectura, como el resto.
    indice_pruebas = IndicePruebas(
        repositorio,
        cache,
        indice,
        ttl_seg=cfg.index_pruebas_ttl_seg,
    )

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

    # --- Registro local de pruebas ---------------------------------------- #
    # Perfiles de rol y asignaciones de épicas. Fichero JSON **fuera de git**:
    # son datos de trabajo, no código, y exigir un commit por cada asignación
    # convertía el respaldo en un ritual. No usa caché: leerlo es una operación
    # de disco de microsegundos y cachearlo abriría la puerta a servir un registro
    # viejo justo cuando otra pestaña acaba de cambiarlo.
    #
    # `RegistroConCopia` decora al adaptador de fichero: si no hay
    # `REGISTRO_COPIA_RUTA`, es un passthrough exacto. Con ella, copia después de
    # cada guardado y restaura al arrancar si el registro no está. Un fallo de
    # copia se registra y se muestra, pero no tumba la escritura: el dato ya
    # está guardado y decir «no se guardó» sería falso.
    registro_principal: RegistroAsignacionesPort = RegistroJson(cfg.registro_ruta)
    registro_con_copia = RegistroConCopia(
        registro_principal,
        Path(cfg.registro_ruta),
        Path(cfg.registro_copia_ruta) if cfg.registro_copia_ruta else None,
    )
    if cfg.registro_copia_ruta:
        logger.info(
            "Copia del registro configurada en %s%s",
            cfg.registro_copia_ruta,
            ""
            if Path(cfg.registro_copia_ruta).parent.is_dir()
            else "  AVISO: esa carpeta no existe; la copia NO se está escribiendo",
        )
    else:
        logger.warning(
            "Registro sin copia de seguridad (REGISTRO_COPIA_RUTA vacía). "
            "Está en %s y no está en git: si se pierde el disco, se pierde.",
            cfg.registro_ruta,
        )
    servicio_registro = ServicioRegistro(registro_con_copia, indice, indice_pruebas)

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

    # --- Actividad por épica (bajo demanda) ------------------------------- #
    # Se compone DESPUÉS del servicio de backlog porque reutiliza su árbol
    # cacheado: si no, cada petición de actividad volvería a construir el grafo
    # de la épica, que ya está en memoria de la vista anterior.
    actividad = ServicioActividad(repositorio, servicio, cache, ttl_seg=cfg.actividad_ttl_seg)

    return Contenedor(
        settings=cfg,
        transporte=transporte,
        monitor=monitor,
        repositorio=repositorio,
        cache=cache,
        servicio=servicio,
        indice=indice,
        indice_pruebas=indice_pruebas,
        registro_principal=registro_principal,
        registro_copia=registro_con_copia,
        servicio_registro=servicio_registro,
        actividad=actividad,
        escritura=escritura,
        transporte_escritura=transporte_escritura,
    )