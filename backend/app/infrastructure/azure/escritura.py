"""Adaptador de **escritura** de work items en Azure DevOps (opt-in).

Complemento de :mod:`repository`, que permanece estrictamente de solo lectura.
Este módulotraduce un :class:`ActualizacionQA` a un *JSON Patch* acotado y lo
envía con ``PATCH``, sin permitir nunca que un campo fuera de la lista blanca
llegue a Azure.

Decisiones de seguridad aplicadas aquí:

* **Lista blanca estricta**: solo se aceptan los campos de
  :class:`ActualizacionQA`. Cualquier otro se rechaza antes de la red.
* **Escape de notas QA**: el texto del usuario se escapa con ``html.escape``
  antes de incrustarlo en el HTML de la descripción, para no inyectar markup en
  Azure DevOps.
* **Notas QA son append-only**: nunca se sobrescribe la descripción existente,
  solo se agrega un bloque al final (preserva el formato del autor original).
* **Tags acotados**: se rechazan ``;`` (separador de Azure), ``*`` (tag
  jerárquico) y cadenas excesivamente largas.
* **Concurrencia**: se acepta ``rev_esperada``; si el work item cambió, se
  devuelve ``None`` para que la aplicación no sobrescriba a otro QA.
* **Nunca** se envía ``bypassRules``: las reglas del proyecto se respetan.
"""

import html
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from ...domain.models import ActualizacionQA, ResultadoActualizacion
from ...domain.ports import EscrituraBacklogPort, TransportePort
from . import queries
from .transport import AzureError

logger = logging.getLogger("devops")

#: Máximo de caracteres admitidos en las notas QA antes de truncar.
MAX_NOTAS_QA = 2000
#: Máximo de caracteres en el campo de tags.
MAX_TAGS = 500
#: Prefijo legible del bloque de notas QA que se agrega a la descripción.
MARCA_NOTAS_QA = "Notas de QA"
#: Separador de tags en Azure DevOps.
SEPARADOR_TAGS = ";"


class ErrorValidacionEscritura(ValueError):
    """La actualización fue rechazada por una validación local (no llegó a Azure)."""


def _normalizar_tags(bruto: str) -> str:
    """Valida y normaliza la lista de tags de Azure."""
    texto = (bruto or "").strip()
    if not texto:
        return ""
    if SEPARADOR_TAGS in texto:
        raise ErrorValidacionEscritura(
            "Los tags no pueden contener ';': es el separador de Azure. "
            "Envía los tags ya separados por comas."
        )
    if "*" in texto:
        raise ErrorValidacionEscritura(
            "Los tags no pueden usar '*' (tag jerárquico de Azure)."
        )
    if len(texto) > MAX_TAGS:
        raise ErrorValidacionEscritura(
            f"La lista de tags supera el máximo de {MAX_TAGS} caracteres."
        )
    # Deduplicación case-insensitive: "qa" y "Verificado-QA" son tags
    # distintos, pero "qa" repetido no debe generar entradas redundantes.
    vistas: set[str] = set()
    unicos: List[str] = []
    for parte in (p.strip() for p in texto.split(",")):
        if not parte:
            continue
        clave = parte.lower()
        if clave in vistas:
            continue
        vistas.add(clave)
        unicos.append(parte)
    return ", ".join(unicos)


def _escapar_notas(texto: str) -> str:
    """Escapa el texto del usuario antes de incrustarlo en HTML de Azure."""
    limpio = (texto or "").strip()
    if not limpio:
        raise ErrorValidacionEscritura("Las notas QA están vacías.")
    if len(limpio) > MAX_NOTAS_QA:
        limpio = limpio[:MAX_NOTAS_QA].rstrip() + "…"
    # Escapa el markup del usuario: el resultado es texto plano seguro dentro
    # del HTML que Azure almacena en System.Description.
    return html.escape(limpio, quote=False)


def construir_bloque_notas(notas: str, *, rev: int, ahora: Optional[datetime] = None) -> str:
    """Construye el bloque HTML de notas QA (append-only)."""
    sello = (ahora or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M UTC")
    cuerpo = _escapar_notas(notas)
    return (
        "<hr />\n"
        f"<div><strong>{MARCA_NOTAS_QA}</strong> — {html.escape(sello)}"
        f" · rev {rev}</div>\n"
        f"<div>{cuerpo}</div>"
    )


class AzureEscrituraRepositorio(EscrituraBacklogPort):
    """Escritura de work items sobre la API REST de Azure DevOps."""

    def __init__(
        self,
        org_url: str,
        proyecto: str,
        transporte: TransportePort,
    ) -> None:
        self._org_url = (org_url or "").strip().rstrip("/")
        self._proyecto = (proyecto or "").strip()
        self._transporte = transporte

    def _ruta_workitem(self, work_item_id: int, sufijo: str = "") -> str:
        proyecto = quote(self._proyecto, safe="")
        base = f"{self._org_url}/{proyecto}/_apis/wit/workitems/{int(work_item_id)}"
        return f"{base}{sufijo}"

    async def obtener_revision(self, work_item_id: int) -> int:
        """Revisión actual del work item (para control de concurrencia)."""
        url = self._ruta_workitem(
            work_item_id,
            f"?$fields={quote(queries.CAMPO_ID, safe=',')}"
            f"&api-version={queries.API_VERSION}",
        )
        datos = await self._transporte.get(url)
        return int(datos.get("rev") or 0)

    async def _descripcion_actual(self, work_item_id: int) -> str:
        url = self._ruta_workitem(
            work_item_id,
            f"?$fields={quote(queries.CAMPO_DESCRIPCION, safe=',')}"
            f"&api-version={queries.API_VERSION}",
        )
        datos = await self._transporte.get(url)
        return str(queries.campo(datos, queries.CAMPO_DESCRIPCION) or "")

    async def _json_patch(
        self,
        work_item_id: int,
        cambios: ActualizacionQA,
        *,
        rev_esperada: Optional[int],
    ) -> List[Dict[str, Any]]:
        """Traduce la actualización a un JSON Patch de lista blanca."""
        operaciones: List[Dict[str, Any]] = []

        if cambios.estado is not None:
            estado = (cambios.estado or "").strip()
            if not estado:
                raise ErrorValidacionEscritura("El estado no puede estar vacío.")
            operaciones.append(
                {
                    "op": "add",
                    "path": f"/fields/{queries.CAMPO_ESTADO}",
                    "value": estado,
                }
            )

        if cambios.prioridad is not None:
            operaciones.append(
                {
                    "op": "add",
                    "path": f"/fields/{queries.CAMPO_PRIORIDAD}",
                    "value": (cambios.prioridad or "").strip(),
                }
            )

        if cambios.severidad is not None:
            operaciones.append(
                {
                    "op": "add",
                    "path": f"/fields/{queries.CAMPO_SEVERIDAD}",
                    "value": (cambios.severidad or "").strip(),
                }
            )

        if cambios.tags is not None:
            tags = _normalizar_tags(cambios.tags)
            operaciones.append(
                {
                    "op": "add",
                    "path": f"/fields/{queries.CAMPO_TAGS}",
                    "value": tags,
                }
            )

        if cambios.notas_qa is not None:
            rev = rev_esperada or await self.obtener_revision(work_item_id)
            actual = await self._descripcion_actual(work_item_id)
            bloque = construir_bloque_notas(cambios.notas_qa, rev=rev)
            # Append-only: se conserva la descripción previa intacta.
            nueva = f"{actual}\n\n{bloque}" if actual else bloque
            operaciones.append(
                {
                    "op": "add",
                    "path": f"/fields/{queries.CAMPO_DESCRIPCION}",
                    "value": nueva,
                }
            )

        if not operaciones:
            raise ErrorValidacionEscritura("No hay cambios que aplicar.")
        return operaciones

    async def actualizar_work_item(
        self,
        work_item_id: int,
        cambios: ActualizacionQA,
        *,
        validar: bool = False,
        rev_esperada: Optional[int] = None,
    ) -> ResultadoActualizacion:
        """Aplica (o valida en seco) la actualización de un work item.

        Con ``validar=True`` se envía ``validateOnly=true`` para que Azure
        compruebe reglas sin persistir nada.
        """
        rev_actual = await self.obtener_revision(work_item_id)
        if rev_esperada is not None and rev_esperada != rev_actual:
            logger.info(
                "Conflicto de revisión en work item %s: esperada=%s actual=%s",
                work_item_id,
                rev_esperada,
                rev_actual,
            )
            raise ErrorValidacionEscritura(
                f"El work item cambió desde que lo abriste (rev {rev_esperada} "
                f"→ {rev_actual}). Vuelve a cargarlo antes de guardar."
            )

        operaciones = await self._json_patch(
            work_item_id, cambios, rev_esperada=rev_actual
        )

        query = f"?api-version={queries.API_VERSION}"
        if validar:
            query += "&validateOnly=true"
        url = self._ruta_workitem(work_item_id, query)
        datos = await self._transporte.patch(url, operaciones)

        rev_resultado = int(datos.get("rev") or rev_actual)
        campos = cambios.campos_modificados()
        logger.info(
            "Work item %s %s: campos=%s rev=%s",
            work_item_id,
            "validado" if validar else "actualizado",
            ",".join(campos),
            rev_resultado,
        )
        return ResultadoActualizacion(
            work_item_id=work_item_id,
            rev=rev_resultado,
            campos=campos,
            validado=validar,
            detalle=(
                "Azure validó el cambio; no se guardó nada."
                if validar
                else "Cambio aplicado en Azure DevOps."
            ),
        )
