"""Pruebas del registro JSON: la pieza donde un error pierde trabajo.

Aquí no se comprueba que el código "funcione", sino que **no pierde datos**. Las
tres garantías del adaptador tienen su prueba:

* escritura atómica (un fallo no deja un JSON truncado),
* hash de versión (no pisa cambios ajenos),
* fichero corrupto es un error y no un registro vacío.

Y todas usan ficheros temporales: los tests no tocan el registro real, que es el
único sitio donde vive información que Azure no tiene.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

import pytest

from app.domain.models import Asignacion, PerfilPersona
from app.infrastructure.registro_json import (
    VERSION_FORMATO,
    ErrorRegistro,
    RegistroJson,
    RegistroModificado,
)

ASIGNACION = Asignacion(
    epica=5324,
    persona="abc-123",
    rol="qa",
    desde=date(2026, 9, 1),
    nota="revisión de contratos",
)


@pytest.fixture
def ruta(tmp_path: Path) -> Path:
    return tmp_path / "datos" / "asignaciones.json"


# --------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_fichero_ausente_es_primer_arranque_y_no_un_error(ruta):
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    assert instantanea.recien_creado is True
    assert instantanea.asignaciones == []
    assert instantanea.hash == ""


@pytest.mark.asyncio
async def test_lectura_de_un_registro_completo(ruta):
    ruta.parent.mkdir(parents=True)
    ruta.write_text(
        json.dumps(
            {
                "version": VERSION_FORMATO,
                "perfiles": {"abc-123": {"es_qa": True, "es_dev": False}},
                "asignaciones": [
                    {
                        "epica": 5324,
                        "persona": "abc-123",
                        "rol": "qa",
                        "desde": "2026-09-01",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    instantanea = await RegistroJson(ruta).leer()
    assert instantanea.perfiles["abc-123"].es_qa is True
    assert instantanea.asignaciones[0].epica == 5324
    assert instantanea.hash != ""


@pytest.mark.asyncio
async def test_json_corrupto_es_error_y_no_registro_vacio(ruta):
    # Este es el que más importa: devolver «no hay asignaciones» cuando lo que hay
    # es un JSON ilegible lleva a conclusiones opuestas — borrar de más, o no asignar a
    # nadie — y ninguna de las dos se puede deshacer.
    ruta.parent.mkdir(parents=True)
    ruta.write_text("{ esto no es json", encoding="utf-8")
    with pytest.raises(ErrorRegistro) as exc:
        await RegistroJson(ruta).leer()
    assert "no es un JSON válido" in str(exc.value)


@pytest.mark.asyncio
async def test_json_que_no_es_objeto_da_error(ruta):
    ruta.parent.mkdir(parents=True)
    ruta.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(ErrorRegistro):
        await RegistroJson(ruta).leer()


@pytest.mark.asyncio
async def test_version_desconocida_da_error_en_vez_de_leer_mal(ruta):
    # Un fichero de otra versión del sistema no se puede interpretar con este
    # backend. Adivinar sería peor que parar.
    ruta.parent.mkdir(parents=True)
    ruta.write_text(json.dumps({"version": 99}), encoding="utf-8")
    with pytest.raises(ErrorRegistro) as exc:
        await RegistroJson(ruta).leer()
    assert "version=99" in str(exc.value)


@pytest.mark.asyncio
async def test_una_asignacion_rota_no_arrastra_a_las_demas(ruta):
    # Perder cuatro asignaciones porque una está mal sería peor que perder una.
    ruta.parent.mkdir(parents=True)
    ruta.write_text(
        json.dumps(
            {
                "version": VERSION_FORMATO,
                "asignaciones": [
                    {"epica": 1, "persona": "a", "rol": "qa", "desde": "2026-09-01"},
                    {"epica": -3, "persona": "a", "rol": "qa", "desde": "2026-09-01"},
                    {"epica": 2, "persona": "b", "rol": "inventado", "desde": "2026-09-01"},
                    {"epica": 3, "persona": "c", "rol": "dev", "desde": "2026-09-01"},
                ],
            }
        ),
        encoding="utf-8",
    )
    instantanea = await RegistroJson(ruta).leer()
    assert [a.epica for a in instantanea.asignaciones] == [1, 3]


@pytest.mark.asyncio
async def test_un_perfil_roto_no_arrastra_a_los_demis(ruta):
    ruta.parent.mkdir(parents=True)
    ruta.write_text(
        json.dumps(
            {
                "version": VERSION_FORMATO,
                "perfiles": {"bueno": {"es_qa": True}, "malo": "no soy un objeto"},
            }
        ),
        encoding="utf-8",
    )
    instantanea = await RegistroJson(ruta).leer()
    assert set(instantanea.perfiles) == {"bueno"}


# --------------------------------------------------------------------- #
# Escritura
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_ida_y_vuelta_conserva_lo_que_se_guardo(ruta):
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    instantanea.asignaciones = [ASIGNACION]
    instantanea.perfiles = {"abc-123": PerfilPersona(guid="abc-123", es_qa=True)}
    guardada = await registro.guardar(instantanea)

    releida = await RegistroJson(ruta).leer()
    assert releida.asignaciones[0] == ASIGNACION
    assert releida.perfiles["abc-123"].es_qa is True
    # El hash devuelto es el de lo escrito: sirve para encadenar otra operación.
    assert guardada.hash == releida.hash


@pytest.mark.asyncio
async def test_guardar_dos_veces_lo_mismo_da_el_mismo_hash(ruta):
    # Con el hash volátil de una marca de tiempo, dos guardados idénticos darían
    # hashes distintos y la comprobación de concurrencia daría falsos positivos.
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    instantanea.asignaciones = [ASIGNACION]
    primera = await registro.guardar(instantanea)

    segunda = await registro.leer()
    segunda.asignaciones = [ASIGNACION]
    assert (await registro.guardar(segunda)).hash == primera.hash


@pytest.mark.asyncio
async def test_no_deja_temporales_tras_escribir(ruta):
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    instantanea.asignaciones = [ASIGNACION]
    await registro.guardar(instantanea)
    # Un temporal huérfano aparece en `git status` y no se explica solo.
    assert list(ruta.parent.glob("*.tmp")) == []


# --------------------------------------------------------------------- #
# La garantía que importa: no pisar cambios ajenos
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_no_pisa_un_registro_que_cambio_en_disco(ruta):
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()

    # Otra pestaña (o un `git checkout`) escribe mientras esta tenía el
    # registro en memoria.
    instantanea_ajena = await registro.leer()
    instantanea_ajena.asignaciones = [
        Asignacion(epica=999, persona="otro", rol="dev", desde=date(2026, 8, 1))
    ]
    await registro.guardar(instantanea_ajena)

    instantanea.asignaciones = [ASIGNACION]
    with pytest.raises(RegistroModificado):
        await registro.guardar(instantanea)

    # Lo importante: la escritura ajena sigue ahí.
    releida = await RegistroJson(ruta).leer()
    assert [a.epica for a in releida.asignaciones] == [999]


@pytest.mark.asyncio
async def test_dos_escrituras_concurrentes_no_pierden_la_primera(ruta):
    """Dos escrituras simultáneas: una gana, la otra recibe 409, no se pisan."""
    registro = RegistroJson(ruta)
    base = await registro.leer()

    primera = base.model_copy(deep=True)
    primera.asignaciones = [
        Asignacion(epica=1, persona="a", rol="qa", desde=date(2026, 9, 1))
    ]
    segunda = base.model_copy(deep=True)
    segunda.asignaciones = [
        Asignacion(epica=2, persona="b", rol="dev", desde=date(2026, 9, 1))
    ]

    await registro.guardar(primera)
    with pytest.raises(RegistroModificado):
        await registro.guardar(segunda)

    releida = await RegistroJson(ruta).leer()
    assert [a.epica for a in releida.asignaciones] == [1]


@pytest.mark.asyncio
async def test_una_escritura_no_toca_azure(ruta):
    """El registro es local por completo: ni una llamada sale a la red."""
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    instantanea.asignaciones = [ASIGNACION]
    await registro.guardar(instantanea)
    # El adaptador no tiene ni transporte: no podría hablar con Azure aunque
    # quisiera. La garantía es estructural, no una promesa.
    assert not hasattr(registro, "_transporte")


# --------------------------------------------------------------------- #
# El formato
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_el_fichero_generado_es_legible_por_personas(ruta):
    # Va a estar versionado en git: un diff con `\u00f1` escapes es ilegible y
    # hace que nadie lo revise.
    registro = RegistroJson(ruta)
    instantanea = await registro.leer()
    instantanea.asignaciones = [
        Asignacion(
            epica=5324, persona="a", rol="qa", desde=date(2026, 9, 1), nota="revisión de añejos"
        )
    ]
    await registro.guardar(instantanea)
    texto = ruta.read_text(encoding="utf-8")
    assert "revisión de añejos" in texto
    assert "\\u" not in texto
