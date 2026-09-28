"""Copia de seguridad del registro, a un destino configurable.

Decora a :class:`~app.infrastructure.registro_json.RegistroJson` sin cambiar su
comportamiento: si no hay destino configurado, es un passthrough exacto.

Por qué existe, y por qué no es «un ``cp`` más»:

* **El destino es configuración, no código.** ``REGISTRO_COPIA_RUTA`` en el
  ``.env``. Cambiar de disco a una carpeta corporativa, o al revés, no es un
  commit ni un despliegue.
* **Una copia configurada a una carpeta que no existe NO es un respaldo.** Es lo
  que hace peligroso pointed el registro a un `OneDrive` sin sesión iniciada:
  el fichero *parece* respaldado y no lo está. Por eso el destino inexistente
  se registra como **fallo visible**, nunca como copia correcta.
* **La copia falla sin tumbar la escritura.** Si el destino está lleno o
  bloqueado, la asignación ya está guardada en el registro principal: que la
  copia falle es un problema de respaldo, no de la petición, y devolver un error
  HTTP diría «no se guardó» sobre algo que sí se guardó.
* **La copia también es atómica.** Se escribe en un temporal y se renombra con
  ``os.replace``, igual que el registro. Una copia a medio escribir es peor que
  ninguna copia: parece un respaldo y no se puede leer.
* **Restaurar solo si falta, nunca sobre un fichero que existe.** Si el
  registro está corrupto, un «restaurar» automático destruiría el contenido
  corrupto, que quizá todavía se puede recuperar a mano. Ausente se restaura;
  corrupto se avisa y se deja como está.
"""

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from ..domain.models import Instantanea
from ..domain.ports import RegistroAsignacionesPort

logger = logging.getLogger("devops")


class RegistroConCopia(RegistroAsignacionesPort):
    """Registro con una copia opcional en otro sitio, y restauración al arrancar."""

    def __init__(
        self,
        interno: RegistroAsignacionesPort,
        origen: Path,
        destino: Optional[Path],
    ) -> None:
        self._interno = interno
        self._origen = Path(origen)
        self._destino = Path(destino) if destino else None
        #: Último fallo de copia, para que la interfaz pueda avisar. Vive en
        #: memoria a propósito: si el proceso se reinicia, la copia se reintenta
        #: en el siguiente guardado y el aviso es el de ese momento.
        self.ultimo_error: str = ""
        self.ultima_copia: str = ""

    # ------------------------------------------------------------------ #
    # Estado, para la interfaz
    # ------------------------------------------------------------------ #
    @property
    def configurado(self) -> bool:
        return self._destino is not None

    def estado(self) -> dict:
        """Qué pasa con el almacenamiento, dicho sin adornos.

        `copia_activa` es `true` solo si hay destino **y** se ha podido escribir
        alguna vez. Con el destino configurado pero inaccesible es `false` y hay
        un `aviso`: ese es el estado que hay que ver, no un `true` optimista.
        """
        destino = str(self._destino) if self._destino else ""
        # `activo` NO exige que ya se haya escrito una copia, porque eso hacia
        # falta justo cuando se consulta: en un proceso recien arrancado
        # `ultima_copia` esta vacio en memoria, y el panel se ponia en rojo
        # diciendo que el respaldo no funcionaba con un aviso vacio. Una alarma
        # falsa entrena a ignorar las alarmas.
        #
        # Lo que decide es si el destino esta realmente disponible: configurado
        # y sin fallo previo, mas «ya se copio» o «la carpeta existe». Si la
        # carpeta no existe, no se puede escribir y hay que decirlo. Si existe
        # pero luego falla al escribir, el error se registra y lo dice el aviso.
        disponible = bool(self.ultima_copia) or (
            self._destino is not None and self._destino.parent.is_dir()
        )
        activo = bool(self._destino) and not self.ultimo_error and disponible
        if not self._destino:
            aviso = (
                "No hay copia de seguridad configurada. Si este equipo se "
                "reinstala o se pierde el disco, las asignaciones se pierden: "
                "Azure no las conoce. Define REGISTRO_COPIA_RUTA en el .env."
            )
        elif self.ultimo_error:
            aviso = (
                f"La copia de seguridad NO se está escribiendo: {self.ultimo_error}. "
                "El registro principal sí se guardó."
            )
        elif not self._destino.parent.is_dir():
            aviso = (
                f"La carpeta de copia no existe: {self._destino.parent}. "
                "El registro principal sí se guardó, pero sin respaldo."
            )
        else:
            aviso = ""
        return {
            "ruta": str(self._origen),
            "copia_configurada": self.configurado,
            "copia_ruta": destino,
            "copia_activa": activo,
            "ultima_copia": self.ultima_copia,
            "aviso": aviso,
        }

    # ------------------------------------------------------------------ #
    # Puerto
    # ------------------------------------------------------------------ #
    async def leer(self) -> Instantanea:
        """Lee, restaurando antes desde la copia si el registro no está.

        La restauración es **explícita en el log**: que aparezcan 264
        asignaciones de la nada tiene que verse, no deducirse.
        """
        if not self._origen.exists() and self._destino is not None:
            self._restaurar()
        return await self._interno.leer()

    async def guardar(self, instantanea: Instantanea) -> Instantanea:
        """Guarda y luego copia. Un fallo de copia no falla el guardado."""
        resultado = await self._interno.guardar(instantanea)
        if self._destino is not None:
            self._copiar()
        return resultado

    # ------------------------------------------------------------------ #
    # Copia
    # ------------------------------------------------------------------ #
    def _copiar(self) -> None:
        assert self._destino is not None  # garantizado por quien llama
        try:
            self._destino.parent.mkdir(parents=True, exist_ok=True)
            # Temporal en el **mismo** directorio que el destino: `os.replace`
            # solo es atómico dentro del mismo volumen, y una carpeta de OneDrive
            # puede estar en otro disco que el registro.
            temporal: Optional[str] = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=str(self._destino.parent),
                    prefix=self._destino.name + ".",
                    suffix=".tmp",
                    delete=False,
                ) as handle:
                    temporal = handle.name
                    with self._origen.open("rb") as origen:
                        shutil.copyfileobj(origen, handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporal, self._destino)
                temporal = None
            finally:
                if temporal:
                    try:
                        os.unlink(temporal)
                    except OSError:
                        pass
        except OSError as exc:
            # Aviso, no excepción: el registro principal ya está escrito.
            self.ultimo_error = f"{self._destino} ({type(exc).__name__}: {exc})"
            logger.error("No se pudo copiar el registro a %s: %s", self._destino, exc)
            return
        self.ultimo_error = ""
        self.ultima_copia = self._sello()

    def _restaurar(self) -> None:
        assert self._destino is not None
        if not self._destino.exists():
            # Sin copia no hay nada que restaurar. No es un error: es el primer
            # arranque, o una copia que aún no se ha escrito.
            return
        try:
            self._origen.parent.mkdir(parents=True, exist_ok=True)
            temporal: Optional[str] = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=str(self._origen.parent),
                    prefix=self._origen.name + ".",
                    suffix=".tmp",
                    delete=False,
                ) as handle:
                    temporal = handle.name
                    with self._destino.open("rb") as origen:
                        shutil.copyfileobj(origen, handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporal, self._origen)
                temporal = None
            finally:
                if temporal:
                    try:
                        os.unlink(temporal)
                    except OSError:
                        pass
        except OSError as exc:
            self.ultimo_error = f"no se pudo restaurar desde {self._destino} ({exc})"
            logger.error("No se pudo restaurar el registro desde %s: %s", self._destino, exc)
            return
        logger.warning(
            "Registro restaurado desde la copia: %s -> %s. "
            "El registro principal no existia; esto no es el arranque normal.",
            self._destino,
            self._origen,
        )
        self.ultimo_error = ""

    def _sello(self) -> str:
        from datetime import datetime, timezone

        return (
            datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
