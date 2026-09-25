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
        try:
            respuesta = await self._cliente.patch(
                url,
                json=body,
                headers={**self._headers(), "Content-Type": content_type},
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
