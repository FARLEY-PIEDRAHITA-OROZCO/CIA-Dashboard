"""Pruebas del adaptador de escritura QA y de sus validaciones locales.

Ninguna prueba toca Azure: el transporte fake registra las llamadas y el test
verifica el JSON Patch exacto que se habría enviado.
"""

import pytest

from app.domain.models import ActualizacionQA
from app.infrastructure.azure.escritura import (
    MAX_NOTAS_QA,
    AzureEscrituraRepositorio,
    ErrorValidacionEscritura,
    construir_bloque_notas,
)

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"


class TransporteEscritura:
    """Fake que registra PATCH y devuelve un work item de Azure."""

    def __init__(self, rev: int = 3, descripcion: str = "", campos: dict | None = None) -> None:
        self.rev = rev
        self.descripcion = descripcion
        self.campos = campos or {}
        self.patches: list[tuple[str, object, bool]] = []
        self.gets: list[str] = []
        self.error: Exception | None = None

    async def get(self, url: str, params=None) -> dict:
        self.gets.append(url)
        if "System.Description" in url:
            return {"id": 1, "rev": self.rev, "fields": {"System.Description": self.descripcion}}
        return {"id": 1, "rev": self.rev, "fields": dict(self.campos)}

    async def post(self, url: str, body=None) -> dict:
        return {}

    async def patch(self, url: str, body=None, *, content_type: str = "application/json-patch+json") -> dict:
        validar = "validateOnly=true" in url
        self.patches.append((url, body, validar))
        if self.error is not None:
            raise self.error
        return {"id": 1, "rev": self.rev + (0 if validar else 1), "fields": {}}

    async def cerrar(self) -> None:
        return None


def fabricar(descripcion: str = "", rev: int = 3):
    transporte = TransporteEscritura(rev=rev, descripcion=descripcion)
    return AzureEscrituraRepositorio(ORG, PROY, transporte), transporte  # type: ignore[arg-type]


# --------------------------------------------------------------------- #
# Lista blanca
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_solo_genera_operaciones_de_campos_permitidos():
    repo, transporte = fabricar()
    cambios = ActualizacionQA(estado="Active", prioridad="1", severidad="Critical", tags="qa")

    await repo.actualizar_work_item(1, cambios)

    generadas = [op["path"] for op in transporte.patches[0][1]]
    assert generadas == [
        "/fields/System.State",
        "/fields/Microsoft.VSTS.Common.Priority",
        "/fields/Microsoft.VSTS.Common.Severity",
        "/fields/System.Tags",
    ]


@pytest.mark.asyncio
async def test_modelo_rechaza_actualizacion_vacia():
    with pytest.raises(ValueError):
        ActualizacionQA()


def test_campos_modificados_reporta_solo_lo_presente():
    cambios = ActualizacionQA(estado="Active")
    assert cambios.campos_modificados() == ["estado"]


# --------------------------------------------------------------------- #
# Etiqueta de la petición
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_usa_patch_y_api_version_correcta():
    repo, transporte = fabricar()

    await repo.actualizar_work_item(7, ActualizacionQA(estado="Closed"))

    url = transporte.patches[0][0]
    assert "_apis/wit/workitems/7" in url
    assert "api-version=7.1" in url
    assert "validateOnly" not in url


@pytest.mark.asyncio
async def test_validar_marca_validate_only_sin_escribir():
    repo, transporte = fabricar()

    resultado = await repo.actualizar_work_item(7, ActualizacionQA(estado="Closed"), validar=True)

    assert "validateOnly=true" in transporte.patches[0][0]
    assert resultado.validado is True
    assert resultado.detalle


# --------------------------------------------------------------------- #
# Notas QA: append-only y escapado
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_notas_qa_conservan_descripcion_previa():
    previo = "<div>Descripcion original con <b>negrita</b></div>"
    repo, transporte = fabricar(descripcion=previo)

    await repo.actualizar_work_item(1, ActualizacionQA(notas_qa="Reproducido en Chrome"))

    op = next(o for o in transporte.patches[0][1] if o["path"] == "/fields/System.Description")
    assert op["value"].startswith(previo)
    assert "Reproducido en Chrome" in op["value"]


@pytest.mark.asyncio
async def test_notas_qa_escapan_markup_del_usuario():
    repo, transporte = fabricar()

    await repo.actualizar_work_item(1, ActualizacionQA(notas_qa="<script>alert(1)</script>"))

    op = next(o for o in transporte.patches[0][1] if o["path"] == "/fields/System.Description")
    assert "<script>" not in op["value"]
    assert "&lt;script&gt;" in op["value"]


def test_bloque_notas_marca_y_trunca():
    bloque = construir_bloque_notas("x" * (MAX_NOTAS_QA + 100), rev=7)
    assert "Notas de QA" in bloque
    assert "…" in bloque


@pytest.mark.asyncio
async def test_notas_vacias_se_rechazan_localmente():
    repo, transporte = fabricar()

    with pytest.raises(ErrorValidacionEscritura):
        await repo.actualizar_work_item(1, ActualizacionQA(notas_qa="   "))
    assert not transporte.patches


# --------------------------------------------------------------------- #
# Tags
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_tags_se_normalizan_y_deduplican():
    repo, transporte = fabricar()

    await repo.actualizar_work_item(1, ActualizacionQA(tags="qa, Verificado-QA ,qa"))

    op = next(o for o in transporte.patches[0][1] if o["path"] == "/fields/System.Tags")
    # "qa" y "Verificado-QA" son tags distintos; el duplicado exacto se elimina.
    assert op["value"] == "qa, Verificado-QA"


@pytest.mark.asyncio
async def test_tags_rechazan_separador_de_azure():
    repo, transporte = fabricar()

    with pytest.raises(ErrorValidacionEscritura):
        await repo.actualizar_work_item(1, ActualizacionQA(tags="a;b"))
    assert not transporte.patches


@pytest.mark.asyncio
async def test_tags_rechazan_asterisco_jerarquico():
    repo, transporte = fabricar()

    with pytest.raises(ErrorValidacionEscritura):
        await repo.actualizar_work_item(1, ActualizacionQA(tags="padre*"))
    assert not transporte.patches


# --------------------------------------------------------------------- #
# Concurrencia
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_revision_esperada_desfasada_aborta_sin_escribir():
    repo, transporte = fabricar(rev=9)

    with pytest.raises(ErrorValidacionEscritura) as exc:
        await repo.actualizar_work_item(1, ActualizacionQA(estado="New"), rev_esperada=4)

    assert "cambió" in str(exc.value)
    assert not transporte.patches


@pytest.mark.asyncio
async def test_revision_coincidente_permite_escribir():
    repo, transporte = fabricar(rev=4)

    await repo.actualizar_work_item(1, ActualizacionQA(estado="New"), rev_esperada=4)

    assert transporte.patches


@pytest.mark.asyncio
async def test_obtener_revision_devuelve_rev():
    repo, _ = fabricar(rev=12)
    assert await repo.obtener_revision(1) == 12


# --------------------------------------------------------------------- #
# Estado
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_estado_vacio_se_rechaza():
    repo, transporte = fabricar()

    with pytest.raises(ErrorValidacionEscritura):
        await repo.actualizar_work_item(1, ActualizacionQA(estado="  "))
    assert not transporte.patches
