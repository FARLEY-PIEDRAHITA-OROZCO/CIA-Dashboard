"""Puertos (abstracciones) que definen los contratos del dominio.

Los servicios de aplicación dependen de estos protocolos, no de los
adaptadores concretos (inversión de dependencias). Esto permite implementar
trasportes HTTP, repositorios o caches alternativos (mock, GraphQL, Redis)
sin tocar la capa de negocio.
"""

from typing import Any, Dict, List, Optional, Protocol

from .models import (
    ActualizacionQA,
    CargaPruebas,
    Epic,
    Instantanea,
    ItemIndice,
    ResultadoActualizacion,
    Revision,
)


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

    async def listar_work_items(
        self, tipos: Optional[tuple[str, ...]] = None
    ) -> List[ItemIndice]:
        """Proyección plana de los work items del proyecto (para el índice local).

        Se mantiene separada de `listar_epicas` porque responde a un uso
        distinto: el índice de sprints y personas, no el listado del dashboard.
        """
        ...

    async def listar_activos_prueba(
        self, tipos: tuple[str, ...]
    ) -> CargaPruebas:
        """Activos de prueba (Test Plan / Suite / Case) con sus requisitos.

        Vive en este puerto y no en el de escritura porque es **solo lectura**.
        Devuelve un `CargaPruebas` y no una lista a propósito: el conteo de
        lotes fallidos es lo que permite que la cobertura se declare parcial en
        lugar de completa y falsa.
        """
        ...

    async def obtener_epica(
        self, epic_id: int, *, incluir_bugs: bool = False
    ) -> Optional[Epic]: ...

    async def historial_work_item(self, work_item_id: int) -> List[Revision]:
        """Historial de revisiones de **un** work item, en orden de revisión.

        Va en este puerto, uno a uno, y no por lote a propósito: no existe un
        endpoint de Azure que dé el historial de varios ítems en una llamada
        (medido), así que una vista global de actividad serían 5.651 peticiones
        y no es una opción. Por eso se ofrece por épica y bajo demanda.

        Un item sin historial legible devuelve lista vacía, no error: que un ítem
        no tenga revisiones no es un fallo de lectura, es un dato.
        """
        ...


class CachePort(Protocol):
    """Contrato de caché clave/valor con expiración."""

    def obtener(self, clave: str) -> Optional[Any]: ...

    def guardar(self, clave: str, valor: Any, ttl_seg: float) -> None: ...

    def eliminar(self, clave: str) -> None: ...

    def limpiar(self) -> None: ...


class RegistroAsignacionesPort(Protocol):
    """Persistencia local de perfiles y asignaciones de pruebas.

    Vive aparte de `CachePort` a propósito: la caché es volátil y se puede tirar
    sin consecuencias, mientras que esto es **el único sitio donde existe la
    información de qué épica lleva cada persona**. Un error aquí pierde trabajo
    que Azure no conoce y no puede devolver.

    Se lee y se escribe con un hash de versión, no con un `PUT` ciego: si el
    fichero en disco cambió desde que se leyó, la escritura se rechaza en vez de
    pisar el cambio ajeno.
    """

    async def leer(self) -> Instantanea:
        """Lee el registro. Un fichero ausente devuelve una instantánea vacía.

        No es un error: es el primer arranque. Un fichero **corrupto** sí lo es, y
        debe decirlo en vez de devolver un registro vacío, porque «no hay
        asignaciones» y «no se pudo leer el fichero» llevan a decisiones
        opuestas.
        """
        ...

    async def guardar(self, instantanea: Instantanea) -> Instantanea:
        """Escribe el registro y devuelve la instantánea nueva con su hash.

        Si el hash guardado no coincide con el del disco, lanza
        `RegistroModificado`: el registro cambió desde que se leyó.
        """
        ...


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