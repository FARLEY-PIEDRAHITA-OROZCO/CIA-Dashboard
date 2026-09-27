"""Pruebas HTTP del registro de QA (perfiles de rol).

Lo que se vigila sobre todo es el **mapeo de los tres fallos distintos**: un
formulario con un GUID malo (422), una escritura que perdió la carrera (409) y
un fichero corrupto (500). Confundirlos manda al usuario a la puerta
equivocada, y el 500 en particular no se puede arreglar desde el formulario.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.application.registro import ServicioRegistro
from app.domain.models import ItemIndice, ItemPrueba, Persona
from app.infrastructure.registro_json import VERSION_FORMATO, RegistroJson
from app.main import crear_app

from .conftest import FakeRepositorio, RegistroMemoria, contenedor_con

RAIZ = "Proyecto de ejemplo"


def historia(id_, guid: str, nombre: str) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="User Story",
        titulo=f"Historia {id_}",
        estado="Active",
        sprint=f"{RAIZ}\\Sprint 1",
        persona=Persona(guid=guid, nombre=nombre),
    )


def caso(id_, guid: str) -> ItemPrueba:
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Case",
        titulo=f"Caso {id_}",
        estado="Design",
        persona=Persona(guid=guid, nombre="X"),
    )


def cliente(
    *,
    historias=None,
    activos=(),
    registro=None,
    configurado=True,
):
    repo = FakeRepositorio(
        items_indice=historias
        or [
            historia(1, "g-ana", "Ana Diaz"),
            historia(2, "g-luis", "Luis Ruiz"),
        ],
        activos_prueba=list(activos),
    )
    return TestClient(
        crear_app(contenedor_con(repo, configurado, registro=registro or RegistroMemoria()))
    )


def cuerpo(r: dict, guid: str) -> dict:
    return next(p for p in r["personas"] if p["guid"] == guid)


# --------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------- #
def test_lista_las_personas_del_proyecto():
    c = cliente()
    r = c.get("/api/qa/personas")
    assert r.status_code == 200
    datos = r.json()
    assert datos["total"] == 2
    assert {p["nombre"] for p in datos["personas"]} == {"Ana Diaz", "Luis Ruiz"}


def test_sin_rol_alguno_por_defecto():
    # Nadie es QA hasta que alguien lo marque. Suponerlo sería inventar.
    datos = cliente().get("/api/qa/personas").json()
    assert datos["qa"] == 0 and datos["dev"] == 0 and datos["sin_rol"] == 2


def test_cuenta_los_que_sin_rol():
    registro = RegistroMemoria()
    c = cliente(registro=registro)
    c.put("/api/qa/personas/g-ana", json={"es_qa": True})
    datos = c.get("/api/qa/personas").json()
    assert (datos["qa"], datos["dev"], datos["sin_rol"]) == (1, 0, 1)


def test_trae_la_carga_de_azure_para_contrastar():
    # `items_backlog` viene de Azure y el rol del registro: poder ponerlos uno al
    # lado del otro es lo que permite detectar un registro que no cuadra.
    datos = cliente().get("/api/qa/personas").json()
    assert cuerpo(datos, "g-ana")["items_backlog"] == 1


def test_sin_configuracion_devuelve_409():
    assert cliente(configurado=False).get("/api/qa/personas").status_code == 409


# --------------------------------------------------------------------- #
# Marcar rol
# --------------------------------------------------------------------- #
def test_marca_qa_y_lo_devuelve():
    c = cliente()
    r = c.put("/api/qa/personas/g-ana", json={"es_qa": True})
    assert r.status_code == 200
    assert r.json()["es_qa"] is True
    assert c.get("/api/qa/personas").json()["qa"] == 1


def test_marca_los_dos_roles_a_la_vez():
    # Alguien que prueba y desarrolla es normal en equipos pequeños; obligarle a
    # elegir uno haría que el registro mintiera.
    r = cliente().put("/api/qa/personas/g-ana", json={"es_qa": True, "es_dev": True})
    assert (r.json()["es_qa"], r.json()["es_dev"]) == (True, True)


def test_quitar_un_rol_con_false():
    c = cliente()
    c.put("/api/qa/personas/g-ana", json={"es_qa": True})
    r = c.put("/api/qa/personas/g-ana", json={"es_qa": False})
    assert r.json()["es_qa"] is False


def test_un_campo_null_no_toca_el_otro():
    # La diferencia entre `null` (no lo toques) y `false` (quítaselo): si no,
    # reenviar el formulario borraría el rol que no se quería cambiar.
    c = cliente()
    c.put("/api/qa/personas/g-ana", json={"es_qa": True, "es_dev": True})
    r = c.put("/api/qa/personas/g-ana", json={"es_qa": None, "es_dev": False})
    assert r.json()["es_qa"] is True
    assert r.json()["es_dev"] is False


def test_cuerpo_vacio_es_422():
    r = cliente().put("/api/qa/personas/g-ana", json={})
    assert r.status_code == 422
    assert "al menos un campo" in r.json()["detail"]


def test_guid_desconocido_es_422_con_mensaje_util():
    r = cliente().put("/api/qa/personas/g-fantasma", json={"es_qa": True})
    assert r.status_code == 422
    detalle = r.json()["detail"]
    assert "g-fantasma" in detalle
    # Dice qué hacer, no solo que falla: sin esto no se sabe si es un error de
    # tecleo o que la persona no ha entrado nunca en el proyecto.
    assert "backlog" in detalle


def test_guid_vacio_es_422():
    assert cliente().put("/api/qa/personas/%20", json={"es_qa": True}).status_code == 422


# --------------------------------------------------------------------- #
# Sugerencia
# --------------------------------------------------------------------- #
def test_la_sugerencia_devuelve_quien_mas_toca_activos():
    activos = [caso(i, "g-ana") for i in range(5)] + [caso(99, "g-luis")]
    r = cliente(activos=activos).get("/api/qa/sugerencia-qa?minimo=1")
    assert r.status_code == 200
    datos = r.json()
    assert [s["guid"] for s in datos["sugerencias"]] == ["g-ana", "g-luis"]
    assert datos["sugerencias"][0]["activos"] == 5


def test_la_sugerencia_avisa_de_lo_ya_marcado():
    c = cliente(activos=[caso(1, "g-ana")])
    c.put("/api/qa/personas/g-ana", json={"es_qa": True})
    datos = c.get("/api/qa/sugerencia-qa?minimo=1").json()
    assert datos["sugerencias"][0]["ya_es_qa"] is True


def test_la_sugerencia_no_guarda_nada():
    # Guardarla sola sería clasificar mal a alguien con un error que queda en el
    # registro sin que nadie lo revise.
    registro = RegistroMemoria()
    cliente(activos=[caso(i, "g-ana") for i in range(5)], registro=registro).get(
        "/api/qa/sugerencia-qa?minimo=1"
    )
    assert registro.datos.perfiles == {}
    assert registro.datos.asignaciones == []


def test_el_minimo_se_devuelve_para_que_la_ui_lo_explique():
    datos = cliente().get("/api/qa/sugerencia-qa?minimo=7").json()
    assert datos["minimo"] == 7
    assert datos["nota"] != ""


def test_minimo_se_valida():
    assert cliente().get("/api/qa/sugerencia-qa?minimo=-1").status_code == 422
    assert cliente().get("/api/qa/sugerencia-qa?minimo=99999").status_code == 422


# --------------------------------------------------------------------- #
# Traducción de fallos: los tres códigos tienen que ser distintos
# --------------------------------------------------------------------- #
def test_una_carrera_se_traduce_a_409_y_no_pisa_nada():
    """El 409 sale cuando el fichero cambia **durante** la petición.

    Provocar eso de verdad exigiría cambiar el fichero entre el read y el write
    de una misma petición, que es un enganche artificial. Lo que se comprueba
    aquí es el cableado: que `RegistroModificado` llegue como 409 y no como un
    500 genérico que sugeriría un fallo del servidor.

    El conflicto en sí, y que no se pise nada, ya está probado en
    `test_registro.py::test_no_pisa_un_registro_que_cambio_en_disco`.
    """
    class EnConflicto(RegistroMemoria):
        async def guardar(self, instantanea):
            from app.infrastructure.registro_json import RegistroModificado

            raise RegistroModificado("el registro cambió en disco")

    r = cliente(registro=EnConflicto()).put("/api/qa/personas/g-ana", json={"es_qa": True})
    assert r.status_code == 409
    assert "cambió" in r.json()["detail"]


def test_un_cambio_hecho_por_fuera_no_se_pisa(tmp_path: Path):
    """Si otra pestaña escribió antes de nuestra petición, la leemos y la respetamos.

    No es un conflicto: la versión nueva es la buena. Lo que no puede pasar es
    que la ignoremos.
    """
    ruta = tmp_path / "asignaciones.json"
    registro_real = RegistroJson(ruta)
    repo = FakeRepositorio(items_indice=[historia(1, "g-ana", "Ana Diaz")])
    c = TestClient(crear_app(contenedor_con(repo, registro=registro_real)))
    assert c.put("/api/qa/personas/g-ana", json={"es_qa": True}).status_code == 200

    ruta.write_text(
        json.dumps(
            {
                "version": VERSION_FORMATO,
                "actualizado": "2026-09-27T00:00:00Z",
                "perfiles": {"g-luis": {"es_qa": True, "es_dev": False}},
                "asignaciones": [],
            }
        ),
        encoding="utf-8",
    )
    r = c.put("/api/qa/personas/g-ana", json={"es_qa": True, "es_dev": True})
    assert r.status_code == 200
    # La marca de la otra pestaña sigue en el fichero, junto a la nuestra.
    # (No aparece en `/api/qa/personas` porque `g-luis` no está en el proyecto:
    # esa lista sale del índice de Azure, y un GUID que no está ahí no es
    # seleccionable, aunque su marca se conserve.)
    perfiles = json.loads(ruta.read_text(encoding="utf-8"))["perfiles"]
    assert perfiles["g-luis"]["es_qa"] is True
    assert perfiles["g-ana"]["es_dev"] is True


def test_un_fichero_corrupto_es_500_y_no_un_registro_vacio():
    # 500 y no 422: el problema no está en la petición, está en el fichero. Un
    # 422 mandaría al usuario a corregir un formulario que está bien.
    registro = Roto()
    r = cliente(registro=registro).put("/api/qa/personas/g-ana", json={"es_qa": True})
    assert r.status_code == 500
    assert "JSON" in r.json()["detail"]


def test_un_fichero_corrupto_tambien_falla_al_leer():
    assert cliente(registro=Roto()).get("/api/qa/personas").status_code == 500


class Roto(RegistroMemoria):
    async def leer(self):
        from app.infrastructure.registro_json import ErrorRegistro

        raise ErrorRegistro("el fichero no es un JSON válido")

    async def guardar(self, instantanea):
        raise AssertionError("no debería llegarse a guardar")


# --------------------------------------------------------------------- #
# El tiempo no se llama «horas»
# --------------------------------------------------------------------- #
def test_el_campo_es_dias_laborables_y_no_horas():
    # El worklog de Azure responde 401: no hay ninguna fuente de horas. Un campo
    # llamado `horas` sería un número que el sistema no tiene.
    datos = cliente().get("/api/qa/personas").json()
    assert "dias_laborables" in datos["personas"][0]
    assert "horas" not in datos["personas"][0]


def test_el_lector_muestra_las_asignaciones_existentes():
    # Aunque escribir asignaciones sea de la fase siguiente, su lectura forma
    # parte de este modelo: una lista de QA sin épicas no dice nada.
    registro = RegistroMemoria()
    c = cliente(registro=registro)
    _ = c.put("/api/qa/personas/g-ana", json={"es_qa": True})

    # Asigna por el mismo camino que usará la fase siguiente.
    import asyncio

    inicio = date.today() - timedelta(days=20)
    asyncio.run(
        c.app.state.contenedor.servicio_registro.asignar(5324, "g-ana", "qa", desde=inicio)
    )
    fila = cuerpo(c.get("/api/qa/personas").json(), "g-ana")
    assert fila["epicas"] == 1
    assert fila["epicas_qa"] == 1
    assert fila["dias_laborables"] > 10
    assert fila["mas_antigua"] == inicio.isoformat()
