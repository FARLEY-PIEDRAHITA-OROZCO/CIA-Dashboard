"""Pruebas del índice local de work items (Fase 1).

El índice es la pieza que hace posible filtrar sin llamar a Azure, así que se
verifican tanto los resultados como la garantía de que filtrar **no** genera
peticiones.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.application.indice import IndiceWorkItems
from app.domain.models import ItemIndice, Persona
from app.infrastructure.cache import CacheMemoria

from .conftest import FakeRepositorio

AHORA = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


class _RepoFalso(FakeRepositorio):
    """Alias del doble compartido, que ya cuenta las llamadas al índice."""

    @property
    def llamadas(self) -> int:
        return self.llamadas_indice


def item(
    id_: int,
    *,
    tipo: str = "Task",
    titulo: str = "",
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
        titulo=titulo or f"Ítem {id_}",
        estado=estado,
        tags=tags,
        sprint=sprint,
        persona=Persona(guid=persona[0], nombre=persona[1]) if persona else None,
        creado=momento - timedelta(days=10),
        modificado=momento,
    )


def indice(items, ttl: float = 120.0):
    repo = _RepoFalso(items_indice=items)
    cache = CacheMemoria()
    return IndiceWorkItems(repo, cache, ttl_seg=ttl), repo, cache


# --------------------------------------------------------------------- #
# Carga y caché
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_carga_los_items_del_repositorio():
    idx, repo, _ = indice([item(1), item(2)])

    assert len(await idx.todos()) == 2
    assert repo.llamadas == 1


@pytest.mark.asyncio
async def test_reutiliza_la_cache_sin_volver_a_azure():
    idx, repo, _ = indice([item(1)])

    await idx.todos()
    await idx.filtrar(tipo="Task")
    await idx.sprints()
    await idx.personas()

    assert repo.llamadas == 1


@pytest.mark.asyncio
async def test_invalidar_forza_la_recarga():
    idx, repo, _ = indice([item(1)])

    await idx.todos()
    idx.invalidar()
    await idx.todos()

    assert repo.llamadas == 2


@pytest.mark.asyncio
async def test_filtrar_no_llama_a_azure():
    """El objetivo de diseño: filtrar es local, no una consulta remota."""
    idx, repo, _ = indice([item(1, sprint="x"), item(2, sprint="y")])

    await idx.todos()  # primera carga
    llamadas = repo.llamadas
    await idx.filtrar(sprint="x")
    await idx.filtrar(persona="nadie")
    await idx.sprints()
    await idx.personas()

    assert repo.llamadas == llamadas


@pytest.mark.asyncio
async def test_indice_vacio_no_falla():
    idx, _, _ = indice([])

    assert await idx.todos() == []
    assert await idx.sprints() == []
    assert await idx.personas() == []
    assert await idx.sprint_actual() is None


# --------------------------------------------------------------------- #
# Filtros
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_filtra_por_sprint():
    idx, _, _ = indice(
        [item(1, sprint="P\\Sprint 1"), item(2, sprint="P\\Sprint 2")]
    )

    assert [i.azure_id for i in await idx.filtrar(sprint="P\\Sprint 1")] == [1]


@pytest.mark.asyncio
async def test_filtra_por_persona_por_guid_o_por_nombre():
    idx, _, _ = indice(
        [
            item(1, persona=("g-1", "Ana Pérez")),
            item(2, persona=("g-2", "Luis Gómez")),
        ]
    )

    assert [i.azure_id for i in await idx.filtrar(persona="g-1")] == [1]
    assert [i.azure_id for i in await idx.filtrar(persona="ana pérez")] == [1]
    assert [i.azure_id for i in await idx.filtrar(persona="LUIS")] == [2]


@pytest.mark.asyncio
async def test_filtra_por_tipo_y_por_tag():
    idx, _, _ = indice(
        [
            item(1, tipo="Task", tags="verificado-qa;qa"),
            item(2, tipo="Bug", tags="bloqueado"),
        ]
    )

    assert [i.azure_id for i in await idx.filtrar(tipo="Bug")] == [2]
    # Acepta ';' (Azure) y ',' (el formulario QA).
    assert [i.azure_id for i in await idx.filtrar(etiqueta="verificado-qa")] == [1]
    assert len(await idx.filtrar(etiqueta="qa")) == 1


@pytest.mark.asyncio
async def test_filtros_se_combinan_con_and():
    idx, _, _ = indice(
        [
            item(1, sprint="S1", tipo="Task", persona=("g-1", "Ana")),
            item(2, sprint="S1", tipo="Bug", persona=("g-1", "Ana")),
        ]
    )

    resultado = await idx.filtrar(sprint="S1", persona="g-1", tipo="Task")

    assert [i.azure_id for i in resultado] == [1]


@pytest.mark.asyncio
async def test_solo_abiertos_excluye_los_cerrados():
    idx, _, _ = indice(
        [
            item(1, estado="New"),
            item(2, estado="Closed"),
            item(3, estado="Done"),
            item(4, estado="Resolved"),
        ]
    )

    assert [i.azure_id for i in await idx.filtrar(solo_abiertos=True)] == [1]


# --------------------------------------------------------------------- #
# Sprints
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_catalogo_excluye_la_raiz_de_iteracion():
    """Épicas y features apuntan a la raíz, que no es un sprint real."""
    idx, _, _ = indice(
        [
            item(1, tipo="Epic", sprint="Proyecto de ejemplo"),
            item(2, sprint="Proyecto de ejemplo\\Sprint 1"),
        ]
    )

    nombres = [s["nombre"] for s in await idx.sprints()]

    assert nombres == ["Sprint 1"]


@pytest.mark.asyncio
async def test_sprints_se_ordenan_numericamente():
    idx, _, _ = indice(
        [
            item(1, sprint="P\\Sprint 10"),
            item(2, sprint="P\\Sprint 2"),
            item(3, sprint="P\\Sprint 1"),
        ]
    )

    nombres = [s["nombre"] for s in await idx.sprints()]

    assert nombres == ["Sprint 1", "Sprint 2", "Sprint 10"]


@pytest.mark.asyncio
async def test_la_raiz_no_se_confunde_con_un_sprint_corto():
    """`Sprint 1` es más corta que `Sprint 10` pero no es la raíz.

    La raíz se detecta por ser prefijo de otras rutas, nunca por longitud: si
    se usara "la más corta", `Sprint 1` se descartaría como si fuera la raíz.
    """
    idx, _, _ = indice(
        [
            item(1, sprint="Proyecto de ejemplo\\Sprint 1"),
            item(2, sprint="Proyecto de ejemplo\\Sprint 10"),
            item(3, sprint="Proyecto de ejemplo"),
        ]
    )

    nombres = [s["nombre"] for s in await idx.sprints()]

    assert "Proyecto de ejemplo" not in nombres
    assert nombres == ["Sprint 1", "Sprint 10"]


@pytest.mark.asyncio
async def test_sin_jerarquia_no_se_excluye_nada():
    """Si ninguna ruta es prefijo de otra, no hay raíz que quitar."""
    idx, _, _ = indice([item(1, sprint="Sprint 1"), item(2, sprint="Sprint 2")])

    assert [s["nombre"] for s in await idx.sprints()] == ["Sprint 1", "Sprint 2"]


@pytest.mark.asyncio
async def test_sprint_con_nombre_legado_se_ordena_por_su_numero():
    idx, _, _ = indice(
        [item(1, sprint="P\\Sprint_001-HUB"), item(2, sprint="P\\Sprint 5")]
    )

    nombres = [s["nombre"] for s in await idx.sprints()]

    assert nombres == ["Sprint_001-HUB", "Sprint 5"]


@pytest.mark.asyncio
async def test_conteos_por_sprint():
    idx, _, _ = indice(
        [
            item(1, sprint="P\\Sprint 1", estado="New"),
            item(2, sprint="P\\Sprint 1", estado="Closed"),
            item(3, sprint="P\\Sprint 1", estado="Done", persona=("g-1", "Ana")),
        ]
    )

    sprint = (await idx.sprints())[0]

    assert sprint["total"] == 3
    assert sprint["cerrados"] == 2
    assert sprint["abiertos"] == 1
    assert sprint["personas"] == 1


@pytest.mark.asyncio
async def test_sprint_actual_es_el_de_cambio_mas_reciente():
    idx, _, _ = indice(
        [
            item(1, sprint="P\\Sprint 1", dias=30),
            item(2, sprint="P\\Sprint 9", dias=1),
            item(3, sprint="P\\Sprint 5", dias=10),
        ]
    )

    assert await idx.sprint_actual() == "Sprint 9"


@pytest.mark.asyncio
async def test_sprint_actual_cae_al_ultimo_sin_fechas():
    idx, _, _ = indice(
        [
            ItemIndice(azure_id=1, tipo="Task", sprint="P\\Sprint 1"),
            ItemIndice(azure_id=2, tipo="Task", sprint="P\\Sprint 7"),
        ]
    )

    assert await idx.sprint_actual() == "Sprint 7"


# --------------------------------------------------------------------- #
# Personas
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_personas_con_carga_ordenadas_por_volumen():
    idx, _, _ = indice(
        [
            item(1, persona=("g-1", "Ana")),
            item(2, persona=("g-1", "Ana")),
            item(3, persona=("g-2", "Luis")),
            item(4),
        ]
    )

    personas = await idx.personas()

    assert [p["nombre"] for p in personas] == ["Ana", "Luis"]
    assert personas[0]["total"] == 2
    assert personas[0]["guid"] == "g-1"


@pytest.mark.asyncio
async def test_carga_por_persona_entrega_bugs_y_verificados():
    idx, _, _ = indice(
        [
            item(1, tipo="Bug", persona=("g-1", "Ana"), estado="Active"),
            item(2, tipo="Bug", persona=("g-1", "Ana"), estado="Closed"),
            item(3, tipo="Task", persona=("g-1", "Ana"), tags="verificado-qa"),
        ]
    )

    persona = (await idx.personas())[0]

    assert persona["bugs"] == 2
    assert persona["bugs_abiertos"] == 1
    assert persona["verificados"] == 1
    assert persona["abiertos"] == 2


@pytest.mark.asyncio
async def test_busca_persona_por_guid():
    idx, _, _ = indice([item(1, persona=("g-1", "Ana"))])

    assert await idx.persona_por_guid("g-1") is not None
    assert await idx.persona_por_guid("no-existe") is None
