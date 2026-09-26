"""Pruebas de las señales diferenciales de analítica QA (Fase 4).

Estas señales son el motivo por el que el sistema aporta algo que Azure no
ofrece, así que se prueban con los cuatro casos que las hacen útiles.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.application.indice import IndiceWorkItems
from app.domain.models import ItemIndice, Persona

from .conftest import FakeRepositorio

AHORA = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)
RAIZ = "Proyecto de ejemplo"


def bug(
    id_: int, estado: str, tags: str = "", *, dias: int = 0
) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="Bug",
        titulo=f"Bug {id_}",
        estado=estado,
        tags=tags,
        sprint=f"{RAIZ}\\Sprint 1",
        persona=Persona(guid="g-1", nombre="Ana"),
        creado=AHORA - timedelta(days=90),
        modificado=AHORA - timedelta(days=dias),
    )


def historia(
    id_: int, estado: str, tags: str = "", *, dias: int = 0
) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="User Story",
        titulo=f"HU {id_}",
        estado=estado,
        tags=tags,
        sprint=f"{RAIZ}\\Sprint 1",
        creado=AHORA - timedelta(days=90),
        modificado=AHORA - timedelta(days=dias),
    )


def tarea(id_: int, estado: str = "New", *, dias: int = 0) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="Task",
        titulo=f"Tarea {id_}",
        estado=estado,
        sprint=f"{RAIZ}\\Sprint 1",
        creado=AHORA - timedelta(days=90),
        modificado=AHORA - timedelta(days=dias),
    )


def indice(items):
    from app.infrastructure.cache import CacheMemoria

    return IndiceWorkItems(
        FakeRepositorio(items_indice=items), CacheMemoria(), ttl_seg=120
    )


# --------------------------------------------------------------------- #
# Señal ① Brecha de verificación
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_brecha_detecta_bug_cerrado_sin_verificar():
    """El caso crítico: un bug corregido que nadie probó."""
    idx = indice([bug(1, "Closed"), bug(2, "Closed", "verificado-qa")])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["bugs"] == 2
    assert r["resumen"]["bugs_cerrados_sin_verificar"] == 1
    assert [i["azure_id"] for i in r["cerrados_sin_verificar"]] == [1]


@pytest.mark.asyncio
async def test_brecha_detecta_bug_verificado_sin_cerrar():
    """QA aprobó algo que desarrollo no cerró."""
    idx = indice([bug(1, "Active", "verificado-qa"), bug(2, "Active")])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["bugs_verificados_sin_cerrar"] == 1
    assert [i["azure_id"] for i in r["verificados_sin_cerrar"]] == [1]


@pytest.mark.asyncio
async def test_brecha_detecta_historia_terminada_sin_verificar():
    idx = indice([historia(1, "Done"), historia(2, "Done", "verificado-qa")])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["historias"] == 2
    assert r["resumen"]["historias_sin_evidencia"] == 1


@pytest.mark.asyncio
async def test_brecha_ignora_bugs_abiertos_sin_verificar():
    """Un bug abierto sin verificar es trabajo pendiente normal, no un riesgo."""
    idx = indice([bug(1, "Active"), bug(2, "New")])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["bugs_cerrados_sin_verificar"] == 0
    assert r["resumen"]["bugs_verificados_sin_cerrar"] == 0


@pytest.mark.asyncio
async def test_brecha_es_case_insensitive_en_el_tag():
    idx = indice([bug(1, "Closed", "Verificado-QA")])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["bugs_cerrados_sin_verificar"] == 0


@pytest.mark.asyncio
async def test_brecha_sin_bugs_devuelve_ceros():
    idx = indice([tarea(1)])

    r = await idx.brecha_de_verificacion()

    assert r["resumen"]["bugs"] == 0
    assert r["cerrados_sin_verificar"] == []


# --------------------------------------------------------------------- #
# Señal ② Trabajo estancado
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_aging_separa_inactivos_de_en_curso():
    idx = indice(
        [
            tarea(1, dias=2),  # reciente: no aparece
            tarea(2, dias=20),  # inactivo (>14)
            tarea(3, dias=60),  # en curso (>30)
        ]
    )

    r = await idx.trabajo_estancado(dias_inactivo=14, dias_en_curso=30)

    assert r["resumen"]["inactivos"] == 1
    assert r["resumen"]["en_curso"] == 1
    assert [i["azure_id"] for i in r["inactivos"]] == [2]
    assert [i["azure_id"] for i in r["en_curso"]] == [3]


@pytest.mark.asyncio
async def test_aging_ignora_los_cerrados():
    """Un ítem cerrado hace un año no está estancado: terminó."""
    idx = indice([tarea(1, "Closed", dias=200)])

    r = await idx.trabajo_estancado()

    assert r["resumen"]["inactivos"] == 0
    assert r["resumen"]["en_curso"] == 0


@pytest.mark.asyncio
async def test_aging_usa_created_cuando_no_hay_modified():
    idx = indice(
        [
            ItemIndice(
                azure_id=1,
                tipo="Task",
                estado="New",
                creado=AHORA - timedelta(days=60),
            )
        ]
    )

    r = await idx.trabajo_estancado()

    assert r["resumen"]["en_curso"] == 1


@pytest.mark.asyncio
async def test_aging_umbrales_configurables():
    idx = indice([tarea(1, dias=8)])

    estricto = await idx.trabajo_estancado(dias_inactivo=7, dias_en_curso=30)
    laxo = await idx.trabajo_estancado(dias_inactivo=30, dias_en_curso=60)

    assert estricto["resumen"]["inactivos"] == 1
    assert laxo["resumen"]["inactivos"] == 0


# --------------------------------------------------------------------- #
# Señal ③ Rezago entre sprints
# --------------------------------------------------------------------- #
def con_sprint(id_: int, sprint: str, estado: str = "New") -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="Task",
        titulo=f"Tarea {id_}",
        estado=estado,
        sprint=sprint,
        creado=AHORA - timedelta(days=100),
        modificado=AHORA - timedelta(days=1),
    )


@pytest.mark.asyncio
async def test_rezago_detecta_deuda_de_sprints_anteriores():
    idx = indice(
        [
            con_sprint(1, f"{RAIZ}\\Sprint 1", "New"),
            con_sprint(2, f"{RAIZ}\\Sprint 1", "New"),
            con_sprint(3, f"{RAIZ}\\Sprint 1", "Closed"),
            con_sprint(4, f"{RAIZ}\\Sprint 2", "New"),
        ]
    )

    r = await idx.rezago_entre_sprints()

    filas = {f["sprint"]: f["abiertos"] for f in r["sprints"]}
    assert filas == {"Sprint 1": 2}
    assert r["resumen"]["sprint_referencia"] == "Sprint 2"
    assert r["resumen"]["rezagados"] == 2


@pytest.mark.asyncio
async def test_rezago_ordena_por_cantidad_de_deuda():
    idx = indice(
        [
            con_sprint(1, f"{RAIZ}\\Sprint 1"),
            con_sprint(2, f"{RAIZ}\\Sprint 2"),
            con_sprint(3, f"{RAIZ}\\Sprint 2"),
            con_sprint(4, f"{RAIZ}\\Sprint 3"),
        ]
    )

    r = await idx.rezago_entre_sprints()

    assert [f["sprint"] for f in r["sprints"]] == ["Sprint 2", "Sprint 1"]


@pytest.mark.asyncio
async def test_rezago_sin_sprints_no_falla():
    idx = indice([])

    r = await idx.rezago_entre_sprints()

    assert r["sprints"] == []
    assert r["resumen"]["sprints"] == 0
