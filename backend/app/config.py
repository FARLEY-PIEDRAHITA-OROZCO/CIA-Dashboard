"""Configuración de la aplicación.

Carga segura de ajustes por variables de entorno / archivo ``.env``.
El PAT de Azure DevOps se mantiene fuera de la API y no se registra. El
campo usa ``repr=False``; no serialices el objeto ``Settings`` completo.
"""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


#: Raíz del backend (`backend/`). El registro se resuelve con rutas **absolutas**
#: desde aquí, igual que el `.env`: una ruta relativa dependería del directorio de
#: trabajo desde el que se arranque, y el fichero de asignaciones cayendo en otro
#: sitio es la peor forma de perderlo.
RAIZ_BACKEND = Path(__file__).resolve().parents[1]
ENV_FILE = RAIZ_BACKEND / ".env"


class Settings(BaseSettings):
    """Ajustes globales. Valores sensibles marcados con ``repr=False``."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Azure DevOps ---------------------------------------------------- #
    azure_org_url: str = ""
    azure_proyecto: str = ""
    azure_pat: str = Field(default="", repr=False)
    area_path: str = ""

    # --- Escritura (opt-in, ver ADR-11) ---------------------------------- #
    # PAT **dedicado** con scope "Work Items: Read & Write". Se mantiene
    # separado del PAT de lectura para poder revocar la escritura sin
    # quedarse sin la capacidad de consultar el backlog.
    azure_pat_escritura: str = Field(default="", repr=False)
    escritura_habilitada: bool = False

    # --- Servidor -------------------------------------------------------- #
    host: str = "127.0.0.1"
    puerto: int = 8000
    log_nivel: str = "INFO"
    origen_cors: str = "http://localhost:5173"
    permitir_externo: bool = False

    # --- Comportamiento -------------------------------------------------- #
    cache_ttl_seg: int = 120
    timeout_seg: float = 30.0
    # TTL del índice local de sprints/personas. Mayor que `cache_ttl_seg`
    # porque construirlo implica varios lotes contra Azure; filtrar, en cambio,
    # es local y no consume red.
    index_ttl_seg: float = 300.0
    # TTL del índice local de activos de prueba. Mayor que `index_ttl_seg`
    # porque cuesta más construirlo (3.932 ítems y `$expand=relations`: ~5,5 s
    # medidos) y porque los casos en `Design` cambian muy poco. Es un segundo
    # índice, con carga perezosa: la vista de sprints no lo toca nunca.
    index_pruebas_ttl_seg: float = 900.0

    # --- Actividad por épica ---------------------------------------------- #
    # TTL de la agregación de historial de revisiones. Es el más largo porque
    # es la lectura más cara del sistema: **una llamada a Azure por ítem del
    # árbol** (no existe endpoint por lotes, medido). Medido en el proyecto real:
    # de 1 a 254 ítems por épica, mediana 26; de 0,3 s a 5,8 s, mediana 1,2 s. Y
    # el historial de un ítem no cambia de forma útil de un minuto a otro.
    # Reescribir un ítem invalida su caché.
    actividad_ttl_seg: float = 900.0

    # --- Registro local de pruebas ---------------------------------------- #
    # Fichero donde viven los perfiles de rol y las asignaciones de épicas. Es
    # el ÚNICO sitio donde existe esa información: Azure no tiene ningún campo
    # para ella (medido: el tipo Epic de este proyecto no tiene ni `System.Tags`
    # ni `System.HyperLink` ni ningún campo `Custom.*` propio), así que si el
    # fichero se pierde, no hay de dónde recuperarla.
    #
    # **NO está rastreado en git.** Es un dato, no código: exigir un commit por
    # cada asignación era un coste ceremonial a cambio de una copia de seguridad
    # que no se pidió. El fichero está en `.gitignore` y el respaldo se
    # configura aparte, con `registro_copia_ruta`.
    registro_ruta: str = "datos/asignaciones.json"

    # Dónde se copia el registro después de cada guardado. Vacío = sin copia, y
    # la interfaz lo dice, porque un registro sin respaldo es un riesgo que hay
    # que ver.
    #
    # Se deja **sin valor por defecto a propósito**: adivinar la ruta de un
    # `OneDrive` sin sesión iniciada produciría un fichero que parece respaldado
    # y no lo está, que es peor que no tener copia. Ponerlo vacío hace que la
    # ausencia sea visible; poner la ruta equivocada la escondería.
    registro_copia_ruta: str = ""

    @field_validator("registro_ruta")
    @classmethod
    def _resolver_registro(cls, valor: str) -> str:
        """Absoluta siempre, resuelta desde la raíz del backend."""
        ruta = Path(str(valor or "")).expanduser()
        if not ruta.is_absolute():
            ruta = RAIZ_BACKEND / ruta
        return str(ruta)

    @field_validator("registro_copia_ruta")
    @classmethod
    def _resolver_copia(cls, valor: str) -> str:
        """Igual que el registro, y vacío se queda vacío.

        Un vacío se devuelve como vacío y no como la raíz del backend: si
        «sin copia» se convirtiera en «copiar a /backend», el respaldo escribiría
        encima de sí mismo y nadie se enteraría.
        """
        crudo = str(valor or "").strip()
        if not crudo:
            return ""
        ruta = Path(crudo).expanduser()
        if not ruta.is_absolute():
            ruta = RAIZ_BACKEND / ruta
        return str(ruta)

    @field_validator("azure_org_url")
    @classmethod
    def _exigir_https(cls, valor: str) -> str:
        limpio = (valor or "").strip().rstrip("/")
        if limpio and not limpio.startswith("https://"):
            raise ValueError("Azure exige HTTPS para la organización.")
        return limpio

    @field_validator("origen_cors")
    @classmethod
    def _separar_origines(cls, valor: str) -> str:
        return ",".join(x.strip() for x in (valor or "").split(",") if x.strip())

    @model_validator(mode="after")
    def _exigir_opt_in_para_exposicion_externa(self) -> "Settings":
        loopback = {"127.0.0.1", "localhost", "::1"}
        if self.host.strip().lower() not in loopback and not self.permitir_externo:
            raise ValueError(
                "Para escuchar fuera de loopback define PERMITIR_EXTERNO=true "
                "y configura un proxy con autenticación."
            )
        return self

    @model_validator(mode="after")
    def _exigir_loopback_para_escritura(self) -> "Settings":
        """La escritura nunca puede quedar expuesta a una red sin autenticación.

        Este sistema **no tiene login propio**: la única defensa es el binding
        a loopback. Publicar una capacidad de escritura detrás de un proxy sin
        autenticación permitiría que cualquiera alcanzara el backlog del equipo,
        por lo que se rechaza la configuración en lugar de solo advertir.
        """
        loopback = {"127.0.0.1", "localhost", "::1"}
        if self.escritura_habilitada and self.host.strip().lower() not in loopback:
            raise ValueError(
                "La escritura está habilitada pero HOST no es loopback. Este "
                "sistema no tiene autenticación propia: para exponer la "
                "escritura en red se requiere antes un proxy con "
                "autenticación (ADR-11)."
            )
        return self

    @property
    def configurado(self) -> bool:
        """True solo si hay credenciales suficientes para leer el backlog."""
        return bool(self.azure_org_url and self.azure_proyecto and self.azure_pat)

    @property
    def configurado_escritura(self) -> bool:
        """True solo si la escritura está habilitada Y tiene su propio PAT.

        La escritura es *opt-in* y además requiere un PAT dedicado: sin
        ``AZURE_PAT_ESCRITURA`` el sistema se comporta como solo lectura aunque
        el flag esté activo.
        """
        return bool(
            self.escritura_habilitada
            and self.azure_pat_escritura
            and self.azure_org_url
            and self.azure_proyecto
        )

    @property
    def area_path_efectivo(self) -> str:
        """AreaPath para filtrar; si no se dio, se usa el propio proyecto."""
        return (self.area_path or "").strip() or self.azure_proyecto.strip()

    @property
    def origenes_cors(self) -> List[str]:
        return [o for o in self.origen_cors.split(",") if o]


@lru_cache
def obtener_settings() -> Settings:
    """Singleton de configuración (memorizado para no releer el entorno)."""
    return Settings()