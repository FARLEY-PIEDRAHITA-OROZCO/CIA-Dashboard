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
