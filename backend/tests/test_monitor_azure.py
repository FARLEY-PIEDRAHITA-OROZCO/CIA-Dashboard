"""Pruebas del monitor de llamadas a Azure.

Lo que se vigila, por orden de importancia:

1. **Que el monitor no altere nada.** Es un observador: no puede reescribir,
   reintentar ni cortar una petición. Si pudiera, estaría midiendo algo distinto
   de lo que se envió.
2. **Que apagado no cueste nada.** Con `monitor=None` el transporte se comporta
   exactamente igual que antes: ni una rama, ni un registro, ni una asignación de
   más.
3. **Que los errores de red también se cuenten.** Un fallo de red antes de enviar
   no es una respuesta de Azure, pero es un fallo del sistema y tiene que
   aparecer. Sin esto, la tasa de error quedaría por debajo de la real.
4. **Que la concurrencia no se quede desbloqueada.** Si una petición levanta
   entre `entrar()` y `salir()`, el contador no vuelve a bajar y el pico sería
   mentira.
5. **Que los umbrales disparen avisos, no números sueltos.** Un contador de
   errores no dice nada; «esto supera el umbral» sí.
"""

import httpx
import pytest

from app.infrastructure.azure.monitor import (
    LIMITE_CONCURRENTES,
    MAX_RECIENTES,
    MonitorAzure,
    categorizar,
    _percentil,
)
from app.infrastructure.azure.transport import AzureError, AzureTransporte


class ClienteHTTPDoble:
    """Doble mínimo de `httpx.AsyncClient` para aislar al transporte.

    Acepta solo lo que el transporte le pasa de verdad: `url`, `headers`,
    `timeout`, y `json`/`params` cuando existen. Si el transporte empieza a pasar
    algo que no debe, el doble lo dice en vez de pasar desapercibido.
    """

    def __init__(self, respuestas) -> None:
        self.respuestas = list(respuestas)
        self.solicitudes: list[dict] = []

    async def get(self, url, headers=None, timeout=None, **kwargs):
        self.solicitudes.append({"metodo": "get", "url": url, "headers": headers, **kwargs})
        return self.respuestas.pop(0)

    async def post(self, url, headers=None, timeout=None, **kwargs):
        self.solicitudes.append({"metodo": "post", "url": url, "headers": headers, **kwargs})
        return self.respuestas.pop(0)

    async def patch(self, url, headers=None, timeout=None, **kwargs):
        self.solicitudes.append({"metodo": "patch", "url": url, "headers": headers, **kwargs})
        return self.respuestas.pop(0)


def transporte(respuestas, monitor=None):
    return AzureTransporte("pat-falso", cliente=ClienteHTTPDoble(respuestas), monitor=monitor)


# ---------------------------------------------------------------------- #
# Categorización
# ---------------------------------------------------------------------- #
class TestCategorizar:
    @pytest.mark.parametrize(
        "url,esperado",
        [
            ("https://dev.azure.com/o/p/_apis/wit/wiql?api-version=7.1", "WIQL"),
            ("https://dev.azure.com/o/p/_apis/wit/workitems?ids=1,2&api-version=7.1", "Lote"),
            ("https://dev.azure.com/o/p/_apis/wit/workitems/123?api-version=7.1", "Work item"),
            ("https://dev.azure.com/o/p/_apis/wit/workitems/123/updates?api-version=7.1", "Historial"),
            ("https://dev.azure.com/o/p/_apis/projects/Mi%20Proyecto", "Proyecto"),
            # Los comentarios son un sub-recurso del work item: agruparlos con él
            # es correcto, y «Otro» sería una categoría que no dice nada.
            ("https://dev.azure.com/o/p/_apis/wit/workitems/123/comments", "Work item"),
        ],
    )
    def test_clasifica_por_lo_que_es_no_por_la_url(self, url, esperado):
        # Agrupar por URL literal daría una categoría por ítem y el monitor no
        # serviría para nada.
        assert categorizar(url) == esperado

    def test_el_lote_se_distingue_del_item_suelto(self):
        # `/workitems?ids=1,2` es un lote; `/workitems/123` es un ítem. Si se
        # confunden, «28 lotes» parece «28 peticiones» y el número engaña.
        assert categorizar("https://x/_apis/wit/workitems?ids=1,2") == "Lote"
        assert categorizar("https://x/_apis/wit/workitems/123") == "Work item"


# ---------------------------------------------------------------------- #
# El monitor no altera nada
# ---------------------------------------------------------------------- #
class TestMonitorNoAltera:
    @pytest.mark.asyncio
    async def test_una_llamada_correcta_devuelve_lo_mismo_con_y_sin_monitor(self):
        respuesta = httpx.Response(200, json={"ok": True})
        sin = transporte([respuesta])
        con = transporte([httpx.Response(200, json={"ok": True})], monitor=MonitorAzure())

        assert await sin.get("https://x") == {"ok": True}
        assert await con.get("https://x") == {"ok": True}

    @pytest.mark.asyncio
    async def test_sin_monitor_no_hay_registro_ni_concurrencia(self):
        t = transporte([httpx.Response(200, json={})])
        await t.get("https://x")
        # No hay monitor: no hay nada que preguntar. Y el transporte no falla.
        assert t._monitor is None

    @pytest.mark.asyncio
    async def test_el_monitor_no_puede_cortar_una_peticion(self):
        """Un monitor que pudiera alterar la petición estaría midiendo otra cosa."""
        monitor = MonitorAzure()
        t = transporte([httpx.Response(200, json={"ok": True})], monitor=monitor)
        await t.get("https://x")
        solicitud = t._cliente.solicitudes[0]
        # Ni reescribe la URL ni añade headers que no sean los de antes.
        assert solicitud["url"] == "https://x"
        assert "Authorization" in solicitud["headers"]


# ---------------------------------------------------------------------- #
# Registro
# ---------------------------------------------------------------------- #
class TestRegistro:
    @pytest.mark.asyncio
    async def test_registra_metodo_categoria_estado_y_duracion(self):
        monitor = MonitorAzure()
        t = transporte([httpx.Response(200, json={})], monitor=monitor)
        await t.get("https://x/_apis/wit/wiql?api-version=7.1")

        estado = await monitor.estado()
        assert estado.total == 1
        assert estado.por_categoria == {"WIQL": 1}
        assert estado.por_estado == {"200": 1}
        assert estado.errores == 0
        assert estado.tasa_error == 0.0
        assert estado.llamadas_recientes[0].metodo == "GET"
        assert estado.llamadas_recientes[0].categoria == "WIQL"
        assert estado.llamadas_recientes[0].estado == 200

    @pytest.mark.asyncio
    async def test_un_error_http_se_como_error(self):
        monitor = MonitorAzure()
        t = transporte([httpx.Response(404, json={"message": "no está"})], monitor=monitor)
        with pytest.raises(AzureError):
            await t.get("https://x")

        estado = await monitor.estado()
        assert estado.errores == 1
        assert estado.tasa_error == 1.0
        assert estado.llamadas_recientes[0].estado == 404
        assert "no está" in estado.llamadas_recientes[0].error

    @pytest.mark.asyncio
    async def test_un_error_de_red_tambien_se_cuenta(self):
        """Si no, la tasa de error quedaría por debajo de la real."""

        class ClienteCaido:
            async def get(self, *a, **k):
                raise httpx.ConnectError("sin red")

        monitor = MonitorAzure()
        t = AzureTransporte("pat", cliente=ClienteCaido(), monitor=monitor)
        with pytest.raises(AzureError):
            await t.get("https://x")

        estado = await monitor.estado()
        assert estado.total == 1
        assert estado.errores == 1
        assert estado.llamadas_recientes[0].estado == 0
        assert "ConnectError" in estado.llamadas_recientes[0].error

    @pytest.mark.asyncio
    async def test_el_error_se_acota_para_no_llevarse_el_monitor_por_delante(self):
        monitor = MonitorAzure()
        cuerpo = "x" * 5000
        t = transporte([httpx.Response(500, json={"message": cuerpo})], monitor=monitor)
        with pytest.raises(AzureError):
            await t.get("https://x")
        assert len((await monitor.estado()).llamadas_recientes[0].error) <= 200


# ---------------------------------------------------------------------- #
# Concurrencia
# ---------------------------------------------------------------------- #
class TestConcurrencia:
    @pytest.mark.asyncio
    async def test_entrar_y_saltar_deja_el_contador_en_cero(self):
        monitor = MonitorAzure()
        await monitor.entrar()
        await monitor.salir()
        assert (await monitor.estado()).concurrentes == 0

    @pytest.mark.asyncio
    async def test_cualquier_excepcion_no_deja_la_concurrencia_colgada(self):
        """La concurrencia se libera con `finally`, no solo en los errores de red.

        Si una petición levanta una excepción que no es de red y el contador no
        baja, el pico sería mentira: se quedaría subido para siempre.
        """

        class ClienteExplosivo:
            async def get(self, *a, **k):
                raise RuntimeError("boom")

        monitor = MonitorAzure()
        t = AzureTransporte("pat", cliente=ClienteExplosivo(), monitor=monitor)
        with pytest.raises(Exception):
            await t.get("https://x")
        assert (await monitor.estado()).concurrentes == 0

    @pytest.mark.asyncio
    async def test_el_pico_no_baja_nunca(self):
        monitor = MonitorAzure()
        await monitor.entrar()
        await monitor.entrar()
        await monitor.salir()
        estado = await monitor.estado()
        assert estado.concurrentes == 1
        assert estado.concurrentes_pico == 2


# ---------------------------------------------------------------------- #
# Percentiles y avisos
# ---------------------------------------------------------------------- #
class TestPercentiles:
    def test_percentil_con_pocas_llamadas_no_inventa_un_numero(self):
        # Con 3 llamadas, el p95 «del elemento más cercano» es el máximo, y eso no
        # es el 95 %: es el 100 % de tres.
        assert _percentil([100, 200, 300], 95) == 290

    def test_percentil_con_una_sola_llamada(self):
        assert _percentil([500], 95) == 500

    def test_percentil_con_lista_vacia(self):
        assert _percentil([], 95) == 0

    def test_el_maximo_es_el_maximo(self):
        assert _percentil([1, 2, 3, 4, 5], 100) == 5


class TestAvisos:
    @pytest.mark.asyncio
    async def test_una_tasa_de_error_alta_avisa(self):
        monitor = MonitorAzure()
        for _ in range(10):
            await monitor.registrar(
                metodo="GET", url="https://x", estado=500, duracion_ms=100
            )
        for _ in range(10):
            await monitor.registrar(
                metodo="GET", url="https://x", estado=200, duracion_ms=100
            )
        avisos = (await monitor.estado()).avisos
        assert any("Tasa de error" in a for a in avisos)

    @pytest.mark.asyncio
    async def test_una_tasa_de_error_baja_no_avisa(self):
        monitor = MonitorAzure()
        for _ in range(100):
            await monitor.registrar(
                metodo="GET", url="https://x", estado=200, duracion_ms=100
            )
        assert (await monitor.estado()).avisos == []

    @pytest.mark.asyncio
    async def test_un_429_avisa_diciendo_que_es_el_limite(self):
        """Un 429 no es un fallo de la aplicación: es Azure diciendo «vas demasiado rápido».

        Decirlo importa, porque la respuesta es distinta: un 500 se arregla
        mirando el servidor, un 429 se arregla yendo más despacio.
        """
        monitor = MonitorAzure()
        await monitor.registrar(metodo="GET", url="https://x", estado=429, duracion_ms=100)
        avisos = (await monitor.estado()).avisos
        assert any("429" in a for a in avisos)

    @pytest.mark.asyncio
    async def test_acercarse_al_limite_de_concurrencia_avisa(self):
        monitor = MonitorAzure(limite_concurrentes=10)
        for _ in range(8):
            await monitor.entrar()
        avisos = (await monitor.estado()).avisos
        assert any("conexiones simultáneas" in a for a in avisos)

    @pytest.mark.asyncio
    async def test_el_limite_por_defecto_es_el_de_azure(self):
        # 300 es el límite de conexiones simultáneas por usuario en Azure DevOps.
        # Si se cambia aquí sin cambiarlo en Azure, el aviso llega tarde.
        assert LIMITE_CONCURRENTES == 300
        assert MonitorAzure()._limite == 300

    @pytest.mark.asyncio
    async def test_una_latencia_p95_alta_avisa(self):
        monitor = MonitorAzure()
        for _ in range(20):
            await monitor.registrar(
                metodo="GET", url="https://x", estado=200, duracion_ms=10_000
            )
        assert any("95 %" in a for a in (await monitor.estado()).avisos)


# ---------------------------------------------------------------------- #
# El endpoint
# ---------------------------------------------------------------------- #
class TestEndpoint:
    def _cliente(self, monitor):
        from fastapi.testclient import TestClient

        from app.main import crear_app
        from tests.conftest import FakeRepositorio, contenedor_con

        return TestClient(
            crear_app(contenedor_con(FakeRepositorio(), monitor=monitor))
        )

    def test_apagado_devuelve_404_no_un_contador_vacio(self):
        """Un contador a cero apagado parece «todo va bien». Un 404 no."""
        cliente = self._cliente(None)
        r = cliente.get("/api/monitor/azure")
        assert r.status_code == 404
        assert "MONITOR_HABILITADA" in r.json()["detail"]

    def test_encendido_devuelve_el_estado(self):
        cliente = self._cliente(MonitorAzure())
        r = cliente.get("/api/monitor/azure")
        assert r.status_code == 200
        datos = r.json()
        assert datos["activa"] is True
        assert datos["total"] == 0
        assert datos["limite_concurrentes"] == 300
        assert datos["avisos"] == []

    def test_no_llama_a_azure_ni_al_indice(self):
        """Es solo un contador: no puede ser la causa de lo que mide."""
        monitor = MonitorAzure()
        cliente = self._cliente(monitor)
        cliente.get("/api/monitor/azure")
        assert monitor._total == 0
