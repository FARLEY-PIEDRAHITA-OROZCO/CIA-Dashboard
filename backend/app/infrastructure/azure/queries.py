"""Consultas WIQL y utilidades de campos de work items de Azure DevOps.

Vocabulario estable de la API 7.x de Work Item Tracking. Se centralizan aquí
los nombres de campos, la política de relaciones y la construcción de la
consulta de épicas para que el repositorio solo se ocupe de orquestar llamadas
y mapear resultados.
"""

from typing import Dict

# Versión de API REST de Azure DevOps usada por todo el transporte.
API_VERSION = "7.1"

# Tipos de work item que se traen en el tree y sus hijos permitidos.
# ``incluir_bugs`` se aplica en el repositorio; esta tabla es la política
# base del grafo y no mezcla detalles de HTTP.
TIPOS_HIJOS: Dict[str, tuple] = {
    "Epic": ("Feature", "User Story"),
    "Feature": ("User Story",),
    "User Story": ("Task", "Bug"),
    "Bug": ("Task",),
}

# Relaciones de asociación de un solo salto. Solo se convierten en Bug si el
# work item destino es realmente de ese tipo.
RELACION_HIJO = "System.LinkTypes.Hierarchy-Forward"
RELACION_RELATED = "System.LinkTypes.Related"
RELACIONES_ASOCIACION = (RELACION_RELATED,)
TIPOS_ASOCIADOS = frozenset({"Bug"})

# Nombres canónicos de campos.
CAMPO_ID = "System.Id"
CAMPO_TIPO = "System.WorkItemType"
CAMPO_TITULO = "System.Title"
CAMPO_ESTADO = "System.State"
CAMPO_DESCRIPCION = "System.Description"
CAMPO_PRIORIDAD = "Microsoft.VSTS.Common.Priority"
CAMPO_SEVERIDAD = "Microsoft.VSTS.Common.Severity"
CAMPO_ASIGNADO = "System.AssignedTo"
CAMPO_TAGS = "System.Tags"
CAMPOS_LISTADO = ",".join(
    (
        CAMPO_ID,
        CAMPO_TIPO,
        CAMPO_TITULO,
        CAMPO_ESTADO,
        CAMPO_DESCRIPCION,
        CAMPO_PRIORIDAD,
        CAMPO_SEVERIDAD,
        CAMPO_ASIGNADO,
        CAMPO_TAGS,
    )
)
CAMPOS_ARBOL = CAMPOS_LISTADO

TAMANO_LOTE_API = 200


def wiql_epicas(area_path: str) -> str:
    """Consulta de solo épicas dentro del AreaPath (escape de comillas simples)."""
    area = str(area_path or "").replace("'", "''")
    return (
        f"SELECT [{CAMPO_ID}], [{CAMPO_TITULO}], [{CAMPO_TIPO}], "
        f"[{CAMPO_ESTADO}], [{CAMPO_DESCRIPCION}] "
        "FROM WorkItems "
        "WHERE [System.TeamProject] = @project "
        "AND [System.WorkItemType] = 'Epic' "
        f"AND [System.AreaPath] UNDER '{area}' "
        "ORDER BY [System.Id]"
    )


def campo(item: Dict, nombre: str) -> str:
    """Lee un campo de un work item devolviendo siempre texto limpio."""
    fields = item.get("fields") if isinstance(item, dict) else None
    if not isinstance(fields, dict):
        return ""
    valor = fields.get(nombre)
    if isinstance(valor, dict):
        return str(valor.get("displayName") or "")
    return "" if valor is None else str(valor)


def tipo(item: Dict) -> str:
    return campo(item, CAMPO_TIPO)


def ids_relaciones(item: Dict, relacion: str) -> list[int]:
    """Ids de work items relacionados con un ``rel`` concreto."""
    salida: list[int] = []
    for rel in item.get("relations") or []:
        if not isinstance(rel, dict) or rel.get("rel") != relacion:
            continue
        url = str(rel.get("url") or "")
        try:
            id_ = int(url.rstrip("/").split("/")[-1])
        except (TypeError, ValueError):
            continue
        if id_ > 0:
            salida.append(id_)
    return salida


def ids_relaciones_hijas(item: Dict) -> list[int]:
    """Ids de los work items relacionados como Hierarchy-Forward."""
    return ids_relaciones(item, RELACION_HIJO)


def ids_relaciones_asociadas(item: Dict) -> list[int]:
    """Ids de las asociaciones permitidas de un solo salto."""
    salida: list[int] = []
    for relacion in RELACIONES_ASOCIACION:
        salida.extend(ids_relaciones(item, relacion))
    return salida


def hijos_permitidos(tipo_actual: str, incluir_bugs: bool) -> tuple[str, ...]:
    """Política de descendencia para una rama del grafo."""
    permitidos = TIPOS_HIJOS.get(tipo_actual, ())
    if not incluir_bugs:
        return tuple(t for t in permitidos if t != "Bug")
    return permitidos
