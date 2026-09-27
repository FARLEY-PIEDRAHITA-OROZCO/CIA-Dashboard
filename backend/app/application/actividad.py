"""Actividad registrada en una épica, a partir del historial de revisiones.

Módulo aparte de `services.py` a propósito, por dos razones que no son
estilísticas:

- **Coste.** Cada ítem necesita su propia llamada a Azure: no existe un
  endpoint que dé el historial de varios ítems a la vez (medido, `workitems/
  {id}/updates` es uno a uno). Por eso esto se pide **por épica y bajo
  demanda**, nunca al abrir una vista. Como método más de `ServicioBacklog`
  acabaría siendo algo que alguien llama en un bucle sin ver el coste.
- **Naturaleza del dato.** Cuenta revisiones, no horas, y tiene un techo que
  depende de la antigüedad del ítem. Es un dato que hay que leer con un aviso
  al lado, y un método más en la clase de servicio lo escondería entre los demás.

Lo que **no** hace, y no por descuido: no estima esfuerzo. El registro de
tiempos de Azure responde 401 con el PAT de lectura (medido), así que no existe
ninguna fuente de horas en este sistema, y derivar «horas» desde revisiones
sería inventar una unidad que nadie ha medido.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Protocol, Tuple

from ..domain.models import ActividadEpica, Bug, Epic, Feature, Revision, Task, UserStory
from ..domain.ports import CachePort, RepositorioBacklogPort

logger = logging.getLogger("devops")

#: Cuántos historiales se piden a la vez.
#:
#: Suficiente para que una épica de 254 ítems no tarde lo que tardaría en serie
#: (medido: 5,8 s así, frente a lo que serían casi dos minutos), y poco para no
#: abrir 254 conexiones contra la misma organización. El límite de Azure son 300
#: simultáneas, así que el margen es amplio; el que manda aquí es no parecer un
#: abuso desde la red de la organización.
CONCURRENCIA = 8

CLAVE_ACTIVIDAD = "actividad:epica:{}:bugs"

NOTA_LECTURA = (
    "Actividad registrada = número de revisiones, no horas. Azure no expone el "
    "registro de tiempos con este PAT, así que no hay ninguna fuente de horas. "
    "Además los ítems antiguos suelen tener una sola revisión (la de creación) "
    "y los recientes muchas: compara solo épicas de antigüedad parecida."
)


class ArbolEpicaPort(Protocol):
    """Lo mínimo que este servicio necesita: el árbol de una épica.

    Protocolo en vez de importar `ServicioBacklog` para no arrastrar su
    superficie entera, y para que la prueba pueda pasar un árbol de tres líneas.
    """

    async def arbol_epica(
        self, epic_id: int, *, incluir_bugs: bool = False
    ) -> Optional[Epic]: ...


class ServicioActividad:
    """Agrega el historial de revisiones de una épica y de todo su árbol."""

    def __init__(
        self,
        repositorio: RepositorioBacklogPort,
        arbol: ArbolEpicaPort,
        cache: CachePort,
        *,
        ttl_seg: int = 900,
    ) -> None:
        self._repo = repositorio
        self._arbol = arbol
        self._cache = cache
        self._ttl_seg = float(ttl_seg)
        # Épicas agregadas por esta instancia, para poder olvidarlas sin que la
        # caché tenga que saber enumerar su contenido. `CachePort` no expone
        # `claves()` a propósito —es una caché de valores, no un índice— y
        # `limpiar()` serviría pero tiraría también la lista de épicas y los dos
        # índices, que es un rediseño de 10 s por cada escritura.
        self._cacheadas: set[int] = set()

    async def actividad_epica(self, epic_id: int) -> Optional[ActividadEpica]:
        """Actividad de la épica, o `None` si la épica ya no existe.

        Se piden bugs incluidos: un bug corregido es trabajo de la épica, y
        excluirlo haría que una épica con mucho trabajo de corrección pareciera
        quieta.
        """
        clave = CLAVE_ACTIVIDAD.format(epic_id)
        cached = self._cache.obtener(clave)
        if cached is not None:
            return cached

        epica = await self._arbol.arbol_epica(epic_id, incluir_bugs=True)
        if epica is None:
            return None

        items = _recorrer(epica)
        actividad = await self._agregar(epica, items)
        self._cache.guardar(clave, actividad, self._ttl_seg)
        self._cacheadas.add(epic_id)
        return actividad

    def invalidar(self) -> int:
        """Olvida **todas** las actividades agregadas. Devuelve cuántas borró.

        Se invalida entera, y no solo la épica del ítem editado, porque no se
        puede saber a qué épica pertenece: un ítem puede ser una tarea al fondo de
        un árbol y su épica no está en ningún lado. Invalidar solo una dejaría el
        resto de las actividades con el recuento anterior al cambio, que es
        justo el bug que esto evita.

        Solo se llama tras una escritura real, así que tirar la caché es
        aceptable: son 15 minutos de historial de una acción que alguien acaba de
        hacer y quiere ver reflejada.
        """
        for epic_id in list(self._cacheadas):
            self._cache.eliminar(CLAVE_ACTIVIDAD.format(epic_id))
        borradas = len(self._cacheadas)
        self._cacheadas.clear()
        if borradas:
            logger.info("Actividad invalidada para %d épica(s)", borradas)
        return borradas

    async def _agregar(self, epica: Epic, items: List[Tuple[int, str]]) -> ActividadEpica:
        """Lee el historial de cada ítem y lo agrega en un solo recuento.

        Un historial ilegible **no** aborta: marca `parcial` y sigue. La
        diferencia con la cobertura es el signo del error: allí un lote fallido
        hace parecer que hay más brecha de la que hay (sobrestimación); aquí un
        historial perdido hace parecer que hay menos actividad de la que hay
        (subestimación). En los dos casos el número solo vale como cota, y por eso
        viaja con `parcial`.
        """
        limite = asyncio.Semaphore(CONCURRENCIA)

        async def uno(item_id: int) -> Tuple[List[Revision], bool]:
            async with limite:
                try:
                    return await self._repo.historial_work_item(item_id), False
                except Exception as exc:  # noqa: BLE001 - se reporta como parcial
                    logger.warning(
                        "Historial ilegible del ítem %s (%s)", item_id, type(exc).__name__
                    )
                    return [], True

        resultados = await asyncio.gather(*(uno(item_id) for item_id, _ in items))

        por_persona: Dict[str, Dict] = {}
        por_tipo: Dict[str, int] = {}
        fechas: List[datetime] = []
        revisiones = 0
        leidos = 0
        fallidos = 0
        sin_actividad = 0

        for (_, tipo), (historial, fallo) in zip(items, resultados):
            if fallo:
                fallidos += 1
                continue
            leidos += 1
            por_tipo[tipo] = por_tipo.get(tipo, 0) + 1
            revs_utiles = 0
            for revision in historial:
                # La revisión 1 es la de creación, y llega con la fecha centinela.
                # Contarla como actividad de alguien daría la sensación de
                # trabajo de quien solo abrió el ítem.
                if revision.rev <= 1 and not revision.tiene_fecha:
                    continue
                revs_utiles += 1
                revisiones += 1
                if revision.tiene_fecha:
                    fechas.append(revision.fecha)  # type: ignore[arg-type]
                persona = revision.persona
                if persona is None:
                    continue
                # Sin GUID no se puede atribuir a nadie. Se descarta en vez de
                # agrupar bajo una clave vacía, que juntaría a personas distintas
                # en una sola entrada sin nombre.
                clave = (persona.guid or "").strip().lower()
                if not clave:
                    continue
                fila = por_persona.get(clave)
                if fila is None:
                    por_persona[clave] = {
                        "guid": persona.guid,
                        "nombre": persona.nombre or "Sin nombre",
                        "revisiones": 1,
                    }
                else:
                    fila["revisiones"] += 1
            if not revs_utiles:
                # «Abierto y nunca tocado». Cuenta también el historial vacío,
                # que es el mismo hecho visto desde el otro lado.
                sin_actividad += 1

        fechas.sort()
        return ActividadEpica(
            epica=epica.azure_id,
            titulo=epica.titulo,
            items_analizados=leidos,
            items_totales=len(items),
            revisiones=revisiones,
            personas=len(por_persona),
            primera=fechas[0] if fechas else None,
            ultima=fechas[-1] if fechas else None,
            por_persona=sorted(
                por_persona.values(),
                key=lambda f: (-int(f["revisiones"]), str(f["nombre"])),
            ),
            por_tipo=dict(sorted(por_tipo.items())),
            parcial=fallidos > 0,
            items_sin_actividad=sin_actividad,
            nota=NOTA_LECTURA,
        )


def _recorrer(epica: Epic) -> List[Tuple[int, str]]:
    """`(id, tipo)` de la épica y todo su árbol, sin duplicar por ID.

    Deduplica por ID porque un bug puede aparecer dos veces: como hijo de una
    historia y comobug relacionado. Contarlo dos veces inflaría el recuento, y
    «cuánto se ha trabajado» no mejora por contarlo dos veces.
    """
    vistos: Dict[int, str] = {}

    def registrar(nodo: object, tipo: str) -> None:
        item_id = getattr(nodo, "azure_id", 0)
        if isinstance(item_id, int) and item_id > 0:
            # `setdefault` y no asignación: gana el primer tipo con el que se vio
            # el ítem, que es el de la rama jerárquica, no el de un relacionado.
            vistos.setdefault(item_id, tipo)

    def visitar_hu(hu: UserStory) -> None:
        registrar(hu, "User Story")
        for tarea in hu.tareas:
            registrar(tarea, "Task")
        for bug in hu.bugs or []:
            visitar_bug(bug)

    def visitar_bug(bug: Bug) -> None:
        registrar(bug, "Bug")
        for tarea in bug.tareas:
            registrar(tarea, "Task")

    def visitar_feature(feature: Feature) -> None:
        registrar(feature, "Feature")
        for hu in feature.hus:
            visitar_hu(hu)

    registrar(epica, "Epic")
    for feature in epica.features:
        visitar_feature(feature)
    for hu in epica.hus:
        visitar_hu(hu)

    return sorted(vistos.items())


__all__ = [
    "ArbolEpicaPort",
    "CONCURRENCIA",
    "NOTA_LECTURA",
    "ServicioActividad",
]
