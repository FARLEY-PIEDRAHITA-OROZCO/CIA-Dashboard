"""Pruebas del caso de uso ServicioBacklog (caché y estado)."""

import pytest

from app.application.services import ServicioBacklog
from app.domain.models import EstadoIntegracion, Epic
from app.infrastructure.cache import CacheMemoria

from .conftest import (
    FakeRepositorio,
    epica_canonica,
    epica_con_bug_en_feature,
    epica_con_bugs,
)


class ContadorRepositorio(FakeRepositorio):
    def __init__(self) -> None:
        super().__init__(epicas=[epica_canonica()], arbol=epica_canonica())
        self.llamadas_listado = 0
        self.llamadas_arbol = 0

    async def listar_epicas(self):
        self.llamadas_listado += 1
        return await super().listar_epicas()

    async def obtener_epica(self, epic_id: int, *, incluir_bugs: bool = False):
        self.llamadas_arbol += 1
        return await super().obtener_epica(epic_id, incluir_bugs=incluir_bugs)


def servicio_con(repo, ttl=3600, configurado=True) -> ServicioBacklog:
    return ServicioBacklog(
        repositorio=repo,
        cache=CacheMemoria(),
        ttl_seg=ttl,
        configuracion=configurado,
        organizacion="https://dev.azure.com/organizacion-ejemplo",
        proyecto="Proyecto de ejemplo",
        area_path="Proyecto de ejemplo",
    )


@pytest.mark.asyncio
async def test_listado_se_cachea_y_refrescar_lo_invalida():
    repo = ContadorRepositorio()
    servicio = servicio_con(repo)

    primera = await servicio.listar_epicas()
    segunda = await servicio.listar_epicas()
    assert repo.llamadas_listado == 1  # la segunda consulta vino de caché
    assert primera == segunda

    servicio.refrescar()
    await servicio.listar_epicas()
    assert repo.llamadas_listado == 2


@pytest.mark.asyncio
async def test_arbol_se_cachea_por_epica():
    repo = ContadorRepositorio()
    servicio = servicio_con(repo)

    await servicio.arbol_epica(100)
    await servicio.arbol_epica(100)
    assert repo.llamadas_arbol == 1


@pytest.mark.asyncio
async def test_estado_sin_configuracion_no_llama_a_azure():
    repo = ContadorRepositorio()
    servicio = servicio_con(repo, configurado=False)

    estado: EstadoIntegracion = await servicio.estado()

    assert estado.configurada is False
    assert estado.verificado is False
    assert repo.llamadas_listado == 0


@pytest.mark.asyncio
async def test_estado_verifica_cuando_hay_configuracion():
    servicio = servicio_con(FakeRepositorio())
    estado = await servicio.estado()
    assert estado.configurada is True
    assert estado.verificado is True


@pytest.mark.asyncio
async def test_estado_no_expone_detalles_de_excepcion():
    repo = FakeRepositorio()
    repo.sintoma = RuntimeError("pat-secreto y detalle interno")
    servicio = servicio_con(repo)

    estado = await servicio.estado()

    assert estado.verificado is False
    assert "pat-secreto" not in estado.error
    assert "RuntimeError" in estado.error


def _epica_cerrada() -> Epic:
    return Epic(
        azure_id=900,
        titulo="Épica cerrada",
        estado="Closed",
        url="https://dev.azure.com/s/_workitems/edit/900",
    )


@pytest.mark.asyncio
async def test_bugs_epica_calcula_metricas_y_filtra_cerrados():
    servicio = servicio_con(FakeRepositorio(arbol=epica_con_bugs()))

    detalle = await servicio.bugs_epica(100)

    assert detalle is not None
    assert [bug.azure_id for bug in detalle.bugs] == [300]
    assert detalle.metricas.total == 2
    assert detalle.metricas.abiertos == 1
    assert detalle.metricas.cerrados == 1
    assert detalle.metricas.por_relacion == {"hierarchy": 1, "related": 1}


@pytest.mark.asyncio
async def test_bugs_de_hu_dentro_de_feature_se_incluyen_en_métricas():
    servicio = servicio_con(FakeRepositorio(arbol=epica_con_bug_en_feature()))

    detalle = await servicio.bugs_epica(100)

    assert detalle is not None
    assert [bug.azure_id for bug in detalle.bugs] == [300]
    assert detalle.metricas.total == 1


@pytest.mark.asyncio
async def test_bugs_epica_incluye_cerrados_opcionalmente():
    servicio = servicio_con(FakeRepositorio(arbol=epica_con_bugs()))

    detalle = await servicio.bugs_epica(100, incluir_cerradas=True)

    assert detalle is not None
    assert [bug.azure_id for bug in detalle.bugs] == [300, 302]
    assert detalle.metricas.cerrados == 1


@pytest.mark.asyncio
async def test_listado_excluye_cerradas_por_defecto():
    repo = FakeRepositorio(epicas=[epica_canonica(), _epica_cerrada()])
    servicio = servicio_con(repo)

    epicas = await servicio.listar_epicas()
    assert [e.azure_id for e in epicas] == [100]


@pytest.mark.asyncio
async def test_listado_incluye_cerradas_configurable():
    repo = FakeRepositorio(epicas=[epica_canonica(), _epica_cerrada()])
    servicio = servicio_con(repo)

    epicas = await servicio.listar_epicas(incluir_cerradas=True)
    assert [e.azure_id for e in epicas] == [100, 900]


@pytest.mark.asyncio
async def test_filtro_no_pierde_la_cache_completa():
    repo = ContadorRepositorio()
    repo.epicas = [epica_canonica(), _epica_cerrada()]
    servicio = servicio_con(repo)

    solo_activas = await servicio.listar_epicas()
    con_cerradas = await servicio.listar_epicas(incluir_cerradas=True)

    assert [e.azure_id for e in solo_activas] == [100]
    assert [e.azure_id for e in con_cerradas] == [100, 900]
    assert repo.llamadas_listado == 1  # solo una lectura de Azure/backend


@pytest.mark.asyncio
async def test_estado_vacio_no_cuenta_como_cerrada():
    repo = FakeRepositorio(
        epicas=[Epic(azure_id=1, titulo="Sin estado", estado="", url="")]
    )
    servicio = servicio_con(repo)

    epicas = await servicio.listar_epicas()
    assert [e.azure_id for e in epicas] == [1]