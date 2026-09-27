"""Consultas WIQL y utilidades de campos de work items de Azure DevOps.

Vocabulario estable de la API 7.x de Work Item Tracking. Se centralizan aquí
los nombres de campos, la política de relaciones y la construcción de la
consulta de épicas para que el repositorio solo se ocupe de orquestar llamadas
y mapear resultados.
"""

from datetime import datetime
from typing import Dict, List, Optional

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
CAMPO_ITERACION = "System.IterationPath"
CAMPO_CREADO = "System.CreatedDate"
CAMPO_MODIFICADO = "System.ChangedDate"
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
        CAMPO_ITERACION,
        CAMPO_CREADO,
        CAMPO_MODIFICADO,
    )
)
CAMPOS_ARBOL = CAMPOS_LISTADO

# --- Activos de prueba (Test Plan / Test Suite / Test Case) ---------------
#: ¿El caso tiene pasos de prueba ejecutables? Es un campo booleano
#: calculado por Azure a partir de `Microsoft.VSTS.TCM.Steps`. El paso **no**
#: se pide nunca: ver `CAMPOS_PRUEBA`.
CAMPO_TIENE_PASOS = "Microsoft.VSTS.TCM.Steps"
#: `Not Automated` / `Planned` / `Automated`. Es un eje distinto al estado: un
#: caso `Closed` puede estar automatizado o no, así que no es un tono de estado.
CAMPO_AUTOMATIZACION = "Microsoft.VSTS.TCM.AutomationStatus"
#: Motivo del cambio de estado (`New`, `Fixed`, …). Presente en los casos.
CAMPO_RAGON = "System.Reason"

#: Campos del inventario de pruebas.
#:
#: Deliberadamente **sin** `System.Description` ni `Microsoft.VSTS.TCM.Steps`.
#: Pedirlos con `$expand=relations` sobre los 3.431 casos provoca errores HTTP
#: 500 medidos; con esta lista y `$expand=relations` la misma lectura son 18
#: lotes, 0 errores y 5,5 s. Los pasos, si algún día hacen falta, irán en un
#: endpoint de detalle bajo demanda.
CAMPOS_PRUEBA = ",".join(
    (
        CAMPO_ID,
        CAMPO_TIPO,
        CAMPO_TITULO,
        CAMPO_ESTADO,
        CAMPO_PRIORIDAD,
        CAMPO_ASIGNADO,
        CAMPO_TAGS,
        CAMPO_ITERACION,
        CAMPO_CREADO,
        CAMPO_MODIFICADO,
        CAMPO_AUTOMATIZACION,
        CAMPO_RAGON,
    )
)

#: Relación que dice «este caso prueba este requisito». Es el único vínculo
#: entre pruebas y requisitos que se puede leer: la pertenencia de un caso a un
#: plan **no** es accesible (las rutas de casos del plan devuelven 404).
RELACION_TESTED_BY = "Microsoft.VSTS.Common.TestedBy-Reverse"

TAMANO_LOTE_API = 200


def escapar_wiql(valor: str) -> str:
    """Duplica las comillas simples para incrustar texto en una consulta WIQL.

    Única fuente de este escape: dos copias divergen en silencio y solo se nota
    con un tipo de work item que traiga apostrofo en el nombre.
    """
    return str(valor or "").replace("'", "''")


def wiql_tipos(tipos: "tuple[str, ...]") -> str:
    """WIQL que trae los ids de los tipos indicados, ordenados por id.

    El orden por id hace la carga determinista entre ejecuciones, que es lo que
    permite que el índice sea reproducible y sus pruebas fiables.
    """
    condiciones = ["[System.TeamProject] = @project"]
    if tipos:
        lista = ", ".join(f"'{escapar_wiql(t)}'" for t in tipos)
        condiciones.append(f"[System.WorkItemType] IN ({lista})")
    return (
        f"SELECT [{CAMPO_ID}] FROM WorkItems "
        f"WHERE {' AND '.join(condiciones)} ORDER BY [{CAMPO_ID}]"
    )


def id_destino_de_relacion(relacion: Dict) -> Optional[int]:
    """Saca el work item destino de una relación a partir de su URL.

    Azure devuelve la URL completa del destino; solo interesa el id final. Se
    toleran query strings y barras porque la forma varía entre relaciones.
    """
    url = str((relacion or {}).get("url") or "").strip()
    if not url:
        return None
    frag = url.rstrip("/").split("/")[-1].split("?")[0]
    try:
        valor = int(frag)
    except ValueError:
        return None
    return valor if valor > 0 else None


def requisitos_de_prueba(item: Dict) -> List[int]:
    """Ids de los requisitos que prueba un `Test Case`.

    Solo se lee `TestedBy-Reverse`: es la relación inversa de «este requisito lo
    prueban estos casos», que es como la guarda Azure en el caso. Las demás
    relaciones del caso (pasos compartidos, archivos, dependencias) no hablan de
    cobertura y se ignoran.

    .. note:: Solo el `Test Case` aporta cobertura. Azure admite `TestedBy`
       entre cualquier par de tipos, y en este proyecto hay una `User Story`
       (17548) enlazada por `TestedBy` a cuatro **Tasks** del proceso de QA
       («Creación de casos de pruebas», «Ejecución de casos», «Evidencias»…) y
       no a ningún caso. Esa historia tiene proceso de QA documentado, pero
       **ningún caso de prueba**, así que cuenta como descubierta. Verificado
       medido: 240 historias con caso frente a 241 enlazadas por `TestedBy`.
    """
    relations = item.get("relations") if isinstance(item, dict) else None
    if not isinstance(relations, list):
        return []
    vistos: set[int] = set()
    for relacion in relations:
        if not isinstance(relacion, dict):
            continue
        if str(relacion.get("rel") or "") != RELACION_TESTED_BY:
            continue
        destino = id_destino_de_relacion(relacion)
        if destino:
            vistos.add(destino)
    return sorted(vistos)


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


def identidad(item: Dict, nombre_campo: str) -> Optional[Dict[str, str]]:
    """Extrae una ``IdentityRef`` de Azure (asignado, cambiado por…).

    Devuelve ``{guid, nombre, url}`` o ``None`` si el campo está vacío. El GUID
    es el identificador estable de la persona: los nombres_display cambian, los
    GUID no, y filtrar por nombre rompería en cuanto alguien se renombre.
    """
    fields = item.get("fields") if isinstance(item, dict) else None
    if not isinstance(fields, dict):
        return None
    valor = fields.get(nombre_campo)
    if not isinstance(valor, dict):
        return None
    guid = str(valor.get("id") or "").strip()
    nombre = str(valor.get("displayName") or "").strip()
    if not guid and not nombre:
        return None
    return {"guid": guid, "nombre": nombre, "url": str(valor.get("url") or "")}


def fecha(item: Dict, nombre: str) -> Optional[datetime]:
    """Lee una fecha ISO de Azure (UTC) y la devuelve como ``datetime``.

    Devuelve ``None`` si falta o viene malformada: un dato corrupto no debe
    tumbar la carga de un árbol entero.
    """
    fields = item.get("fields") if isinstance(item, dict) else None
    if not isinstance(fields, dict):
        return None
    valor = fields.get(nombre)
    if not isinstance(valor, str) or not valor.strip():
        return None
    try:
        # Azure devuelve '2026-09-25T13:29:54.123Z'; el 'Z' no lo acepta
        # fromisoformat en versiones antiguas de Python.
        return datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        return None


def nombre_sprint(iteracion: str) -> str:
    """Último segmento de la ruta de iteración: ``CIA\\Proyecto\\Sprint 35`` → ``Sprint 35``.

    Los sprint paths de Azure son jerárquicos; el nombre real del sprint es la
    hoja. Se conservan ambas formas para filtrar por ruta completa o por nombre.
    """
    limpio = (iteracion or "").strip()
    if not limpio:
        return ""
    return limpio.rsplit("\\", 1)[-1].strip()


def clave_orden_sprint(nombre: str) -> tuple[int, int, str]:
    """Clave de ordenación tolerante: ``Sprint 9`` va antes que ``Sprint 10``.

    Devuelve ``(grupo, numero, nombre)``:

    - ``(1, n, …)`` para nombres con número: se ordenan numéricamente, da igual
      que el número esté al principio o al final (``Sprint 10``,
      ``Sprint_001-HUB`` → 1).
    - ``(2, 0, …)`` para nombres sin número y para el vacío: van **al final**,
      alfabéticamente, porque un humano prefiere ver primero los sprints
      numerados y luego los nombres libres (``Retro``, ``Mantenimiento``).
    """
    texto = (nombre or "").strip()
    if not texto:
        return (2, 0, "")
    digitos = ""
    for caracter in texto:
        if caracter.isdigit():
            digitos += caracter
        elif digitos:
            break
    if digitos:
        return (1, int(digitos), texto)
    return (2, 0, texto)


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
