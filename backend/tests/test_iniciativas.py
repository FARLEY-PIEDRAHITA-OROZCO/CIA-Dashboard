"""Pruebas del servicio de gestión de carpetas de iniciativas."""

import json
import os
from pathlib import Path

import pytest

from app.application.iniciativas import (
    SUBCARPETAS,
    ServicioIniciativas,
)


@pytest.fixture
def servicio(tmp_path):
    """Servicio con registro temporal."""
    ruta = tmp_path / "iniciativas.json"
    return ServicioIniciativas(str(ruta))


@pytest.fixture
def ruta_base(tmp_path):
    """Ruta base temporal."""
    ruta = tmp_path / "Iniciativas"
    ruta.mkdir()
    return ruta


class TestEstadoRuta:
    def test_ruta_vacia_no_existe(self, servicio):
        estado = servicio.estado_ruta()
        assert estado.existe is False
        assert estado.escribible is False

    def test_ruta_valida(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        estado = servicio.estado_ruta()
        assert estado.existe is True
        assert estado.escribible is True

    def test_ruta_no_existente(self, servicio, tmp_path):
        servicio.actualizar_ruta(str(tmp_path / "no_existe"))
        estado = servicio.estado_ruta()
        assert estado.existe is False


class TestCrearEstructura:
    def test_crea_estructura_completa(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        iniciativa = servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        assert iniciativa.numero == "001"
        assert iniciativa.epica_id == 5586
        assert Path(iniciativa.ruta).exists()

        # Verificar subcarpetas
        for subcarpeta in SUBCARPETAS:
            assert (Path(iniciativa.ruta) / subcarpeta).exists()

    def test_numero_incremental(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        i1 = servicio.crear_estructura(5586, "Epic- IA Mundial Express")
        i2 = servicio.crear_estructura(5587, "Epic- Banca Digital")

        assert i1.numero == "001"
        assert i2.numero == "002"

    def test_no_duplica(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        i1 = servicio.crear_estructura(5586, "Epic- IA Mundial Express")
        i2 = servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        assert i1.numero == i2.numero

    def test_ruta_no_existente_error(self, servicio, tmp_path):
        servicio.actualizar_ruta(str(tmp_path / "no_existe"))
        with pytest.raises(FileNotFoundError):
            servicio.crear_estructura(5586, "Epic- IA Mundial Express")


class TestEliminarEstructura:
    def test_elimina_carpeta_y_registro(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        iniciativa = servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        assert servicio.eliminar_estructura(5586) is True
        assert not Path(iniciativa.ruta).exists()
        assert servicio.obtener_iniciativa(5586) is None

    def test_eliminar_inexistente(self, servicio):
        assert servicio.eliminar_estructura(9999) is False


class TestArchivos:
    def test_listar_archivos_vacio(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        archivos = servicio.listar_archivos(5586, "Documentos")
        assert archivos == []

    def test_subir_y_listar_archivo(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        servicio.subir_archivo(5586, "Documentos", "test.txt", b"contenido")
        archivos = servicio.listar_archivos(5586, "Documentos")

        assert len(archivos) == 1
        assert archivos[0]["nombre"] == "test.txt"
        assert archivos[0]["tamano"] == 9

    def test_eliminar_archivo(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        servicio.crear_estructura(5586, "Epic- IA Mundial Express")
        servicio.subir_archivo(5586, "Documentos", "test.txt", b"contenido")

        assert servicio.eliminar_archivo(5586, "Documentos", "test.txt") is True
        assert servicio.listar_archivos(5586, "Documentos") == []

    def test_carpeta_no_valida(self, servicio, ruta_base):
        servicio.actualizar_ruta(str(ruta_base))
        servicio.crear_estructura(5586, "Epic- IA Mundial Express")

        with pytest.raises(ValueError):
            servicio.listar_archivos(5586, "NoValido")


class TestRegistroPersistente:
    def test_persiste_entre_instancias(self, tmp_path, ruta_base):
        ruta = tmp_path / "iniciativas.json"

        s1 = ServicioIniciativas(str(ruta))
        s1.actualizar_ruta(str(ruta_base))
        s1.crear_estructura(5586, "Epic- IA Mundial Express")

        s2 = ServicioIniciativas(str(ruta))
        assert s2.obtener_iniciativa(5586) is not None
