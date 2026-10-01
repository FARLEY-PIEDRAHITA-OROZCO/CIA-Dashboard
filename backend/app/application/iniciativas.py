"""Servicio de gestión de carpetas de iniciativas.

Cada iniciativa a cargo tiene una carpeta local sincronizada con OneDrive.
La estructura es:

    <ruta_base>/<NNN - <nombre épica>>/
        ├── Documentos/
        ├── HU/
        ├── Casos de prueba/
        ├── Archivos de evidencias/
        └── Certificaciones/

La numeración es automática por orden de asignación y no se reutiliza.
"""

import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("devops")

#: Subcarpetas que se crean en cada iniciativa.
SUBCARPETAS = [
    "Documentos",
    "HU",
    "Casos de prueba",
    "Archivos de evidencias",
    "Certificaciones",
]


@dataclass
class Iniciativa:
    """Una iniciativa a cargo con su carpeta de OneDrive."""

    epica_id: int
    numero: str
    nombre: str
    ruta: str
    creada: str = field(default_factory=lambda: date.today().isoformat())


@dataclass
class EstadoRuta:
    """Estado de la ruta base de OneDrive."""

    ruta: str
    existe: bool
    escribible: bool
    total_iniciativas: int = 0


class ServicioIniciativas:
    """Gestiona el registro de iniciativas y sus carpetas."""

    def __init__(self, ruta_registro: str) -> None:
        self._ruta = Path(ruta_registro)
        self._datos: dict = {"ruta_base": "", "iniciativas": []}
        self._cargar()

    def _cargar(self) -> None:
        """Carga el registro desde disco."""
        if self._ruta.exists():
            try:
                self._datos = json.loads(self._ruta.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("No se pudo leer el registro de iniciativas: %s", exc)
                self._datos = {"ruta_base": "", "iniciativas": []}

    def _guardar(self) -> None:
        """Guarda el registro en disco."""
        self._ruta.parent.mkdir(parents=True, exist_ok=True)
        self._ruta.write_text(
            json.dumps(self._datos, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------ #
    # Configuración de ruta
    # ------------------------------------------------------------------ #

    def estado_ruta(self) -> EstadoRuta:
        """Devuelve el estado actual de la ruta base."""
        ruta = self._datos.get("ruta_base", "")
        p = Path(ruta) if ruta else None
        existe = p is not None and p.exists()
        escribible = existe and os.access(p, os.W_OK)
        return EstadoRuta(
            ruta=ruta,
            existe=existe,
            escribible=escribible,
            total_iniciativas=len(self._datos.get("iniciativas", [])),
        )

    def actualizar_ruta(self, nueva_ruta: str) -> EstadoRuta:
        """Actualiza la ruta base."""
        self._datos["ruta_base"] = nueva_ruta
        self._guardar()
        return self.estado_ruta()

    # ------------------------------------------------------------------ #
    # Iniciativas
    # ------------------------------------------------------------------ #

    def listar_iniciativas(self) -> List[Iniciativa]:
        """Lista todas las iniciativas con carpeta creada."""
        return [
            Iniciativa(**datos)
            for datos in self._datos.get("iniciativas", [])
        ]

    def obtener_iniciativa(self, epica_id: int) -> Optional[Iniciativa]:
        """Busca una iniciativa por su ID de épica."""
        for datos in self._datos.get("iniciativas", []):
            if datos["epica_id"] == epica_id:
                return Iniciativa(**datos)
        return None

    def _siguiente_numero(self) -> str:
        """Calcula el siguiente número disponible (3 dígitos)."""
        numeros = [
            int(i["numero"])
            for i in self._datos.get("iniciativas", [])
            if i["numero"].isdigit()
        ]
        siguiente = max(numeros, default=0) + 1
        return f"{siguiente:03d}"

    def crear_estructura(
        self, epica_id: int, nombre_epica: str
    ) -> Iniciativa:
        """Crea la estructura de carpetas para una iniciativa."""
        estado = self.estado_ruta()
        if not estado.existe:
            raise FileNotFoundError(
                f"La ruta base no existe: {estado.ruta}"
            )
        if not estado.escribible:
            raise PermissionError(
                f"La ruta base no es escribible: {estado.ruta}"
            )

        # Verificar que no exista ya
        existente = self.obtener_iniciativa(epica_id)
        if existente:
            return existente

        numero = self._siguiente_numero()
        nombre_carpeta = f"{numero} - {nombre_epica}"
        ruta_carpeta = Path(estado.ruta) / nombre_carpeta

        # Crear estructura
        ruta_carpeta.mkdir(parents=True, exist_ok=True)
        for subcarpeta in SUBCARPETAS:
            (ruta_carpeta / subcarpeta).mkdir(exist_ok=True)

        # Registrar
        iniciativa = Iniciativa(
            epica_id=epica_id,
            numero=numero,
            nombre=nombre_epica,
            ruta=str(ruta_carpeta),
        )
        self._datos.setdefault("iniciativas", []).append(
            {
                "epica_id": iniciativa.epica_id,
                "numero": iniciativa.numero,
                "nombre": iniciativa.nombre,
                "ruta": iniciativa.ruta,
                "creada": iniciativa.creada,
            }
        )
        self._guardar()
        logger.info(
            "Estructura creada para iniciativa %d en %s", epica_id, ruta_carpeta
        )
        return iniciativa

    def eliminar_estructura(self, epica_id: int) -> bool:
        """Elimina la carpeta y el registro de una iniciativa."""
        iniciativa = self.obtener_iniciativa(epica_id)
        if not iniciativa:
            return False

        # Eliminar carpeta
        ruta = Path(iniciativa.ruta)
        if ruta.exists():
            # OneDrive bloquea archivos para sincronización; cambiar permisos
            # antes de eliminar para evitar WinError 5 (Acceso denegado)
            def _onerror(func, path, exc_info):
                import stat
                os.chmod(path, stat.S_IWRITE)
                func(path)

            shutil.rmtree(ruta, onerror=_onerror)

        # Eliminar registro
        self._datos["iniciativas"] = [
            i
            for i in self._datos.get("iniciativas", [])
            if i["epica_id"] != epica_id
        ]
        self._guardar()
        logger.info("Estructura eliminada para iniciativa %d", epica_id)
        return True

    # ------------------------------------------------------------------ #
    # Archivos
    # ------------------------------------------------------------------ #

    def listar_archivos(
        self, epica_id: int, carpeta: str
    ) -> List[dict]:
        """Lista los archivos de una subcarpeta."""
        iniciativa = self.obtener_iniciativa(epica_id)
        if not iniciativa:
            raise ValueError(f"Iniciativa {epica_id} no encontrada")

        if carpeta not in SUBCARPETAS:
            raise ValueError(f"Carpeta no válida: {carpeta}")

        ruta_carpeta = Path(iniciativa.ruta) / carpeta
        if not ruta_carpeta.exists():
            return []

        archivos = []
        for archivo in ruta_carpeta.iterdir():
            if archivo.is_file():
                stat = archivo.stat()
                archivos.append(
                    {
                        "nombre": archivo.name,
                        "tamano": stat.st_size,
                        "modificado": date.fromtimestamp(
                            stat.st_mtime
                        ).isoformat(),
                    }
                )
        return sorted(archivos, key=lambda a: a["nombre"])

    def subir_archivo(
        self,
        epica_id: int,
        carpeta: str,
        nombre: str,
        contenido: bytes,
    ) -> dict:
        """Sube un archivo a una subcarpeta."""
        iniciativa = self.obtener_iniciativa(epica_id)
        if not iniciativa:
            raise ValueError(f"Iniciativa {epica_id} no encontrada")

        if carpeta not in SUBCARPETAS:
            raise ValueError(f"Carpeta no válida: {carpeta}")

        ruta_carpeta = Path(iniciativa.ruta) / carpeta
        ruta_carpeta.mkdir(parents=True, exist_ok=True)

        ruta_archivo = ruta_carpeta / nombre
        ruta_archivo.write_bytes(contenido)

        stat = ruta_archivo.stat()
        return {
            "nombre": nombre,
            "tamano": stat.st_size,
            "modificado": date.today().isoformat(),
        }

    def eliminar_archivo(
        self, epica_id: int, carpeta: str, nombre: str
    ) -> bool:
        """Elimina un archivo de una subcarpeta."""
        iniciativa = self.obtener_iniciativa(epica_id)
        if not iniciativa:
            raise ValueError(f"Iniciativa {epica_id} no encontrada")

        if carpeta not in SUBCARPETAS:
            raise ValueError(f"Carpeta no válida: {carpeta}")

        ruta_archivo = Path(iniciativa.ruta) / carpeta / nombre
        if not ruta_archivo.exists():
            return False

        ruta_archivo.unlink()
        return True

    def abrir_en_explorador(self, epica_id: int) -> str:
        """Abre la carpeta en el explorador de archivos del sistema."""
        iniciativa = self.obtener_iniciativa(epica_id)
        if not iniciativa:
            raise ValueError(f"Iniciativa {epica_id} no encontrada")

        ruta = Path(iniciativa.ruta)
        if not ruta.exists():
            raise FileNotFoundError(
                f"La carpeta no existe: {iniciativa.ruta}"
            )

        # En Windows, os.startfile abre la carpeta en el explorador
        import os
        os.startfile(str(ruta))  # type: ignore[attr-defined]

        return iniciativa.ruta
