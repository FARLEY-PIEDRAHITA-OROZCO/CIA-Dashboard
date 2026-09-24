"""Consultas WIQL y utilidades de campos de work items de Azure DevOps.

Vocabulario estable de la API 7.x de Work Item Tracking. Se centralizan aquí
los nombres de campos y la construcción de la consulta de épicas para que el
repositorio solo se ocupe de orquestar llamadas y mapear resultados.
"""

from typing import Dict, Optional

# Versión de API REST de Azure DevOps usada por todo el transporte.
API_VERSION = "7.1"

# Tipos de work item que se traen en el tree y sus hijos permitidos.
TIPOS_HIJOS: Dict[str, tuple] = {
    "Epic": ("Feature", "User Story"),
    "Feature": ("User Story",),
    "User Story": ("Task",),
}

# Nombres canónicos de campos.
CAMPO_ID = "System.Id"
CAMPO_TIPO = "System.WorkItemType"
CAMPO_TITULO = "System.Title"
CAMPO_ESTADO = "System.State"
CAMPO_DESCRIPCION = "System.Description"
CAMPOS_LISTADO = ",".join(
    (CAMPO_ID, CAMPO_TIPO, CAMPO_TITULO, CAMPO_ESTADO, CAMPO_DESCRIPCION)
)
CAMPOS_ARBOL = CAMPOS_LISTADO

TAMANO_LOTE_API = 200

RELACION_HIJO = "System.LinkTypes.Hierarchy-Forward"


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
    return "" if valor is None else str(valor)


def tipo(item: Dict) -> str:
    return campo(item, CAMPO_TIPO)


def ids_relaciones_hijas(item: Dict) -> list[int]:
    """Ids de los work items relacionados como Hierarchy-Forward."""
    salida: list[int] = []
    for rel in item.get("relations") or []:
        if not isinstance(rel, dict) or rel.get("rel") != RELACION_HIJO:
            continue
        url = str(rel.get("url") or "")
        try:
            id_ = int(url.rstrip("/").split("/")[-1])
        except (TypeError, ValueError):
            continue
        if id_ > 0:
            salida.append(id_)
    return salida