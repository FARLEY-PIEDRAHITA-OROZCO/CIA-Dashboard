"""Adaptador de transporte HTTP hacia Azure DevOps.

Responsabilidad única: hablar HTTP(S) con Azure, autenticando con el PAT vía
``Basic auth``, y traducir errores a :class:`AzureError`. No conoce WIQL ni
la estructura del backlog; el repositorio decide qué URLs consultar.
El header de autorización se construye en un único punto y jamás se registra.
"""

import base64
from typing import Any, Dict, Optional

import httpx


class AzureError(Exception):
    """Error operativo de la integración con Azure DevOps."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class AzureTransporte:
    """Transporte HTTP con autenticación de PAT contra Azure DevOps."""

    def __init__(
        self,
        pat: str,
        *,
        timeout: float = 30.0,
        cliente: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._pat = pat or ""
        self._timeout = timeout
        self._cliente = cliente or httpx.AsyncClient(timeout=timeout)

    # ------------------------------------------------------------------ #
    # Contrato TransportePort
    # ------------------------------------------------------------------ #
    async def get(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            respuesta = await self._cliente.get(
                url,
                params=params,
                headers=self._headers(),
                timeout=self._timeout,
            )
        except httpx.RequestError as exc:
            raise AzureError(
                f"No se pudo contactar a Azure ({type(exc).__name__})."
            ) from exc
        return self._procesar(respuesta)

    async def post(
        self,
        url: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            respuesta = await self._cliente.post(
                url,
                json=body,
                headers=self._headers(),
                timeout=self._timeout,
            )
        except httpx.RequestError as exc:
            raise AzureError(
                f"No se pudo contactar a Azure ({type(exc).__name__})."
            ) from exc
        return self._procesar(respuesta)

    async def cerrar(self) -> None:
        await self._cliente.aclose()

    # ------------------------------------------------------------------ #
    # Internos
    # ------------------------------------------------------------------ #
    def _headers(self) -> Dict[str, str]:
        token = base64.b64encode(f":{self._pat}".encode("utf-8")).decode("ascii")
        return {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }

    def _procesar(self, respuesta: httpx.Response) -> Dict[str, Any]:
        status = respuesta.status_code
        if status >= 400:
            raise AzureError(
                f"Azure respondió HTTP {status}.",
                status_code=status,
            )
        if status != 200:
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
