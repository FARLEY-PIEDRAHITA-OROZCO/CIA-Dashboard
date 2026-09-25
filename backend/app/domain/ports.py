"""Puertos (abstracciones) que definen los contratos del dominio.

Los servicios de aplicación dependen de estos protocolos, no de los
adaptadores concretos (inversión de dependencias). Esto permite implementar
trasportes HTTP, repositorios o caches alternativos (mock, GraphQL, Redis)
sin tocar la capa de negocio.
"""

from typing import Any, Dict, List, Optional, Protocol

from .models import ActualizacionQA, Epic, ResultadoActualizacion


class TransportePort(Protocol):
    """Contrato mínimo de transporte HTTP JSON."""

    async def get(self, url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: ...

    async def post(self, url: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: ...

    async def patch(
        self,
        url: str,
        body: Optional[Any] = None,
        *,
        content_type: str = "application/json-patch+json",
    ) -> Dict[str, Any]: ...

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

    def eliminar(self, clave: str) -> None: ...

    def limpiar(self) -> None: ...


class EscrituraBacklogPort(Protocol):
    """Capacidad de escritura **opt-in** sobre work items (ADR-11).

    Vive separada de :class:`RepositorioBacklogPort` a propósito: el sistema
    es un lector de solo lectura y la escritura es un adaptador adicional que
    se puede retirar sin tocar la lectura.
    """

    async def actualizar_work_item(
        self,
        work_item_id: int,
        cambios: ActualizacionQA,
        *,
        validar: bool = False,
        rev_esperada: int | None = None,
    ) -> ResultadoActualizacion: ...

    async def obtener_revision(self, work_item_id: int) -> int: ...