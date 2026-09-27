"""Pruebas HTTP de los endpoints de gestión de pruebas.

Lo que se vigila aquí sobre todo es el contrato: que los endpoints sean de
**solo lectura**, que declaren la cobertura parcial, y que la paginación de
`/sin-cubrir` no devuelva nunca una página completa y falsa.
"""

import pytest
from fastapi.testclient import TestClient

from app.domain.models import ItemIndice, ItemPrueba, Persona
from app.main import crear_app

from .conftest import FakeRepositorio, contenedor_con

RAIZ = "Proyecto de ejemplo"


def historia(id_, sprint=f"{RAIZ}\\Sprint 1", persona="Ana Diaz"):
    return ItemIndice(
        azure_id=id_,
        tipo="User Story",
        titulo=f"Historia {id_}",
        estado="Active",
        sprint=sprint,
        persona=Persona(guid=f"g{id_}", nombre=persona),
    )


def caso(id_, requisitos=()):
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Case",
        titulo=f"Caso {id_}",
        estado="Design",
        sprint=f"{RAIZ}\\Sprint 1",
        automatizacion="Not Automated",
        requisitos=list(requisitos),
    )


def cliente(
    historias,
    activos,
    *,
    lotes_con_error=0,
    configurado=True,
    escritura=None,
):
    repo = FakeRepositorio(
        items_indice=historias,
        activos_prueba=activos,
        lotes_prueba_con_error=lotes_con_error,
        lotes_prueba_totales=18,
    )
    return TestClient(crear_app(contenedor_con(repo, configurado, escritura=escritura)))


@pytest.fixture
def cliente_basico():
    return cliente(
        [historia(1), historia(2), historia(3)],
        [caso(100, requisitos=(1, 2)), caso(101, requisitos=(2,))],
    )


# --------------------------------------------------------------------- #
# Los cuatro endpoints
# --------------------------------------------------------------------- #
def test_resumen_inventario_y_brecha(cliente_basico):
    r = cliente_basico.get("/api/pruebas/resumen")
    assert r.status_code == 200
    datos = r.json()
    assert datos["inventario"] == {
        "planes": 0,
        "suites": 0,
        "casos": 2,
        "total": 2,
    }
    assert datos["brecha"]["historias"] == 3
    assert datos["brecha"]["cubiertas"] == 2
    assert datos["brecha"]["sin_cubrir"] == 1
    assert datos["automatizacion"]["automatizados"] == 0
    assert datos["parcial"] is False


def test_cobertura_agrupa_por_sprint(cliente_basico):
    r = cliente_basico.get("/api/pruebas/cobertura")
    assert r.status_code == 200
    datos = r.json()
    assert datos["resumen"]["historias"] == 3
    # El resumen de `/cobertura` y la brecha de `/resumen` son el mismo tipo:
    # si divergieran, el frontend leería un campo inexistente en uno de los dos.
    assert datos["resumen"]["cubiertas"] == 2
    assert datos["resumen"]["sin_cubrir"] == 1
    assert datos["resumen"]["parcial"] is False
    fila = datos["sprints"][0]
    assert fila["nombre"] == "Sprint 1"
    assert fila["cubiertas"] == 2 and fila["sin_cubrir"] == 1


def test_sin_cubrir_devuelve_la_lista_de_trabajo():
    c = cliente([historia(i) for i in range(1, 8)], [caso(100, requisitos=(1,))])
    r = c.get("/api/pruebas/sin-cubrir?limite=3&offset=0")
    assert r.status_code == 200
    datos = r.json()
    # 7 historias, 1 cubierta -> 6 en la lista de trabajo.
    assert datos["resumen"]["total"] == 6
    assert datos["resumen"]["hay_mas"] is True
    assert len(datos["items"]) == 3
    assert datos["items"][0]["azure_id"] == 2

    resto = c.get("/api/pruebas/sin-cubrir?limite=3&offset=3").json()
    assert [i["azure_id"] for i in datos["items"] + resto["items"]] == [2, 3, 4, 5, 6, 7]
    # La última página no debe prometer más de lo que queda.
    assert resto["resumen"]["hay_mas"] is False


def test_sin_cubrir_filtra_por_sprint_y_persona():
    c = cliente(
        [
            historia(1, sprint=f"{RAIZ}\\Sprint 2", persona="Ana Diaz"),
            historia(2, sprint=f"{RAIZ}\\Sprint 3", persona="Luis Ruiz"),
        ],
        [],
    )
    assert c.get("/api/pruebas/sin-cubrir?sprint=Sprint 3").json()["resumen"]["total"] == 1
    assert c.get("/api/pruebas/sin-cubrir?persona=luis").json()["resumen"]["total"] == 1


def test_planes_devuelve_lista_vacia_sin_que_sea_error(cliente_basico):
    r = cliente_basico.get("/api/pruebas/planes")
    assert r.status_code == 200
    assert r.json() == []


# --------------------------------------------------------------------- #
# Cobertura parcial: el contrato que evita que la cifra mienta
# --------------------------------------------------------------------- #
def test_los_endpoints_declaran_la_cobertura_parcial():
    c = cliente([historia(1), historia(2)], [caso(100, requisitos=(1,))], lotes_con_error=2)
    assert c.get("/api/pruebas/resumen").json()["parcial"] is True
    cobertura = c.get("/api/pruebas/cobertura").json()
    assert cobertura["resumen"]["parcial"] is True
    assert cobertura["resumen"]["lotes_con_error"] == 2
    assert c.get("/api/pruebas/sin-cubrir").json()["resumen"]["parcial"] is True


# --------------------------------------------------------------------- #
# Robustez del contrato HTTP
# --------------------------------------------------------------------- #
def test_limite_y_offset_se_validan(cliente_basico):
    c = cliente_basico
    assert c.get("/api/pruebas/sin-cubrir?limite=0").status_code == 422
    assert c.get("/api/pruebas/sin-cubrir?limite=201").status_code == 422
    assert c.get("/api/pruebas/sin-cubrir?offset=-1").status_code == 422


def test_sin_configuracion_devuelve_409():
    """Mismo contrato que el resto de vistas: sin org/proyecto/PAT no hay nada."""
    c = cliente([historia(1)], [], configurado=False)
    for ruta in ("resumen", "cobertura", "sin-cubrir", "planes"):
        assert c.get(f"/api/pruebas/{ruta}").status_code == 409


def test_sin_activos_devuelve_ceros_y_no_error():
    """Sin casos, la brecha es el 100 % y el sprint aparece con 0 cubiertas.

    El sprint **sí** se lista: existe y sus historias no tienen caso. Quitarlo
    haría creer que no hay trabajo sin probar, que es lo contrario de la verdad.
    """
    c = cliente([historia(1)], [])
    datos = c.get("/api/pruebas/resumen").json()
    assert datos["inventario"]["total"] == 0
    assert datos["brecha"]["sin_cubrir"] == 1
    assert datos["brecha"]["pct_cubiertas"] == 0.0

    sprints = c.get("/api/pruebas/cobertura").json()["sprints"]
    assert len(sprints) == 1
    assert sprints[0]["cubiertas"] == 0 and sprints[0]["sin_cubrir"] == 1
    assert c.get("/api/pruebas/planes").json() == []


def test_refrescar_invalida_los_dos_indices():
    repo = FakeRepositorio(
        items_indice=[historia(1)],
        activos_prueba=[caso(100, requisitos=(1,))],
    )
    c = TestClient(crear_app(contenedor_con(repo)))
    c.get("/api/pruebas/cobertura")
    c.get("/api/sprints")
    assert repo.llamadas_indice_pruebas == 1

    assert c.post("/api/epics/refresh").status_code == 200
    c.get("/api/pruebas/cobertura")
    c.get("/api/sprints")
    # Sin invalidar el índice de pruebas, los recuentos de cobertura serían
    # previos al refresco: por eso se invalidan los dos.
    assert repo.llamadas_indice_pruebas == 2
    assert repo.llamadas_indice == 2


def test_una_escritura_invalida_el_indice_de_pruebas():
    from .conftest import FakeEscritura

    repo = FakeRepositorio(
        items_indice=[historia(1)],
        activos_prueba=[caso(100, requisitos=(1,))],
    )
    escritura = FakeEscritura()
    c = TestClient(crear_app(contenedor_con(repo, escritura=escritura)))
    c.get("/api/pruebas/cobertura")

    r = c.patch(
        "/api/workitems/1",
        json={"estado": "Closed", "tags": "verificado-qa"},
    )
    assert r.status_code == 200
    c.get("/api/pruebas/cobertura")
    assert repo.llamadas_indice_pruebas == 2


def test_una_validacion_en_seco_no_invalida():
    """`?validar=true` no escribe nada, así que no hay nada que invalidar."""
    from .conftest import FakeEscritura

    repo = FakeRepositorio(items_indice=[historia(1)], activos_prueba=[])
    c = TestClient(crear_app(contenedor_con(repo, escritura=FakeEscritura())))
    c.get("/api/pruebas/cobertura")

    r = c.patch("/api/workitems/1", json={"estado": "Closed"}, params={"validar": "true"})
    assert r.status_code == 200
    c.get("/api/pruebas/cobertura")
    assert repo.llamadas_indice_pruebas == 1
