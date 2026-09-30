"""Adaptador de transporte HTTP hacia Azure DevOps.

Responsabilidad única: hablar HTTP(S) con Azure, autenticando con el PAT vía
``Basic auth``, y traducir errores a :class:`AzureError`. No conoce WIQL ni
la estructura del backlog; el repositorio decide qué URLs consultar.
El header de autorización se construye en un único punto y jamás se registra.
"""

import base64
import time
from typing import Any, Dict, Optional

import httpx

from .monitor import MonitorAzure


class AzureError(Exception):
    """Error operativo de la integración con Azure DevOps.

    ``detalle`` conserva el mensaje de Azure (por ejemplo, qué regla de
    transición rechazó el cambio). Se limita a 300 caracteres y nunca contiene
    credenciales: Azure lo usa para describir la regla, no el PAT.
    """

    MAX_DETALLE = 300

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        detalle: str = "",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detalle = self._sanear(detalle)

    def _sanear(self, valor: object) -> str:
        texto = str(valor or "").strip()
        if not texto:
            return ""
        texto = " ".join(texto.split())
        return texto[: self.MAX_DETALLE]


class AzureTransporte:
    """Transporte HTTP con autenticación de PAT contra Azure DevOps."""

    def __init__(
        self,
        pat: str,
        *,
        timeout: float = 30.0,
        cliente: Optional[httpx.AsyncClient] = None,
        monitor: Optional[MonitorAzure] = None,
    ) -> None:
        self._pat = pat or ""
        self._timeout = timeout
        self._cliente = cliente or httpx.AsyncClient(timeout=timeout)
        #: Monitor de llamadas, opcional. Sin él el transporte se comporta
        #: exactamente igual que antes: el monitor es un observador, no un
        #: participante, y no puede alterar una petición ni su respuesta.
        self._monitor = monitor

    # ------------------------------------------------------------------ #
    # Contrato TransportePort
    # ------------------------------------------------------------------ #
    async def get(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._llamar("GET", url, self._cliente.get, params=params)

    async def post(
        self,
        url: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._llamar("POST", url, self._cliente.post, body=body)

    async def patch(
        self,
        url: str,
        body: Optional[Any] = None,
        *,
        content_type: str = "application/json-patch+json",
    ) -> Dict[str, Any]:
        """Aplica un *JSON Patch* (Azure DevOps actualiza work items con PATCH).

        `content_type` es parametrizable porque la misma primitiva sirve para
        `application/json-patch+json` (escritura de work items) y para
        `application/json` (WIQL y otros cuerpos).
        """
        return await self._llamar(
            "PATCH",
            url,
            self._cliente.patch,
            body=body,
            content_type=content_type,
        )

    async def cerrar(self) -> None:
        await self._cliente.aclose()

    async def _llamar(
        self,
        metodo: str,
        url: str,
        funcion,
        *,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Any] = None,
        content_type: str = "application/json",
    ) -> Dict[str, Any]:
        """Ejecuta una petición y la deja registrada en el monitor, si lo hay.

        Tres decisiones que no son de estilo:

        1. **El monitor nunca altera la petición.** Se le pasa la URL ya formada y
           el resultado ya obtenido; no puede reescribir, reintentar ni cortar.
           Un monitor que pudiera alterar la petición estaría midiendo algo
           distinto de lo que se envió.
        2. **Los errores de red también se registran**, con el estado que Azure
           habría devolto si hubiera respondido. Sin esto, un fallo de red
           desaparecería del contador y la tasa de error quedaría por debajo de la
           real.
        3. **La concurrencia se mide con entrar/salir**, no con un contador que se
           incrementa al inicio y se olvida: si una petición levanta, el contador
           quedaría desbloqueado para siempre y el pico sería mentira.
        """
        if self._monitor is None:
            return await self._sin_monitor(metodo, url, funcion, params=params, body=body, content_type=content_type)

        await self._monitor.entrar()
        inicio = time.perf_counter()
        try:
            # `json` y `params` solo cuando existen: un GET con `json=None` es una
            # petición mal formada, y un POST con `params=None` es igual de raro.
            kwargs: Dict[str, Any] = {}
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params
            respuesta = await funcion(
                url,
                headers=self._headers(content_type),
                timeout=self._timeout,
                **kwargs,
            )
        except httpx.RequestError as exc:
            duracion = int((time.perf_counter() - inicio) * 1000)
            await self._monitor.registrar(
                metodo=metodo,
                url=url,
                estado=0,
                duracion_ms=duracion,
                error=f"{type(exc).__name__}: {exc}",
            )
            raise AzureError(
                f"No se pudo contactar a Azure ({type(exc).__name__})."
            ) from exc
        finally:
            # La concurrencia se libera **siempre**, también si la petición levanta
            # una excepción que no es de red. Sin este `finally`, un error
            # inesperado dejaría el contador subido para siempre y el pico sería
            # mentira.
            await self._monitor.salir()
        duracion = int((time.perf_counter() - inicio) * 1000)
        estado = respuesta.status_code
        if estado >= 400:
            detalle = self._detalle_error(respuesta)
            await self._monitor.registrar(
                metodo=metodo,
                url=url,
                estado=estado,
                duracion_ms=duracion,
                error=detalle,
            )
            raise AzureError(
                f"Azure respondió HTTP {estado}.",
                status_code=estado,
                detalle=detalle,
            )
        if estado not in (200, 201):
            await self._monitor.registrar(
                metodo=metodo, url=url, estado=estado, duracion_ms=duracion
            )
            raise AzureError(
                f"Azure devolvió un estado HTTP inesperado: {estado}.",
                status_code=estado,
            )
        try:
            datos = respuesta.json()
        except ValueError as exc:
            await self._monitor.registrar(
                metodo=metodo, url=url, estado=estado, duracion_ms=duracion
            )
            raise AzureError(
                "Azure devolvió una respuesta que no es JSON válido.",
                status_code=estado,
            ) from exc
        if not isinstance(datos, dict):
            await self._monitor.registrar(
                metodo=metodo, url=url, estado=estado, duracion_ms=duracion
            )
            raise AzureError(
                "Azure devolvió un JSON con una forma inesperada.",
                status_code=estado,
            )
        await self._monitor.registrar(
            metodo=metodo, url=url, estado=estado, duracion_ms=duracion
        )
        return datos

    async def _sin_monitor(
        self,
        metodo: str,
        url: str,
        funcion,
        *,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Any] = None,
        content_type: str = "application/json",
    ) -> Dict[str, Any]:
        """El mismo camino de antes, sin monitor.

        Existe como método aparte y no como `if` dentro de `_llamar` para que el
        caso sin monitor no pague ni una rama por comprobación: el monitor está
        apagado la mayor parte del tiempo, y su coste cuando está apagado debe ser
        cero, no «una comprobación de más».
        """
        try:
            # `json` y `params` solo cuando existen: un GET con `json=None` es una
            # petición mal formada, y un POST con `params=None` es igual de raro.
            kwargs: Dict[str, Any] = {}
            if body is not None:
                kwargs["json"] = body
            if params is not None:
                kwargs["params"] = params
            respuesta = await funcion(
                url,
                headers=self._headers(content_type),
                timeout=self._timeout,
                **kwargs,
            )
        except httpx.RequestError as exc:
            raise AzureError(
                f"No se pudo contactar a Azure ({type(exc).__name__})."
            ) from exc
        return self._procesar(respuesta)

    def _headers(self, content_type: str = "application/json") -> Dict[str, str]:
        token = base64.b64encode(f":{self._pat}".encode("utf-8")).decode("ascii")
        return {
            "Authorization": f"Basic {token}",
            "Content-Type": content_type,
        }

    @staticmethod
    def _detalle_error(respuesta: httpx.Response) -> str:
        """Extrae el mensaje de regla de Azure, sin volcar el cuerpo completo.

        Azure devuelve ``{"message": ..., "typeKey": ...}`` en los 4xx. Solo se
        conserva ``message`` (acotado por ``AzureError``), nunca el cuerpo
        bruto, para no filtrar información innecesaria al frontend.
        """
        try:
            cuerpo = respuesta.json()
        except ValueError:
            return ""
        if not isinstance(cuerpo, dict):
            return ""
        return str(cuerpo.get("message") or cuerpo.get("typeKey") or "")

    def _procesar(self, respuesta: httpx.Response) -> Dict[str, Any]:
        status = respuesta.status_code
        if status >= 400:
            raise AzureError(
                f"Azure respondió HTTP {status}.",
                status_code=status,
                detalle=self._detalle_error(respuesta),
            )
        if status not in (200, 201):
            raise AzureError(
                f"Azure devolvió un estado HTTP inesperado: {status}.",
                status_code=status,
            )
        try:
            datos = respuesta.json()
        except ValueError as exc:
            raise AzureError(
                "Azure devolvió una respuesta que no es JSON válido.",
                status_code=status,
            ) from exc
        if not isinstance(datos, dict):
            raise AzureError(
                "Azure devolvió un JSON con una forma inesperada.",
                status_code=status,
            )
        return datos
