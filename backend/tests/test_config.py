"""Pruebas de configuración y validación de entrada."""

import pytest
from pydantic import ValidationError

from app.config import ENV_FILE, Settings


def test_env_file_apunta_a_backend_y_se_puede_anular():
    assert ENV_FILE.name == ".env"
    assert ENV_FILE.parent.name == "backend"

    settings = Settings(
        _env_file=None,
        azure_org_url="https://dev.azure.com/org",
        azure_proyecto="Proyecto de ejemplo",
        azure_pat="secret",
        origen_cors="http://localhost:5173, https://team.example",
    )

    assert settings.configurado is True
    assert settings.area_path_efectivo == "Proyecto de ejemplo"
    assert settings.origenes_cors == ["http://localhost:5173", "https://team.example"]


def test_configuracion_exige_organizacion_proyecto_y_pat():
    settings = Settings(
        _env_file=None,
        azure_org_url="https://dev.azure.com/org",
        azure_proyecto="Proyecto de ejemplo",
    )

    assert settings.configurado is False


def test_organizacion_debe_https():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, azure_org_url="http://dev.azure.com/org")


def test_exposicion_externa_exige_opt_in_explicito():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, host="0.0.0.0")

    settings = Settings(_env_file=None, host="0.0.0.0", permitir_externo=True)
    assert settings.permitir_externo is True


# --------------------------------------------------------------------- #
# Escritura QA (ADR-11)
# --------------------------------------------------------------------- #
def test_escritura_esta_apagada_por_defecto():
    settings = Settings(
        _env_file=None,
        azure_org_url="https://dev.azure.com/org",
        azure_proyecto="Proyecto de ejemplo",
        azure_pat="secret",
        azure_pat_escritura="otro-secreto",
    )

    assert settings.escritura_habilitada is False
    assert settings.configurado_escritura is False


def test_escritura_exige_flag_y_pat_propio():
    comun = {
        "_env_file": None,
        "azure_org_url": "https://dev.azure.com/org",
        "azure_proyecto": "Proyecto de ejemplo",
        "azure_pat": "secret",
        "azure_pat_escritura": "otro-secreto",
    }

    # Flag + PAT: habilitada.
    assert Settings(**comun, escritura_habilitada=True).configurado_escritura is True

    # Solo el flag, sin PAT dedicado: sigue en solo lectura.
    solo_flag = Settings(
        _env_file=None,
        azure_org_url=comun["azure_org_url"],
        azure_proyecto=comun["azure_proyecto"],
        azure_pat="secret",
        escritura_habilitada=True,
    )
    assert solo_flag.configurado_escritura is False

    # PAT dedicado pero sin flag: el sistema es solo lectura.
    sin_flag = Settings(**comun)
    assert sin_flag.configurado_escritura is False


def test_pat_de_escritura_no_se_expone_en_repr():
    settings = Settings(
        _env_file=None,
        azure_org_url="https://dev.azure.com/org",
        azure_proyecto="Proyecto de ejemplo",
        azure_pat="secreto-lectura",
        azure_pat_escritura="secreto-escritura",
        escritura_habilitada=True,
    )

    representacion = repr(settings)
    assert "secreto-lectura" not in representacion
    assert "secreto-escritura" not in representacion


def test_escritura_se_rechaza_fuera_de_loopback():
    """La escritura nunca puede quedar expuesta sin autenticación propia."""
    with pytest.raises(ValidationError) as exc:
        Settings(
            _env_file=None,
            host="0.0.0.0",
            permitir_externo=True,
            azure_org_url="https://dev.azure.com/org",
            azure_proyecto="Proyecto de ejemplo",
            azure_pat="secret",
            azure_pat_escritura="otro-secreto",
            escritura_habilitada=True,
        )

    assert "autenticación" in str(exc.value)
