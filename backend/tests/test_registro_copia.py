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
from tests.conftest import FakeRepositorio


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

    def test_destino_configurado_sin_escribir_nada_no_es_copia_activa(self, tmp_path):
        """Carpeta de destino INEXISTENTE: no se puede escribir, hay que decirlo."""
        destino = tmp_path / "no-existe" / "asignaciones.json"
        registro, _, _ = _montar(tmp_path, destino)
        estado = registro.estado()
        assert estado["copia_configurada"] is True
        assert estado["copia_activa"] is False
        assert estado["ultima_copia"] == ""
        assert "no existe" in estado["aviso"]

    def test_arranque_en_fresco_con_carpeta_valida_no_pinta_alarma_falsa(self, tmp_path):
        """El caso que un proceso recién arrancado produce siempre.

        `ultima_copia` vive en memoria, así que en el primer arranque está vacío.
        Si `copia_activa` exigiera una copia escrita, el panel se pondría en rojo
        diciendo que el respaldo no funciona con un aviso vacío: una alarma falsa
        que entrena a ignorar las alarmas. Con la carpeta ahí, el destino está
        disponible y eso es lo que se informa.
        """
        destino = tmp_path / "respaldo" / "asignaciones.json"
        destino.parent.mkdir(parents=True)
        registro, _, _ = _montar(tmp_path, destino)

        estado = registro.estado()
        assert estado["copia_configurada"] is True
        assert estado["copia_activa"] is True, "la carpeta existe: el destino está disponible"
        assert estado["aviso"] == "", "una alarma sin explicación es peor que ninguna"
        assert estado["ultima_copia"] == "", "pero sí se dice que aún no se ha copiado"

    def test_sin_destino_no_da_alarma_roja_pero_sí_aviso(self, tmp_path):
        """Sin destino no hay respaldo, y eso es un riesgo que hay que nombrar."""
        registro, _, _ = _montar(tmp_path, None)
        estado = registro.estado()
        assert estado["copia_activa"] is False
        assert estado["aviso"] != ""


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


# ---------------------------------------------------------------------- #
# El endpoint que impide que la UI vuelva a mentir
# ---------------------------------------------------------------------- #
class TestEndpointEstado:
    """`GET /api/qa/registro` existe para una sola cosa: que el frontend no diga
    «haz git commit» cuando el registro ya no está en git.

    Un aviso que miente es peor que ningún aviso, porque el usuario actúa sobre
    él: si la pantalla dice que el dato está respaldado y no lo está, nadie va a
    mirar más ese panel.
    """

    def _cliente(self):
        from fastapi.testclient import TestClient

        from app.main import crear_app
        from tests.conftest import contenedor_con

        return TestClient(crear_app(contenedor_con(FakeRepositorio())))

    def test_sin_copia_avisa_con_el_riesgo_real(self):
        r = self._cliente().get("/api/qa/registro")
        assert r.status_code == 200
        datos = r.json()
        assert datos["copia_configurada"] is False
        assert datos["copia_activa"] is False
        # El aviso tiene que nombrar la consecuencia, no solo la ausencia.
        assert "se pierde" in datos["aviso"]
        assert datos["ruta"].endswith("asignaciones.json")

    def test_no_afirma_respaldo_si_no_esta_configurado(self):
        """Con el destino vacío, `copia_activa: true` sería la forma más
        elegante de seguir mintiendo."""
        datos = self._cliente().get("/api/qa/registro").json()
        assert datos["copia_activa"] is False
        assert datos["copia_ruta"] == ""
        assert datos["ultima_copia"] == ""

    def test_no_toca_azure_ni_el_registro(self):
        """Es solo estado de almacenamiento: no lee asignaciones ni llama a nada."""
        repo = FakeRepositorio()

        from fastapi.testclient import TestClient

        from app.main import crear_app
        from tests.conftest import contenedor_con

        cliente = TestClient(crear_app(contenedor_con(repo)))
        cliente.get("/api/qa/registro")
        assert repo.llamadas_indice == 0
        assert repo.llamadas_indice_pruebas == 0
        assert repo.llamadas_historial == []


# ---------------------------------------------------------------------- #
# La trampa de las comillas dobles en el .env
# ---------------------------------------------------------------------- #
class TestRutaConCaracteresDeControl:
    """Descubierto usándolo, no pensándolo.

    Con comillas dobles en el `.env`, python-dotenv interpreta escapes de Python:
    `C:\\Users\\frlpi\\...` llega como `C:\\Users` + 0x0C + `rlpi\\...`, y `\\a` se
    come la letra. La ruta resultante **no puede existir jamás**, así que sin un
    chequeo la aplicación avisaría eternamente de «la carpeta no existe» sin
    decir por qué. Es un fallo invisible salvo que seorgescribas los caracteres.

    `\f`, `\a`, `\t`, `\r`, `\n`, `\b`, `\v` son las secuencias que lo disparan, y
    ninguna es exótica: `formularios`, `artefactos`, `tablas`, `riesgos`,
    `nuevo`, `base`, `varios`.
    """

    def _settings(self, valor: str):
        from pydantic import ValidationError

        from app.config import Settings

        with pytest.raises(ValidationError) as exc:
            Settings(_env_file=None, registro_copia_ruta=valor)
        return str(exc.value)

    def test_rechaza_el_salto_de_formulario(self):
        error = self._settings("C:\\Users\x0crlpi\\asig.json")
        assert "caracteres de control" in error
        # El mensaje tiene que NOMBRAR la causa, no solo el síntoma.
        assert "SIMPLES" in error
        assert "DOBLES" in error

    def test_rechaza_todas_las_secuencias_de_escape_de_python(self):
        # `\a` (artefactos), `\t` (tablas), `\r` (riesgos), `\n` (nuevo),
        # `\b` (base), `\v` (varios): ninguna es exótica.
        for etiqueta, caracter in (
            ("pitido", "\x07"),
            ("tabulador", "\x09"),
            ("nueva linea", "\x0a"),
            ("retorno", "\x0d"),
            ("retroceso", "\x08"),
            ("vertical", "\x0b"),
        ):
            error = self._settings(f"C:\\ruta{caracter}x\\asig.json")
            assert "caracteres de control" in error, etiqueta

    def test_la_cadena_entera_falla_con_comillas_dobles_y_pasa_con_simples(self):
        """La prueba de verdad: el `.env` real, no el valor ya parseado.

        Al pasar la ruta por código no hay escapes, así que una prueba que solo
        llame a `Settings(...)` no reproduce el fallo. Hay que pasar por el
        parseador de `.env` para ver cómo `\f` se convierte en 0x0C.
        """
        import io

        import dotenv
        from pydantic import ValidationError

        from app.config import Settings

        ruta = "C:\\Users\\frlpi\\OneDrive\\asig.json"
        con_dobles = f'REGISTRO_COPIA_RUTA="{ruta}"\n'
        con_simples = f"REGISTRO_COPIA_RUTA='{ruta}'\n"

        # Con dobles: el parser destroza la ruta y la validación la rechaza
        # nombrando la causa, en vez de avisar eternamente de «no existe».
        destrozada = dotenv.dotenv_values(stream=io.StringIO(con_dobles))[
            "REGISTRO_COPIA_RUTA"
        ]
        assert any(ord(c) < 32 for c in destrozada), "el fixture no reproduce el fallo"
        with pytest.raises(ValidationError) as exc:
            Settings(_env_file=None, registro_copia_ruta=destrozada)
        assert "SIMPLES" in str(exc.value)

        # Con simples: intacta.
        intacta = dotenv.dotenv_values(stream=io.StringIO(con_simples))["REGISTRO_COPIA_RUTA"]
        assert intacta == ruta
        assert Settings(_env_file=None, registro_copia_ruta=intacta).registro_copia_ruta == ruta

    def test_una_ruta_limpia_pasa(self):
        from app.config import Settings

        s = Settings(_env_file=None, registro_copia_ruta="C:\\ruta\\normal\\asig.json")
        assert s.registro_copia_ruta == "C:\\ruta\\normal\\asig.json"

    def test_una_ruta_con_espacios_y_guiones_pasa(self):
        # El caso real: «OneDrive - Mundial de Seguros S.A» lleva espacio y punto.
        from app.config import Settings

        cruda = "C:\\Users\\frlpi\\OneDrive - Mundial de Seguros S.A\\1. Iniciativas Azure\\x.json"
        s = Settings(_env_file=None, registro_copia_ruta=cruda)
        assert s.registro_copia_ruta == cruda

    def test_vacia_se_queda_vacia(self):
        from app.config import Settings

        assert Settings(_env_file=None, registro_copia_ruta="").registro_copia_ruta == ""
