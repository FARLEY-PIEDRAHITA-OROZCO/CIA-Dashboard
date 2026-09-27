"""Índice local de activos de prueba y cobertura de pruebas por requisito.

**Por qué un segundo índice y no ampliar el de sprints.** Los activos de prueba
son 3.932 ítems (44 planes, 457 suites, 3.431 casos) y nadie los consulta al
abrir la vista de sprints. Meterlos en `IndiceWorkItems` duplicaría el tiempo
en frío de una vista que ya funciona (~10 s → ~20 s medidos) a cambio de nada.
Viven aparte, con su TTL y su carga perezosa: `#/sprints` no los toca nunca.

**Qué se puede medir y qué no.** Se comprobó contra la API real que la
pertenencia de un caso a un plan **no es accesible**: los work items `Test Plan`
no tienen relaciones de pertenencia y las rutas de casos del plan devuelven 404
en todas las versiones probadas. Por eso este módulo no intenta "abrir un plan":
cuenta activos y cruza el único vínculo que sí existe, `TestedBy-Reverse`
(«este caso prueba este requisito»), que aparece en 2.014 de 3.431 casos.

**Por qué la cobertura puede declararse parcial.** Un lote de relaciones ilegible
deja 200 casos fuera, y si eso se ignora la cuenta de historias «sin caso» sube:
el error apunta contra el equipo sin motivo. Aquí el conteo de lotes fallidos
viaja con los datos y todas las respuestas lo declaran.

Este módulo solo razona sobre :class:`ItemPrueba` e :class:`ItemIndice`; no
conoce nombres de campo de Azure ni HTTP.
"""

import asyncio
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from ..domain.models import CargaPruebas, ItemIndice, ItemPrueba
from ..domain.ports import CachePort, RepositorioBacklogPort
from ..infrastructure.azure.queries import clave_orden_sprint, nombre_sprint
from .indice import TIPOS_PRUEBA, IndiceWorkItems

logger = logging.getLogger("devops")

CLAVE_INDICE_PRUEBAS = "indice:pruebas"

#: Tipo de work item que cuenta como requisito a cubrir en la analítica de QA.
#: Los casos también apuntan a épicas y features (355 requisitos cubiertos frente
#: a 241 historias), pero la unidad de trabajo de QA es la historia.
TIPO_REQUISITO = "User Story"

#: Estados de un `Test Case` que describen diseño, no ejecución.
ESTADO_DISENO = "design"

#: A partir de cuántos días sin tocarse un caso en `Design` se considera
#: abandonado en lugar de trabajo en curso. Sin esto, 1.577 casos en diseño se
#: leerían como «deuda» cuando parte puede ser trabajo reciente.
DIAS_DISENO_ABANDONADO = 180


class IndicePruebas:
    """Proyección cacheada de los activos de prueba del proyecto.

    Vive en la capa de aplicación y razona sobre modelos de dominio. Recibe el
    `IndiceWorkItems` porque **la cobertura se cruza con las historias**: saber
    qué casos existen no dice nada hasta saber qué historias no tienen ninguno.
    """

    def __init__(
        self,
        repositorio: RepositorioBacklogPort,
        cache: CachePort,
        indice_work_items: IndiceWorkItems,
        *,
        ttl_seg: float = 900.0,
        tipos: Iterable[str] = TIPOS_PRUEBA,
    ) -> None:
        self._repo = repositorio
        self._cache = cache
        self._work = indice_work_items
        self._ttl = float(ttl_seg)
        self._tipos = tuple(tipos)
        # Mismo motivo que en el índice de sprints: FastAPI sirve peticiones
        # simultáneas y dos recargas a la vez duplicarían los lotes contra Azure.
        self._candado = asyncio.Lock()

    # ------------------------------------------------------------------ #
    # Carga y caché
    # ------------------------------------------------------------------ #
    def invalidar(self) -> None:
        """Fuerza la recarga en la próxima consulta."""
        self._cache.eliminar(CLAVE_INDICE_PRUEBAS)

    async def _cargar(self) -> CargaPruebas:
        crudo = self._cache.obtener(CLAVE_INDICE_PRUEBAS)
        if isinstance(crudo, CargaPruebas):
            return crudo
        async with self._candado:
            # Otra petición pudo cargar mientras se esperaba el cerrojo.
            crudo = self._cache.obtener(CLAVE_INDICE_PRUEBAS)
            if isinstance(crudo, CargaPruebas):
                return crudo
            carga = await self._repo.listar_activos_prueba(self._tipos)
            self._cache.guardar(CLAVE_INDICE_PRUEBAS, carga, self._ttl)
            logger.info(
                "Índice de pruebas cargado: %d activos (%d lotes con error)",
                len(carga.items),
                carga.lotes_con_error,
            )
            return carga

    async def todos(self) -> List[ItemPrueba]:
        return (await self._cargar()).items

    # ------------------------------------------------------------------ #
    # Inventario
    # ------------------------------------------------------------------ #
    async def resumen(self) -> Dict[str, Any]:
        """Inventario, brecha de cobertura, automatización y diseño.

        El automatizado se cuenta como `Automated` **exacto**: `Planned` sigue
        siendo un caso manual hoy, y sumarlo inflaría la métrica.
        """
        carga = await self._cargar()
        ahora = datetime.now(timezone.utc)
        limite_diseno = ahora - timedelta(days=DIAS_DISENO_ABANDONADO)

        por_tipo: Counter[str] = Counter()
        estados: dict[str, Counter[str]] = {}
        automatizados = planificados = diseno = diseno_abandonado = 0
        casos = 0

        for item in carga.items:
            por_tipo[item.tipo] += 1
            estados.setdefault(item.tipo, Counter())[item.estado or "(vacío)"] += 1
            if item.tipo != "Test Case":
                continue
            casos += 1
            if item.automatizado:
                automatizados += 1
            elif (item.automatizacion or "").strip().lower() == "planned":
                planificados += 1
            if (item.estado or "").strip().lower() == ESTADO_DISENO:
                diseno += 1
                referencia = item.modificado or item.creado
                if referencia is None or referencia < limite_diseno:
                    diseno_abandonado += 1

        brecha = await self._brecha(carga)
        return {
            "inventario": {
                "planes": por_tipo.get("Test Plan", 0),
                "suites": por_tipo.get("Test Suite", 0),
                "casos": por_tipo.get("Test Case", 0),
                "total": len(carga.items),
            },
            "estados": {tipo: dict(conteo) for tipo, conteo in estados.items()},
            "automatizacion": {
                "casos": casos,
                "automatizados": automatizados,
                "planificados": planificados,
                "manuales": casos - automatizados - planificados,
                "pct_automatizado": _pct(automatizados, casos),
            },
            "diseno": {
                "en_diseno": diseno,
                "sin_mover": diseno_abandonado,
                "dias": DIAS_DISENO_ABANDONADO,
            },
            "brecha": brecha,
            "parcial": carga.parcial,
            "generado": ahora.isoformat(),
        }

    async def planes(self) -> List[Dict[str, Any]]:
        """Los planes como **contexto**: quién lleva las pruebas de cada sprint.

        No se presentan como la entidad central porque no lo son. Un plan tiene
        0 relaciones de pertenencia, así que no se puede abrir ni contar qué
        contiene; lo único que aporta de fiable es su sprint y su responsable.
        """
        carga = await self._cargar()
        filas: List[Dict[str, Any]] = []
        for item in carga.items:
            if item.tipo != "Test Plan":
                continue
            filas.append(
                {
                    "azure_id": item.azure_id,
                    "titulo": item.titulo,
                    "estado": item.estado,
                    "sprint": nombre_sprint(item.sprint),
                    "persona": item.persona.nombre if item.persona else "",
                    "modificado": item.modificado.isoformat() if item.modificado else "",
                }
            )
        filas.sort(
            key=lambda f: (
                _clave_sprint(f["sprint"]),
                f["persona"].lower(),
                f["azure_id"],
            )
        )
        return filas

    # ------------------------------------------------------------------ #
    # Cobertura
    # ------------------------------------------------------------------ #
    async def cobertura(self) -> Dict[str, Any]:
        """Cobertura global y por sprint, con la marca de parcial.

        Cuando algún lote de relaciones no se pudo leer, `parcial` es `True` y
        las historias sin caso son **como máximo** las que se indican: puede
        haber más, nunca menos.
        """
        carga = await self._cargar()
        historias = await self._historias()
        cubierto, total_req = _requisitos_cubiertos(carga.items)
        conteo = await self._cobertura_por_sprint(historias, cubierto)
        brecha = _brecha(historias, cubierto, carga.parcial)
        brecha["requisitos_cubiertos_total"] = total_req
        return {
            "resumen": {
                "historias": len(historias),
                "historias_cubiertas": brecha["cubiertas"],
                "historias_sin_cubrir": brecha["sin_cubrir"],
                "pct_cubiertas": _pct(brecha["cubiertas"], len(historias)),
                "requisitos_cubiertos_total": total_req,
                "parcial": carga.parcial,
                "lotes_con_error": carga.lotes_con_error,
                "generado": datetime.now(timezone.utc).isoformat(),
            },
            "sprints": conteo,
        }

    async def sin_cubrir(
        self,
        *,
        persona: str = "",
        sprint: str = "",
        limite: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Las historias que no tienen ningún caso: la lista de trabajo de QA.

        El orden es por sprint (más antiguo primero, que es por donde se empieza a
        pagar una deuda) y luego por id, para que la paginación sea estable: con
        un orden cambiante, el `offset` repetiría o saltaría historias.
        """
        carga = await self._cargar()
        historias = await self._historias()
        cubierto, _ = _requisitos_cubiertos(carga.items)
        pendientes = [h for h in historias if h.azure_id not in cubierto]
        if sprint.strip():
            objetivo = sprint.strip()
            pendientes = [
                h
                for h in pendientes
                if h.sprint == objetivo or nombre_sprint(h.sprint).lower() == objetivo.lower()
            ]
        if persona.strip():
            objetivo = persona.strip().lower()
            pendientes = [
                h
                for h in pendientes
                if h.persona
                and (
                    objetivo == h.persona.guid.lower()
                    or objetivo in h.persona.nombre.lower()
                )
            ]
        pendientes.sort(key=lambda h: (_clave_sprint(h.sprint), h.azure_id))
        total = len(pendientes)
        pagina = pendientes[max(0, offset) : max(0, offset) + max(1, limite)]
        return {
            "resumen": {
                "total": total,
                "offset": max(0, offset),
                "limite": max(1, limite),
                "hay_mas": max(0, offset) + len(pagina) < total,
                "parcial": carga.parcial,
                "lotes_con_error": carga.lotes_con_error,
            },
            "items": [
                {
                    "azure_id": h.azure_id,
                    "titulo": h.titulo,
                    "estado": h.estado,
                    "sprint": nombre_sprint(h.sprint),
                    "persona": h.persona.nombre if h.persona else "",
                    "modificado": h.modificado.isoformat() if h.modificado else "",
                }
                for h in pagina
            ],
        }

    # ------------------------------------------------------------------ #
    # Interno
    # ------------------------------------------------------------------ #
    async def _historias(self) -> List[ItemIndice]:
        """Historias del índice de trabajo: la otra mitad del cruce.

        Viene del índice de sprints, no de una lectura propia. Las historias ya
        están en memoria por la vista de sprints, así que pedirlo otra vez sería
        una lectura redundante de 5.651 ítems.
        """
        return [i for i in await self._work.todos() if i.tipo == TIPO_REQUISITO]

    async def _brecha(self, carga: CargaPruebas) -> Dict[str, Any]:
        historias = await self._historias()
        cubierto, total_req = _requisitos_cubiertos(carga.items)
        brecha = _brecha(historias, cubierto, carga.parcial)
        brecha["requisitos_cubiertos_total"] = total_req
        return brecha

    async def _cobertura_por_sprint(
        self, historias: List[ItemIndice], cubierto: Set[int]
    ) -> List[Dict[str, Any]]:
        """Cobertura agrupada por sprint, en el orden tolerante de la cinta.

        Una historia cuenta como cubierta si **algún** caso la prueba, sin mirar
        en qué sprint está el caso: el sprint de un caso es dónde se planificó
        ejecutarlo, no dónde está el requisito.
        """
        conteo: Counter[str] = Counter()
        cubiertas: Counter[str] = Counter()
        rutas: dict[str, str] = {}
        for h in historias:
            hoja = nombre_sprint(h.sprint)
            if not hoja:
                continue
            conteo[hoja] += 1
            rutas[hoja] = h.sprint
            if h.azure_id in cubierto:
                cubiertas[hoja] += 1
        return [
            {
                "nombre": hoja,
                "ruta": rutas[hoja],
                "historias": conteo[hoja],
                "cubiertas": cubiertas[hoja],
                "sin_cubrir": conteo[hoja] - cubiertas[hoja],
                "pct_cubiertas": _pct(cubiertas[hoja], conteo[hoja]),
            }
            for hoja in sorted(conteo, key=clave_orden_sprint)
        ]


# --------------------------------------------------------------------- #
# Utilidades puras
# --------------------------------------------------------------------- #
def _requisitos_cubiertos(items: List[ItemPrueba]) -> tuple[Set[int], int]:
    """Ids de todos los requisitos que algún caso prueba, y cuántos son.

    Se recorre **todo** el inventario, no solo los casos: en este proyecto los
    planes y suites no traen `TestedBy`, pero filtrar por tipo sería asumir que
    eso es siempre cierto y perder cobertura sin avisar.
    """
    cubiertos: Set[int] = set()
    for item in items:
        cubiertos.update(item.requisitos)
    return cubiertos, len(cubiertos)


def _brecha(
    historias: List[ItemIndice], cubierto: Set[int], parcial: bool
) -> Dict[str, Any]:
    """Historias cubiertas y sin cubrir, con la marca de parcial.

    `sin_cubrir` es una **cota superior** cuando `parcial` es `True`: un lote de
    relaciones ilegible hace parecer descubiertas historias que sí tienen caso.
    """
    cubiertas = sum(1 for h in historias if h.azure_id in cubierto)
    return {
        "historias": len(historias),
        "cubiertas": cubiertas,
        "sin_cubrir": len(historias) - cubiertas,
        "pct_cubiertas": _pct(cubiertas, len(historias)),
        "parcial": parcial,
    }


def _pct(parte: int, total: int) -> float:
    """Porcentaje redondeado a un decimal, o 0.0 si no hay denominador."""
    if total <= 0:
        return 0.0
    return round(parte * 100.0 / total, 1)


def _clave_sprint(sprint: str) -> tuple:
    """Orden de sprint tolerante a números, con la raíz al final.

    Las historias sin sprint no son un sprint más: si se mezclaran en la
    secuencia, la cinta mostraría un grupo invisible con un número.
    """
    return (0, "") if not sprint else (1, clave_orden_sprint(sprint))
