"""Pruebas del servicio de registro: reglas de negocio, no formato.

El formato lo prueba `test_registro.py`. Aquí se comprueba lo que el servicio
**rechaza** y por qué: un GUID inventado, una fecha futura, un rol que no existe.
Cada rechazo tiene un motivo, y el motivo es la mitad del comportamiento: sin un
mensivo que explique qué hacer, el usuario no sabe si corregir o abandonar.
"""

from datetime import date, timedelta

import pytest

from app.application.registro import (
    AsignacionInvalida,
    ServicioRegistro,
    dias_laborables,
)
from app.domain.models import ItemIndice, ItemPrueba, Persona
from app.domain.ports import RegistroAsignacionesPort
from app.infrastructure.registro_json import RegistroModificado


class Memoria(RegistroAsignacionesPort):
    """Doble en memoria: permite provocar conflictos sin tocar disco."""

    def __init__(self) -> None:
        from app.domain.models import Instantanea

        self.datos = Instantanea()

    async def leer(self):
        return self.datos

    async def guardar(self, instantanea):
        if self.datos.hash != instantanea.hash:
            raise RegistroModificado("cambió")
        self.datos = instantanea
        return instantanea


class RepoPersonas:
    """Personas fijas, sin índice: el servicio solo necesita GUID y nombre."""

    async def personas(self):
        return [
            {"guid": "g-ana", "nombre": "Ana Diaz", "total": 12, "abiertos": 3,
             "bugs": 1, "bugs_abiertos": 0, "verificados": 0},
            {"guid": "g-luis", "nombre": "Luis Ruiz", "total": 4, "abiertos": 4,
             "bugs": 0, "bugs_abiertos": 0, "verificados": 0},
        ]


class PruebasFijas:
    def __init__(self, activos):
        self._activos = activos

    async def todos(self):
        return self._activos


def armar(activos_prueba=()):
    repo = RepoPersonas()
    registro = Memoria()
    servicio = ServicioRegistro(registro, repo, PruebasFijas(list(activos_prueba)))
    return servicio, registro


def caso(id_, guid, titulo="Caso"):
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Case",
        titulo=titulo,
        estado="Design",
        persona=Persona(guid=guid, nombre="X"),
    )


# --------------------------------------------------------------------- #
# Asignar
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_asignar_guarda_y_se_relee():
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa", desde=date(2026, 9, 1))
    assert [a.epica for a in await servicio.asignaciones()] == [5324]
    assert (await servicio.asignaciones())[0].persona == "g-ana"


@pytest.mark.asyncio
async def test_reasignar_no_duplica():
    # La UI reenvía el mismo formulario al cambiar un matiz. Dejar dos filas
    # para la misma épica y la misma persona haría que «cuántas épicas lleva» no
    # cuadrase con la lista.
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa", desde=date(2026, 9, 1))
    await servicio.asignar(5324, "g-ana", "qa", desde=date(2026, 9, 10), nota="ajustado")
    asignaciones = await servicio.asignaciones()
    assert len(asignaciones) == 1
    assert asignaciones[0].desde == date(2026, 9, 10)
    assert asignaciones[0].nota == "ajustado"


@pytest.mark.asyncio
async def test_una_epica_puede_tener_qa_y_dev_a_la_vez():
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa")
    await servicio.asignar(5324, "g-luis", "dev")
    assert {a.rol for a in await servicio.asignaciones(epica=5324)} == {"qa", "dev"}


@pytest.mark.asyncio
async def test_rechaza_un_guid_que_no_existe():
    # Sin esta comprobación, un GUID mal escrito crearía una asignación
    # imposible de ver y de borrar desde la UI: no aparecería en ninguna lista.
    servicio, _ = armar()
    with pytest.raises(AsignacionInvalida) as exc:
        await servicio.asignar(5324, "g-inexistente", "qa")
    assert "g-inexistente" in str(exc.value)
    assert await servicio.asignaciones() == []


@pytest.mark.asyncio
async def test_rechaza_una_fecha_futura():
    # Una fecha futura daría días negativos, que no significan nada, y
    # delataría que la fecha es una estimación.
    servicio, _ = armar()
    mañana = date.today() + timedelta(days=1)
    with pytest.raises(AsignacionInvalida) as exc:
        await servicio.asignar(5324, "g-ana", "qa", desde=mañana)
    assert "futura" in str(exc.value)


@pytest.mark.asyncio
async def test_rechaza_un_rol_inexistente():
    servicio, _ = armar()
    with pytest.raises(AsignacionInvalida) as exc:
        await servicio.asignar(5324, "g-ana", "arquitecto")
    assert "Rol desconocido" in str(exc.value)


@pytest.mark.asyncio
async def test_rechaza_un_id_de_epica_imposible():
    servicio, _ = armar()
    with pytest.raises(AsignacionInvalida):
        await servicio.asignar(0, "g-ana", "qa")


# --------------------------------------------------------------------- #
# Quitar
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_quitar_borra_solo_esa_asignacion():
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa")
    await servicio.asignar(5324, "g-luis", "dev")
    await servicio.asignar(7000, "g-ana", "qa")
    await servicio.quitar(5324, "g-ana", "qa")
    assert {(a.epica, a.rol) for a in await servicio.asignaciones()} == {
        (5324, "dev"),
        (7000, "qa"),
    }


@pytest.mark.asyncio
async def test_quitar_a_alguien_que_se_fue_no_consulta_el_indice():
    # Cuando alguien deja el proyecto desaparece del índice, y su asignación
    # es justo la que más urge quitar. Por eso aquí no se valida el GUID.
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa")
    await servicio.quitar(5324, "g-ana", "qa")
    assert await servicio.asignaciones() == []


@pytest.mark.asyncio
async def test_quitar_lo_que_no_esta_no_falla():
    servicio, _ = armar()
    await servicio.quitar(1, "g-ana", "qa")
    assert await servicio.asignaciones() == []


# --------------------------------------------------------------------- #
# Concurrencia propagada
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_un_conflicto_de_concurrencia_llega_intacto():
    # La API lo traduce a 409. Si el servicio se lo tragara o lo cambiara por un
    # error genérico, el usuario creería que guardó y habría perdido la
    # asignación sin enterarse.
    class EnConflicto(RegistroAsignacionesPort):
        async def leer(self):
            from app.domain.models import Instantanea

            return Instantanea()

        async def guardar(self, instantanea):
            raise RegistroModificado("el registro cambió en disco")

    servicio = ServicioRegistro(EnConflicto(), RepoPersonas())
    with pytest.raises(RegistroModificado) as exc:
        await servicio.asignar(1, "g-ana", "qa")
    assert "cambió en disco" in str(exc.value)


@pytest.mark.asyncio
async def test_un_registro_corrupto_no_se_confunde_con_una_asignacion_invalida():
    # Son fallos distintos con salidas distintas: 422 (corrige el formulario)
    # frente a 500 (arregla el fichero). Confundirlos mandaría al usuario a la
    # puerta equivocada.
    from app.infrastructure.registro_json import ErrorRegistro

    class Roto(RegistroAsignacionesPort):
        async def leer(self):
            raise ErrorRegistro("el fichero no es un JSON válido")

        async def guardar(self, instantanea):
            raise AssertionError("no debería llegarse a guardar")

    servicio = ServicioRegistro(Roto(), RepoPersonas())
    with pytest.raises(ErrorRegistro):
        await servicio.asignar(1, "g-ana", "qa")
    with pytest.raises(AsignacionInvalida):
        await servicio.asignar(1, "g-ana", "arquitecto")


# --------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_personas_incluye_el_registro_y_la_carga_de_azure():
    servicio, _ = armar()
    await servicio.asignar(5324, "g-ana", "qa", desde=date.today())
    await servicio.asignar(7000, "g-ana", "qa", desde=date.today())
    filas = {f["guid"]: f for f in await servicio.personas()}

    assert filas["g-ana"]["epicas"] == 2
    assert filas["g-ana"]["epicas_qa"] == 2
    assert filas["g-ana"]["epicas_dev"] == 0
    assert filas["g-ana"]["items_backlog"] == 12
    # Sin asignaciones, la persona sale igual: la lista de personas del proyecto
    # no debe depender de que le hayan asignado algo.
    assert filas["g-luis"]["epicas"] == 0


@pytest.mark.asyncio
async def test_carga_solo_las_que_tienen_epicas_y_ordenada():
    servicio, _ = armar()
    await servicio.asignar(1, "g-ana", "qa")
    await servicio.asignar(1, "g-ana", "qa", desde=date.today())
    await servicio.asignar(2, "g-luis", "dev")
    filas = await servicio.carga_por_persona()
    assert [f["guid"] for f in filas] == ["g-ana", "g-luis"]
    assert all(f["epicas"] > 0 for f in filas)


@pytest.mark.asyncio
async def test_dias_laborables_de_la_asignacion_mas_antigua():
    servicio, _ = armar()
    inicio = date.today() - timedelta(days=20)
    await servicio.asignar(1, "g-ana", "qa", desde=inicio)
    filas = {f["guid"]: f for f in await servicio.personas()}
    assert filas["g-ana"]["dias_laborables"] == dias_laborables(inicio)
    assert filas["g-ana"]["dias_laborables"] > 10


@pytest.mark.asyncio
async def test_filtrar_por_persona_ignora_mayusculas():
    servicio, _ = armar()
    await servicio.asignar(1, "g-ana", "qa")
    assert len(await servicio.asignaciones(persona="G-ANA")) == 1


# --------------------------------------------------------------------- #
# Roles y sugerencia
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_marcar_rol_guarda_la_decision():
    servicio, _ = armar()
    await servicio.marcar_rol("g-ana", es_qa=True, forzado=True)
    filas = {f["guid"]: f for f in await servicio.personas()}
    assert filas["g-ana"]["es_qa"] is True
    assert filas["g-ana"]["forzado"] is True


@pytest.mark.asyncio
async def test_marcar_rol_rechaza_un_guid_inexistente():
    servicio, _ = armar()
    with pytest.raises(AsignacionInvalida):
        await servicio.marcar_rol("g-fantasma", es_qa=True)


@pytest.mark.asyncio
async def test_la_sugerencia_ordena_por_activos_de_prueba_tocados():
    activos = [caso(i, "g-ana") for i in range(5)] + [caso(9, "g-luis")]
    servicio, _ = armar(activos)
    sugerida = await servicio.sugerencia_qa(minimo=1)
    assert [s["guid"] for s in sugerida] == ["g-ana", "g-luis"]
    assert sugerida[0]["activos"] == 5


@pytest.mark.asyncio
async def test_la_sugerencia_respeta_el_minimo():
    activos = [caso(1, "g-ana"), caso(2, "g-luis")]
    servicio, _ = armar(activos)
    assert await servicio.sugerencia_qa(minimo=2) == []


@pytest.mark.asyncio
async def test_la_sugerencia_avisa_de_lo_que_ya_esta_marcado():
    # No se guarda sola, pero sí dice qué es una redundancia: sin eso, cada
    # visita repetiría la misma sugerencia ya resuelta.
    servicio, _ = armar([caso(1, "g-ana")])
    await servicio.marcar_rol("g-ana", es_qa=True, forzado=True)
    sugerida = await servicio.sugerencia_qa(minimo=1)
    assert sugerida[0]["guid"] == "g-ana"
    assert sugerida[0]["ya_es_qa"] is True


@pytest.mark.asyncio
async def test_la_sugerencia_es_vacia_sin_indice_de_pruebas():
    repo = RepoPersonas()
    registro = Memoria()
    servicio = ServicioRegistro(registro, repo)
    assert await servicio.sugerencia_qa() == []


# --------------------------------------------------------------------- #
# Días laborables
# --------------------------------------------------------------------- #
def test_dias_laborables_cuenta_ambos_extremos():
    # Inclusivo porque las otras dos opciones se leen como errores: una épica
    # asignada hoy consultada hoy daría 0 y parecería que no se guardó.
    assert dias_laborables(date(2026, 9, 21), date(2026, 9, 21)) == 1
    assert dias_laborables(date(2026, 9, 21), date(2026, 9, 28)) == 6


def test_dias_laborables_no_cuenta_sabado_ni_domingo():
    # 26/09/2026 es sábado y 27/09/2026 domingo.
    assert dias_laborables(date(2026, 9, 26), date(2026, 9, 27)) == 0
    assert dias_laborables(date(2026, 9, 26), date(2026, 9, 28)) == 1


def test_dias_laborables_con_fechas_invertidas_da_cero():
    assert dias_laborables(date(2026, 9, 28), date(2026, 9, 21)) == 0


def test_dias_laborables_acepta_otra_jornada():
    # Un equipo que trabaja sábados necesita poder decirlo sin tocar el código.
    assert dias_laborables(date(2026, 9, 26), date(2026, 9, 27), frozenset({5})) == 1
