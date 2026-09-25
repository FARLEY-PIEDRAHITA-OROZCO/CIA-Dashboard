"""Pruebas del adaptador de repositorio Azure y la caché en memoria."""

import pytest

from app.domain.models import Epic
from app.infrastructure.azure.repository import AzureBacklogRepositorio
from app.infrastructure.azure.transport import AzureError
from app.infrastructure.cache import CacheMemoria

from .conftest import SabanaTransporte, item_azure

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"
AREA = "Proyecto de ejemplo"


def fabricar_repo(wiql_ids, items):
    transporte = SabanaTransporte(wiql_ids, items)
    repo = AzureBacklogRepositorio(ORG, PROY, AREA, transporte)  # type: ignore[arg-type]
    return repo, transporte


def _backlog_completo():
    """Árbol: epica 100 -> features 101/102, HU directa 103; feature 101 -> task 300 (ignorada)."""
    return [
        item_azure(100, "Epic", titulo="Canal digital", estado="In Progress", hijos=[101, 102, 103]),
        item_azure(101, "Feature", titulo="Onboarding", estado="Committed", hijos=[201, 202, 300]),
        item_azure(102, "Feature", titulo="Pagos", estado="New", hijos=[203]),
        item_azure(201, "User Story", titulo="HU Registro", estado="New", hijos=[400]),
        item_azure(400, "Task", titulo="Tarea registro inicial", estado="New"),
        item_azure(202, "User Story", titulo="HU Login", estado="In Progress"),
        item_azure(203, "User Story", titulo="HU Pago", estado="Approved"),
        item_azure(103, "User Story", titulo="HU Directa", estado="New"),
        item_azure(300, "Task", titulo="Tarea sin jerarquía válida", estado="New"),
    ]


@pytest.mark.asyncio
async def test_resumen_incluye_url_y_proyecto_codificado():
    repo, _ = fabricar_repo([100], _backlog_completo())

    epicas = await repo.listar_epicas()

    assert epicas[0].url.endswith("/Proyecto%20de%20ejemplo/_workitems/edit/100")


@pytest.mark.asyncio
async def test_bfs_ignora_hijos_omitidos_por_azure():
    class TransporteParcial:
        async def post(self, url, body=None):
            return {"workItems": [{"id": 100}]}

        async def get(self, url, params=None):
            if "/workitems/100?" in url:
                return item_azure(100, "Epic", titulo="Épica", hijos=[999])
            return {"value": []}

        async def cerrar(self):
            return None

    repo = AzureBacklogRepositorio(ORG, PROY, AREA, TransporteParcial())  # type: ignore[arg-type]

    epica = await repo.obtener_epica(100)

    assert epica is not None
    assert epica.features == []
    assert epica.hus == []


@pytest.mark.asyncio
async def test_repositorio_no_mantiene_una_segunda_cache():
    repo, transporte = fabricar_repo([100], _backlog_completo())

    await repo.listar_epicas()
    await repo.listar_epicas()

    assert sum(1 for metodo, _ in transporte.llamadas if metodo == "post") == 2


@pytest.mark.asyncio
async def test_verificar_proyecto_usa_endpoint_de_organizacion():
    repo, transporte = fabricar_repo([], [])

    resultado = await repo.verificar_proyecto()

    assert resultado == {"proyecto": "Proyecto de ejemplo"}
    assert transporte.llamadas == [
        (
            "get",
            "https://dev.azure.com/organizacion-ejemplo/_apis/projects/"
            "Proyecto%20de%20ejemplo?api-version=7.1",
        )
    ]


@pytest.mark.asyncio
async def test_listar_epicas_sin_hijos():
    repo, transporte = fabricar_repo([100, 404], _backlog_completo())
    epicas = await repo.listar_epicas()
    assert [e.azure_id for e in epicas] == [100]
    épica = epicas[0]
    assert épica.titulo == "Canal digital"
    assert épica.estado == "In Progress"
    assert épica.features == []  # listado liviano (drill-down perezoso)


@pytest.mark.asyncio
async def test_arbol_completo_filtra_tipos_no_permitidos():
    repo, _ = fabricar_repo([100], _backlog_completo())
    árbol = await repo.obtener_epica(100)
    assert isinstance(árbol, Epic)
    assert [f.azure_id for f in árbol.features] == [101, 102]
    assert [u.azure_id for u in árbol.features[0].hus] == [201, 202]  # 300 Task excluida
    assert [u.azure_id for u in árbol.features[1].hus] == [203]
    assert [u.azure_id for u in árbol.hus] == [103]
    # 400 Task es hija de la HU 201 y sí se incluye en sus tareas.
    assert [t.azure_id for t in árbol.features[0].hus[0].tareas] == [400]
    assert "workitems/edit/400" in árbol.features[0].hus[0].tareas[0].url
    assert "workitems/edit/100" in árbol.url
    assert "workitems/edit/201" in árbol.features[0].hus[0].url
    assert "workitems/edit/103" in árbol.hus[0].url


@pytest.mark.asyncio
async def test_arbol_incluye_bugs_jerarquicos_y_relacionados():
    items = [
        item_azure(100, "Epic", titulo="Épica", hijos=[201]),
        item_azure(201, "User Story", titulo="HU", hijos=[300, 400], relacionados=[500]),
        item_azure(300, "Bug", titulo="Bug jerárquico", hijos=[301]),
        item_azure(301, "Task", titulo="Tarea del bug"),
        item_azure(400, "Task", titulo="Tarea directa", relacionados=[501]),
        item_azure(500, "Bug", titulo="Bug relacionado con HU"),
        item_azure(501, "Bug", titulo="Bug relacionado con tarea"),
    ]
    repo, _ = fabricar_repo([100], items)

    epica = await repo.obtener_epica(100, incluir_bugs=True)

    assert epica is not None
    hu = epica.hus[0]
    assert [bug.azure_id for bug in hu.bugs or []] == [300, 500]
    assert [tarea.azure_id for tarea in (hu.bugs or [])[0].tareas] == [301]
    assert [bug.azure_id for bug in hu.tareas[0].bugs or []] == [501]


@pytest.mark.asyncio
async def test_related_desde_bug_se_proyecta_a_la_tarea():
    items = [
        item_azure(100, "Epic", hijos=[201]),
        item_azure(201, "User Story", hijos=[400, 500]),
        item_azure(400, "Task", titulo="Tarea"),
        item_azure(500, "Bug", titulo="Bug relacionado", relacionados=[400]),
    ]
    repo, _ = fabricar_repo([100], items)

    epica = await repo.obtener_epica(100, incluir_bugs=True)

    assert epica is not None
    assert [bug.azure_id for bug in epica.hus[0].tareas[0].bugs or []] == [500]


@pytest.mark.asyncio
async def test_arbol_sin_bugs_conserva_contrato_anterior():
    items = [
        item_azure(100, "Epic", titulo="Épica", hijos=[201]),
        item_azure(201, "User Story", titulo="HU", hijos=[300, 400]),
        item_azure(300, "Bug", titulo="Bug jerárquico", hijos=[301]),
        item_azure(301, "Task", titulo="Tarea del bug"),
        item_azure(400, "Task", titulo="Tarea directa"),
    ]
    repo, _ = fabricar_repo([100], items)

    epica = await repo.obtener_epica(100)

    assert epica is not None
    hu = epica.hus[0]
    assert hu.bugs is None
    assert [tarea.azure_id for tarea in hu.tareas] == [400]


@pytest.mark.asyncio
async def test_arbol_expone_tags_de_historias_y_tareas():
    """Los tags alimentan el formulario de edición QA (ADR-11, Fase 5)."""
    items = [
        item_azure(100, "Epic", titulo="Épica", hijos=[201]),
        item_azure(201, "User Story", titulo="HU", tags="verificado-qa", hijos=[400]),
        item_azure(400, "Task", titulo="Tarea", tags="bloqueado,qa"),
    ]
    repo, _ = fabricar_repo([100], items)

    epica = await repo.obtener_epica(100, incluir_bugs=True)

    assert epica is not None
    hu = epica.hus[0]
    assert hu.tags == "verificado-qa"
    assert hu.tareas[0].tags == "bloqueado,qa"


@pytest.mark.asyncio
async def test_tags_vacios_en_todos_los_tipos():
    """Sin tags en Azure, el modelo expone cadena vacía (nunca `None`)."""
    repo, _ = fabricar_repo([100], _backlog_completo())

    epica = await repo.obtener_epica(100, incluir_bugs=True)

    assert epica is not None
    assert epica.tags == ""
    assert all(hu.tags == "" for f in epica.features for hu in f.hus)
    assert all(bug.tags == "" for f in epica.features for hu in f.hus for bug in (hu.bugs or []))


@pytest.mark.asyncio
async def test_pedir_tags_no_rompe_el_lote_de_listado():
    items = [item_azure(100, "Epic", titulo="Épica", tags="qa")]
    repo, transporte = fabricar_repo([100], items)

    await repo.listar_epicas()

    url = next(llamada[1] for llamada in transporte.llamadas if "/workitems?" in llamada[1])
    assert "System.Tags" in url


@pytest.mark.asyncio
async def test_arbol_carga_perezosa_no_descarga_huertas_de_otras_epicas():
    items = [
        item_azure(100, "Epic", hijos=[101]),
        item_azure(101, "Feature", hijos=[]),
    ]
    repo, transporte = fabricar_repo([100], items)
    await repo.obtener_epica(100)
    urls = [t[1] for t in transporte.llamadas if t[0] == "get"]
    # Solo se detalló la épica y su feature; sin WIQL adicional tras la inicial.
    assert all("/workitems" in u for u in urls)


@pytest.mark.asyncio
async def test_arbol_rechaza_work_item_no_epic():
    repo, _ = fabricar_repo([], [item_azure(500, "Feature")])
    with pytest.raises(AzureError):
        await repo.obtener_epica(500)


def test_cache_ttl_guarda_y_expira():
    cache = CacheMemoria()
    cache.guardar("k", {"a": 1}, ttl_seg=1)
    assert cache.obtener("k") == {"a": 1}
    cache.guardar("k2", {"b": 2}, ttl_seg=-5)
    assert cache.obtener("k2") is None
    cache.limpiar()
    assert cache.obtener("k") is None