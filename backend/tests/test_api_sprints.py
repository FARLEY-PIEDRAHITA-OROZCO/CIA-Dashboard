"""Pruebas de la API de sprints, personas e índice (Fases 2-3).

Verifican el contrato HTTP y, sobre todo, la garantía de diseño: **filtrar no
genera peticiones a Azure**, porque el filtro ocurre en el índice local.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.application.indice import IndiceWorkItems
from app.domain.models import ItemIndice, Persona
from app.infrastructure.cache import CacheMemoria
from app.main import crear_app

from .conftest import FakeRepositorio, contenedor_con

AHORA = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
RAIZ = "Proyecto de ejemplo"


def item(
    id_: int,
    *,
    tipo: str = "Task",
    estado: str = "New",
    sprint: str = "",
    persona: tuple[str, str] | None = None,
    tags: str = "",
    dias: int = 0,
) -> ItemIndice:
    momento = AHORA - timedelta(days=dias)
    return ItemIndice(
        azure_id=id_,
        tipo=tipo,
        titulo=f"Ítem {id_}",
        estado=estado,
        tags=tags,
        sprint=sprint,
        persona=Persona(guid=persona[0], nombre=persona[1]) if persona else None,
        creado=momento - timedelta(days=5),
        modificado=momento,
    )


DATOS = [
    # Épica en la raíz de iteración: no debe aparecer como sprint.
    item(1, tipo="Epic", sprint=RAIZ),
    item(2, sprint=f"{RAIZ}\\Sprint 1", persona=("g-1", "Ana Pérez"), dias=10),
    item(3, sprint=f"{RAIZ}\\Sprint 1", persona=("g-2", "Luis Gómez"), estado="Closed", dias=10),
    item(4, tipo="Bug", sprint=f"{RAIZ}\\Sprint 2", persona=("g-1", "Ana Pérez"), dias=0),
    item(5, tipo="User Story", sprint=f"{RAIZ}\\Sprint 10", tags="verificado-qa", dias=20),
    item(6, sprint=f"{RAIZ}\\Sprint 10", persona=("g-1", "Ana Pérez"), estado="Done", dias=20),
]


class RepoContador(FakeRepositorio):
    def __init__(self, items) -> None:
        super().__init__()
        self._items = items
        self.llamadas = 0

    async def listar_work_items(self, tipos=None):
        self.llamadas += 1
        return list(self._items)


def cliente_con(items=None):
    repo = RepoContador(items if items is not None else DATOS)
    contenedor = contenedor_con(repo)
    contenedor.indice = IndiceWorkItems(repo, contenedor.cache, ttl_seg=120)
    return TestClient(crear_app(contenedor)), repo


# --------------------------------------------------------------------- #
# /api/sprints
# --------------------------------------------------------------------- #
def test_lista_sprints_con_conteos_y_actuales():
    cliente, _ = cliente_con()

    r = cliente.get("/api/sprints")

    assert r.status_code == 200
    cuerpo = r.json()
    nombres = [s["nombre"] for s in cuerpo["sprints"]]
    # La raíz no aparece y el orden es numérico, no lexicográfico.
    assert nombres == ["Sprint 1", "Sprint 2", "Sprint 10"]
    assert RAIZ not in nombres
    assert cuerpo["total"] == 3
    assert cuerpo["sprint_actual"] == "Sprint 2"


def test_sprint_reporta_abiertos_cerrados_y_personas():
    cliente, _ = cliente_con()

    por_nombre = {s["nombre"]: s for s in cliente.get("/api/sprints").json()["sprints"]}

    assert por_nombre["Sprint 1"]["total"] == 2
    assert por_nombre["Sprint 1"]["cerrados"] == 1
    assert por_nombre["Sprint 1"]["abiertos"] == 1
    assert por_nombre["Sprint 1"]["personas"] == 2


def test_sprints_vacio_devuelve_listas_no_error():
    cliente, _ = cliente_con([])

    cuerpo = cliente.get("/api/sprints").json()

    assert cuerpo["sprints"] == []
    assert cuerpo["total"] == 0
    assert cuerpo["sprint_actual"] == ""


# --------------------------------------------------------------------- #
# /api/personas
# --------------------------------------------------------------------- #
def test_lista_personas_con_carga_ordenada():
    cliente, _ = cliente_con()

    r = cliente.get("/api/personas")

    assert r.status_code == 200
    cuerpo = r.json()
    assert [p["nombre"] for p in cuerpo["personas"]] == ["Ana Pérez", "Luis Gómez"]
    ana = cuerpo["personas"][0]
    assert ana["guid"] == "g-1"
    assert ana["total"] == 3
    assert ana["bugs"] == 1


def test_personas_sin_configuracion_409():
    contenedor = contenedor_con(FakeRepositorio(), configurado=False)
    cliente = TestClient(crear_app(contenedor))

    assert cliente.get("/api/personas").status_code == 409


# --------------------------------------------------------------------- #
# /api/items
# --------------------------------------------------------------------- #
def test_items_sin_filtro_devuelve_todo_con_tope():
    cliente, _ = cliente_con()

    cuerpo = cliente.get("/api/items").json()

    assert cuerpo["total"] == 6
    assert len(cuerpo["items"]) == 6


def test_filtrar_items_por_sprint():
    cliente, _ = cliente_con()

    cuerpo = cliente.get(f"/api/items?sprint={RAIZ}\\Sprint 1").json()

    assert cuerpo["total"] == 2
    assert {i["azure_id"] for i in cuerpo["items"]} == {2, 3}


def test_filtrar_items_por_persona_por_guid_y_por_nombre():
    cliente, _ = cliente_con()

    por_guid = cliente.get("/api/items?persona=g-1").json()
    por_nombre = cliente.get("/api/items?persona=ana").json()

    assert por_guid["total"] == 3
    assert por_nombre["total"] == 3


def test_filtrar_items_por_tipo_tag_y_solo_abiertos():
    cliente, _ = cliente_con()

    assert cliente.get("/api/items?tipo=Bug").json()["total"] == 1
    assert cliente.get("/api/items?etiqueta=verificado-qa").json()["total"] == 1
    assert cliente.get("/api/items?solo_abiertos=true").json()["total"] == 4


def test_filtros_de_items_se_combinan():
    cliente, _ = cliente_con()

    cuerpo = cliente.get(f"/api/items?sprint={RAIZ}\\Sprint 1&persona=g-2").json()

    assert cuerpo["total"] == 1
    assert cuerpo["items"][0]["azure_id"] == 3


def test_items_incluye_persona_sprint_y_fechas():
    cliente, _ = cliente_con()

    item_ = cliente.get("/api/items?tipo=Bug").json()["items"][0]

    assert item_["persona"]["nombre"] == "Ana Pérez"
    assert item_["persona"]["guid"] == "g-1"
    assert item_["sprint"] == f"{RAIZ}\\Sprint 2"
    assert item_["modificado"]
    assert item_["cerrado"] is False


def test_items_se_ordenan_por_cambio_mas_reciente():
    cliente, _ = cliente_con()

    cuerpo = cliente.get(f"/api/items?sprint={RAIZ}\\Sprint 10").json()

    # Sprint 10 tiene Sprint 10 Done (d=0) y verificado-qa (d=0): empate, luego id.
    assert {i["azure_id"] for i in cuerpo["items"]} == {5, 6}


def test_items_limita_el_tope_de_resultados():
    muchos = [item(100 + i, sprint=f"{RAIZ}\\Sprint 1") for i in range(500)]
    cliente, _ = cliente_con(muchos)

    cuerpo = cliente.get("/api/items").json()

    assert cuerpo["total"] == 500
    assert len(cuerpo["items"]) == 200
    assert cuerpo["hay_mas"] is True


# --------------------------------------------------------------------- #
# Paginación
# --------------------------------------------------------------------- #
def test_la_paginacion_reparte_todos_los_items_sin_repetir_ni_saltar():
    """El tope de 200 no puede dejar ítems inalcanzables."""
    muchos = [item(100 + i, sprint=f"{RAIZ}\\Sprint 1") for i in range(500)]
    cliente, _ = cliente_con(muchos)

    vistos: list[int] = []
    for offset in range(0, 500, 200):
        cuerpo = cliente.get(f"/api/items?offset={offset}").json()
        assert cuerpo["offset"] == offset
        assert cuerpo["hay_mas"] is (offset + 200 < 500)
        vistos.extend(i["azure_id"] for i in cuerpo["items"])

    assert len(vistos) == 500
    assert len(set(vistos)) == 500


def test_la_ultima_pagina_no_pide_de_mas():
    cliente, _ = cliente_con()

    cuerpo = cliente.get(f"/api/items?sprint={RAIZ}\\Sprint 1&offset=4").json()

    assert cuerpo["items"] == []
    assert cuerpo["total"] == 2
    assert cuerpo["hay_mas"] is False


def test_el_limite_se_puede_reducir_pero_no_superar_el_tope():
    cliente, _ = cliente_con()

    assert len(cliente.get("/api/items?limite=1").json()["items"]) == 1
    # 5.000 es inválido: se recorta al tope en vez de volcar el proyecto.
    cuerpo = cliente.get("/api/items?limite=5000").json()
    assert cuerpo["limite"] == 200
    assert len(cuerpo["items"]) == 6


def test_offset_y_limite_negativos_se_corregen():
    """Un `?offset=-1` a mano no debe romper la consulta ni cortar en silencio."""
    cliente, _ = cliente_con()

    cuerpo = cliente.get("/api/items?offset=-1&limite=0").json()

    assert cuerpo["offset"] == 0
    assert cuerpo["limite"] == 1


def test_el_orden_es_estable_entre_paginas():
    """Sin orden determinista, `offset` repetiría o saltaría ítems."""
    cliente, _ = cliente_con()

    primera = cliente.get("/api/items?limite=3").json()["items"]
    segunda = cliente.get("/api/items?limite=3&offset=3").json()["items"]

    ids_primera = [i["azure_id"] for i in primera]
    ids_segunda = [i["azure_id"] for i in segunda]
    assert not set(ids_primera) & set(ids_segunda)
    # Repetir la misma consulta devuelve exactamente lo mismo.
    repetida = cliente.get("/api/items?limite=3").json()["items"]
    assert [i["azure_id"] for i in repetida] == ids_primera


# --------------------------------------------------------------------- #
# Tolerancia del filtro de sprint
# --------------------------------------------------------------------- #
def test_items_acepta_el_nombre_corto_del_sprint():
    """URL compartida o escrita a mano con el nombre, no con la ruta."""
    cliente, _ = cliente_con()

    por_nombre = cliente.get("/api/items?sprint=Sprint 2").json()
    por_ruta = cliente.get(f"/api/items?sprint={RAIZ}\\Sprint 2").json()

    assert por_nombre["total"] == por_ruta["total"] == 1
    assert por_nombre["items"][0]["azure_id"] == 4


# --------------------------------------------------------------------- #
# Garantía de diseño
# --------------------------------------------------------------------- #
def test_filtrar_no_llama_a_azure():
    """El índice se carga una vez; filtrar debe ser siempre local."""
    cliente, repo = cliente_con()

    cliente.get("/api/sprints")  # carga el índice
    llamadas = repo.llamadas

    cliente.get("/api/items")
    cliente.get("/api/items?sprint=Sprint 1")
    cliente.get("/api/personas")
    cliente.get("/api/sprints")

    assert repo.llamadas == llamadas == 1


def test_refresh_invalida_el_indice():
    cliente, repo = cliente_con()

    cliente.get("/api/sprints")
    assert repo.llamadas == 1

    cliente.post("/api/epics/refresh")
    cliente.get("/api/sprints")

    assert repo.llamadas == 2
