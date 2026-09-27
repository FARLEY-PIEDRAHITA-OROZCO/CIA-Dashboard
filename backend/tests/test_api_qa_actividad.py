"""Pruebas de `GET /api/qa/epicas/{id}/actividad`.

Lo que se vigila en el contrato, más allá del cableado:

- El 409 de configuración ausente, como el resto de rutas de datos.
- El 404 de épica inexistente, que es distinto del 200 con ceros.
- Que la respuesta **no** tenga ningún campo que se pueda leer como horas, y que
  la nota vaya dentro de la respuesta en vez de estar solo en la documentación:
  es la que acompaña al número cuando alguien lo ve suelto.
"""

from datetime import datetime, timezone

import pytest

from app.domain.models import Persona, Revision
from tests.conftest import FakeRepositorio, contenedor_con, epica_canonica

CENTINELA = "9999-01-01T00:00:00Z"
ANA = "75712602-99c0-6599-96e8-9f8847c0f673"


def _rev(rev: int, guid: str, nombre: str, fecha: str | None) -> Revision:
    valor = None if fecha is None else datetime.fromisoformat(fecha)
    persona = Persona(guid=guid, nombre=nombre) if guid else None
    return Revision(rev=rev, persona=persona, fecha=valor)


def _revision_buena(guid: str = ANA, nombre: str = "Ana Diaz", rev: int = 2) -> Revision:
    return _rev(rev, guid, nombre, "2026-09-20T10:00:00+00:00")


def _cliente(historiales=None, fallan=None, epica=None, configurado=True):
    from fastapi.testclient import TestClient

    from app.main import crear_app
    from tests.conftest import epica_canonica

    repo = FakeRepositorio(
        arbol=epica if epica is not None else epica_canonica(),
        historiales=historiales,
        historiales_fallan=fallan,
    )
    contenedor = contenedor_con(repo, configurado=configurado)
    return TestClient(crear_app(contenedor)), repo


def test_devuelve_la_actividad_de_la_epica():
    cliente, _ = _cliente(historiales={100: [_rev(1, ANA, "Ana", None), _revision_buena()]})
    r = cliente.get("/api/qa/epicas/100/actividad")
    assert r.status_code == 200
    datos = r.json()
    assert datos["epica"] == 100
    assert datos["titulo"]
    assert datos["revisiones"] == 1
    assert datos["personas"] == 1
    assert datos["por_persona"] == [
        {"guid": ANA, "nombre": "Ana Diaz", "revisiones": 1}
    ]


def test_la_ultima_actividad_no_es_el_ano_9999():
    """El centinela de Azure,translated a cadena vacía.

    Si se colara, la respuesta tendría `9999-01-01T00:00:00+00:00` en `ultima`, que
    es un año futuro y por tanto parece siempre el «más reciente».
    """
    cliente, _ = _cliente(
        historiales={
            100: [_rev(1, ANA, "Ana", None), _revision_buena(), _rev(9, ANA, "Ana", None)]
        }
    )
    datos = cliente.get("/api/qa/epicas/100/actividad").json()
    assert datos["ultima"].startswith("2026-09-20")
    assert "9999" not in datos["ultima"]
    assert "9999" not in datos["primera"]


def test_una_epica_sin_historial_da_ceros_y_no_un_error():
    cliente, _ = _cliente(historiales={})
    r = cliente.get("/api/qa/epicas/100/actividad")
    assert r.status_code == 200
    datos = r.json()
    assert datos["revisiones"] == 0
    assert datos["primera"] == ""
    assert datos["ultima"] == ""
    assert datos["personas"] == 0


def test_una_epica_inexistente_es_404():
    from app.domain.models import Epic

    cliente, _ = _cliente(epica=Epic(azure_id=999, titulo="Otra"), historiales={})
    r = cliente.get("/api/qa/epicas/100/actividad")
    assert r.status_code == 404
    assert "100" in r.json()["detail"]


def test_una_epica_borrada_en_azure_es_404_y_no_502():
    """Azure responde 404 al pedir un ítem que ya no existe.

    Traducirlo a 502 diría «Azure falló», que es un diagnóstico equivocado para
    quien sigue un enlace guardado de una épica borrada: no hay nada que
    reintentar.
    """
    from fastapi.testclient import TestClient

    from app.infrastructure.azure.transport import AzureError
    from app.main import crear_app

    repo = FakeRepositorio(arbol=epica_canonica(), historiales={})
    contenedor = contenedor_con(repo)
    cliente = TestClient(crear_app(contenedor))

    class Arbol404:
        async def arbol_epica(self, epic_id, *, incluir_bugs=False):
            raise AzureError("no encontrado", status_code=404)

    contenedor.actividad._arbol = Arbol404()
    r = cliente.get("/api/qa/epicas/100/actividad")
    assert r.status_code == 404
    assert "ya no existe" in r.json()["detail"]


def test_un_5xx_de_azure_sigue_siendo_502():
    """El 404 es el único que se traduce: los demás siguen siendo de Azure."""
    from fastapi.testclient import TestClient

    from app.infrastructure.azure.transport import AzureError
    from app.main import crear_app

    repo = FakeRepositorio(arbol=epica_canonica(), historiales={})
    contenedor = contenedor_con(repo)
    cliente = TestClient(crear_app(contenedor))

    class ArbolCaido:
        async def arbol_epica(self, epic_id, *, incluir_bugs=False):
            raise AzureError("Azure no responde", status_code=503)

    contenedor.actividad._arbol = ArbolCaido()
    assert cliente.get("/api/qa/epicas/100/actividad").status_code == 502


def test_sin_configuracion_es_409():
    cliente, _ = _cliente(historiales={}, configurado=False)
    assert cliente.get("/api/qa/epicas/100/actividad").status_code == 409


def test_un_id_invalido_es_422():
    cliente, _ = _cliente(historiales={})
    assert cliente.get("/api/qa/epicas/0/actividad").status_code == 422
    assert cliente.get("/api/qa/epicas/abc/actividad").status_code == 422


def test_lo_parcial_se_declara_y_no_se_esconde():
    """`parcial` + `items_analizados` frente a `items_totales` son la misma verdad.

    Publicar el total leído sin decir cuál era el total real haría creer que se
    miró el árbol entero.
    """
    # El árbol canónico tiene 100, 101, 102, 201, 202 (aprox). Se rompe uno.
    cliente, _ = _cliente(
        historiales={i: [_revision_buena()] for i in (100, 201)}, fallan={101, 102}
    )
    datos = cliente.get("/api/qa/epicas/100/actividad").json()
    assert datos["parcial"] is True
    assert datos["items_analizados"] < datos["items_totales"]


def test_una_epica_completa_no_se_declara_parcial():
    cliente, _ = _cliente(historiales={100: [_revision_buena()]})
    datos = cliente.get("/api/qa/epicas/100/actividad").json()
    assert datos["parcial"] is False
    assert datos["items_analizados"] == datos["items_totales"]


def test_la_nota_de_limite_viene_en_la_respuesta():
    """La advertencia acompaña al dato, no está solo en la documentación.

    El número se ve suelto en pantalla mucho después de haber leído el manual.
    """
    cliente, _ = _cliente(historiales={100: [_revision_buena()]})
    nota = cliente.get("/api/qa/epicas/100/actividad").json()["nota"]
    assert "revisiones" in nota
    assert "no horas" in nota


def test_la_respuesta_no_ofrece_ningun_campo_de_horas():
    """El nombre del campo es la defensa contra la lectura equivocada.

    El registro de tiempos de Azure responde 401 con este PAT: no hay horas en
    ninguna parte del sistema. Un campo `horas` o `esfuerzo` sería un número que
    nadie ha medido, y con nombre de medida.
    """
    cliente, _ = _cliente(historiales={100: [_revision_buena()]})
    campos = set(cliente.get("/api/qa/epicas/100/actividad").json())
    assert not campos & {"horas", "esfuerzo", "jornadas", "puntos", "story_points"}


def test_cuenta_por_tipo_y_por_persona_con_guid():
    cliente, _ = _cliente(
        historiales={
            100: [
                _revision_buena(ANA, "Ana Diaz", 2),
                _rev(3, "otro-guid", "Luis Ruiz", "2026-09-21T10:00:00+00:00"),
            ]
        }
    )
    datos = cliente.get("/api/qa/epicas/100/actividad").json()
    assert datos["personas"] == 2
    guids = {f["guid"] for f in datos["por_persona"]}
    # El GUID es lo que permite enlazar con `#/dashboard?qa=<guid>` sin volver a
    # buscar por nombre, que no es único ni estable.
    assert guids == {ANA, "otro-guid"}
    assert datos["por_tipo"]


def test_no_hay_una_vista_global_de_actividad():
    """No existe, y no por descuido.

    Leer el historial de los 5.651 ítems del proyecto serían 5.651 peticiones: no
    es una vista, es un ataque a la API. La actividad es por épica y bajo demanda.
    """
    cliente, _ = _cliente(historiales={100: [_revision_buena()]})
    assert cliente.get("/api/qa/actividad").status_code == 404
