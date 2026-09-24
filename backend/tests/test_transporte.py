"""Pruebas del transporte HTTP hacia Azure (auth y manejo de errores)."""

import base64

import httpx
import pytest

from app.infrastructure.azure.transport import AzureError, AzureTransporte


class ClienteHTTPDoble:
    """Doble mínimo de httpx.AsyncClient para aislar al transporte."""

    def __init__(self, respuestas) -> None:
        self.respuestas = list(respuestas)
        self.solicitudes: list[dict] = []

    async def get(self, url, params=None, headers=None, timeout=None):
        self.solicitudes.append({"metodo": "get", "url": url, "headers": headers, "params": params})
        return self.respuestas.pop(0)

    async def post(self, url, json=None, headers=None, timeout=None):
        self.solicitudes.append({"metodo": "post", "url": url, "headers": headers, "json": json})
        return self.respuestas.pop(0)


@pytest.mark.asyncio
async def test_auth_basic_usa_pat():
    cliente = ClienteHTTPDoble([httpx.Response(200, json={"ok": True})])
    tr = AzureTransporte("pat123", cliente=cliente)  # type: ignore[arg-type]

    await tr.get("https://dev.azure.com/x/_apis/projects")

    esperado = base64.b64encode(b":pat123").decode()
    headers = cliente.solicitudes[0]["headers"]
    assert headers["Authorization"] == f"Basic {esperado}"


@pytest.mark.asyncio
async def test_errores_http_se_traducen_con_diagnostico():
    cliente = ClienteHTTPDoble([httpx.Response(401, text="TF400813: PAT inválido")])
    tr = AzureTransporte("mal", cliente=cliente)  # type: ignore[arg-type]

    with pytest.raises(AzureError) as exc:
        await tr.post("https://dev.azure.com/x/_apis/wit/wiql", {"query": "Q"})

    mensaje = str(exc.value)
    assert "401" in mensaje
    assert "TF400813" not in mensaje


@pytest.mark.asyncio
async def test_falla_de_red_se_envuelve():
    class ClienteCaido:
        async def get(self, *a, **k):
            raise httpx.ConnectError("sin red")

    tr = AzureTransporte("x", cliente=ClienteCaido())  # type: ignore[arg-type]

    with pytest.raises(AzureError):
        await tr.get("https://dev.azure.com/x")


@pytest.mark.asyncio
async def test_extrae_json_de_la_respuesta():
    cliente = ClienteHTTPDoble([httpx.Response(200, json={"valor": 42})])
    tr = AzureTransporte("x", cliente=cliente)  # type: ignore[arg-type]

    datos = await tr.get("https://dev.azure.com/x")

    assert datos == {"valor": 42}


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [203, 204, 302])
async def test_rechaza_estatos_azure_no_inesperados(status):
    cliente = ClienteHTTPDoble([httpx.Response(status, json={"ok": True})])
    tr = AzureTransporte("x", cliente=cliente)  # type: ignore[arg-type]

    with pytest.raises(AzureError) as exc:
        await tr.get("https://dev.azure.com/x")

    assert exc.value.status_code == status


@pytest.mark.asyncio
async def test_rechaza_json_invalido_o_con_forma_inesperada():
    invalido = AzureTransporte("x", cliente=ClienteHTTPDoble([httpx.Response(200, text="<html>")]))  # type: ignore[arg-type]
    with pytest.raises(AzureError, match="JSON"):
        await invalido.get("https://dev.azure.com/x")

    lista = AzureTransporte("x", cliente=ClienteHTTPDoble([httpx.Response(200, json=[])]))  # type: ignore[arg-type]
    with pytest.raises(AzureError, match="forma inesperada"):
        await lista.get("https://dev.azure.com/x")


@pytest.mark.asyncio
async def test_el_error_http_conserva_status_y_redacta_pat():
    cliente = ClienteHTTPDoble([httpx.Response(404, text="pat-secreto no existe")])
    tr = AzureTransporte("pat-secreto", cliente=cliente)  # type: ignore[arg-type]

    with pytest.raises(AzureError) as exc:
        await tr.get("https://dev.azure.com/x/404")

    assert exc.value.status_code == 404
    assert "pat-secreto" not in str(exc.value)
    assert "Azure respondió HTTP 404" in str(exc.value)
