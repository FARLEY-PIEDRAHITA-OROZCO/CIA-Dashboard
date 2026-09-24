"""Fixtures y dobles compartidos por las pruebas del backend."""

from typing import Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.application.services import ServicioBacklog
from app.config import Settings
from app.core.container import Contenedor
from app.domain.models import Epic, Feature, UserStory
from app.main import crear_app


def item_azure(
    id_: int,
    tipo: str,
    *,
    titulo: str = "",
    estado: str = "New",
    descripcion: str = "desc",
    hijos: Optional[List[int]] = None,
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
            return {"name": "CIA (Centro de Inteligencia Artificial)"}
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
        url="https://dev.azure.com/segurosmundial/CIA (Centro de Inteligencia Artificial)/_workitems/edit/100",
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


class FakeRepositorio:
    """Implementación del puerto `RepositorioBacklogPort` en memoria."""

    def __init__(self, epicas: Optional[List[Epic]] = None, arbol: Optional[Epic] = None) -> None:
        self.epicas = epicas or []
        self.arbol = arbol
        self.sintoma = None  # excepción opcional para simular fallos

    async def verificar_proyecto(self) -> Dict[str, str]:
        if self.sintoma:
            raise self.sintoma
        return {"proyecto": "CIA (Centro de Inteligencia Artificial)"}

    async def listar_epicas(self):
        if self.sintoma:
            raise self.sintoma
        return list(self.epicas)

    async def obtener_epica(self, epic_id: int):
        if self.sintoma:
            raise self.sintoma
        if self.arbol and self.arbol.azure_id == epic_id:
            return self.arbol
        return None


def contenedor_con(repo: FakeRepositorio, configurado: bool = True) -> Contenedor:
    from app.infrastructure.cache import CacheMemoria

    settings = Settings(
        azure_org_url="https://dev.azure.com/segurosmundial",
        azure_proyecto="CIA (Centro de Inteligencia Artificial)",
        area_path="CIA (Centro de Inteligencia Artificial)",
        azure_pat="seed",
    )
    cache = CacheMemoria()
    servicio = ServicioBacklog(
        repositorio=repo,
        cache=cache,
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
    )


@pytest.fixture
def cliente_fake() -> TestClient:
    """Cliente HTTP sobre la app con repositorio en memoria."""
    contenedor = contenedor_con(FakeRepositorio(epicas=[epica_canonica()], arbol=epica_canonica()))
    return TestClient(crear_app(contenedor))