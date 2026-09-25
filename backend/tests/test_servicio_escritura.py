"""Pruebas del servicio de escritura: flag, caché dirigida y traducción de errores.

Ninguna prueba contacta Azure: se usa un doble de ``EscrituraBacklogPort``.
"""

import pytest

from app.application.services import EscrituraNoHabilitadaError, ServicioBacklog
from app.domain.models import ActualizacionQA, Epic, ResultadoActualizacion
from app.infrastructure.azure.escritura import ErrorValidacionEscritura
from app.infrastructure.azure.transport import AzureError
from app.infrastructure.cache import CacheMemoria

from .conftest import FakeRepositorio

ORG = "https://dev.azure.com/organizacion-ejemplo"
PROY = "Proyecto de ejemplo"


class EscrituraFalsa:
    """Doble del adaptador de escritura que registra las llamadas."""

    def __init__(self, rev: int = 5, error: Exception | None = None) -> None:
        self.rev = rev
        self.error = error
        self.llamadas: list[tuple[int, list[str], bool, int | None]] = []
        self.revisiones: list[int] = []

    async def actualizar_work_item(
        self,
        work_item_id: int,
        cambios: ActualizacionQA,
        *,
        validar: bool = False,
        rev_esperada: int | None = None,
    ) -> ResultadoActualizacion:
        campos = cambios.campos_modificados()
        self.llamadas.append((work_item_id, campos, validar, rev_esperada))
        if self.error is not None:
            raise self.error
        return ResultadoActualizacion(
            work_item_id=work_item_id,
            rev=self.rev,
            campos=campos,
            validado=validar,
        )

    async def obtener_revision(self, work_item_id: int) -> int:
        self.revisiones.append(work_item_id)
        return self.rev


def servicio_con(escritura: EscrituraFalsa | None, cache: CacheMemoria | None = None):
    return ServicioBacklog(
        FakeRepositorio(),
        cache or CacheMemoria(),
        escritura=escritura,
        escritura_habilitada=escritura is not None,
        configuracion=True,
        organizacion=ORG,
        proyecto=PROY,
    )


# --------------------------------------------------------------------- #
# Flag de habilitación
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_escritura_deshabilitada_rechaza_la_operacion():
    servicio = servicio_con(None)

    with pytest.raises(EscrituraNoHabilitadaError):
        await servicio.actualizar_work_item(1, ActualizacionQA(estado="Active"))

    assert servicio.escritura_habilitada is False


@pytest.mark.asyncio
async def test_bandera_requiere_adaptador_real():
    """Un flag True sin adaptador sigue dejando el sistema en solo lectura."""
    servicio = ServicioBacklog(
        FakeRepositorio(), CacheMemoria(), escritura=None, escritura_habilitada=True
    )
    assert servicio.escritura_habilitada is False
    with pytest.raises(EscrituraNoHabilitadaError):
        await servicio.actualizar_work_item(1, ActualizacionQA(estado="Active"))


@pytest.mark.asyncio
async def test_bandera_sin_adaptador_no_pasa_por_el_adaptador():
    escritura = EscrituraFalsa()
    servicio = ServicioBacklog(
        FakeRepositorio(), CacheMemoria(), escritura=escritura, escritura_habilitada=False
    )
    with pytest.raises(EscrituraNoHabilitadaError):
        await servicio.actualizar_work_item(1, ActualizacionQA(estado="Active"))
    assert not escritura.llamadas


# --------------------------------------------------------------------- #
# Delegación
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_delega_los_cambios_al_adaptador():
    escritura = EscrituraFalsa()
    servicio = servicio_con(escritura)

    resultado = await servicio.actualizar_work_item(
        42, ActualizacionQA(estado="Verificado", tags="qa")
    )

    assert escritura.llamadas == [(42, ["estado", "tags"], False, None)]
    assert resultado.work_item_id == 42
    assert resultado.campos == ["estado", "tags"]


@pytest.mark.asyncio
async def test_traslada_validar_y_rev_esperada():
    escritura = EscrituraFalsa()
    servicio = servicio_con(escritura)

    await servicio.actualizar_work_item(
        7, ActualizacionQA(estado="New"), validar=True, rev_esperada=4
    )

    assert escritura.llamadas[0][2] is True
    assert escritura.llamadas[0][3] == 4


@pytest.mark.asyncio
async def test_revision_delega_al_adaptador():
    escritura = EscrituraFalsa(rev=11)
    servicio = servicio_con(escritura)

    assert await servicio.revision_work_item(3) == 11
    assert escritura.revisiones == [3]


@pytest.mark.asyncio
async def test_revision_deshabilitada_falla():
    servicio = servicio_con(None)
    with pytest.raises(EscrituraNoHabilitadaError):
        await servicio.revision_work_item(1)


# --------------------------------------------------------------------- #
# Errores
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_error_de_azure_se_propaga_con_detalle_de_regla():
    error = AzureError("Azure respondió HTTP 400.", 400, detalle="Regla TF401321: transición no válida")
    servicio = servicio_con(EscrituraFalsa(error=error))

    with pytest.raises(AzureError) as exc:
        await servicio.actualizar_work_item(1, ActualizacionQA(estado="Verificado"))

    assert "TF401321" in exc.value.detalle


@pytest.mark.asyncio
async def test_error_de_validacion_local_se_propaga():
    servicio = servicio_con(EscrituraFalsa(error=ErrorValidacionEscritura("tags con ';'")))
    with pytest.raises(ErrorValidacionEscritura):
        await servicio.actualizar_work_item(1, ActualizacionQA(tags="a;b"))


# --------------------------------------------------------------------- #
# Caché dirigida
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_escritura_invalida_solo_las_claves_afectadas():
    cache = CacheMemoria()
    servicio = servicio_con(EscrituraFalsa(), cache)

    epicas = [Epic(azure_id=1, titulo="A")]
    otra = [Epic(azure_id=2, titulo="B")]
    cache.guardar("epicas", epicas, 120)
    cache.guardar("epica:5", Epic(azure_id=5), 120)
    cache.guardar("epica:5:bugs", Epic(azure_id=5), 120)
    cache.guardar("epica:9", otra[0], 120)

    await servicio.actualizar_work_item(5, ActualizacionQA(estado="New"))

    # El elemento editado y la lista de épicas se releen de Azure...
    assert cache.obtener("epica:5") is None
    assert cache.obtener("epica:5:bugs") is None
    assert cache.obtener("epicas") is None
    # ...pero otra épica sigue cacheada (invalidación dirigida, no total).
    assert cache.obtener("epica:9") is otra[0]


@pytest.mark.asyncio
async def test_validar_no_invalida_la_cache():
    cache = CacheMemoria()
    servicio = servicio_con(EscrituraFalsa(), cache)
    epica = Epic(azure_id=5)
    cache.guardar("epica:5", epica, 120)

    await servicio.actualizar_work_item(5, ActualizacionQA(estado="New"), validar=True)

    # Un dry-run no escribe nada, así que la caché sigue válida.
    assert cache.obtener("epica:5") is epica
