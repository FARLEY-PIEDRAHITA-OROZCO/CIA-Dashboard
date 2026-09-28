"""Pruebas del decorador de copia del registro.

Lo que se vigila, por orden de gravedad real:

1. **Una copia configurada a una carpeta que no existe NO cuenta como copia.**
   Es el fallo que motivated todo esto: un fichero dentro de una carpeta llamada
   `OneDrive` sin sesión iniciada parece respaldado y no lo está.
2. **Un fallo de copia no tumba la escritura.** El dato ya está en el registro
   principal; devolver error HTTP diría «no se guardó» sobre algo guardado.
3. **Restaurar solo si falta, nunca sobre lo que existe.** Si el registro está
   corrupto, restaurarlo por encima destruiría contenido quizá recuperable.
4. **Sin destino configurado, es un passthrough exacto.** Cero cambios de
   comportamiento respecto al adaptador de fichero.
"""

import json
import os
import stat
from pathlib import Path

import pytest

from app.domain.models import Asignacion, Instantanea, PerfilPersona
from app.infrastructure.registro_copia import RegistroConCopia
from app.infrastructure.registro_json import RegistroJson


def _instancia(epica: int = 1) -> Instantanea:
    return Instantanea(
        perfiles={},
        asignaciones=[
            Asignacion(epica=epica, persona="g-ana", rol="qa", desde="2026-09-01")
        ],
        hash="",
    )


async def _guardar(registro, epica: int) -> None:
    """Guarda siguiendo el ciclo real: leer, cambiar, guardar.

    No se puede shortcutear con una instantánea de `hash=""` a partir del
    segundo guardado: el registro rechaza la escritura si el disco cambió desde
    la lectura, que es justo la protección que hay que conservar. Los IDs empiezan
    en 1 porque `epica=0` es inválido.
    """
    actual = await registro.leer()
    await registro.guardar(
        Instantanea(
            perfiles=actual.perfiles,
            asignaciones=[Asignacion(epica=epica, persona="g-ana", rol="qa", desde="2026-09-01")],
            hash=actual.hash,
        )
    )


def _montar(tmp_path: Path, destino: Path | None):
    origen = tmp_path / "registro" / "asignaciones.json"
    interno = RegistroJson(origen)
    registro = RegistroConCopia(interno, origen, destino)
    return registro, interno, origen


# ---------------------------------------------------------------------- #
# Sin destino: passthrough exacto
# ---------------------------------------------------------------------- #
class TestSinDestino:
    @pytest.mark.asyncio
    async def test_guarda_y_lee_igual_que_el_adaptador_de_fichero(self, tmp_path):
        registro, interno, origen = _montar(tmp_path, None)
        await registro.guardar(_instancia())
        releida = await registro.leer()
        assert releida.asignaciones[0].epica == 1
        assert origen.exists()

    @pytest.mark.asyncio
    async def test_no_crea_ningun_fichero_extra(self, tmp_path):
        registro, _, _ = _montar(tmp_path, None)
        await registro.guardar(_instancia())
        assert [p.name for p in (tmp_path / "registro").iterdir()] == ["asignaciones.json"]

    def test_el_estado_avisa_que_no_hay_copia(self, tmp_path):
        registro, _, _ = _montar(tmp_path, None)
        estado = registro.estado()
        assert estado["copia_configurada"] is False
        assert estado["copia_activa"] is False
        # El aviso tiene que nombrar el riesgo real, no decir «sin copia» y ya.
        assert "se pierde" in estado["aviso"]
        assert "REGISTRO_COPIA_RUTA" in estado["aviso"]


# ---------------------------------------------------------------------- #
# Con destino
# ---------------------------------------------------------------------- #
class TestConDestino:
    @pytest.mark.asyncio
    async def test_copia_despues_de_cada_guardado(self, tmp_path):
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, origen = _montar(tmp_path, destino)
        await _guardar(registro, 1)
        assert destino.exists()
        # Idéntico byte a byte: una copia re-serializada podría divergir.
        assert destino.read_bytes() == origen.read_bytes()

        await _guardar(registro, 2)
        assert json.loads(destino.read_text())["asignaciones"][0]["epica"] == 2
        assert json.loads(origen.read_text())["asignaciones"][0]["epica"] == 2

    @pytest.mark.asyncio
    async def test_no_deja_temporales_en_el_destino(self, tmp_path):
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        for i in range(1, 4):
            await _guardar(registro, i)
        assert [p.name for p in destino.parent.iterdir()] == ["asignaciones.json"]

    @pytest.mark.asyncio
    async def test_crea_la_carpeta_del_destino_si_falta(self, tmp_path):
        destino = tmp_path / "a" / "b" / "c" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        await registro.guardar(_instancia())
        assert destino.exists()

    @pytest.mark.asyncio
    async def test_estado_sano_dice_activa_y_sin_aviso(self, tmp_path):
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        await registro.guardar(_instancia())
        estado = registro.estado()
        assert estado["copia_configurada"] is True
        assert estado["copia_activa"] is True
        assert estado["aviso"] == ""
        assert estado["ultima_copia"] != ""


# ---------------------------------------------------------------------- #
# El fallo que motiva todo esto
# ---------------------------------------------------------------------- #
class TestDestinoInaccesible:
    @pytest.mark.asyncio
    async def test_destino_inalcanzable_no_se_declara_copia_activa(self, tmp_path):
        """La carpeta no existe y no se puede crear porque el padre es un fichero.

        Es el caso real de apuntar a un `OneDrive` sin sesión: la ruta parece
        buena, el fichero «se guarda», y no hay ninguna copia.
        """
        bloqueo = tmp_path / "bloqueo"
        bloqueo.write_text("soy un fichero, no una carpeta")
        destino = bloqueo / "sub" / "asignaciones.json"  # bajo un fichero
        registro, _, origen = _montar(tmp_path, destino)

        await registro.guardar(_instancia())

        # El registro principal SÍ se guardó: eso es lo importante.
        assert origen.exists()
        assert json.loads(origen.read_text())["asignaciones"][0]["epica"] == 1
        # Y el estado lo dice, en vez de fingir que hay respaldo.
        estado = registro.estado()
        assert estado["copia_configurada"] is True
        assert estado["copia_activa"] is False
        assert "NO se está escribiendo" in estado["aviso"]
        assert "sí se guardó" in estado["aviso"]

    @pytest.mark.asyncio
    async def test_un_fallo_de_copia_no_propaga_excepcion(self, tmp_path):
        bloqueo = tmp_path / "bloqueo"
        bloqueo.write_text("x")
        destino = bloqueo / "sub" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        # Si la copia levantara, la escritura del registro principal ya está
        # hecha y la respuesta HTTP sería una mentira.
        await registro.guardar(_instancia())
        assert registro.ultimo_error != ""

    @pytest.mark.asyncio
    async def test_un_respaldo_que_se_recupera_deja_la_copia_activa(self, tmp_path):
        """Un fallo transitorio no deja la copia marcada como rota para siempre."""
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        destino.parent.mkdir(parents=True)
        registro.ultimo_error = "fallo anterior"
        await registro.guardar(_instancia())
        assert registro.ultimo_error == ""
        assert registro.estado()["copia_activa"] is True


# ---------------------------------------------------------------------- #
# Restauración
# ---------------------------------------------------------------------- #
class TestRestauracion:
    @pytest.mark.asyncio
    async def test_arranca_vacio_restaura_desde_la_copia(self, tmp_path):
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, origen = _montar(tmp_path, destino)
        await registro.guardar(_instancia(epica=7))
        origen.unlink()  # se perdioó el registro, la copia está

        # Instancia nueva: es lo que pasa al reiniciar el proceso.
        registro2 = RegistroConCopia(RegistroJson(origen), origen, destino)
        recuperada = await registro2.leer()
        assert recuperada.asignaciones[0].epica == 7
        assert origen.exists()

    @pytest.mark.asyncio
    async def test_sin_copia_no_restaura_ni_falla(self, tmp_path):
        registro, _, _ = _montar(tmp_path, None)
        vacia = await registro.leer()
        # Primer arranque: vacío sin error, como siempre.
        assert vacia.asignaciones == []

    @pytest.mark.asyncio
    async def test_no_sobrescribe_un_registro_que_existe(self, tmp_path):
        """Un registro **corrupto** no se restaura encima: podría ser recuperable.

        Automatizarlo destruiría el único indicio de qué lo rompió.
        """
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, origen = _montar(tmp_path, destino)
        await registro.guardar(_instancia(epica=7))

        origen.write_text("{ esto no es json")
        registro2 = RegistroConCopia(RegistroJson(origen), origen, destino)
        with pytest.raises(Exception):
            await registro2.leer()
        # Lo importante: el fichero corrupto sigue ahí, intacto.
        assert origen.read_text() == "{ esto no es json"

    @pytest.mark.asyncio
    async def test_restaura_solo_cuando_falta_de_verdad(self, tmp_path):
        destino = tmp_path / "respaldo" / "asignaciones.json"
        registro, _, origen = _montar(tmp_path, destino)
        await registro.guardar(_instancia(epica=1))
        # Ahora el destino tiene otra versión, más nueva.
        destino.write_text(json.dumps({"version": 1, "perfiles": {}, "asignaciones": [
            {"epica": 99, "persona": "g-x", "rol": "qa", "desde": "2026-01-01"}
        ]}))
        await registro.leer()
        # La copia NO ha pisado el registro: quien manda es el registro.
        assert json.loads(origen.read_text())["asignaciones"][0]["epica"] == 1
