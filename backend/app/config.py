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


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


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