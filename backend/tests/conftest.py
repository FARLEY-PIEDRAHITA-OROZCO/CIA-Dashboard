"""Fixtures y dobles compartidos por las pruebas del backend."""

from typing import Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.application.services import ServicioBacklog
from app.config import Settings
from app.core.container import Contenedor
from app.domain.models import Bug, Epic, Feature, Task, UserStory
from app.main import crear_app


def item_azure(
    id_: int,
    tipo: str,
    *,
    titulo: str = "",
    estado: str = "New",
    descripcion: str = "desc",
    hijos: Optional[List[int]] = None,
    relacionados: Optional[List[int]] = None,
) -> Dict:
    """Work item de Azure DevOps en formato JSON (fields + relations)."""
    campos = {
        "System.Id": id_,
        "System.WorkItemType": tipo,
        "System.Title": titulo or f"{tipo} {id_}",
        "System.State": estado,
        "System.Description": descripcion,
    }
    relaciones = [
        {"rel": "System.LinkTypes.Hierarchy-Forward", "url": f"https://dev.azure.com/o/p/_apis/wit/workitems/{h}"}
        for h in (hijos or [])
    ]
    relaciones.extend(
        {"rel": "System.LinkTypes.Related", "url": f"https://dev.azure.com/o/p/_apis/wit/workitems/{r}"}
        for r in (relacionados or [])
    )
    return {"id": id_, "fields": campos, "relations": relaciones}


class SabanaTransporte:
    """Transporte fake que responde con JSON cocinado según la URL."""

    def __init__(self, wiql_ids: List[int], items: List[Dict]) -> None:
        self.wiql_ids = wiql_ids
        self.items = {int(i["id"]): i for i in items}
        self.llamadas: List[tuple] = []

    async def post(self, url: str, body: Optional[Dict] = None) -> Dict:
        self.llamadas.append(("post", url))
        return {"workItems": [{"id": i} for i in self.wiql_ids]}

    async def get(self, url: str, params: Optional[Dict] = None) -> Dict:
        self.llamadas.append(("get", url))
        if "/_apis/projects/" in url:
            return {"name": "Proyecto de ejemplo"}
        if "/workitems?" in url:
            ids_str = url.split("ids=")[1].split("&")[0]
            ids = [int(x) for x in ids_str.split(",")]
            return {"value": [self.items[i] for i in ids if i in self.items]}
        id_ = int(url.split("/workitems/")[1].split("?")[0])
        return self.items[id_]

    async def cerrar(self) -> None:
        return None


def epica_canonica() -> Epic:
    """Épica con features y user stories de ejemplo (dominio)."""
    return Epic(
        azure_id=100,
        titulo="Épica del canal digital",
        estado="In Progress",
        url="https://dev.azure.com/organizacion-ejemplo/Proyecto de ejemplo/_workitems/edit/100",
        features=[
            Feature(
                azure_id=101,
                titulo="Feature Onboarding",
                estado="Committed",
                hus=[UserStory(azure_id=201, titulo="HU Registro", estado="New")],
            ),
            Feature(
                azure_id=102,
                titulo="Feature Pagos",
                estado="New",
                hus=[UserStory(azure_id=202, titulo="HU Pago PSE", estado="In Progress")],
            ),
        ],
    )


def epica_con_bugs() -> Epic:
    """Épica con bug jerárquico, bug relacionado y una tarea con bug."""
    return Epic(
        azure_id=100,
        titulo="Épica con bugs",
        estado="Active",
        url="https://dev.azure.com/organizacion-ejemplo/Proyecto de ejemplo/_workitems/edit/100",
        hus=[
            UserStory(
                azure_id=201,
                titulo="HU con bugs",
                estado="Active",
                bugs=[
                    Bug(
                        azure_id=300,
                        titulo="Bug jerárquico",
                        estado="Active",
                        prioridad="1",
                        severidad="Critical",
                        relacion="hierarchy",
                        tareas=[Task(azure_id=301, titulo="Tarea del bug")],
                    ),
                    Bug(
                        azure_id=302,
                        titulo="Bug resuelto",
                        estado="Closed",
                        relacion="related",
                    ),
                ],
                tareas=[Task(azure_id=400, titulo="Tarea directa")],
            )
        ],
    )


def epica_con_bug_en_feature() -> Epic:
    """Épica con un bug bajo una HU que vive dentro de una Feature."""
    return Epic(
        azure_id=100,
        titulo="Épica con feature",
        features=[
            Feature(
                azure_id=101,
                titulo="Feature",
                hus=[
                    UserStory(
                        azure_id=201,
                        titulo="HU",
                        bugs=[Bug(azure_id=300, titulo="Bug", estado="Active")],
                    )
                ],
            )
        ],
    )


class FakeRepositorio:
    """Implementación del puerto `RepositorioBacklogPort` en memoria."""

    def __init__(self, epicas: Optional[List[Epic]] = None, arbol: Optional[Epic] = None) -> None:
        self.epicas = epicas or []
        self.arbol = arbol
        self.sintoma = None  # excepción opcional para simular fallos

    async def verificar_proyecto(self) -> Dict[str, str]:
        if self.sintoma:
            raise self.sintoma
        return {"proyecto": "Proyecto de ejemplo"}

    async def listar_epicas(self):
        if self.sintoma:
            raise self.sintoma
        return list(self.epicas)

    async def obtener_epica(self, epic_id: int, *, incluir_bugs: bool = False):
        if self.sintoma:
            raise self.sintoma
        if self.arbol and self.arbol.azure_id == epic_id:
            return self.arbol
        return None


class FakeEscritura:
    """Doble de `EscrituraBacklogPort` para las pruebas de la API."""

    def __init__(
        self,
        rev: int = 4,
        error: Optional[Exception] = None,
    ) -> None:
        self.rev = rev
        self.error = error
        self.llamadas: List[tuple] = []
        self.revisiones: List[int] = []

    async def actualizar_work_item(
        self,
        work_item_id: int,
        cambios,
        *,
        validar: bool = False,
        rev_esperada: Optional[int] = None,
    ):
        campos = cambios.campos_modificados()
        self.llamadas.append((work_item_id, campos, validar, rev_esperada))
        if self.error is not None:
            raise self.error
        from app.domain.models import ResultadoActualizacion

        return ResultadoActualizacion(
            work_item_id=work_item_id,
            rev=self.rev,
            campos=campos,
            validado=validar,
            detalle="validado" if validar else "aplicado",
        )

    async def obtener_revision(self, work_item_id: int) -> int:
        self.revisiones.append(work_item_id)
        return self.rev


def contenedor_con(
    repo: FakeRepositorio,
    configurado: bool = True,
    *,
    escritura: Optional[FakeEscritura] = None,
) -> Contenedor:
    from app.infrastructure.cache import CacheMemoria

    settings = Settings(
        azure_org_url="https://dev.azure.com/organizacion-ejemplo",
        azure_proyecto="Proyecto de ejemplo",
        area_path="Proyecto de ejemplo",
        azure_pat="seed",
        azure_pat_escritura="seed-escritura" if escritura else "",
        escritura_habilitada=escritura is not None,
    )
    cache = CacheMemoria()
    servicio = ServicioBacklog(
        repositorio=repo,
        cache=cache,
        escritura=escritura,
        escritura_habilitada=escritura is not None,
        ttl_seg=0,  # toda cascada guardada expira al instante -> cache neutral
        configuracion=configurado,
        organizacion=settings.azure_org_url,
        proyecto=settings.azure_proyecto,
        area_path=settings.area_path_efectivo,
    )
    return Contenedor(
        settings=settings,
        transporte=SabanaTransporte([], []),
        repositorio=repo,
        cache=cache,
        servicio=servicio,
        escritura=escritura,
    )


@pytest.fixture
def cliente_fake() -> TestClient:
    """Cliente HTTP sobre la app con repositorio en memoria."""
    contenedor = contenedor_con(FakeRepositorio(epicas=[epica_canonica()], arbol=epica_canonica()))
    return TestClient(crear_app(contenedor))