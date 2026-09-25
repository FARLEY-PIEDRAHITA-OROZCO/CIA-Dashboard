"""Puertos (abstracciones) que definen los contratos del dominio.

Los servicios de aplicación dependen de estos protocolos, no de los
adaptadores concretos (inversión de dependencias). Esto permite implementar
trasportes HTTP, repositorios o caches alternativos (mock, GraphQL, Redis)
sin tocar la capa de negocio.
"""

from typing import Any, Dict, List, Optional, Protocol

from .models import Epic


class TransportePort(Protocol):
    """Contrato mínimo de transporte HTTP JSON."""

    async def get(self, url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: ...

    async def post(self, url: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: ...

    async def cerrar(self) -> None: ...


class RepositorioBacklogPort(Protocol):
    """Contrato de lectura del backlog que consume la aplicación."""

    async def verificar_proyecto(self) -> Dict[str, str]: ...

    async def listar_epicas(self) -> List[Epic]: ...

    async def obtener_epica(
        self, epic_id: int, *, incluir_bugs: bool = False
    ) -> Optional[Epic]: ...


class CachePort(Protocol):
    """Contrato de caché clave/valor con expiración."""

    def obtener(self, clave: str) -> Optional[Any]: ...

    def guardar(self, clave: str, valor: Any, ttl_seg: float) -> None: ...

    def limpiar(self) -> None: ...