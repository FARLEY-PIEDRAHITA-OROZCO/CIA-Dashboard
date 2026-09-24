"""Adaptador de repositorio del backlog sobre la API de Azure DevOps.

Compone WIQL + ``workitems`` (batch con ``$expand=relations``) y camina las
relaciones jerárquicas para armar el árbol Épica -> Feature -> User Story -> Task.
La carga es perezosa: el listado de épicas es liviano (sin hijos) y cada
árbol completo se construye solo bajo demanda durante el drill-down.
"""

import logging
from collections import deque
from typing import Dict, List, Optional
from urllib.parse import quote

from ...domain.models import Epic, Feature, Task, UserStory
from ...domain.ports import RepositorioBacklogPort, TransportePort
from . import queries
from .transport import AzureError

logger = logging.getLogger("devops")


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
        url = self._ruta_proyecto(
            f"_apis/projects/{quote(self._proyecto, safe='')}"
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

    async def obtener_epica(self, epic_id: int) -> Optional[Epic]:
        """Árbol completo de una épica, construido bajo demanda."""
        return await self._obtener_epica_sin_cache(epic_id)

    async def _obtener_epica_sin_cache(self, epic_id: int) -> Optional[Epic]:
        """Construye el árbol desde Azure mediante BFS por niveles."""
        raiz = await self._obtener_item(epic_id)
        if queries.tipo(raiz) != "Epic":
            raise AzureError(f"El work item {epic_id} no es una épica.")

        por_id: Dict[int, Dict] = {epic_id: raiz}
        pendientes: deque[int] = deque([epic_id])
        while pendientes:
            nivel = list(pendientes)
            pendientes.clear()
            nuevos: List[int] = []
            for actual in nivel:
                if actual not in por_id:
                    continue
                for hijo in queries.ids_relaciones_hijas(por_id[actual]):
                    if hijo not in por_id and hijo not in nuevos:
                        nuevos.append(hijo)
            if not nuevos:
                continue
            recibidos = await self._detallar_lote(
                nuevos,
                incluir_relaciones=True,
                campos=queries.CAMPOS_ARBOL,
            )
            for id_, item in recibidos.items():
                if id_ in nuevos:
                    por_id[id_] = item
            pendientes.extend(id_ for id_ in nuevos if id_ in por_id)

        arbol = self._construir_arbol(por_id, epic_id)
        return self._a_epica(por_id[epic_id], arbol)

    # ------------------------------------------------------------------ #
    # HTTP / construcción del árbol
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

    @staticmethod
    def _construir_arbol(por_id: Dict[int, Dict], raiz_id: int) -> Dict:
        """Construye el árbol dict restringido a los tipos permitidos."""

        def construir(tid: int) -> Dict:
            item = por_id[tid]
            tipo_actual = queries.tipo(item)
            nodo = {
                "azure_id": tid,
                "titulo": queries.campo(item, queries.CAMPO_TITULO),
                "estado": queries.campo(item, queries.CAMPO_ESTADO),
                "descripcion": queries.campo(item, queries.CAMPO_DESCRIPCION),
            }
            permitidos = queries.TIPOS_HIJOS.get(tipo_actual, ())
            hijos = [
                h for h in queries.ids_relaciones_hijas(item) if h in por_id
            ]
            if "Feature" in permitidos:
                nodo["features"] = [
                    construir(h)
                    for h in hijos
                    if queries.tipo(por_id[h]) == "Feature"
                ]
            if "User Story" in permitidos:
                nodo["hus"] = [
                    construir(h)
                    for h in hijos
                    if queries.tipo(por_id[h]) == "User Story"
                ]
            if "Task" in permitidos:
                nodo["tareas"] = [
                    construir(h)
                    for h in hijos
                    if queries.tipo(por_id[h]) == "Task"
                ]
            return nodo

        return construir(raiz_id)

    def _a_epica_resumen(self, item: Dict) -> Epic:
        id_ = int(item.get("id", 0))
        return Epic(
            azure_id=id_,
            titulo=queries.campo(item, queries.CAMPO_TITULO),
            estado=queries.campo(item, queries.CAMPO_ESTADO),
            descripcion=queries.campo(item, queries.CAMPO_DESCRIPCION),
            url=self._url_workitem(id_),
        )

    def _a_epica(self, item: Dict, arbol: Dict) -> Epic:
        return Epic(
            azure_id=int(item.get("id", 0)),
            titulo=queries.campo(item, queries.CAMPO_TITULO),
            estado=queries.campo(item, queries.CAMPO_ESTADO),
            descripcion=queries.campo(item, queries.CAMPO_DESCRIPCION),
            url=self._url_workitem(int(item.get("id", 0))),
            features=[
                Feature(
                    azure_id=ft["azure_id"],
                    titulo=ft["titulo"],
                    estado=ft["estado"],
                    descripcion=ft["descripcion"],
                    url=self._url_workitem(ft["azure_id"]),
                    hus=[
                        UserStory(
                            azure_id=hu["azure_id"],
                            titulo=hu["titulo"],
                            estado=hu["estado"],
                            descripcion=hu["descripcion"],
                            url=self._url_workitem(hu["azure_id"]),
                            tareas=[
                                Task(
                                    azure_id=tarea["azure_id"],
                                    titulo=tarea["titulo"],
                                    estado=tarea["estado"],
                                    descripcion=tarea["descripcion"],
                                    url=self._url_workitem(tarea["azure_id"]),
                                )
                                for tarea in hu.get("tareas", [])
                            ],
                        )
                        for hu in ft.get("hus", [])
                    ],
                )
                for ft in arbol.get("features", [])
            ],
            hus=[
                UserStory(
                    azure_id=hu["azure_id"],
                    titulo=hu["titulo"],
                    estado=hu["estado"],
                    descripcion=hu["descripcion"],
                    url=self._url_workitem(hu["azure_id"]),
                    tareas=[
                        Task(
                            azure_id=tarea["azure_id"],
                            titulo=tarea["titulo"],
                            estado=tarea["estado"],
                            descripcion=tarea["descripcion"],
                            url=self._url_workitem(tarea["azure_id"]),
                        )
                        for tarea in hu.get("tareas", [])
                    ],
                )
                for hu in arbol.get("hus", [])
            ],
        )
