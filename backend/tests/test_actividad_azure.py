"""Pruebas del adaptador que lee el historial de revisiones de Azure.

Aquí vive la traducción del centinela de fecha, que es el detalle que hace
inútil el dato si no se hace: Azure devuelve la revisión **actual** de cada ítem
con ``revisedDate = 9999-01-01T00:00:00Z`` (medido: 6 de 6 en historias
recientes, y también en la épica #5324). Sin filtrarla, «última actividad» de
cualquier épica sería el año 9999.
"""

import pytest

from app.domain.models import Persona
from app.infrastructure.azure.repository import AzureBacklogRepositorio
from tests.conftest import SabanaTransporte

CENTINELA = "9999-01-01T00:00:00Z"


def _repo(transporte) -> AzureBacklogRepositorio:
    return AzureBacklogRepositorio(
        org_url="https://dev.azure.com/organizacion",
        proyecto="CIA",
        area_path="CIA",
        transporte=transporte,
    )


def _actualizaciones(valores) -> SabanaTransporte:
    transporte = SabanaTransporte([], [])
    transporte.actualizaciones = {"value": valores}
    return transporte


class TestCentinelaDeFecha:
    def test_el_9999_se_traduce_a_ausente(self):
        assert AzureBacklogRepositorio._a_fecha(CENTINELA) is None
        assert AzureBacklogRepositorio._a_fecha("9999-12-31T23:59:59Z") is None

    def test_una_fecha_real_pasa_intacta(self):
        valor = AzureBacklogRepositorio._a_fecha("2026-09-25T14:30:00Z")
        assert valor is not None
        assert valor.year == 2026 and valor.month == 9 and valor.day == 25

    def test_los_años_2000_no_se_desechan(self):
        """El corte es el centinela, no un mínimo inventado.

        Un filtro tipo «solo fechas desde 2020» descartaría ítems antiguos
        legítimos, que en un backlog de 2026 son justo los que menos actividad
        registrada tienen.
        """
        valor = AzureBacklogRepositorio._a_fecha("2001-03-04T00:00:00Z")
        assert valor is not None
        assert valor.year == 2001

    @pytest.mark.parametrize("basura", [None, "", 123, {}, [], "no-es-fecha", "2026-13-45"])
    def test_lo_que_no_es_fecha_da_ausente_y_no_revienta(self, basura):
        assert AzureBacklogRepositorio._a_fecha(basura) is None

    def test_el_año_9999_fuera_de_rango_por_si_azure_lo_cambia(self):
        """Si Azure usara otro centinela alto, el corte sigue acting.

        `>= 9999` cubre el que existe hoy y deja pasar cualquier año real, que es
        lo que importa: un filtro demasiado aggressive perdería datos buenos.
        """
        assert AzureBacklogRepositorio._a_fecha("9998-06-01T00:00:00Z") is not None


@pytest.mark.asyncio
class TestHistorialWorkItem:
    async def test_mapea_revision_autor_y_fecha(self):
        transporte = _actualizaciones(
            [
                {
                    "rev": 1,
                    "revisedDate": CENTINELA,
                    "revisedBy": {
                        "id": "75712602-99c0-6599-96e8-9f8847c0f673",
                        "displayName": "Lina Salazar",
                    },
                },
                {
                    "rev": 2,
                    "revisedDate": "2026-09-25T14:30:00Z",
                    "revisedBy": {
                        "id": "aaaa1111-2222-3333-4444-555566667777",
                        "displayName": "Ana Diaz",
                    },
                },
            ]
        )
        historial = await _repo(transporte).historial_work_item(40983)

        assert len(historial) == 2
        assert historial[0].rev == 1
        assert historial[0].fecha is None, "la creación lleva el centinela"
        assert historial[0].persona is not None
        assert historial[0].persona.guid == "75712602-99c0-6599-96e8-9f8847c0f673"
        assert historial[1].rev == 2
        assert historial[1].fecha is not None
        assert historial[1].persona is not None
        assert historial[1].persona.nombre == "Ana Diaz"

    async def test_ordena_por_revision_no_por_fecha(self):
        """`revisedDate` no viene garantizado en orden; `rev` sí.

        Confiar en el orden de llegada daría una «última actividad» que es en
        realidad la primera.
        """
        transporte = _actualizaciones(
            [
                {"rev": 7, "revisedDate": "2026-09-20T10:00:00Z", "revisedBy": {}},
                {"rev": 2, "revisedDate": "2026-09-01T10:00:00Z", "revisedBy": {}},
                {"rev": 5, "revisedDate": "2026-09-15T10:00:00Z", "revisedBy": {}},
            ]
        )
        historial = await _repo(transporte).historial_work_item(1)
        assert [r.rev for r in historial] == [2, 5, 7]

    async def test_una_revision_sin_autor_no_revienta(self):
        """Azure puede omitir `revisedBy` en importaciones y scripts."""
        transporte = _actualizaciones(
            [{"rev": 3, "revisedDate": "2026-09-10T10:00:00Z"}]
        )
        historial = await _repo(transporte).historial_work_item(1)
        assert historial[0].persona is None
        assert historial[0].rev == 3

    async def test_una_revision_sin_numero_no_revienta(self):
        transporte = _actualizaciones(
            [{"revisedDate": "2026-09-10T10:00:00Z", "revisedBy": {}}]
        )
        historial = await _repo(transporte).historial_work_item(1)
        assert historial[0].rev == 0

    async def test_una_respuesta_vacia_es_lista_vacia(self):
        """Un ítem sin historial no es un error de lectura, es un dato."""
        transporte = _actualizaciones([])
        assert await _repo(transporte).historial_work_item(1) == []

    async def test_una_respuesta_sin_value_no_revienta(self):
        transporte = SabanaTransporte([], [])
        transporte.actualizaciones = {}
        assert await _repo(transporte).historial_work_item(1) == []

    async def test_usa_la_ruta_por_item_correcta(self):
        """El endpoint es de un ítem: no hay forma de pedir varios.

        Por eso la vista es por épica y bajo demanda.
        """
        transporte = _actualizaciones([])
        await _repo(transporte).historial_work_item(40983)
        _, url = transporte.llamadas[0]
        assert "/_apis/wit/workitems/40983/updates" in url
        assert "api-version=7.1" in url
