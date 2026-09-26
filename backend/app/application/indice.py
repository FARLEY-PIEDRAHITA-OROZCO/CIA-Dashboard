"""Índice local de work items para las vistas de sprint y persona.

**Por qué existe un índice en memoria.** Se comprobó contra la API real que:

- WIQL no devuelve los valores de los campos, solo ids → hace falta una
  segunda lectura por lotes de 200.
- ``[System.IterationPath] <> ''`` devuelve 0 e ``IS NOT EMPTY`` da error → **no
  hay forma de enumerar los sprints con una consulta**.
- ``[System.Tags] CONTAINS 'x'`` devuelve 0 → **los tags no se pueden filtrar en
  Azure**, así que la analítica QA tiene que calcularse en memoria.

Filtrar en Azure en cada petición sería, por tanto, caro (hasta 30 lotes) e
imposible para tags. El índice se carga **una vez** y se filtra en memoria: las
búsquedas del usuario no generan ni una sola petición a Azure.

Este módulo solo razona sobre :class:`ItemIndice`; no conoce nombres de campo
de Azure ni HTTP. Traducir el JSON de Azure es tarea del repositorio.
"""

import asyncio
import logging
from collections import Counter
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from ..domain.models import ItemIndice
from ..domain.ports import CachePort, RepositorioBacklogPort
from ..infrastructure.azure.queries import clave_orden_sprint, nombre_sprint

logger = logging.getLogger("devops")

CLAVE_INDICE = "indice:workitems"

#: Tipos que pertenecen a un sprint concreto. Epic y Feature abarcan varios
#: sprints, así que su ``System.IterationPath`` apunta a la raíz de la jerarquía
#: y no a una iteración real (verificado: la épica devuelve el nombre del
#: proyecto). Excluirlos evita que la raíz aparezca como un "sprint" más.
TIPOS_POR_SPRINT = ("User Story", "Task", "Bug", "Issue")

#: Etiqueta que el propio sistema escribe al verificar un ítem (§6 del plan).
TAG_VERIFICADO = "verificado-qa"


class IndiceWorkItems:
    """Proyección plana y cacheada de los work items del proyecto.

    Es un detalle de la aplicación: expone consultas por sprints, personas y
    analítica sobre modelos de dominio, sin conocer Azure ni el transporte.
    """

    def __init__(
        self,
        repositorio: RepositorioBacklogPort,
        cache: CachePort,
        *,
        ttl_seg: float = 300.0,
        tipos: Iterable[str] = TIPOS_POR_SPRINT,
    ) -> None:
        self._repo = repositorio
        self._cache = cache
        self._ttl = float(ttl_seg)
        self._tipos = tuple(tipos)
        # Un índice compartido recibe peticiones simultáneas desde FastAPI: sin
        # este cerrojo, dos recargas a la vez duplicarían los lotes contra Azure.
        self._candado = asyncio.Lock()

    # ------------------------------------------------------------------ #
    # Carga y caché
    # ------------------------------------------------------------------ #
    def invalidar(self) -> None:
        """Fuerza la recarga en la próxima consulta."""
        self._cache.eliminar(CLAVE_INDICE)

    async def _cargar(self) -> List[ItemIndice]:
        crudo = self._cache.obtener(CLAVE_INDICE)
        if isinstance(crudo, list):
            return crudo
        async with self._candado:
            # Otra petición pudo cargar mientras se esperaba el cerrojo.
            crudo = self._cache.obtener(CLAVE_INDICE)
            if isinstance(crudo, list):
                return crudo
            items = list(await self._repo.listar_work_items(self._tipos))
            self._cache.guardar(CLAVE_INDICE, items, self._ttl)
            logger.info("Índice cargado: %d work items", len(items))
            return items

    # ------------------------------------------------------------------ #
    # Consultas
    # ------------------------------------------------------------------ #
    async def todos(self) -> List[ItemIndice]:
        return await self._cargar()

    async def filtrar(
        self,
        *,
        sprint: str = "",
        persona: str = "",
        tipo: str = "",
        etiqueta: str = "",
        solo_abiertos: bool = False,
    ) -> List[ItemIndice]:
        """Filtra en memoria. No hace ninguna petición a Azure.

        Los filtros se combinan con AND y los vacíos se ignoran. ``persona``
        acepta el GUID o el nombre, para que la URL sea legible.
        """
        sprint = sprint.strip()
        persona = persona.strip().lower()
        tipo = tipo.strip()
        etiqueta = etiqueta.strip().lower()
        salida: List[ItemIndice] = []
        for item in await self._cargar():
            if sprint and item.sprint != sprint:
                continue
            if tipo and item.tipo != tipo:
                continue
            if persona and not _coincide_persona(item, persona):
                continue
            if etiqueta and etiqueta not in [t.lower() for t in item.etiquetas]:
                continue
            if solo_abiertos and item.cerrado:
                continue
            salida.append(item)
        return salida

    async def sprints(self) -> List[Dict[str, Any]]:
        """Catálogo de sprints con conteos, ordenado de forma tolerante.

        Se excluye la raíz de la jerarquía de iteración (épicas y features
        apuntan ahí, no a un sprint real) usando la ruta más corta presente en
        los datos: no depende del ``AreaPath`` configurado.
        """
        items = await self._cargar()
        raiz = _raiz_iteracion(items)
        conteo: Counter[str] = Counter()
        cerrados: Counter[str] = Counter()
        personas: dict[str, set[str]] = {}
        ultima: dict[str, datetime] = {}

        for item in items:
            ruta = item.sprint
            if not ruta or ruta == raiz:
                continue
            hoja = nombre_sprint(ruta)
            if not hoja:
                continue
            conteo[hoja] += 1
            if item.cerrado:
                cerrados[hoja] += 1
            if item.persona:
                personas.setdefault(hoja, set()).add(item.persona.nombre)
            momento = item.modificado or item.creado
            if momento and (hoja not in ultima or momento > ultima[hoja]):
                ultima[hoja] = momento

        return [
            {
                "nombre": hoja,
                "total": conteo[hoja],
                "cerrados": cerrados[hoja],
                "abiertos": conteo[hoja] - cerrados[hoja],
                "personas": len(personas.get(hoja, ())),
                "ultimo_cambio": (
                    ultima[hoja].isoformat() if hoja in ultima else ""
                ),
            }
            for hoja in sorted(conteo, key=clave_orden_sprint)
        ]

    async def sprint_actual(self) -> Optional[str]:
        """Sprint con el cambio más reciente.

        Sin fechas de sprint (la API de iteraciones devuelve 401 con un PAT de
        lectura) no hay calendario disponible. La heurística D9 es el último
        sprint *tocado*: es en el que el equipo está trabajando ahora mismo.
        """
        candidatos = await self.sprints()
        if not candidatos:
            return None
        con_fecha = [s for s in candidatos if s["ultimo_cambio"]]
        if not con_fecha:
            return candidatos[-1]["nombre"]
        return max(con_fecha, key=lambda s: s["ultimo_cambio"])["nombre"]

    async def personas(self) -> List[Dict[str, Any]]:
        """Personas con su carga actual, ordenadas por volumen y luego nombre."""
        abierto: Counter[str] = Counter()
        total: Counter[str] = Counter()
        detalle: dict[str, Dict[str, Any]] = {}
        for item in await self._cargar():
            if not item.persona:
                continue
            nombre = item.persona.nombre
            total[nombre] += 1
            if not item.cerrado:
                abierto[nombre] += 1
            fila = detalle.setdefault(
                nombre,
                {
                    "guid": item.persona.guid,
                    "nombre": nombre,
                    "abiertos": 0,
                    "total": 0,
                    "bugs": 0,
                    "bugs_abiertos": 0,
                    "verificados": 0,
                },
            )
            if item.tipo == "Bug":
                fila["bugs"] += 1
                if not item.cerrado:
                    fila["bugs_abiertos"] += 1
            if _tiene(item, TAG_VERIFICADO):
                fila["verificados"] += 1
        for nombre, fila in detalle.items():
            fila["abiertos"] = abierto[nombre]
            fila["total"] = total[nombre]
        return sorted(detalle.values(), key=lambda p: (-p["total"], p["nombre"].lower()))

    async def persona_por_guid(self, guid: str) -> Optional[Dict[str, Any]]:
        objetivo = (guid or "").strip().lower()
        for fila in await self.personas():
            if fila["guid"].lower() == objetivo:
                return fila
        return None


# --------------------------------------------------------------------- #
# Utilidades puras
# --------------------------------------------------------------------- #
def _tiene(item: ItemIndice, etiqueta: str) -> bool:
    return etiqueta.lower() in [t.lower() for t in item.etiquetas]


def _coincide_persona(item: ItemIndice, objetivo: str) -> bool:
    """Compara por GUID exacto o por nombre que contenga el texto buscado.

    El GUID se compara entero (es estable y único). El nombre se compara por
    subcadena para que en la UI baste con teclear «Luis» y no el nombre
    completo; ambos ignoran mayúsculas.
    """
    if not item.persona:
        return False
    if objetivo == item.persona.guid.lower():
        return True
    return objetivo in item.persona.nombre.lower()


def _raiz_iteracion(items: List[ItemIndice]) -> str:
    """Raíz de la jerarquía de iteración.

    En un árbol de iteraciones, la raíz es la ruta que es **prefijo** de otras
    (``CIA (Centro de Inteligencia Artificial)`` es prefijo de
    ``…\\Sprint 30``). No se puede usar "la ruta más corta": con nombres como
    ``Sprint 1`` y ``Sprint 10`` la más corta sería ``Sprint 1`` y se
    descartaría por error como si fuera la raíz.

    Devuelve ``""`` cuando no hay jerarquía, para no excluir nada.
    """
    rutas = {i.sprint for i in items if i.sprint}
    if len(rutas) < 2:
        return ""
    raices = [
        r for r in rutas if any(o.startswith(f"{r}\\") for o in rutas if o != r)
    ]
    if not raices:
        return ""
    return min(raices, key=lambda r: (len(r), r))
