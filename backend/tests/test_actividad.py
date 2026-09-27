"""Pruebas de la agregación de actividad por épica.

Lo que se vigila aquí, por orden de gravedad:

1. **El centinela de fecha.** Azure devuelve la revisión actual con
   ``9999-01-01T00:00:00Z``. Si se propaga, «última actividad» es el año 9999
   en todas las épicas: un número falso con aspecto de bueno.
2. **La revisión de creación.** Llega sin fecha y no es trabajo de nadie.
3. **El signo del error.** Un historial ilegible resta actividad, así que el
   resultado es una **cota inferior** y tiene que declararse parcial. Es lo
   contrario que la cobertura de pruebas, donde perder datos sobrestima.
4. **Una llamada por ítem.** Es el coste; si cambia, la vista global que no
   existe vuelve a ser tentadora.
"""

import pytest
from datetime import datetime

from app.application.actividad import (
    CLAVE_ACTIVIDAD,
    CONCURRENCIA,
    ServicioActividad,
)
from app.domain.models import Bug, Epic, Feature, Persona, Revision, Task, UserStory
from app.infrastructure.cache import CacheMemoria
from tests.conftest import FakeRepositorio


def _persona(guid: str, nombre: str) -> Persona:
    return Persona(guid=guid, nombre=nombre)


def _rev(rev: int, persona: Persona | None, fecha: str | None) -> Revision:
    """Revisión con la fecha ya traducida, como la deja el adaptador real.

    Se construye así a propósito: si la prueba fabricara la fecha *validada*,
    probaría el servicio contra una entrada que Azure nunca envía. La traducción
    del centinela vive en `AzureBacklogRepositorio._a_fecha` y tiene sus propias
    pruebas; aquí `fecha=None` significa «o centinela o ausente».
    """
    valor = None if fecha is None else datetime.fromisoformat(fecha)
    return Revision(rev=rev, persona=persona, fecha=valor)


class ArbolFijo:
    """Árbol estático; cumple el protocolo mínimo que pide el servicio."""

    def __init__(self, epica: Epic | None) -> None:
        self._epica = epica
        self.llamadas: list[tuple[int, bool]] = []

    async def arbol_epica(self, epic_id: int, *, incluir_bugs: bool = False):
        self.llamadas.append((epic_id, incluir_bugs))
        return self._epica


def _epica_simple() -> Epic:
    return Epic(
        azure_id=500,
        titulo="Épica de prueba",
        features=[
            Feature(
                azure_id=501,
                titulo="Feature",
                hus=[
                    UserStory(
                        azure_id=502,
                        titulo="Historia",
                        tareas=[Task(azure_id=503, titulo="Tarea")],
                        bugs=[Bug(azure_id=504, titulo="Bug", tareas=[Task(azure_id=505)])],
                    )
                ],
            )
        ],
        hus=[UserStory(azure_id=506, titulo="Historia suelta")],
    )


def _servicio(epica, historiales, fallan=None):
    repo = FakeRepositorio(historiales=historiales, historiales_fallan=fallan or set())
    arbol = ArbolFijo(epica)
    return ServicioActividad(repo, arbol, CacheMemoria(), ttl_seg=0), repo, arbol


# ---------------------------------------------------------------------- #
# El centinela de fecha
# ---------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestCentinelaDeFecha:
    async def test_la_revision_sin_fecha_no_define_la_ultima_actividad(self):
        epica = Epic(azure_id=1, titulo="E")
        ana = _persona("g-ana", "Ana")
        repo = FakeRepositorio(
            historiales={
                1: [
                    _rev(1, ana, None),  # creación
                    _rev(2, ana, "2026-09-01T10:00:00+00:00"),
                    _rev(3, ana, None),  # revisión actual, centinela
                ]
            }
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)

        # Lo importante: `ultima` es la fecha buena, no un año 9999.
        assert actividad.ultima is not None
        assert actividad.ultima.year == 2026
        assert actividad.primera == actividad.ultima

    async def test_la_revision_de_creacion_no_cuenta_como_trabajo(self):
        """La revisión 1 es la de creación y llega sin fecha.

        Contarla daría la sensación de que quien abrió el ítem trabajó en él.
        """
        epica = Epic(azure_id=1, titulo="E")
        ana = _persona("g-ana", "Ana")
        repo = FakeRepositorio(historiales={1: [_rev(1, ana, None)]})
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)

        assert actividad.revisiones == 0
        assert actividad.personas == 0
        assert actividad.primera is None
        assert actividad.ultima is None
        # Pero sí se declara que el ítem no tiene historial útil, que es distinto
        # de «no se ha analizado».
        assert actividad.items_sin_actividad == 1
        assert actividad.items_analizados == 1

    async def test_una_revision_con_fecha_y_numero_1_si_cuenta(self):
        """El filtro es rev≤1 **y** sin fecha.

        Si solo mirara el número, descartaría una revisión real. Un ítem importado
        puede tener revisión 1 con fecha de verdad.
        """
        epica = Epic(azure_id=1, titulo="E")
        ana = _persona("g-ana", "Ana")
        repo = FakeRepositorio(
            historiales={1: [_rev(1, ana, "2026-09-01T10:00:00+00:00")]}
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)
        assert actividad.revisiones == 1
        assert actividad.personas == 1


# ---------------------------------------------------------------------- #
# Agregación
# ---------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestAgregacion:
    async def test_recorre_el_arbol_completo_y_cuenta_por_tipo(self):
        epica = _epica_simple()  # 500, 501, 502, 503, 504, 505, 506
        historiales = {i: [_rev(2, _persona("g-a", "A"), "2026-09-01T10:00:00+00:00")] for i in (500, 501, 502, 503, 504, 505, 506)}
        servicio, repo, _ = _servicio(epica, historiales)
        actividad = await servicio.actividad_epica(500)

        assert actividad.items_totales == 7
        assert actividad.items_analizados == 7
        assert actividad.por_tipo == {
            "Bug": 1,
            "Epic": 1,
            "Feature": 1,
            "Task": 2,
            "User Story": 2,
        }
        assert actividad.revisiones == 7
        assert repo.llamadas_historial == sorted(repo.llamadas_historial)
        assert len(repo.llamadas_historial) == 7

    async def test_atribuye_a_personas_por_guid_no_por_nombre(self):
        epica = Epic(azure_id=1, titulo="E")
        # Dos personas con el mismo nombre y GUID distinto: el nombre no es clave.
        repo = FakeRepositorio(
            historiales={
                1: [
                    _rev(2, _persona("g-1", "Ana"), "2026-09-01T10:00:00+00:00"),
                    _rev(3, _persona("g-2", "Ana"), "2026-09-02T10:00:00+00:00"),
                    _rev(4, _persona("g-1", "Ana"), "2026-09-03T10:00:00+00:00"),
                ]
            }
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)

        assert actividad.personas == 2
        # Ordenado por volumen, y el desempate por nombre no puede colapsarlos.
        assert [f["revisiones"] for f in actividad.por_persona] == [2, 1]
        assert {f["guid"] for f in actividad.por_persona} == {"g-1", "g-2"}

    async def test_ordena_por_personas_por_volumen(self):
        epica = Epic(azure_id=1, titulo="E")
        repo = FakeRepositorio(
            historiales={
                1: [_rev(2, _persona("g-poco", "Poco"), "2026-09-01T10:00:00+00:00")]
                + [
                    _rev(i, _persona("g-mucho", "Mucho"), f"2026-09-0{i}T10:00:00+00:00")
                    for i in range(3, 6)
                ]
            }
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)
        assert actividad.por_persona[0]["nombre"] == "Mucho"
        assert actividad.por_persona[0]["revisiones"] == 3

    async def test_ignora_revisiones_sin_persona(self):
        """Azure puede devolver una revisión sin `revisedBy` (importación, script).

        Se cuentan como revisiones pero no se atribuyen a nadie: meterlas bajo una
        clave vacía juntaría a personas distintas en una entrada sin nombre.
        """
        epica = Epic(azure_id=1, titulo="E")
        repo = FakeRepositorio(
            historiales={1: [_rev(2, None, "2026-09-01T10:00:00+00:00")]}
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)
        assert actividad.revisiones == 1
        assert actividad.personas == 0
        assert actividad.por_persona == []

    async def test_descarta_personas_sin_guid(self):
        epica = Epic(azure_id=1, titulo="E")
        repo = FakeRepositorio(
            historiales={1: [_rev(2, Persona(guid="", nombre="Sin GUID"), "2026-09-01T10:00:00+00:00")]}
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)
        assert actividad.revisiones == 1
        assert actividad.personas == 0

    async def test_resta_primera_y_ultima_ordenadas(self):
        epica = Epic(azure_id=1, titulo="E")
        repo = FakeRepositorio(
            historiales={
                1: [
                    _rev(5, _persona("g-a", "A"), "2026-09-20T10:00:00+00:00"),
                    _rev(2, _persona("g-a", "A"), "2026-09-01T10:00:00+00:00"),
                    _rev(9, _persona("g-a", "A"), "2026-09-25T10:00:00+00:00"),
                ]
            }
        )
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=0)
        actividad = await servicio.actividad_epica(1)
        # Ordenadas, no en orden de llegada: `revisedDate` no viene garantizado.
        assert actividad.primera.day == 1
        assert actividad.ultima.day == 25

    async def test_una_epica_sin_historial_da_ceros_no_un_error(self):
        epica = Epic(azure_id=1, titulo="E")
        servicio, _, _ = _servicio(epica, {})
        actividad = await servicio.actividad_epica(1)
        assert actividad.revisiones == 0
        assert actividad.items_sin_actividad == 1
        assert actividad.parcial is False
        assert actividad.primera is None and actividad.ultima is None


# ---------------------------------------------------------------------- #
# El signo del error: parcial es una cota INFERIOR
# ---------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestParcial:
    async def test_un_historial_ilegible_no_aborta_la_epica(self):
        epica = _epica_simple()
        historiales = {
            i: [_rev(2, _persona("g-a", "A"), "2026-09-01T10:00:00+00:00")]
            for i in (500, 501, 502, 503, 504, 505, 506)
        }
        servicio, _, _ = _servicio(epica, historiales, fallan={503})
        actividad = await servicio.actividad_epica(500)

        assert actividad.parcial is True
        assert actividad.items_analizados == 6
        assert actividad.items_totales == 7
        # Sigue habiendo dato útil: los otros seis ítems se leyeron.
        assert actividad.revisiones == 6
        assert actividad.por_tipo["Task"] == 1  # solo 505; el 503 no se contó

    async def test_parcial_no_engaña_sobre_el_total(self):
        """`items_analizados` frente a `items_totales` es lo que revela el hueco.

        Publicar solo el total leído haría creer que se miró todo el árbol.
        """
        epica = _epica_simple()
        servicio, _, _ = _servicio(epica, {}, fallan={500, 501, 502, 503, 504, 505})
        actividad = await servicio.actividad_epica(500)
        assert actividad.parcial is True
        assert actividad.items_analizados == 1  # el 506
        assert actividad.items_totales == 7
        assert actividad.revisiones == 0


# ---------------------------------------------------------------------- #
# Coste y caché
# ---------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestCoste:
    async def test_una_llamada_por_item_del_arbol(self):
        """El coste es 1 llamada por ítem: no hay endpoint por lotes (medido).

        Es la razón de que no exista vista global de actividad.
        """
        epica = _epica_simple()
        servicio, repo, _ = _servicio(epica, {})
        await servicio.actividad_epica(500)
        assert len(repo.llamadas_historial) == 7
        assert len(set(repo.llamadas_historial)) == 7  # ninguno repetido

    async def test_la_concurrencia_esta_acotada(self):
        """Se leen en paralelo, pero no todos a la vez.

        44 conexiones simultáneas contra la misma organización no son una
        optimización, son un problema para el otro.
        """
        assert 1 < CONCURRENCIA <= 16

    async def test_pide_bugs_incluidos(self):
        """Un bug corregido es trabajo de la épica.

        Excluirlo haría que una épica con mucho trabajo de corrección pareciera
        quieta, que es justo la lectura que esta vista quiere contradecir.
        """
        servicio, _, arbol = _servicio(_epica_simple(), {})
        await servicio.actividad_epica(500)
        assert arbol.llamadas == [(500, True)]

    async def test_la_segunda_peticcion_no_vuelve_a_leer(self):
        epica = _epica_simple()
        historiales = {i: [_rev(2, _persona("g-a", "A"), "2026-09-01T10:00:00+00:00")] for i in (500, 501, 502, 503, 504, 505, 506)}
        repo = FakeRepositorio(historiales=historiales)
        cache = CacheMemoria()
        arbol = ArbolFijo(epica)
        servicio = ServicioActividad(repo, arbol, cache, ttl_seg=900)

        await servicio.actividad_epica(500)
        assert len(repo.llamadas_historial) == 7
        await servicio.actividad_epica(500)
        # 7 ítems aquí; en una épica real son hasta 254 (medido). Cachearlo no es
        # un detalle, es lo que evita repetir 254 llamadas.
        assert len(repo.llamadas_historial) == 7

    async def test_una_epica_inexistente_devuelve_none(self):
        servicio, _, _ = _servicio(None, {})
        assert await servicio.actividad_epica(999) is None


# ---------------------------------------------------------------------- #
# Invalidación
# ---------------------------------------------------------------------- #
@pytest.mark.asyncio
class TestInvalidacion:
    async def test_escribir_una_epica_hace_que_haya_que_releerla(self):
        """Si no se invalidara, el panel mostraría el recuento previo a la edición.

        Es el mismo motivo por el que `PATCH /api/workitems/{id}` invalida los dos
        índices: una caché que sobrevive a la escritura enseña el pasado.
        """
        epica = Epic(azure_id=1, titulo="E")
        ana = _persona("g-ana", "Ana")
        repo = FakeRepositorio(historiales={1: [_rev(2, ana, "2026-09-01T10:00:00+00:00")]})
        servicio = ServicioActividad(repo, ArbolFijo(epica), CacheMemoria(), ttl_seg=900)

        antes = await servicio.actividad_epica(1)
        assert antes.revisiones == 1

        # Simula la escritura: aparece una revisión nueva en Azure.
        repo.historiales = {1: [
            _rev(2, ana, "2026-09-01T10:00:00+00:00"),
            _rev(3, _persona("g-luis", "Luis"), "2026-09-02T10:00:00+00:00"),
        ]}
        servicio.invalidar()
        despues = await servicio.actividad_epica(1)
        assert despues.revisiones == 2
        assert len(repo.llamadas_historial) == 2, "hubo que releer el historial"

    async def test_invalida_todas_las_epicas_no_solo_una(self):
        """No se sabe a qué épica pertenece un ítem: puede ser una tarea al fondo.

        Invalidar solo la épica del ítem editado dejaría el resto con el recuento
        anterior, que es el bug que la invalidación entera evita.
        """
        repo = FakeRepositorio(historiales={})
        arbol = ArbolFijo(Epic(azure_id=1, titulo="E"))
        servicio = ServicioActividad(repo, arbol, CacheMemoria(), ttl_seg=900)
        cache = CacheMemoria()
        servicio._cache = cache  # el mismo para poder inspeccionarlo

        await servicio.actividad_epica(1)
        await servicio.actividad_epica(2)
        assert servicio.invalidar() == 2
        assert cache.obtener(CLAVE_ACTIVIDAD.format(1)) is None
        assert cache.obtener(CLAVE_ACTIVIDAD.format(2)) is None

    async def test_invalidar_sin_cache_no_rompe_nada(self):
        repo = FakeRepositorio(historiales={})
        servicio = ServicioActividad(repo, ArbolFijo(None), CacheMemoria(), ttl_seg=0)
        assert servicio.invalidar() == 0
