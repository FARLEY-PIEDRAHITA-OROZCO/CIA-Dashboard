"""Pruebas de los campos de sprint, persona y fechas (Fase 0).

Verifican el mapeo de `System.IterationPath`, `System.AssignedTo`,
`System.CreatedDate` y `System.ChangedDate`, y las utilidades de normalización
de sprint que alimentan las vistas de la Fase 3.
"""

from datetime import datetime, timezone

import pytest

from app.infrastructure.azure import queries
from app.infrastructure.azure.repository import AzureBacklogRepositorio

from .conftest import SabanaTransporte, item_azure

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"
RUTA_SPRINT = "Proyecto de ejemplo\\Sprint 35"


def fabricar_repo(items):
    transporte = SabanaTransporte([100], items)
    return AzureBacklogRepositorio(ORG, PROY, "Proyecto de ejemplo", transporte), transporte


# --------------------------------------------------------------------- #
# Utilidades de sprint
# --------------------------------------------------------------------- #
def test_nombre_sprint_toma_la_hoja_de_la_ruta():
    assert queries.nombre_sprint(RUTA_SPRINT) == "Sprint 35"


def test_nombre_sprint_tolera_ruta_simple_o_vacia():
    assert queries.nombre_sprint("Sprint 7") == "Sprint 7"
    assert queries.nombre_sprint("") == ""
    assert queries.nombre_sprint("   ") == ""


def test_orden_de_sprints_es_numerico_y_no_alfabetico():
    nombres = ["Sprint 10", "Sprint 2", "Sprint 1"]
    assert sorted(nombres, key=queries.clave_orden_sprint) == [
        "Sprint 1",
        "Sprint 2",
        "Sprint 10",
    ]


def test_orden_de_sprints_legado_usa_su_numero():
    """`Sprint_001-HUB` se ordena como el sprint 1, no alfabéticamente."""
    nombres = ["Sprint_001-HUB", "Sprint 45", "Sprint 2"]
    assert sorted(nombres, key=queries.clave_orden_sprint) == [
        "Sprint_001-HUB",
        "Sprint 2",
        "Sprint 45",
    ]


def test_orden_ignora_sprint_vacio():
    assert queries.clave_orden_sprint("") == (2, 0, "")


def test_sprint_sin_numero_va_al_final_ordenado_alfabeticamente():
    """Un humano quiere ver primero los sprints numerados, luego los libres."""
    nombres = ["Retro", "Sprint 45", "Mantenimiento", "Sprint 2"]
    assert sorted(nombres, key=queries.clave_orden_sprint) == [
        "Sprint 2",
        "Sprint 45",
        "Mantenimiento",
        "Retro",
    ]


# --------------------------------------------------------------------- #
# Identidad
# --------------------------------------------------------------------- #
def test_identidad_extrae_guid_nombre_y_url():
    item = {
        "fields": {
            "System.AssignedTo": {
                "id": "abc-123",
                "displayName": "Ana Pérez",
                "url": "https://vssps.dev.azure.com/x/abc-123",
            }
        }
    }
    persona = queries.identidad(item, queries.CAMPO_ASIGNADO)
    assert persona is not None
    assert persona["guid"] == "abc-123"
    assert persona["nombre"] == "Ana Pérez"
    assert "abc-123" in persona["url"]


def test_identidad_devuelve_none_si_no_hay_responsable():
    assert queries.identidad({"fields": {}}, queries.CAMPO_ASIGNADO) is None
    assert queries.identidad({"fields": {queries.CAMPO_ASIGNADO: None}}, queries.CAMPO_ASIGNADO) is None
    # Un valor de texto no es una IdentityRef.
    assert queries.identidad({"fields": {queries.CAMPO_ASIGNADO: "texto"}}, queries.CAMPO_ASIGNADO) is None


# --------------------------------------------------------------------- #
# Fechas
# --------------------------------------------------------------------- #
def test_fecha_acepta_el_formato_utc_de_azure():
    item = {"fields": {queries.CAMPO_CREADO: "2026-09-20T15:30:00Z"}}
    valor = queries.fecha(item, queries.CAMPO_CREADO)
    assert valor == datetime(2026, 9, 20, 15, 30, tzinfo=timezone.utc)


def test_fecha_devuelve_none_ante_valores_ausentes_o_malformados():
    assert queries.fecha({}, queries.CAMPO_CREADO) is None
    assert queries.fecha({"fields": {}}, queries.CAMPO_CREADO) is None
    assert queries.fecha({"fields": {queries.CAMPO_CREADO: ""}}, queries.CAMPO_CREADO) is None
    # Una fecha corrupta no debe tumbar la carga de un árbol entero.
    assert queries.fecha({"fields": {queries.CAMPO_CREADO: "no-es-fecha"}}, queries.CAMPO_CREADO) is None


# --------------------------------------------------------------------- #
# Mapeo en el repositorio
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_arbol_mapea_sprint_persona_y_fechas():
    items = [
        item_azure(
            100,
            "Epic",
            titulo="Épica",
            sprint=RUTA_SPRINT,
            asignado=("guid-1", "Ana Pérez"),
            hijos=[201],
        ),
        item_azure(
            201,
            "User Story",
            titulo="HU",
            sprint=RUTA_SPRINT,
            asignado=("guid-2", "Luis Gómez"),
        ),
    ]
    repo, _ = fabricar_repo(items)

    epica = await repo.obtener_epica(100, incluir_bugs=True)

    assert epica is not None
    assert epica.sprint == RUTA_SPRINT
    assert epica.asignado_a is not None
    assert epica.asignado_a.guid == "guid-1"
    assert epica.asignado_a.nombre == "Ana Pérez"

    hu = epica.hus[0]
    assert hu.sprint == RUTA_SPRINT
    assert hu.asignado_a is not None
    assert hu.asignado_a.guid == "guid-2"
    assert hu.creado is not None
    assert hu.modificado is not None
    assert hu.modificado.year == 2026


@pytest.mark.asyncio
async def test_work_item_sin_responsable_deja_asignado_a_none():
    repo, _ = fabricar_repo([item_azure(100, "Epic", titulo="Épica")])

    epica = await repo.obtener_epica(100)

    assert epica is not None
    assert epica.asignado_a is None
    assert epica.sprint == ""


@pytest.mark.asyncio
async def test_resumen_de_epicas_tambien_incluye_sprint_y_persona():
    repo, transporte = fabricar_repo(
        [item_azure(100, "Epic", titulo="Épica", sprint=RUTA_SPRINT, asignado=("g1", "Ana"))]
    )

    epicas = await repo.listar_epicas()

    assert epicas[0].sprint == RUTA_SPRINT
    assert epicas[0].asignado_a is not None
    assert epicas[0].asignado_a.nombre == "Ana"


def test_campos_de_sprint_y_fechas_se_piden_a_azure():
    """Sin ellos en `$fields`, el índice local no podría construirse."""
    campos = queries.CAMPOS_LISTADO
    assert queries.CAMPO_ITERACION in campos
    assert queries.CAMPO_CREADO in campos
    assert queries.CAMPO_MODIFICADO in campos
