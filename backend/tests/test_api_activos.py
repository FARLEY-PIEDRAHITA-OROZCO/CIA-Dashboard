"""Pruebas de la lista de activos de prueba editables (`/api/pruebas/activos`).

Lo que importa aquí no es el filtro, sino que `campos_editables` venga de la
tabla del dominio: es lo que impide que la UI ofrezca un campo que el tipo no
tiene, cosa que Azure aceptaría en silencio.
"""

import pytest
from fastapi.testclient import TestClient

from app.domain.models import ItemIndice, ItemPrueba, Persona
from app.main import crear_app

from .conftest import FakeRepositorio, contenedor_con

RAIZ = "Proyecto de ejemplo"


def caso(id_, estado="Design", requisitos=()) -> ItemPrueba:
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Case",
        titulo=f"Caso {id_}",
        estado=estado,
        sprint=f"{RAIZ}\\Sprint 45",
        persona=Persona(guid=f"p{id_}", nombre="Ana Diaz"),
        prioridad="2",
        tags="smoke",
        requisitos=list(requisitos),
    )


def suite(id_, estado="In Progress") -> ItemPrueba:
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Suite",
        titulo=f"Suite {id_}",
        estado=estado,
        sprint=f"{RAIZ}\\Sprint 45",
    )


def plan(id_) -> ItemPrueba:
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Plan",
        titulo=f"Plan {id_}",
        estado="Active",
        sprint=f"{RAIZ}\\Sprint 45",
        # GUID propio y distinto del de los casos: si coincidieran, el filtro por
        # persona no distinguiría «Ana Diaz» de «Luis Ruiz» y la prueba pasaría
        # por un motivo equivocado.
        persona=Persona(guid="plan-1", nombre="Luis Ruiz"),
    )


def cliente(activos, historias=None, lotes_con_error=0, lotes_totales=0):
    repo = FakeRepositorio(
        items_indice=historias or [ItemIndice(azure_id=1, tipo="User Story", titulo="HU")],
        activos_prueba=activos,
        lotes_prueba_con_error=lotes_con_error,
        lotes_prueba_totales=lotes_totales,
    )
    return TestClient(crear_app(contenedor_con(repo)))


def activo(cliente, azure_id):
    datos = cliente.get("/api/pruebas/activos").json()
    return next(i for i in datos["items"] if i["azure_id"] == azure_id)


# --------------------------------------------------------------------- #
# Los campos editables vienen de la tabla del dominio
# --------------------------------------------------------------------- #
def test_los_activos_declaran_sus_campos_editables():
    c = cliente([caso(1), suite(2), plan(3)])
    datos = c.get("/api/pruebas/activos").json()
    assert {i["tipo"]: i["campos_editables"] for i in datos["items"]} == {
        "Test Case": ["estado", "notas_qa", "prioridad", "tags"],
        "Test Suite": ["estado"],
        "Test Plan": ["estado"],
    }


def test_un_plan_no_ofrece_mas_que_estado():
    # Es la diferencia que separa esta fase de la anterior: antes la UI habría
    # ofrecido tags y notas a un tipo que no tiene ninguno de los dos.
    c = cliente([plan(3)])
    assert activo(c, 3)["campos_editables"] == ["estado"]


def test_un_caso_ofrece_prioridad_pero_no_severidad():
    c = cliente([caso(1)])
    campos = activo(c, 1)["campos_editables"]
    assert "prioridad" in campos
    assert "severidad" not in campos


# --------------------------------------------------------------------- #
# Filtros, orden y paginación
# --------------------------------------------------------------------- #
def test_filtra_por_tipo_y_estado():
    c = cliente([caso(1, "Design"), caso(2, "Ready"), suite(3, "In Progress")])
    assert c.get("/api/pruebas/activos?tipo=Test Case&estado=Ready").json()["resumen"]["total"] == 1
    assert c.get("/api/pruebas/activos?tipo=Test Suite").json()["resumen"]["total"] == 1


def test_filtra_por_persona_por_nombre_o_guid():
    c = cliente([plan(3), caso(1)])
    assert c.get("/api/pruebas/activos?persona=ana").json()["resumen"]["total"] == 1
    assert c.get("/api/pruebas/activos?persona=p1").json()["resumen"]["total"] == 1
    assert c.get("/api/pruebas/activos?persona=luis").json()["resumen"]["total"] == 1


def test_filtra_por_sprint_hoja_o_ruta():
    c = cliente([caso(1)])
    assert c.get("/api/pruebas/activos?sprint=Sprint 45").json()["resumen"]["total"] == 1
    assert (
        c.get(f"/api/pruebas/activos?sprint={RAIZ}%5CSprint%2045").json()["resumen"]["total"] == 1
    )


def test_pagina_sin_repetir_ni_saltar():
    activos = [caso(i) for i in range(1, 13)]
    c = cliente(activos)
    uno = c.get("/api/pruebas/activos?limite=5&offset=0").json()
    dos = c.get("/api/pruebas/activos?limite=5&offset=5").json()
    tres = c.get("/api/pruebas/activos?limite=5&offset=10").json()
    assert uno["resumen"]["total"] == 12
    assert tres["resumen"]["hay_mas"] is False
    ids = [i["azure_id"] for i in uno["items"] + dos["items"] + tres["items"]]
    assert ids == list(range(1, 13))


def test_limite_y_offset_se_validan():
    c = cliente([caso(1)])
    assert c.get("/api/pruebas/activos?limite=0").status_code == 422
    assert c.get("/api/pruebas/activos?limite=201").status_code == 422
    assert c.get("/api/pruebas/activos?offset=-1").status_code == 422


# --------------------------------------------------------------------- #
# Estados disponibles
# --------------------------------------------------------------------- #
def test_los_estados_son_los_que_el_tipo_usa_de_verdad():
    # Azure rechaza con 400 un estado que no existe en el tipo (comprobado con
    # `validateOnly`), así que ofrecer el catálogo completo de la plantilla sería
    # ofrecer transiciones que siempre fallan.
    c = cliente([caso(1, "Design"), caso(2, "Design"), caso(3, "Ready"), caso(4, "Closed")])
    estados = c.get("/api/pruebas/activos").json()["estados"]
    assert estados["Test Case"] == ["Design", "Ready", "Closed"]


def test_sin_activos_devuelve_listas_vacias():
    c = cliente([])
    datos = c.get("/api/pruebas/activos").json()
    assert datos["items"] == []
    assert datos["estados"] == {}
    assert datos["resumen"]["total"] == 0


def test_declara_la_cobertura_parcial():
    c = cliente([caso(1)], lotes_con_error=2, lotes_totales=18)
    assert c.get("/api/pruebas/activos").json()["resumen"]["parcial"] is True
