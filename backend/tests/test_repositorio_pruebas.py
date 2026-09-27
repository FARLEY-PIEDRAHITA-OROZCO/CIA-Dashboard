"""Pruebas del lector de activos de prueba en el repositorio Azure.

Dos cosas se verifican aquí que no se pueden ver en ninguna otra capa:

1. Que la carga **pide relaciones** (es lo único que hace posible la cobertura) y
   **no pide** los pasos de prueba (que son la causa de los HTTP 500).
2. Que un lote ilegible no tumba la carga ni se pierde en silencio: se cuenta y se
   declara. Es la diferencia entre una cobertura parcial y una cobertura falsa.
"""

import pytest

from app.infrastructure.azure import queries
from app.infrastructure.azure.repository import AzureBacklogRepositorio
from app.infrastructure.azure.transport import AzureError

from .conftest import SabanaTransporte, item_azure

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"
AREA = "Proyecto de ejemplo"

BASE_REL = "https://dev.azure.com/o/p/_apis/wit/workItems/"


def activo(id_, **campos):
    base = {
        queries.CAMPO_ID: id_,
        queries.CAMPO_TIPO: "Test Case",
        queries.CAMPO_TITULO: f"Caso {id_}",
        queries.CAMPO_ESTADO: "Design",
        queries.CAMPO_PRIORIDAD: 2,
        queries.CAMPO_AUTOMATIZACION: "Not Automated",
        queries.CAMPO_ITERACION: f"{PROY}\\Sprint 1",
        queries.CAMPO_TAGS: "smoke",
        queries.CAMPO_CREADO: "2026-01-01T00:00:00Z",
        queries.CAMPO_MODIFICADO: "2026-02-01T00:00:00Z",
    }
    base.update(campos)
    return {"id": id_, "fields": base}


def fabricar(items, *, lotes_fallidos=frozenset()):
    ids = [i["id"] for i in items]
    transporte = SabanaTransporte(ids, items)
    if lotes_fallidos:
        transporte = _ConFallos(transporte, lotes_fallidos)
    repo = AzureBacklogRepositorio(ORG, PROY, AREA, transporte)  # type: ignore[arg-type]
    return repo, transporte


class _ConFallos:
    """Transporte que hace fallar los lotes cuyo primer id está en el conjunto."""

    def __init__(self, interior, fallidos):
        self.interior = interior
        self.fallidos = set(fallidos)
        self.intentos: list[str] = []

    async def post(self, url, body=None):
        return await self.interior.post(url, body)

    async def get(self, url, params=None):
        self.intentos.append(url)
        if "/workitems?" in url:
            primero = int(url.split("ids=")[1].split(",")[0])
            if primero in self.fallidos:
                raise AzureError("Lote simulado ilegible", status_code=500)
        return await self.interior.get(url, params)

    async def patch(self, url, body=None, *, content_type="application/json-patch+json"):
        raise AssertionError("el lector de pruebas no escribe")

    async def cerrar(self):
        return None


# --------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_lee_activos_con_sus_requisitos():
    items = [
        activo(1, **{queries.CAMPO_TIPO: "Test Plan", queries.CAMPO_TITULO: "Plan"}),
        activo(2, **{queries.CAMPO_TIPO: "Test Suite", queries.CAMPO_ESTADO: "In Progress"}),
        activo(
            3,
            **{queries.CAMPO_ESTADO: "Closed"},
        ),
    ]
    items[2]["relations"] = [
        {"rel": queries.RELACION_TESTED_BY, "url": f"{BASE_REL}900"},
        {"rel": queries.RELACION_TESTED_BY, "url": f"{BASE_REL}901"},
    ]
    repo, _ = fabricar(items)
    carga = await repo.listar_activos_prueba(("Test Plan", "Test Suite", "Test Case"))

    assert carga.parcial is False
    assert len(carga.items) == 3
    by_id = {i.azure_id: i for i in carga.items}
    assert by_id[1].tipo == "Test Plan"
    assert by_id[2].estado == "In Progress"
    assert by_id[3].requisitos == [900, 901]
    assert by_id[3].prioridad == "2"
    assert by_id[3].automatizacion == "Not Automated"
    assert by_id[3].sprint == f"{PROY}\\Sprint 1"


@pytest.mark.asyncio
async def test_pide_relaciones_y_no_pide_los_pasos():
    """Las dos reglas que hacen viable (o inviable) la lectura de 3.431 casos."""
    repo, transporte = fabricar([activo(1)])
    await repo.listar_activos_prueba(("Test Case",))
    url = next(u for m, u in transporte.llamadas if m == "get" and "/workitems?" in u)
    assert "$expand=relations" in url
    assert queries.CAMPO_TIENE_PASOS not in url
    assert queries.CAMPO_DESCRIPCION not in url


@pytest.mark.asyncio
async def test_sin_activos_devuelve_carga_vacia_y_no_error():
    repo, _ = fabricar([])
    carga = await repo.listar_activos_prueba(("Test Case",))
    assert carga.items == []
    assert carga.parcial is False


# --------------------------------------------------------------------- #
# El lote que falla
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_un_lote_ilegible_no_tumba_la_carga_ni_se_pierde():
    """El caso clave: se conserva lo legible y se declara lo que falta.

    Si el error se tragara en silencio, los casos del lote perdido sumarían
    historias a «sin caso» y la métrica culparía al equipo sin motivo.
    """
    items = [activo(i) for i in range(1, 201)]
    repo, _ = fabricar(items, lotes_fallidos={1})
    carga = await repo.listar_activos_prueba(("Test Case",))

    assert carga.parcial is True
    assert carga.lotes_con_error == 1
    assert carga.lotes_totales == 1
    assert len(carga.items) == 0, "el único lote era el que fallaba"


@pytest.mark.asyncio
async def test_lotes_mixtos_conservan_lo_legible():
    """200 ids son un lote; con 400 hay dos y solo uno puede caer."""
    items = [activo(i) for i in range(1, 401)]
    repo, _ = fabricar(items, lotes_fallidos={1})
    carga = await repo.listar_activos_prueba(("Test Case",))

    assert carga.lotes_totales == 2
    assert carga.lotes_con_error == 1
    assert carga.parcial is True
    assert [i.azure_id for i in carga.items] == list(range(201, 401))


@pytest.mark.asyncio
async def test_el_lector_de_pruebas_nunca_escribe():
    """Es un puerto de solo lectura: un PATCH aquí sería un agujero."""
    repo, transporte = fabricar([activo(1)])
    await repo.listar_activos_prueba(("Test Case",))
    assert all(m in ("get", "post") for m, _ in transporte.llamadas)


@pytest.mark.asyncio
async def test_el_orden_del_indice_viene_de_la_consulta():
    """El determinismo no lo inventa el repositorio: lo pide WIQL.

    Se comprueban las dos mitades porque una sola no demuestra nada. Si WIQL no
    pidiera `ORDER BY`, el índice sería irreproducible entre cargas; y si el
    repositorio reordenara por su cuenta, dejaría de respetar el orden de Azure
    y la comparación con el resto de índices sería falsa.
    """
    # El transporte devuelve los ids en el orden en que se los pasamos, así que
    # se le pasa una lista desordenada a propósito: el repositorio la sigue.
    transporte = _RegistraConsultas([3, 1, 2], [activo(3), activo(1), activo(2)])
    repo = AzureBacklogRepositorio(ORG, PROY, AREA, transporte)  # type: ignore[arg-type]
    carga = await repo.listar_activos_prueba(("Test Case",))

    assert [i.azure_id for i in carga.items] == [3, 1, 2]
    assert f"ORDER BY [{queries.CAMPO_ID}]" in transporte.consulta_wiql


class _RegistraConsultas(SabanaTransporte):
    """Guarda el cuerpo del POST a WIQL para poder inspeccionar la consulta."""

    def __init__(self, wiql_ids, items):
        super().__init__(wiql_ids, items)
        self.consulta_wiql = ""

    async def post(self, url, body=None):
        if body and "query" in body:
            self.consulta_wiql = str(body["query"])
        return await super().post(url, body)


def test_una_relacion_rara_no_rompe_el_mapeo():
    """Mapear no debe ser el punto de fallo: lo inesperado se ignora."""
    item = activo(1)
    item["relations"] = [
        {"rel": "Desconocida", "url": None},
        {"rel": queries.RELACION_TESTED_BY, "url": "no-es-un-id"},
        {"rel": queries.RELACION_TESTED_BY, "url": f"{BASE_REL}5"},
        "basura",
    ]
    repo, _ = fabricar([item])
    assert repo._a_item_prueba(item).requisitos == [5]
