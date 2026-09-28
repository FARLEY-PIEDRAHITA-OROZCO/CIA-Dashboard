"""Fixtures y dobles compartidos por las pruebas del backend."""

from typing import Dict, List, Optional, Set, Tuple
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.application.actividad import ServicioActividad
from app.application.indice import IndiceWorkItems
from app.application.indice_pruebas import IndicePruebas
from app.application.registro import ServicioRegistro
from app.application.services import ServicioBacklog
from app.config import Settings
from app.core.container import Contenedor
from app.domain.models import (
    Bug,
    CargaPruebas,
    Epic,
    Feature,
    Instantanea,
    ItemIndice,
    ItemPrueba,
    Persona,
    Revision,
    Task,
    UserStory,
)
from app.domain.ports import RegistroAsignacionesPort
from app.infrastructure.azure.transport import AzureError
from app.infrastructure.registro_copia import RegistroConCopia
from app.infrastructure.registro_json import RegistroModificado
from app.main import crear_app


def item_azure(
    id_: int,
    tipo: str,
    *,
    titulo: str = "",
    estado: str = "New",
    descripcion: str = "desc",
    tags: str = "",
    sprint: str = "",
    asignado: Optional[Tuple[str, str]] = None,
    creado: str = "2026-09-01T10:00:00Z",
    modificado: str = "2026-09-20T15:30:00Z",
    hijos: Optional[List[int]] = None,
    relacionados: Optional[List[int]] = None,
) -> Dict:
    """Work item de Azure DevOps en formato JSON (fields + relations)."""
    campos: Dict = {
        "System.Id": id_,
        "System.WorkItemType": tipo,
        "System.Title": titulo or f"{tipo} {id_}",
        "System.State": estado,
        "System.Description": descripcion,
        "System.Tags": tags,
        "System.IterationPath": sprint,
        "System.CreatedDate": creado,
        "System.ChangedDate": modificado,
    }
    if asignado is not None:
        guid, nombre = asignado
        campos["System.AssignedTo"] = {
            "id": guid,
            "displayName": nombre,
            "url": f"https://vssps.dev.azure.com/_apis/GraphProfile/Members/{guid}",
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
        #: Respuesta de `_apis/wit/workitems/{id}/updates`. Se fija por prueba
        #: porque el historial es de un ítem y no hay forma de cocinarlo todas
        #: las URLs a la vez.
        self.actualizaciones: Dict = {"value": []}

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
        if "/updates" in url:
            # Antes de la rama de un solo ítem: la ruta lleva `/updates` detrás
            # del ID y `int()` reventaría con «40983/updates».
            return self.actualizaciones
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

    def __init__(
        self,
        epicas: Optional[List[Epic]] = None,
        arbol: Optional[Epic] = None,
        items_indice: Optional[List["ItemIndice"]] = None,
        activos_prueba: Optional[List["ItemPrueba"]] = None,
        lotes_prueba_con_error: int = 0,
        lotes_prueba_totales: int = 0,
        historiales: Optional[Dict[int, List["Revision"]]] = None,
        historiales_fallan: Optional[Set[int]] = None,
    ) -> None:
        self.epicas = epicas or []
        self.arbol = arbol
        self.items_indice = items_indice or []
        self.activos_prueba = activos_prueba or []
        self.lotes_prueba_con_error = lotes_prueba_con_error
        self.lotes_prueba_totales = lotes_prueba_totales
        self.historiales = historiales or {}
        self.historiales_fallan = historiales_fallan or set()
        self.llamadas_indice = 0
        self.llamadas_indice_pruebas = 0
        self.llamadas_historial: List[int] = []
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

    async def listar_work_items(self, tipos=None) -> List["ItemIndice"]:
        """Proyección plana del índice; cuenta llamadas para probar la caché."""
        if self.sintoma:
            raise self.sintoma
        self.llamadas_indice += 1
        return list(self.items_indice)

    async def listar_activos_prueba(self, tipos=None) -> "CargaPruebas":
        """Activos de prueba; cuenta llamadas y puede simular lotes fallidos.

        `lotes_prueba_con_error` permite probar que la cobertura se declara
        **parcial** cuando un lote no se pudo leer, en vez de publicar una cifra
        completa que en realidad cuenta huecos como si fueran ceros.
        """
        if self.sintoma:
            raise self.sintoma
        self.llamadas_indice_pruebas += 1
        return CargaPruebas(
            items=list(self.activos_prueba),
            lotes_con_error=self.lotes_prueba_con_error,
            lotes_totales=self.lotes_prueba_totales or 1,
        )

    async def historial_work_item(self, work_item_id: int) -> List["Revision"]:
        """Historial de revisiones de un ítem, desde `historiales`.

        Un ID que no está en el diccionario devuelve lista vacía, que es un dato
        (un ítem sin revisiones) y no un error. `historiales_fallan` permite
        comprobar que un historial ilegible marca la actividad como **parcial**.
        """
        self.llamadas_historial.append(work_item_id)
        if work_item_id in self.historiales_fallan:
            raise AzureError("historial no disponible")
        return list(self.historiales.get(work_item_id, []))


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


class RegistroMemoria(RegistroAsignacionesPort):
    """Doble del registro para las pruebas de la API.

    El adaptador real (`RegistroJson`) tiene sus propias pruebas, con fichero
    temporal. Aquí interesa que las rutas de la API no toquen disco: un test que
    escribiese en `backend/datos/asignaciones.json` dejaría basura en el repo y
    podría, con mala suerte, pisar el registro real de alguien.
    """

    def __init__(self) -> None:
        self.datos = Instantanea()
        self.escrituras = 0

    async def leer(self) -> Instantanea:
        return self.datos

    async def guardar(self, instantanea: Instantanea) -> Instantanea:
        if self.datos.hash != (instantanea.hash or ""):
            raise RegistroModificado("el registro cambió en disco")
        self.datos = instantanea
        self.escrituras += 1
        return instantanea


def contenedor_con(
    repo: FakeRepositorio,
    configurado: bool = True,
    *,
    escritura: Optional[FakeEscritura] = None,
    registro: Optional[RegistroAsignacionesPort] = None,
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
    indice = IndiceWorkItems(repo, cache)
    indice_pruebas = IndicePruebas(repo, cache, indice)
    registro_real = registro or RegistroMemoria()
    return Contenedor(
        settings=settings,
        transporte=SabanaTransporte([], []),
        repositorio=repo,
        cache=cache,
        servicio=servicio,
        indice=indice,
        indice_pruebas=indice_pruebas,
        registro_principal=registro_real,
        # Sin destino: el decorador es un passthrough exacto y las pruebas del
        # registro se centran en el servicio, no en la copia. La copia tiene sus
        # propias pruebas, con ficheros de verdad, en `test_registro_copia.py`.
        registro_copia=RegistroConCopia(registro_real, Path("datos/asignaciones.json"), None),
        servicio_registro=ServicioRegistro(registro_real, indice, indice_pruebas),
        # ttl_seg=0 como la caché del servicio: la actividad no debe sobrevivir
        # entre pruebas. El árbol sí lo aporta el servicio (mismo `cache`).
        actividad=ServicioActividad(repo, servicio, cache, ttl_seg=0),
        escritura=escritura,
    )


@pytest.fixture
def cliente_fake() -> TestClient:
    """Cliente HTTP sobre la app con repositorio en memoria."""
    contenedor = contenedor_con(FakeRepositorio(epicas=[epica_canonica()], arbol=epica_canonica()))
    return TestClient(crear_app(contenedor))