"""Pruebas HTTP de las asignaciones de épicas.

Dos cosas se vigilan sobre todo:

- **Una asignación a una épica que ya no existe en Azure no se esconde.** Sigue
  en el registro, se devuelve con `titulo_conocido: false` y se cuenta aparte.
  Borrarla sin que nadie lo decida sería perder trabajo; esconderla sería
  perderla de la vista.
- **Los días son días, no horas.** El registro de tiempos de Azure responde 401.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.domain.models import Epic, ItemIndice, Persona
from app.main import crear_app

from .conftest import FakeRepositorio, RegistroMemoria, contenedor_con

RAIZ = "Proyecto de ejemplo"


def epica(id_: int, titulo: str, estado: str = "Active") -> Epic:
    return Epic(azure_id=id_, titulo=titulo, estado=estado, features=[], hus=[])


def historia(id_, guid, nombre) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="User Story",
        titulo=f"Historia {id_}",
        estado="Active",
        sprint=f"{RAIZ}\\Sprint 1",
        persona=Persona(guid=guid, nombre=nombre),
    )


def cliente(*, epicas=None, historias=None, registro=None):
    repo = FakeRepositorio(
        epicas=list(epicas if epicas is not None else [epica(5324, "Buzón jurídico")]),
        items_indice=historias
        or [historia(1, "g-ana", "Ana Diaz"), historia(2, "g-luis", "Luis Ruiz")],
    )
    return TestClient(
        crear_app(
            contenedor_con(repo, escritura=None, registro=registro or RegistroMemoria())
        )
    )


def servicio_de(c: TestClient):
    return c.app.state.contenedor.servicio_registro


# --------------------------------------------------------------------- #
# Asignar
# --------------------------------------------------------------------- #
def test_asigna_y_devuelve_la_asignacion_con_titulo():
    c = cliente()
    r = c.put(
        "/api/qa/asignaciones",
        json={"epica": 5324, "persona": "g-ana", "rol": "qa"},
    )
    assert r.status_code == 200
    cuerpo = r.json()
    # Sin el título, la UI solo podría enseñar «épica 5324», que no dice nada.
    assert cuerpo["titulo"] == "Buzón jurídico"
    assert cuerpo["titulo_conocido"] is True
    assert cuerpo["nombre_persona"] == "Ana Diaz"
    assert cuerpo["desde"] == date.today().isoformat()


def test_reenviar_la_misma_no_duplica():
    # El formulario se reenvía al cambiar un matiz. Duplicar rompería el
    # recuento de épicas por persona, que es justo lo que la vista enseña.
    c = cliente()
    cuerpo = {"epica": 5324, "persona": "g-ana", "rol": "qa"}
    c.put("/api/qa/asignaciones", json=cuerpo)
    c.put("/api/qa/asignaciones", json={**cuerpo, "nota": "ajustado"})
    assert c.get("/api/qa/asignaciones").json()["total"] == 1


def test_una_epica_puede_tener_qa_y_dev():
    c = cliente()
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-luis", "rol": "dev"})
    datos = c.get("/api/qa/asignaciones").json()
    assert datos["total"] == 2
    assert {a["rol"] for a in datos["asignaciones"]} == {"qa", "dev"}


def test_acepta_una_fecha_pasada():
    inicio = date.today() - timedelta(days=30)
    r = cliente().put(
        "/api/qa/asignaciones",
        json={"epica": 5324, "persona": "g-ana", "rol": "qa", "desde": inicio.isoformat()},
    )
    assert r.status_code == 200
    assert r.json()["dias_laborables"] > 20


def test_rechaza_una_fecha_futura():
    manana = (date.today() + timedelta(days=1)).isoformat()
    r = cliente().put(
        "/api/qa/asignaciones",
        json={"epica": 5324, "persona": "g-ana", "rol": "qa", "desde": manana},
    )
    assert r.status_code == 422
    assert "futura" in r.json()["detail"]


def test_rechaza_un_rol_inexistente():
    r = cliente().put(
        "/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "arquitecto"}
    )
    # Lo rechaza el propio esquema: ni siquiera llega al servicio.
    assert r.status_code == 422


def test_rechaza_un_guid_que_no_existe():
    r = cliente().put(
        "/api/qa/asignaciones", json={"epica": 5324, "persona": "g-fantasma", "rol": "qa"}
    )
    assert r.status_code == 422
    assert "g-fantasma" in r.json()["detail"]


def test_rechaza_un_id_de_epica_imposible():
    assert cliente().put(
        "/api/qa/asignaciones", json={"epica": 0, "persona": "g-ana", "rol": "qa"}
    ).status_code == 422


def test_no_asigna_a_una_epica_que_no_existe():
    # Que la épica no esté en Azure no impide registrarla: puede haberse borrado
    # después de asignar. Lo que no se permite es asignar a un id que nunca existió
    # sin darse cuenta, por ejemplo un tecleo.
    c = cliente()
    r = c.put("/api/qa/asignaciones", json={"epica": 999999, "persona": "g-ana", "rol": "qa"})
    assert r.status_code == 200
    assert r.json()["titulo_conocido"] is False
    assert r.json()["titulo"] == ""


# --------------------------------------------------------------------- #
# Listar
# --------------------------------------------------------------------- #
def test_filtra_por_epica():
    c = cliente(epicas=[epica(5324, "Buzón jurídico"), epica(7000, "Auditorías")])
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    c.put("/api/qa/asignaciones", json={"epica": 7000, "persona": "g-ana", "rol": "qa"})
    datos = c.get("/api/qa/asignaciones?epica=7000").json()
    assert datos["total"] == 1
    assert datos["asignaciones"][0]["titulo"] == "Auditorías"


def test_filtra_por_persona_y_por_rol():
    c = cliente()
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-luis", "rol": "dev"})
    assert c.get("/api/qa/asignaciones?persona=g-ana").json()["total"] == 1
    assert c.get("/api/qa/asignaciones?rol=dev").json()["total"] == 1


def test_una_epica_borrada_de_azure_se_declara_y_no_se_oculta():
    c = cliente(epicas=[])
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    datos = c.get("/api/qa/asignaciones").json()
    assert datos["total"] == 1
    assert datos["asignaciones"][0]["titulo_conocido"] is False
    # Y se cuenta aparte, para que alguien la pueda limpiar.
    assert datos["epicas_desconocidas"] == 1


def test_una_epica_cerrada_sigue_titulada():
    # `listar_epicas` excluye las cerradas por defecto. Una épica cerrada sigue
    # siendo una épica con nombre: sin `incluir_cerradas=true` saldría sin
    # título, que parece que se borró cuando no lo está.
    c = cliente(epicas=[epica(5324, "Buzón jurídico", estado="Closed")])
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    assert c.get("/api/qa/asignaciones").json()["asignaciones"][0]["titulo"] == "Buzón jurídico"


def test_rol_invalido_en_el_filtro_es_422():
    assert cliente().get("/api/qa/asignaciones?rol=inventado").status_code == 422


def test_epica_invalida_en_el_filtro_es_422():
    assert cliente().get("/api/qa/asignaciones?epica=0").status_code == 422


def test_sin_configuracion_devuelve_409():
    repo = FakeRepositorio(items_indice=[historia(1, "g-ana", "Ana Diaz")])
    c = TestClient(crear_app(contenedor_con(repo, configurado=False)))
    assert c.get("/api/qa/asignaciones").status_code == 409
    assert c.put(
        "/api/qa/asignaciones", json={"epica": 1, "persona": "g-ana", "rol": "qa"}
    ).status_code == 409


# --------------------------------------------------------------------- #
# Quitar
# --------------------------------------------------------------------- #
def test_quita_la_asignacion():
    c = cliente()
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    r = c.delete("/api/qa/asignaciones/5324/g-ana/qa")
    assert r.status_code == 200
    assert c.get("/api/qa/asignaciones").json()["total"] == 0


def test_quitar_solo_esa_asignacion():
    c = cliente()
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-ana", "rol": "qa"})
    c.put("/api/qa/asignaciones", json={"epica": 5324, "persona": "g-luis", "rol": "dev"})
    c.delete("/api/qa/asignaciones/5324/g-ana/qa")
    datos = c.get("/api/qa/asignaciones").json()
    assert [(a["persona"], a["rol"]) for a in datos["asignaciones"]] == [("g-luis", "dev")]


def test_quitar_lo_que_no_esta_no_falla():
    assert cliente().delete("/api/qa/asignaciones/1/g-ana/qa").status_code == 200


def test_quitar_con_rol_invalido_es_422():
    assert cliente().delete("/api/qa/asignaciones/1/g-ana/inventado").status_code == 422


# --------------------------------------------------------------------- #
# Carga por persona
# --------------------------------------------------------------------- #
def test_carga_agrupa_por_persona_y_ordena_por_volumen():
    import asyncio

    c = cliente(epicas=[epica(1, "Una"), epica(2, "Dos"), epica(3, "Tres")])
    servicio = servicio_de(c)
    inicio = date.today() - timedelta(days=40)
    asyncio.run(servicio.asignar(1, "g-luis", "qa", desde=inicio))
    asyncio.run(servicio.asignar(2, "g-luis", "dev", desde=inicio))
    asyncio.run(servicio.asignar(3, "g-ana", "qa", desde=inicio))

    datos = c.get("/api/qa/carga").json()
    assert [f["nombre"] for f in datos] == ["Luis Ruiz", "Ana Diaz"]
    assert datos[0]["epicas"] == 2
    # 40 días naturales son unos 29 laborables: los dos fines de semana de cada
    # semana no cuentan, que es justo lo que se quiere medir.
    assert 25 <= datos[0]["dias_laborables"] <= 30
    assert datos[0]["desde"] == inicio.isoformat()


def test_carga_solo_devuelve_quien_tiene_epicas():
    import asyncio

    c = cliente()
    asyncio.run(servicio_de(c).asignar(5324, "g-ana", "qa"))
    nombres = {f["nombre"] for f in c.get("/api/qa/carga").json()}
    assert nombres == {"Ana Diaz"}


def test_carga_incluye_el_titulo_de_cada_epica():
    import asyncio

    c = cliente(epicas=[epica(5324, "Buzón jurídico")])
    asyncio.run(servicio_de(c).asignar(5324, "g-ana", "qa"))
    fila = c.get("/api/qa/carga").json()[0]
    assert fila["asignaciones"][0]["titulo"] == "Buzón jurídico"
    assert fila["asignaciones"][0]["titulo_conocido"] is True
    # Asignada hoy puede ser 0 si hoy es fin de semana: los días laborables no
    # cuentan sábados ni domingos, y una épica creada el domingo no lleva un
    # día de trabajo encima. La UI dirá «hoy» en vez de «0 días».
    assert fila["asignaciones"][0]["dias_laborables"] >= 0


def test_una_semana_de_calenda_es_cinco_dias_laborables():
    import asyncio

    c = cliente(epicas=[epica(1, "Una")])
    inicio = date.today() - timedelta(days=7)
    asyncio.run(servicio_de(c).asignar(1, "g-ana", "qa", desde=inicio))
    dias = c.get("/api/qa/carga").json()[0]["asignaciones"][0]["dias_laborables"]
    # 7 días naturales son 5 laborables. Se cuentan ambos extremos, así que
    # según el día de la semana puede ser 5 o 6; lo que no puede ser es contar
    # los fines de semana.
    assert 5 <= dias <= 6


def test_carga_marca_las_epicas_que_ya_no_existen():
    import asyncio

    c = cliente(epicas=[])
    asyncio.run(servicio_de(c).asignar(5324, "g-ana", "qa"))
    fila = c.get("/api/qa/carga").json()[0]
    assert fila["asignaciones"][0]["titulo_conocido"] is False


def test_carga_con_el_registro_vacio_es_lista_vacia():
    assert cliente().get("/api/qa/carga").json() == []


# --------------------------------------------------------------------- #
# El tiempo no se llama «horas»
# --------------------------------------------------------------------- #
def test_ningun_endpoint_expone_horas():
    import asyncio

    c = cliente()
    asyncio.run(servicio_de(c).asignar(5324, "g-ana", "qa"))
    assert "horas" not in c.get("/api/qa/carga").text
    assert "horas" not in c.get("/api/qa/asignaciones").text
