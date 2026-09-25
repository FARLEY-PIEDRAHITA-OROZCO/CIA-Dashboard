"""Implementación de caché en memoria con TTL.

Cumple el puerto :class:`CachePort`. Es reemplazable por Redis u otra
tecnología sin cambiar la aplicación (open/closed + dependency inversion).
"""

import time
from typing import Any, Dict, Optional, Tuple

from ..domain.ports import CachePort


class CacheMemoria(CachePort):
    """Caché simple con expiración por clave."""

    def __init__(self) -> None:
        self._datos: Dict[str, Tuple[float, Any]] = {}

    def obtener(self, clave: str) -> Optional[Any]:
        tupla = self._datos.get(clave)
        if tupla is None:
            return None
        expira, valor = tupla
        if time.monotonic() > expira:
            self._datos.pop(clave, None)
            return None
        return valor

    def guardar(self, clave: str, valor: Any, ttl_seg: float) -> None:
        self._datos[clave] = (time.monotonic() + max(0.0, ttl_seg), valor)

    def eliminar(self, clave: str) -> None:
        """Invalidación dirigida: borra solo esa clave.

        Tras una escritura en Azure hay que refrescar únicamente lo afectado
        (la épica y su árbol), sin tirar la caché completa que obligaría a
        releer todo el backlog.
        """
        self._datos.pop(clave, None)

    def limpiar(self) -> None:
        self._datos.clear()

    def claves(self) -> list[str]:
        return list(self._datos)