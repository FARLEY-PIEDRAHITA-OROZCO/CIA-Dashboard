"""Pruebas de la API HTTP (endpoints del dashboard de épicas)."""

import pytest

from fastapi.testclient import TestClient

from app.main import crear_app
from app.infrastructure.azure.transport import AzureError
from app.domain.models import Epic

from .conftest import FakeRepositorio, contenedor_con, epica_canonica, epica_con_bugs


def test_health(cliente_fake):
    r = cliente_fake.get("/api/health")
    assert r.status_code == 200
    assert r.json()["estado"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"


def test_cors_solo_permite_originen_configurado():
    contenedor = contenedor_con(FakeRepositorio())
    contenedor.settings.origen_cors = "https://team.example"
    cliente = TestClient(crear_app(contenedor))

    permitido = cliente.get("/api/health", headers={"Origin": "https://team.example"})
    rechazado = cliente.get("/api/health", headers={"Origin": "https://evil.example"})

    assert permitido.headers["access-control-allow-origin"] == "https://team.example"
    assert "access-control-allow-origin" not in rechazado.headers


def test_estado_integracion(cliente_fake):
    r = cliente_fake.get("/api/azure/estado")
    cuerpo = r.json()
    assert r.status_code == 200
    assert cuerpo["configurada"] is True
    assert cuerpo["verificado"] is True
    assert cuerpo["proyecto"] == "Proyecto de ejemplo"


def test_lista_epicas(cliente_fake):
    r = cliente_fake.get("/api/epics")
    assert r.status_code == 200
    vistas = r.json()["epicas"]
    assert [v["azure_id"] for v in vistas] == [100]
    assert vistas[0]["titulo"] == "Épica del canal digital"


def test_lista_epicas_devuelve_solo_resumen(cliente_fake):
    vistas = cliente_fake.get("/api/epics").json()["epicas"]
    assert "features" not in vistas[0]
    assert "url" in vistas[0]


def test_arbol_epica(cliente_fake):
    r = cliente_fake.get("/api/epics/100/arbol")
    assert r.status_code == 200
    árbol = r.json()
    assert árbol["azure_id"] == 100
    assert [f["azure_id"] for f in árbol["features"]] == [101, 102]
    assert árbol["features"][0]["hus"][0]["titulo"] == "HU Registro"


def test_arbol_epica_incluye_bugs_opcionalmente():
    cliente = TestClient(crear_app(contenedor_con(FakeRepositorio(arbol=epica_canonica()))))
    sin_bugs = cliente.get("/api/epics/100/arbol").json()

    cliente_con_bugs = TestClient(
        crear_app(contenedor_con(FakeRepositorio(arbol=epica_con_bugs())))
    )
    con_bugs = cliente_con_bugs.get("/api/epics/100/arbol?incluir_bugs=true").json()

    assert "bugs" not in sin_bugs["features"][0]["hus"][0]
    assert [bug["azure_id"] for bug in con_bugs["hus"][0]["bugs"]] == [300, 302]


def test_bugs_epica_devuelve_bugs_y_metricas():
    repo = FakeRepositorio(arbol=epica_con_bugs())
    cliente = TestClient(crear_app(contenedor_con(repo)))

    r = cliente.get("/api/epics/100/bugs")

    assert r.status_code == 200
    cuerpo = r.json()
    assert [bug["azure_id"] for bug in cuerpo["bugs"]] == [300]
    assert cuerpo["metricas"]["total"] == 2
    assert cuerpo["metricas"]["abiertos"] == 1
    assert cuerpo["metricas"]["cerrados"] == 1
    assert cuerpo["metricas"]["por_relacion"] == {"hierarchy": 1, "related": 1}


def test_arbol_epica_inexistente_404(cliente_fake):
    r = cliente_fake.get("/api/epics/999/arbol")
    assert r.status_code == 404


def test_arbol_rechaza_id_no_positivo(cliente_fake):
    r = cliente_fake.get("/api/epics/0/arbol")
    assert r.status_code == 422


def test_404_upstream_de_arbol_se_traduce_a_404():
    repo = FakeRepositorio(epicas=[epica_canonica()])
    repo.sintoma = AzureError("No existe", status_code=404)
    cliente = TestClient(crear_app(contenedor_con(repo)))

    r = cliente.get("/api/epics/100/arbol")

    assert r.status_code == 404


def test_refresh_invalida_cache(cliente_fake):
    r = cliente_fake.post("/api/epics/refresh")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_epics_sin_configuracion_409():
    contenedor = contenedor_con(FakeRepositorio(), configurado=False)

    cliente = TestClient(crear_app(contenedor))
    r = cliente.get("/api/epics")
    assert r.status_code == 409


def test_error_upstream_se_muestra_como_502():
    repo = FakeRepositorio(epicas=[epica_canonica()])
    repo.sintoma = AzureError("Azure respondió HTTP 500")
    contenedor = contenedor_con(repo)

    cliente = TestClient(crear_app(contenedor))
    r = cliente.get("/api/epics")
    assert r.status_code == 502
    assert "HTTP 500" in r.json()["detail"]


def test_lista_epicas_excluye_cerradas_configurable():
    repo = FakeRepositorio(
        epicas=[
            epica_canonica(),
            Epic(azure_id=900, titulo="Épica cerrada", estado="Closed", url=""),
        ]
    )
    contenedor = contenedor_con(repo)
    cliente = TestClient(crear_app(contenedor))

    solo_activas = cliente.get("/api/epics").json()["epicas"]
    con_cerradas = cliente.get("/api/epics?incluir_cerradas=true").json()["epicas"]
    resumen = con_cerradas[1]

    assert [e["azure_id"] for e in solo_activas] == [100]
    assert [e["azure_id"] for e in con_cerradas] == [100, 900]
    assert resumen["titulo"] == "Épica cerrada"
    assert resumen["estado"] == "Closed"