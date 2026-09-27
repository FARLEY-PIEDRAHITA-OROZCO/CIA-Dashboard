"""Pruebas de la lista blanca de escritura **por tipo** (Fase 5).

La tabla `CAMPOS_POR_TIPO` se midió contra el proyecto real: `Test Plan` y
`Test Suite` no tienen tags, descripción ni prioridad. Y se comprobó con
`validateOnly` que **Azure deja escribir esos campos igual**: comprueba el valor,
no la existencia del campo en el tipo. Así que la lista blanca no es un
esquema del adaptador, es la única barrera contra crear campos huérfanos.
"""

import pytest

from app.domain.models import CAMPOS_POR_TIPO, campos_admitidos
from app.infrastructure.azure.escritura import (
    ErrorValidacionEscritura,
    comprobar_tipo,
)
from tests.test_escritura import TransporteEscritura

from app.infrastructure.azure.escritura import AzureEscrituraRepositorio

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"


def repo(tipo: str, **kwargs) -> tuple[AzureEscrituraRepositorio, TransporteEscritura]:
    transporte = TransporteEscritura(tipo=tipo, **kwargs)
    return AzureEscrituraRepositorio(ORG, PROY, transporte), transporte  # type: ignore[arg-type]


# --------------------------------------------------------------------- #
# La tabla
# --------------------------------------------------------------------- #
def test_plan_y_suite_solo_admiten_estado():
    # Medido: 0 de 44 planes y 0 de 457 suites tienen Tags, Description o
    # Priority, y los campos ni siquiera aparecen en la respuesta de Azure.
    assert campos_admitidos("Test Plan") == frozenset({"estado"})
    assert campos_admitidos("Test Suite") == frozenset({"estado"})


def test_el_caso_si_admite_prioridad_y_tags():
    assert campos_admitidos("Test Case") == frozenset(
        {"estado", "prioridad", "tags", "notas_qa"}
    )


def test_la_severidad_solo_existe_en_bug():
    # 143 de 143 bugs la tienen; 0 de 3 issues y 0 de 3.431 casos.
    assert "severidad" in campos_admitidos("Bug")
    for tipo in ("User Story", "Task", "Test Plan", "Test Suite", "Test Case"):
        assert "severidad" not in campos_admitidos(tipo), tipo


def test_epic_y_feature_siguen_excluidos():
    """ADR-11 los excluye. Antes solo lo cumplía la UI; ahora lo cumple el backend."""
    for tipo in ("Epic", "Feature", "Issue", "Desconocido", ""):
        assert campos_admitidos(tipo) == frozenset(), tipo


def test_la_tabla_es_la_unica_fuente_de_los_tipos_editables():
    # Si alguien añade un tipo a otra lista, esta prueba avisa: la tabla es la
    # que aplica la comprobación.
    assert set(CAMPOS_POR_TIPO) == {"Bug", "User Story", "Task", "Test Plan", "Test Suite", "Test Case"}


# --------------------------------------------------------------------- #
# La comprobación
# --------------------------------------------------------------------- #
def test_rechaza_un_tipo_no_editable():
    with pytest.raises(ErrorValidacionEscritura) as exc:
        comprobar_tipo("Epic", ["estado"])
    assert "no es editable" in str(exc.value)
    # El mensaje lista los editables: si no, solo dice que no.
    assert "Test Case" in str(exc.value)


def test_rechaza_tags_en_un_plan_con_un_mensaje_que_explica():
    # Es el caso que más sorprende: el tipo sí está en la lista de editables.
    with pytest.raises(ErrorValidacionEscritura) as exc:
        comprobar_tipo("Test Plan", ["tags"])
    mensaje = str(exc.value)
    assert "solo tiene estado editable" in mensaje
    assert "tags" in mensaje


def test_un_plan_acepta_su_estado():
    comprobar_tipo("Test Plan", ["estado"])  # no lanza


def test_lista_los_campos_que_sobran():
    with pytest.raises(ErrorValidacionEscritura) as exc:
        comprobar_tipo("Test Suite", ["estado", "notas_qa", "tags"])
    mensaje = str(exc.value)
    assert "notas_qa" in mensaje and "tags" in mensaje
    assert "estado" not in mensaje.split("Quita:")[1]


# --------------------------------------------------------------------- #
# El adaptador: la comprobación ocurre antes de la red
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_el_adaptador_rechaza_antes_de_construir_el_patch():
    from app.domain.models import ActualizacionQA

    r, transporte = repo("Test Plan")
    with pytest.raises(ErrorValidacionEscritura):
        await r.actualizar_work_item(1, ActualizacionQA(tags="verificado-qa"))
    # Ni un PATCH: el rechazo es local, como el resto de validaciones.
    assert transporte.patches == []


@pytest.mark.asyncio
async def test_el_adaptutor_permite_el_estado_de_un_plan():
    from app.domain.models import ActualizacionQA

    r, transporte = repo("Test Plan")
    resultado = await r.actualizar_work_item(1, ActualizacionQA(estado="Active"))
    assert resultado.campos == ["estado"]
    assert len(transporte.patches) == 1
    # Se pidió el tipo real al backend, no se confió en el cliente.
    assert any("System.WorkItemType" in u for u in transporte.gets)


@pytest.mark.asyncio
async def test_el_adaptador_permite_todos_los_campos_de_un_caso():
    from app.domain.models import ActualizacionQA

    r, transporte = repo("Test Case")
    await r.actualizar_work_item(
        1, ActualizacionQA(estado="Ready", prioridad="1", tags="verificado-qa", notas_qa="ok")
    )
    rutas = {op["path"] for op in transporte.patches[0][1]}
    assert "/fields/System.State" in rutas
    assert "/fields/Microsoft.VSTS.Common.Priority" in rutas
    assert "/fields/System.Tags" in rutas
    assert "/fields/System.Description" in rutas


@pytest.mark.asyncio
async def test_la_prioridad_del_caso_usa_el_mismo_campo_que_la_del_bug():
    """No hace falta mapear: los dos usan `Microsoft.VSTS.Common.Priority`.

    Se comprueba porque el riesgo real es inventar un segundo nombre de campo
    para los test items y acabar escribiendo en el equivocado.
    """
    from app.domain.models import ActualizacionQA

    r, _ = repo("Test Case")
    patch = await r._json_patch(1, ActualizacionQA(prioridad="1"), rev_esperada=1)
    assert patch[0]["path"] == "/fields/Microsoft.VSTS.Common.Priority"
