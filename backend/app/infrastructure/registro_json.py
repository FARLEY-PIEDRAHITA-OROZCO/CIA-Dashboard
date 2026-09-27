"""Adaptador del registro sobre un fichero JSON versionado en git.

Cumple :class:`RegistroAsignacionesPort`. Es la **única** pieza del sistema que
escribe en disco, y por eso lleva las tres garantías que evitan perder
información que Azure no conoce:

* **Escritura atómica**: se escribe en un temporal y se renombra con
  :func:`os.replace`, que en Windows y en POSIX es atómico. Un fallo a mitad de
  escritura deja el fichero anterior intacto, no un JSON truncado.
* **Hash de versión**: al guardar se recalcula el hash del disco y se compara
  con el que traía la instantánea leída. Si no coincide, se rechaza la escritura
  en vez de pisar el cambio de otra pestaña o de un ``git checkout``.
* **Fichero corrupto es un error, no un registro vacío**: devolver «no hay
  asignaciones» cuando lo que hay es un JSON ilegible lleva a conclusiones opuestas
  (borrar de más o no asignar a nadie).

El fichero se **rastrea en git** a propósito. Son ~264 filas y el objetivo es que
no se pierdan: el historial da recuperación gratis y hace que un cambio de roles
sea revisable como cualquier otro cambio de código.
"""

import hashlib
import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from ..domain.models import (
    ROLES,
    Asignacion,
    Instantanea,
    PerfilPersona,
)
from ..domain.ports import RegistroAsignacionesPort

logger = logging.getLogger("devops")

#: Versión del formato. Se incrementa solo si el esquema cambia de forma incompatible.
VERSION_FORMATO = 1


class ErrorRegistro(ValueError):
    """El registro no se pudo leer o no se pudo escribir.

    Es una validación local: la petición nunca llegó a Azure, y **no** significa
    que el fichero esté mal. Para eso está `RegistroModificado`.
    """


class RegistroModificado(ErrorRegistro):
    """El fichero cambió desde que se leyó: la escritura se rechaza.

    No es un error que haya que arreglar, es una protección. Lo correcto es
    recargar y volver a aplicar el cambio encima de la versión nueva.
    """


def _hash_de(bruto: bytes) -> str:
    return hashlib.sha256(bruto).hexdigest()


class RegistroJson(RegistroAsignacionesPort):
    """Registro de perfiles y asignaciones sobre un fichero JSON."""

    def __init__(self, ruta: str | Path) -> None:
        self._ruta = Path(ruta)

    @property
    def ruta(self) -> Path:
        return self._ruta

    # ------------------------------------------------------------------ #
    # Lectura
    # ------------------------------------------------------------------ #
    async def leer(self) -> Instantanea:
        """Lee el registro. Fichero ausente → instantánea vacía (primer arranque)."""
        bruto = self._leer_bruto()
        if bruto is None:
            return Instantanea(hash="", recien_creado=True)
        return self._interpretar(bruto, hash_calculado=_hash_de(bruto))

    def _leer_bruto(self) -> bytes | None:
        try:
            return self._ruta.read_bytes()
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise ErrorRegistro(
                f"No se pudo leer el registro en {self._ruta}: {exc}. "
                "Revisa los permisos del fichero."
            ) from exc

    def _interpretar(self, bruto: bytes, *, hash_calculado: str) -> Instantanea:
        """Convierte el JSON en modelos, validando cada pieza.

        Se valida **pieza a pieza** y no «todo o nada»: si un registro tiene
        cuatro asignaciones y una está mal, perder las cuatro sería peor que
        perder una. Las que no se pueden leer se avisan por log y se saltan.
        """
        try:
            crudo = json.loads(bruto.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ErrorRegistro(
                f"El registro {self._ruta} no es un JSON válido: {exc}. "
                "No se ha modificado nada; revísalo o renómbralo para empezar de cero."
            ) from exc
        if not isinstance(crudo, dict):
            raise ErrorRegistro(
                f"El registro {self._ruta} debe ser un objeto JSON con "
                "'perfiles' y 'asignaciones'."
            )

        version = crudo.get("version")
        if version != VERSION_FORMATO:
            raise ErrorRegistro(
                f"El registro {self._ruta} dice version={version!r} y este "
                f"backend entiende la {VERSION_FORMATO}. Si el fichero es de otra "
                "versión del sistema, actualiza el backend antes de tocarlo."
            )

        perfiles = self._leer_perfiles(crudo.get("perfiles"))
        asignaciones = self._leer_asignaciones(crudo.get("asignaciones"))
        return Instantanea(
            perfiles=perfiles,
            asignaciones=asignaciones,
            hash=hash_calculado,
        )

    @staticmethod
    def _leer_perfiles(crudo: Any) -> Dict[str, PerfilPersona]:
        if crudo is None:
            return {}
        if not isinstance(crudo, dict):
            raise ErrorRegistro("'perfiles' debe ser un objeto.")
        salida: Dict[str, PerfilPersona] = {}
        for guid, valores in crudo.items():
            if not isinstance(valores, dict):
                logger.warning("Registro: perfil de %s ignorado, no es un objeto", guid)
                continue
            try:
                salida[str(guid)] = PerfilPersona(
                    guid=str(guid),
                    es_qa=bool(valores.get("es_qa", False)),
                    es_dev=bool(valores.get("es_dev", False)),
                    forzado=valores.get("forzado"),
                )
            except Exception as exc:  # noqa: BLE001 - un perfil malo no tumba el resto
                logger.warning("Registro: perfil de %s ignorado (%s)", guid, exc)
        return salida

    @staticmethod
    def _leer_asignaciones(crudo: Any) -> List[Asignacion]:
        if crudo is None:
            return []
        if not isinstance(crudo, list):
            raise ErrorRegistro("'asignaciones' debe ser una lista.")
        salida: List[Asignacion] = []
        for i, valores in enumerate(crudo):
            if not isinstance(valores, dict):
                logger.warning("Registro: asignación %d ignorada, no es un objeto", i)
                continue
            try:
                salida.append(Asignacion(**valores))
            except Exception as exc:  # noqa: BLE001 - una mala no tumba el resto
                logger.warning("Registro: asignación %d ignorada (%s)", i, exc)
        return salida

    # ------------------------------------------------------------------ #
    # Escritura
    # ------------------------------------------------------------------ #
    async def guardar(self, instantanea: Instantanea) -> Instantanea:
        """Escribe el registro. Rechaza la escritura si el disco cambió."""
        actual = self._leer_bruto()
        hash_actual = _hash_de(actual) if actual is not None else ""
        if hash_actual != (instantanea.hash or ""):
            raise RegistroModificado(
                "El registro cambió en disco desde que lo cargaste "
                "(otra pestaña, o un `git checkout`). Vuelve a cargarlo y aplica "
                "el cambio otra vez: no se ha sobrescrito nada."
            )

        cuerpo = self._serializar(instantanea)
        self._escribir_atomico(cuerpo)
        return Instantanea(
            perfiles=dict(instantanea.perfiles),
            asignaciones=list(instantanea.asignaciones),
            hash=_hash_de(cuerpo),
        )

    @staticmethod
    def _serializar(instantanea: Instantanea) -> bytes:
        """Serializa de forma estable: mismo contenido, mismos bytes.

        Importa para el hash. Con claves ordenadas, guardar dos veces lo mismo
        da el mismo hash y la comprobación de concurrencia no da falsos positivos.
        """
        documento = {
            "version": VERSION_FORMATO,
            "actualizado": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "perfiles": {
                guid: {
                    "es_qa": p.es_qa,
                    "es_dev": p.es_dev,
                    **({"forzado": p.forzado} if p.forzado is not None else {}),
                }
                for guid, p in sorted(instantanea.perfiles.items())
            },
            "asignaciones": [
                {
                    "epica": a.epica,
                    "persona": a.persona,
                    "rol": a.rol,
                    "desde": a.desde.isoformat(),
                    **({"nota": a.nota} if a.nota else {}),
                }
                for a in sorted(
                    instantanea.asignaciones, key=lambda a: (a.epica, a.persona, a.rol)
                )
            ],
        }
        return (json.dumps(documento, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
            "utf-8"
        )

    def _escribir_atomico(self, cuerpo: bytes) -> None:
        """Escribe en un temporal y renombra. Un fallo deja el anterior intacto."""
        self._ruta.parent.mkdir(parents=True, exist_ok=True)
        temporal: str | None = None
        try:
            # En el mismo directorio que el destino: `os.replace` solo es atómico
            # dentro del mismo sistema de ficheros, y escribir en `%TEMP%` y
            # renombrar cruzando volúmenes perdería esa garantía.
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=str(self._ruta.parent),
                prefix=self._ruta.name + ".",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporal = handle.name
                handle.write(cuerpo)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporal, self._ruta)
            temporal = None
        except OSError as exc:
            raise ErrorRegistro(
                f"No se pudo escribir el registro en {self._ruta}: {exc}."
            ) from exc
        finally:
            if temporal:
                # Temporal huérfano: se limpia para no dejar basura en git status.
                try:
                    os.unlink(temporal)
                except OSError:
                    logger.warning("No se pudo borrar el temporal %s", temporal)
