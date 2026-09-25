"""Adaptador de repositorio del backlog sobre la API de Azure DevOps.

Compone WIQL + ``workitems`` (batch con ``$expand=relations``) y camina un
grafo de work items para construir Épica -> Feature -> User Story -> Bug ->
Task. Las asociaciones ``Related`` se cargan de un solo salto y solo cuando el
destino es realmente un ``Bug``.

La carga es perezosa: el listado de épicas es liviano (sin hijos) y cada árbol
completo se construye solo bajo demanda durante el drill-down.
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set
from urllib.parse import quote

from ...domain.models import Bug, Epic, Feature, Task, UserStory
from ...domain.ports import RepositorioBacklogPort, TransportePort
from . import queries
from .transport import AzureError

logger = logging.getLogger("devops")


@dataclass
class _GrafoCargado:
    por_id: Dict[int, Dict] = field(default_factory=dict)
    relacionados: Dict[int, Set[int]] = field(default_factory=dict)
    stats: Dict[str, int] = field(default_factory=dict)


class AzureBacklogRepositorio(RepositorioBacklogPort):
    """Repositorio concreto sobre Azure DevOps (solo lectura)."""

    def __init__(
        self,
        org_url: str,
        proyecto: str,
        area_path: str,
        transporte: TransportePort,
    ) -> None:
        self._org_url = (org_url or "").strip().rstrip("/")
        self._proyecto = (proyecto or "").strip()
        self._area_path = (area_path or "").strip()
        self._transporte = transporte
        if not self._area_path:
            self._area_path = self._proyecto

    @property
    def _proyecto_codificado(self) -> str:
        return quote(self._proyecto, safe="")

    def _ruta_proyecto(self, sufijo: str) -> str:
        return f"{self._org_url}/{self._proyecto_codificado}/{sufijo.lstrip('/')}"

    def _url_workitem(self, azure_id: int) -> str:
        return self._ruta_proyecto(f"_workitems/edit/{int(azure_id)}")

    # ------------------------------------------------------------------ #
    # Contrato RepositorioBacklogPort
    # ------------------------------------------------------------------ #
    async def verificar_proyecto(self) -> Dict[str, str]:
        """Comprueba que el proyecto exista y el PAT tenga lectura."""
        # Es un endpoint Core de nivel organizacion. No usar _ruta_proyecto():
        # anteponer aqui el proyecto duplica el segmento y Azure responde 401.
        url = (
            f"{self._org_url}/_apis/projects/{self._proyecto_codificado}"
            f"?api-version={queries.API_VERSION}"
        )
        datos = await self._transporte.get(url)
        return {"proyecto": str(datos.get("name") or self._proyecto)}

    async def listar_epicas(self) -> List[Epic]:
        """Lista liviana de épicas, sin hijos ni payload innecesario."""
        ids = await self._ejecutar_wiql(queries.wiql_epicas(self._area_path))
        if not ids:
            return []
        items = await self._detallar_lote(
            ids,
            incluir_relaciones=False,
            campos=queries.CAMPOS_LISTADO,
        )
        return [
            self._a_epica_resumen(item)
            for id_ in ids
            if (item := items.get(id_)) is not None
        ]

    async def obtener_epica(
        self,
        epic_id: int,
        *,
        incluir_bugs: bool = False,
    ) -> Optional[Epic]:
        """Árbol completo de una épica, construido bajo demanda."""
        return await self._obtener_epica_sin_cache(epic_id, incluir_bugs=incluir_bugs)

    async def _obtener_epica_sin_cache(
        self,
        epic_id: int,
        *,
        incluir_bugs: bool = False,
    ) -> Optional[Epic]:
        """Construye el grafo y su árbol de dominio desde Azure."""
        inicio = time.perf_counter()
        raiz = await self._obtener_item(epic_id)
        if queries.tipo(raiz) != "Epic":
            raise AzureError(f"El work item {epic_id} no es una épica.")

        grafo = await self._cargar_grafo(raiz, incluir_bugs=incluir_bugs)
        arbol = self._construir_arbol(
            grafo.por_id,
            epic_id,
            relacionados=grafo.relacionados,
            incluir_bugs=incluir_bugs,
        )
        epica = self._a_modelo(arbol)
        grafo.stats["duration_ms"] = int((time.perf_counter() - inicio) * 1000)
        logger.info(
            "Carga de épica %s: items=%d batches=%d hierarchy_edges=%d "
            "related_edges=%d bugs=%d duration_ms=%d",
            epic_id,
            grafo.stats.get("items", 0),
            grafo.stats.get("batches", 0),
            grafo.stats.get("hierarchy_edges", 0),
            grafo.stats.get("related_edges", 0),
            grafo.stats.get("bugs", 0),
            grafo.stats.get("duration_ms", 0),
        )
        return epica

    # ------------------------------------------------------------------ #
    # HTTP / construcción del grafo
    # ------------------------------------------------------------------ #
    async def _ejecutar_wiql(self, consulta: str) -> List[int]:
        url = self._ruta_proyecto(
            f"_apis/wit/wiql?api-version={queries.API_VERSION}"
        )
        try:
            resultado = await self._transporte.post(url, {"query": consulta})
        except AzureError:
            raise
        except Exception as exc:  # noqa: BLE001 - envolver a error de dominio
            raise AzureError(
                f"No se pudo ejecutar la consulta WIQL ({type(exc).__name__})."
            ) from exc

        ids: List[int] = []
        for item in resultado.get("workItems") or []:
            try:
                id_ = int(item.get("id", 0))
            except (AttributeError, TypeError, ValueError):
                continue
            if id_ > 0:
                ids.append(id_)
        return ids

    async def _obtener_item(self, id_: int) -> Dict:
        url = self._ruta_proyecto(
            f"_apis/wit/workitems/{id_}"
            f"?$expand=relations&api-version={queries.API_VERSION}"
        )
        return await self._transporte.get(url)

    async def _detallar_lote(
        self,
        ids: list[int],
        *,
        incluir_relaciones: bool,
        campos: str,
    ) -> Dict[int, Dict]:
        """Resuelve lotes de work items, opcionalmente con relaciones."""
        result: Dict[int, Dict] = {}
        for inicio in range(0, len(ids), queries.TAMANO_LOTE_API):
            lote = ids[inicio : inicio + queries.TAMANO_LOTE_API]
            parametros = ",".join(str(i) for i in lote)
            query = f"ids={parametros}"
            if incluir_relaciones:
                query += "&$expand=relations"
            query += f"&$fields={quote(campos, safe=',')}"
            query += f"&api-version={queries.API_VERSION}"
            url = self._ruta_proyecto(f"_apis/wit/workitems?{query}")
            datos = await self._transporte.get(url)
            for item in datos.get("value") or []:
                if not isinstance(item, dict):
                    continue
                try:
                    id_ = int(item.get("id", 0))
                except (AttributeError, TypeError, ValueError):
                    continue
                if id_ > 0:
                    result[id_] = item
        return result

    async def _cargar_grafo(
        self,
        raiz: Dict,
        *,
        incluir_bugs: bool,
    ) -> _GrafoCargado:
        """Carga jerarquía y asociaciones Related sin seguir ciclos."""
        grafo = _GrafoCargado(
            por_id={int(raiz["id"]): raiz},
            stats={
                "items": 1,
                "batches": 0,
                "hierarchy_edges": 0,
                "related_edges": 0,
            },
        )
        pendientes: deque[int] = deque([int(raiz["id"])])
        procesados: Set[int] = set()
        hijos_por_padre: Dict[int, List[int]] = {}

        while pendientes:
            nivel = list(pendientes)
            pendientes.clear()
            nuevos: List[int] = []
            for actual in nivel:
                if actual in procesados or actual not in grafo.por_id:
                    continue
                procesados.add(actual)
                hijos = queries.ids_relaciones_hijas(grafo.por_id[actual])
                hijos_por_padre[actual] = hijos
                grafo.stats["hierarchy_edges"] += len(hijos)
                for hijo in hijos:
                    if hijo not in grafo.por_id and hijo not in nuevos:
                        nuevos.append(hijo)
            if not nuevos:
                continue
            grafo.stats["batches"] += self._numero_lotes(nuevos)
            recibidos = await self._detallar_lote(
                nuevos,
                incluir_relaciones=True,
                campos=queries.CAMPOS_ARBOL,
            )
            grafo.por_id.update(recibidos)
            grafo.stats["items"] = len(grafo.por_id)

            for padre, hijos in hijos_por_padre.items():
                permitidos = queries.hijos_permitidos(
                    queries.tipo(grafo.por_id[padre]), incluir_bugs
                )
                for hijo in hijos:
                    item = grafo.por_id.get(hijo)
                    if item is None or hijo in procesados:
                        continue
                    if queries.tipo(item) in permitidos:
                        pendientes.append(hijo)

        if incluir_bugs:
            await self._cargar_relacionados(grafo)

        grafo.stats["bugs"] = sum(
            1 for item in grafo.por_id.values() if queries.tipo(item) == "Bug"
        )
        return grafo

    async def _cargar_relacionados(self, grafo: _GrafoCargado) -> None:
        pares: List[tuple[int, int]] = []
        destinos: Set[int] = set()
        for origen, item in grafo.por_id.items():
            for destino in queries.ids_relaciones_asociadas(item):
                pares.append((origen, destino))
                destinos.add(destino)

        grafo.stats["related_edges"] = len(pares)
        faltantes = sorted(destinos - set(grafo.por_id))
        if faltantes:
            grafo.stats["batches"] += self._numero_lotes(faltantes)
            grafo.por_id.update(
                await self._detallar_lote(
                    faltantes,
                    incluir_relaciones=False,
                    campos=queries.CAMPOS_LISTADO,
                )
            )
            grafo.stats["items"] = len(grafo.por_id)

        for origen, destino in pares:
            origen_item = grafo.por_id.get(origen)
            destino_item = grafo.por_id.get(destino)
            if origen_item is None or destino_item is None:
                continue
            origen_tipo = queries.tipo(origen_item)
            destino_tipo = queries.tipo(destino_item)
            if destino_tipo in queries.TIPOS_ASOCIADOS:
                grafo.relacionados.setdefault(origen, set()).add(destino)
            elif origen_tipo in queries.TIPOS_ASOCIADOS:
                # Related es bidireccional: si solo aparece en el Bug, se
                # proyecta al HU/tarea que lo referencia.
                grafo.relacionados.setdefault(destino, set()).add(origen)

    @staticmethod
    def _numero_lotes(ids: list[int]) -> int:
        return (len(ids) + queries.TAMANO_LOTE_API - 1) // queries.TAMANO_LOTE_API

    def _construir_arbol(
        self,
        por_id: Dict[int, Dict],
        raiz_id: int,
        *,
        relacionados: Dict[int, Set[int]],
        incluir_bugs: bool,
    ) -> Dict:
        """Construye el grafo restringido a la política de descendencia."""

        def nodo_base(item: Dict, tipo_actual: str, relacion: str = "hierarchy") -> Dict:
            return {
                "tipo": tipo_actual,
                "azure_id": int(item.get("id", 0)),
                "titulo": queries.campo(item, queries.CAMPO_TITULO),
                "estado": queries.campo(item, queries.CAMPO_ESTADO),
                "descripcion": queries.campo(item, queries.CAMPO_DESCRIPCION),
                "relacion": relacion,
            }

        def bug_relacionado(bug_id: int) -> Dict:
            item = por_id[bug_id]
            nodo = nodo_base(item, "Bug", relacion="related")
            nodo.update(
                {
                    "prioridad": queries.campo(item, queries.CAMPO_PRIORIDAD),
                    "severidad": queries.campo(item, queries.CAMPO_SEVERIDAD),
                    "asignado_a": queries.campo(item, queries.CAMPO_ASIGNADO),
                    "tareas": [],
                }
            )
            return nodo

        def construir(item_id: int, ancestors: Set[int]) -> Optional[Dict]:
            if item_id in ancestors:
                return None
            item = por_id.get(item_id)
            if item is None:
                return None
            tipo_actual = queries.tipo(item)
            nodo = nodo_base(item, tipo_actual)
            if tipo_actual == "Bug":
                nodo.update(
                    {
                        "prioridad": queries.campo(item, queries.CAMPO_PRIORIDAD),
                        "severidad": queries.campo(item, queries.CAMPO_SEVERIDAD),
                        "asignado_a": queries.campo(item, queries.CAMPO_ASIGNADO),
                    }
                )

            permitidos = queries.hijos_permitidos(tipo_actual, incluir_bugs)
            hijos = [
                hijo
                for hijo in queries.ids_relaciones_hijas(item)
                if hijo in por_id
                and queries.tipo(por_id[hijo]) in permitidos
                and hijo not in ancestors
            ]
            siguiente = set(ancestors)
            siguiente.add(item_id)

            if "Feature" in permitidos:
                nodo["features"] = [
                    hijo_nodo
                    for hijo in hijos
                    if queries.tipo(por_id[hijo]) == "Feature"
                    if (hijo_nodo := construir(hijo, siguiente)) is not None
                ]
            if "User Story" in permitidos:
                nodo["hus"] = [
                    hijo_nodo
                    for hijo in hijos
                    if queries.tipo(por_id[hijo]) == "User Story"
                    if (hijo_nodo := construir(hijo, siguiente)) is not None
                ]
            if "Task" in permitidos:
                nodo["tareas"] = [
                    hijo_nodo
                    for hijo in hijos
                    if queries.tipo(por_id[hijo]) == "Task"
                    if (hijo_nodo := construir(hijo, siguiente)) is not None
                ]
            if incluir_bugs and tipo_actual in {"User Story", "Task"}:
                jerarquicos = [
                    hijo
                    for hijo in hijos
                    if queries.tipo(por_id[hijo]) == "Bug"
                ]
                bugs = [
                    hijo_nodo
                    for hijo in jerarquicos
                    if (hijo_nodo := construir(hijo, siguiente)) is not None
                ]
                ya_incluidos = set(jerarquicos)
                bugs.extend(
                    bug_relacionado(hijo)
                    for hijo in sorted(relacionados.get(item_id, set()))
                    if hijo in por_id
                    and queries.tipo(por_id[hijo]) == "Bug"
                    and hijo not in ya_incluidos
                )
                nodo["bugs"] = bugs
            return nodo

        raiz = construir(raiz_id, set())
        if raiz is None:
            raise AzureError(f"El work item {raiz_id} no es una épica.")
        return raiz

    def _a_modelo(self, nodo: Dict[str, Any]):
        """Convierte el dict del grafo a los modelos Pydantic del dominio."""
        comun = {
            "azure_id": int(nodo["azure_id"]),
            "titulo": nodo.get("titulo", ""),
            "estado": nodo.get("estado", ""),
            "descripcion": nodo.get("descripcion", ""),
            "url": self._url_workitem(int(nodo["azure_id"])),
        }
        tipo_actual = nodo.get("tipo", "")
        if tipo_actual == "Epic":
            return Epic(
                **comun,
                features=[self._a_modelo(item) for item in nodo.get("features", [])],
                hus=[self._a_modelo(item) for item in nodo.get("hus", [])],
            )
        if tipo_actual == "Feature":
            return Feature(
                **comun,
                hus=[self._a_modelo(item) for item in nodo.get("hus", [])],
            )
        if tipo_actual == "User Story":
            return UserStory(
                **comun,
                tareas=[self._a_modelo(item) for item in nodo.get("tareas", [])],
                bugs=(
                    [self._a_modelo(item) for item in nodo["bugs"]]
                    if nodo.get("bugs") is not None
                    else None
                ),
            )
        if tipo_actual == "Task":
            return Task(
                **comun,
                bugs=(
                    [self._a_modelo(item) for item in nodo["bugs"]]
                    if nodo.get("bugs") is not None
                    else None
                ),
            )
        if tipo_actual == "Bug":
            return Bug(
                **comun,
                prioridad=nodo.get("prioridad", ""),
                severidad=nodo.get("severidad", ""),
                asignado_a=nodo.get("asignado_a", ""),
                relacion=nodo.get("relacion", "hierarchy"),
                tareas=[self._a_modelo(item) for item in nodo.get("tareas", [])],
            )
        raise AzureError(f"Tipo de work item no soportado: {tipo_actual or 'desconocido'}.")

    def _a_epica_resumen(self, item: Dict) -> Epic:
        id_ = int(item.get("id", 0))
        return Epic(
            azure_id=id_,
            titulo=queries.campo(item, queries.CAMPO_TITULO),
            estado=queries.campo(item, queries.CAMPO_ESTADO),
            descripcion=queries.campo(item, queries.CAMPO_DESCRIPCION),
            url=self._url_workitem(id_),
        )
