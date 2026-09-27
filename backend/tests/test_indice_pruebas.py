"""Pruebas del índice de activos de prueba y de la cobertura.

La cobertura se cruza en dos direcciones y aquí se exige que **coincidan**. Es la
única defensa contra el fallo dangerous: un lote de relaciones ilegible deja
casos fuera y, sin contraste, contaría historias como «sin caso» que sí lo
tienen. El error apuntaría contra el equipo sin motivo.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.application.indice import IndiceWorkItems
from app.application.indice_pruebas import (
    CLAVE_INDICE_PRUEBAS,
    ESTADO_DISENO,
    IndicePruebas,
    _pct,
    _requisitos_cubiertos,
)
from app.domain.models import ItemIndice, ItemPrueba, Persona
from app.infrastructure.cache import CacheMemoria

RAIZ = "Proyecto de ejemplo"
ANCHO = 10


def historia(
    id_: int,
    *,
    sprint: str = f"{RAIZ}\\Sprint 1",
    persona: str = "Ana Diaz",
    estado: str = "Active",
) -> ItemIndice:
    return ItemIndice(
        azure_id=id_,
        tipo="User Story",
        titulo=f"Historia {id_}",
        estado=estado,
        sprint=sprint,
        persona=Persona(guid=f"g{id_}", nombre=persona),
        creado=datetime(2026, 1, 1, tzinfo=timezone.utc),
        modificado=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def caso(
    id_: int,
    requisitos: tuple[int, ...] = (),
    *,
    estado: str = "Design",
    automatizacion: str = "Not Automated",
    sprint: str = f"{RAIZ}\\Sprint 1",
    modificado: datetime | None = None,
) -> ItemPrueba:
    """Caso de prueba. `modificado` es **reciente** por defecto.

    Importa: `DIAS_DISENO_ABANDONADO` es de 180 días, y una fecha fija de 2026
    dejaría «abandonado» a todos los casos de las pruebas y el contraste entre
    trabajo en curso y deuda no se distinguiría.
    """
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Case",
        titulo=f"Caso {id_}",
        estado=estado,
        sprint=sprint,
        automatizacion=automatizacion,
        requisitos=list(requisitos),
        modificado=modificado or datetime.now(timezone.utc),
    )


def plan(id_: int, *, sprint: str = f"{RAIZ}\\Sprint 1", persona: str = "Luis Ruiz") -> ItemPrueba:
    return ItemPrueba(
        azure_id=id_,
        tipo="Test Plan",
        titulo=f"Plan {id_}",
        estado="Active",
        sprint=sprint,
        persona=Persona(guid=f"p{id_}", nombre=persona),
    )


def suite(id_: int, estado: str = "In Progress") -> ItemPrueba:
    return ItemPrueba(azure_id=id_, tipo="Test Suite", titulo=f"Suite {id_}", estado=estado)


def armar(historias, activos, **kwargs):
    from tests.conftest import FakeRepositorio

    repo = FakeRepositorio(items_indice=historias, activos_prueba=activos, **kwargs)
    cache = CacheMemoria()
    work = IndiceWorkItems(repo, cache)
    return repo, IndicePruebas(repo, cache, work)


# --------------------------------------------------------------------- #
# Inventario
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_resumen_cuenta_inventario_por_tipo():
    repo, indice = armar(
        [historia(1)],
        [plan(10), suite(11), suite(12, "Completed"), caso(13), caso(14, estado="Closed")],
    )
    datos = await indice.resumen()
    assert datos["inventario"] == {
        "planes": 1,
        "suites": 2,
        "casos": 2,
        "total": 5,
    }
    assert repo.llamadas_indice_pruebas == 1


@pytest.mark.asyncio
async def test_planned_no_cuenta_como_automatizado():
    """`Planned` sigue siendo un caso manual hoy; sumarlo inflaría la métrica."""
    _, indice = armar(
        [historia(1)],
        [
            caso(13, automatizacion="Automated"),
            caso(14, automatizacion="Planned"),
            caso(15, automatizacion="Not Automated"),
        ],
    )
    auto = (await indice.resumen())["automatizacion"]
    assert auto["automatizados"] == 1
    assert auto["planificados"] == 1
    assert auto["manuales"] == 1
    assert auto["pct_automatizado"] == _pct(1, 3)


@pytest.mark.asyncio
async def test_diseno_separa_trabajo_reciente_de_caso_abandonado():
    """1.577 casos en diseño no son todos deuda: hay que separar los que se tocan."""
    viejo = datetime.now(timezone.utc) - timedelta(days=400)
    _, indice = armar(
        [historia(1)],
        [caso(13), caso(14, estado="Ready"), caso(15, modificado=viejo)],
    )
    diseno = (await indice.resumen())["diseno"]
    assert diseno["en_diseno"] == 2
    assert diseno["sin_mover"] == 1
    assert diseno["dias"] > 0


@pytest.mark.asyncio
async def test_indice_vacio_no_es_error():
    _, indice = armar([historia(1)], [])
    datos = await indice.resumen()
    assert datos["inventario"]["total"] == 0
    assert datos["brecha"]["sin_cubrir"] == 1
    assert (await indice.cobertura())["resumen"]["historias"] == 1


# --------------------------------------------------------------------- #
# Cobertura: el contraste cruzado, que es la defensa principal
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_cobertura_cruza_casos_con_historias():
    _, indice = armar(
        [historia(1), historia(2), historia(3)],
        [caso(100, requisitos=(1, 2)), caso(101, requisitos=(2,))],
    )
    resumen = (await indice.cobertura())["resumen"]
    assert resumen["historias"] == 3
    assert resumen["historias_cubiertas"] == 2
    assert resumen["historias_sin_cubrir"] == 1
    assert resumen["pct_cubiertas"] == 66.7
    assert resumen["parcial"] is False


@pytest.mark.asyncio
async def test_cobertura_coincide_en_las_dos_direcciones():
    """El lado de los casos y el lado de las historias deben dar lo mismo.

    Es el test que sustituye al contraste en producción (que duplicaría las
    lecturas): el mismo conjunto, contado desde ambos lados, tiene que coincidir.
    Si un cambio en el mapeo de `TestedBy` hiciera divergir los dos lados, la
    cifra empezaría a mentir y este test lo dirá.
    """
    historias = [historia(i) for i in range(1, 21)]
    activos = [
        caso(100, requisitos=(1, 2, 3)),
        caso(101, requisitos=(2,)),
        caso(102, requisitos=(19, 20)),
        # Un caso que apunta a una épica: no es una historia, no debe contar.
        caso(103, requisitos=(999,)),
        # Un caso sin requisitos: no cubre nada.
        caso(104),
    ]
    _, indice = armar(historias, activos)

    # Lado A: el que ve la UI, desde los casos del índice de pruebas.
    desde_casos = (await indice.cobertura())["resumen"]["historias_cubiertas"]
    # Lado B: el independiente, contando los requisitos desde las historias.
    cubierto, _ = _requisitos_cubiertos(activos)
    desde_historias = sum(1 for h in historias if h.azure_id in cubierto)

    assert desde_casos == desde_historias == 5
    # Y la épica cubierta sigue declarada aparte, sin contarse como historia.
    assert (await indice.cobertura())["resumen"]["requisitos_cubiertos_total"] == 6


@pytest.mark.asyncio
async def test_un_requisito_inexistente_no_inventa_historias():
    _, indice = armar([historia(1)], [caso(100, requisitos=(7777,))])
    resumen = (await indice.cobertura())["resumen"]
    assert resumen["historias_cubiertas"] == 0
    assert resumen["historias_sin_cubrir"] == 1
    # Sí se declara como requisito cubierto: el dato existe aunque no sea historia.
    assert resumen["requisitos_cubiertos_total"] == 1


@pytest.mark.asyncio
async def test_lote_fallido_declara_cobertura_parcial():
    """Un lote ilegible no puede producir una cifra completa.

    El sesgo sería en contra del equipo: los casos que no se leyeron cuentan como
    historias «sin caso». Por eso la respuesta lo declara.
    """
    _, indice = armar(
        [historia(1), historia(2)],
        [caso(100, requisitos=(1,))],
        lotes_prueba_con_error=1,
        lotes_prueba_totales=18,
    )
    cobertura = await indice.cobertura()
    assert cobertura["resumen"]["parcial"] is True
    assert cobertura["resumen"]["lotes_con_error"] == 1
    assert (await indice.resumen())["parcial"] is True
    assert (await indice.sin_cubrir())["resumen"]["parcial"] is True


# --------------------------------------------------------------------- #
# Cobertura por sprint y lista de trabajo
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_cobertura_por_sprint_agrupa_y_ordena():
    _, indice = armar(
        [
            historia(1, sprint=f"{RAIZ}\\Sprint 10"),
            historia(2, sprint=f"{RAIZ}\\Sprint 10"),
            historia(3, sprint=f"{RAIZ}\\Sprint 2"),
        ],
        [caso(100, requisitos=(1,))],
    )
    filas = (await indice.cobertura())["sprints"]
    # Orden tolerante a números: `Sprint 2` va antes que `Sprint 10`.
    assert [f["nombre"] for f in filas] == ["Sprint 2", "Sprint 10"]
    assert filas[0]["historias"] == 1 and filas[0]["sin_cubrir"] == 1
    assert filas[1]["historias"] == 2 and filas[1]["cubiertas"] == 1
    assert filas[1]["ruta"] == f"{RAIZ}\\Sprint 10"


@pytest.mark.asyncio
async def test_historias_sin_sprint_no_inventan_un_sprint():
    _, indice = armar([historia(1, sprint="")], [caso(100)])
    assert (await indice.cobertura())["sprints"] == []
    # Pero sí cuentan en la brecha global: existen y nadie las prueba.
    assert (await indice.cobertura())["resumen"]["historias"] == 1


@pytest.mark.asyncio
async def test_sin_cubrir_pagina_sin_repetir_ni_saltar():
    historias = [historia(i, sprint=f"{RAIZ}\\Sprint {i}") for i in range(1, 26)]
    _, indice = armar(historias, [])
    primera = await indice.sin_cubrir(limite=10, offset=0)
    segunda = await indice.sin_cubrir(limite=10, offset=10)
    tercera = await indice.sin_cubrir(limite=10, offset=20)
    assert primera["resumen"]["total"] == 25
    assert primera["resumen"]["hay_mas"] is True
    assert tercera["resumen"]["hay_mas"] is False

    vistos = [i["azure_id"] for i in primera["items"] + segunda["items"] + tercera["items"]]
    assert len(vistos) == 25
    assert len(set(vistos)) == 25, "la paginación repitió o saltó historias"


@pytest.mark.asyncio
async def test_sin_cubrir_ordena_por_sprint_y_es_estable():
    """Con un orden cambiante, el `offset` repetiría historias entre páginas."""
    historias = [
        historia(3, sprint=f"{RAIZ}\\Sprint 10"),
        historia(1, sprint=f"{RAIZ}\\Sprint 2"),
        historia(2, sprint=f"{RAIZ}\\Sprint 2"),
    ]
    _, indice = armar(historias, [])
    uno = [i["azure_id"] for i in (await indice.sin_cubrir())["items"]]
    dos = [i["azure_id"] for i in (await indice.sin_cubrir())["items"]]
    assert uno == dos == [1, 2, 3]


@pytest.mark.asyncio
async def test_sin_cubrir_filtra_por_sprint_hoja_y_por_persona():
    historias = [
        historia(1, sprint=f"{RAIZ}\\Sprint 2", persona="Ana Diaz"),
        historia(2, sprint=f"{RAIZ}\\Sprint 3", persona="Luis Ruiz"),
        historia(3, sprint=f"{RAIZ}\\Sprint 3", persona="Ana Diaz"),
    ]
    _, indice = armar(historias, [])
    # La ruta completa…
    assert (await indice.sin_cubrir(sprint=f"{RAIZ}\\Sprint 3"))["resumen"]["total"] == 2
    # …y el nombre corto, que es lo que llega en una URL escrita a mano.
    assert (await indice.sin_cubrir(sprint="Sprint 3"))["resumen"]["total"] == 2
    assert (await indice.sin_cubrir(persona="ana"))["resumen"]["total"] == 2
    assert (await indice.sin_cubrir(persona="g3"))["resumen"]["total"] == 1


@pytest.mark.asyncio
async def test_las_historias_cubiertas_no_aparecen_en_la_lista():
    _, indice = armar(
        [historia(1), historia(2)],
        [caso(100, requisitos=(2,))],
    )
    pendientes = await indice.sin_cubrir()
    assert [i["azure_id"] for i in pendientes["items"]] == [1]


# --------------------------------------------------------------------- #
# Planes como contexto
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_planes_solo_los_planes_ordenados_por_sprint():
    _, indice = armar(
        [historia(1)],
        [
            plan(11, sprint=f"{RAIZ}\\Sprint 10", persona="Luis Ruiz"),
            plan(10, sprint=f"{RAIZ}\\Sprint 2", persona="Ana Diaz"),
            suite(12),
            caso(13),
        ],
    )
    filas = await indice.planes()
    assert [f["azure_id"] for f in filas] == [10, 11]
    assert filas[0]["sprint"] == "Sprint 2"
    assert filas[0]["persona"] == "Ana Diaz"


@pytest.mark.asyncio
async def test_plan_en_raiz_de_iteracion_no_equivale_a_un_sprint():
    """2 de 44 planes apuntan a la raíz; la raíz no es un sprint más."""
    _, indice = armar([historia(1)], [plan(10, sprint=RAIZ)])
    filas = await indice.planes()
    assert filas[0]["sprint"] == RAIZ


# --------------------------------------------------------------------- #
# Caché e invalidación
# --------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_la_carga_esta_cacheada_y_se_puede_invalidar():
    repo, indice = armar([historia(1)], [caso(100, requisitos=(1,))])
    await indice.cobertura()
    await indice.cobertura()
    assert repo.llamadas_indice_pruebas == 1, "la segunda consulta releyó Azure"

    indice.invalidar()
    await indice.cobertura()
    assert repo.llamadas_indice_pruebas == 2


@pytest.mark.asyncio
async def test_el_indice_de_pruebas_no_toca_la_clave_del_de_sprints():
    """Son dos cachés: invalidar uno no puede tirar el otro."""
    repo, indice = armar([historia(1)], [caso(100)])
    await indice._cargar()
    await indice._work.todos()
    indice.invalidar()
    assert CLAVE_INDICE_PRUEBAS not in indice._cache.claves()


@pytest.mark.asyncio
async def test_sin_azure_no_se_pide_nada_a_despues_de_cargar():
    """Filtrar es local: la lista de trabajo no genera peticiones a Azure."""
    repo, indice = armar([historia(i) for i in range(1, 6)], [caso(100, requisitos=(1,))])
    await indice._cargar()
    llamadas = repo.llamadas_indice_pruebas
    await indice.sin_cubrir(limite=ANCHO)
    await indice.cobertura()
    await indice.planes()
    assert repo.llamadas_indice_pruebas == llamadas


def test_porcentaje_sin_denominador_es_cero():
    """Sin denominador no hay porcentaje: 0,0 y no una división por cero."""
    assert _pct(0, 0) == 0.0
    assert _pct(3, 3) == 100.0


def test_el_estado_de_diseno_se_compara_en_minusculas():
    """El estado es texto abierto de Azure: `Design`, `design` o `DESIGN`."""
    assert ESTADO_DISENO == "design"
