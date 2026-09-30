"""Contador de peticiones HTTP hacia Azure DevOps.

Es un observador pasivo: el transporte lo consulta después de cada llamada,
y este objeto anota método, categoría, estado y duración. Nada de esto sale
del proceso.

Diseño a propósito:

- **En memoria y con tope.** Un `deque(maxlen=200)` retiene las últimas 200
  llamadas. Sin este tope, una sesión larga con el panel de monitorización
  abierto crecería sin límite y la pestaña terminaría consumiendo toda la
  RAM. 200 entradas son ~50 kB: suficiente para una conversación, y no tanto
  para importar.
- **La categoría se deriva del path.** El llamante no decide qué categoría se
  le asigna; se extrae del endpoint (`/wit/wiql`, `/wit/workitems`, etc.).
  De otro modo dos llamadas al mismo recurso podían contabilizarse de forma
  distinta.
- **Nunca lanza.** El monitor se consulta desde el interior de la petición,
  de modo que un error al anotar no puede tumbar una lectura que ya tuvo éxito.
  La observabilidad no puede ser la causa de un fallo.
"""

import asyncio
import logging
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List

logger = logging.getLogger("devops")

#: Número máximo de llamadas recientes que se conservan.
MAX_RECIENTES = 200

#: Límite de conexiones simultáneas por usuario en Azure DevOps.
LIMITE_CONCURRENTES = 300


def categorizar(path: str) -> str:
    """Clasifica una URL de Azure DevOps por el recurso que toca.

    El criterio es el segmento que identifica el recurso dentro de
    `_apis/…`, no la ruta completa: ids, queries y `api-version` varían en
    cada llamada pero no dicen nada sobre qué se está consultando.
    """
    segmentos = [s for s in path.split("?")[0].split("/") if s]
    if "_apis" not in segmentos:
        return "otro"
    inicio = segmentos.index("_apis") + 1
    sub = segmentos[inicio:]
    if not sub:
        return "raiz"
    raiz = sub[0]
    # /wit/wiql → WIQL
    if raiz == "wit" and len(sub) >= 2 and sub[1] == "wiql":
        return "WIQL"
    # /wit/workitems?ids=1,2 → Lote; /wit/workitems/123 → Work item
    if raiz == "wit" and len(sub) >= 2 and sub[1] == "workitems":
        # Sub-recursos primero: /workitems/123/updates → Historial
        if len(sub) >= 4 and sub[3] == "updates":
            return "Historial"
        if len(sub) >= 3 and sub[2] == "comments":
            return "Work item"
        if len(sub) >= 3:
            return "Work item"
        return "Lote"
    # /projects → Proyecto
    if raiz == "projects":
        return "Proyecto"
    return raiz


def _percentil(valores: List[int], percentil: int) -> int:
    """Calcula el percentil con interpolación lineal.

    Con un solo elemento, cualquier percentil es ese elemento. Con lista
    vacía, devuelve 0.
    """
    if not valores:
        return 0
    if len(valores) == 1:
        return valores[0]
    ordenados = sorted(valores)
    posicion = (percentil / 100) * (len(ordenados) - 1)
    inferior = int(posicion)
    superior = min(inferior + 1, len(ordenados) - 1)
    fraccion = posicion - inferior
    return int(ordenados[inferior] + fraccion * (ordenados[superior] - ordenados[inferior]))


@dataclass
class PeticionAzure:
    """Una llamada a Azure DevOps ya terminada."""

    hora: float
    metodo: str
    categoria: str
    estado: int
    duracion_ms: int
    error: str = ""


@dataclass
class EstadoMonitor:
    """Estado agregado del monitor, listo para serializar."""

    activa: bool
    total: int
    por_categoria: Dict[str, int]
    por_estado: Dict[str, int]
    errores: int
    tasa_error: float
    latencia_p50_ms: int
    latencia_p95_ms: int
    latencia_max_ms: int
    concurrentes: int
    concurrentes_pico: int
    limite_concurrentes: int
    llamadas_recientes: List[PeticionAzure]
    avisos: List[str] = field(default_factory=list)

    def model_dump(self) -> dict:
        """Serializa a dict para la API."""
        return {
            "activa": self.activa,
            "total": self.total,
            "por_categoria": self.por_categoria,
            "por_estado": self.por_estado,
            "errores": self.errores,
            "tasa_error": self.tasa_error,
            "latencia_p50_ms": self.latencia_p50_ms,
            "latencia_p95_ms": self.latencia_p95_ms,
            "latencia_max_ms": self.latencia_max_ms,
            "concurrentes": self.concurrentes,
            "concurrentes_pico": self.concurrentes_pico,
            "limite_concurrentes": self.limite_concurrentes,
            "llamadas_recientes": [
                {
                    "hora": time.strftime(
                        "%Y-%m-%dT%H:%M:%S", time.localtime(p.hora)
                    ),
                    "metodo": p.metodo,
                    "categoria": p.categoria,
                    "estado": p.estado,
                    "duracion_ms": p.duracion_ms,
                    "error": p.error,
                }
                for p in self.llamadas_recientes
            ],
            "avisos": self.avisos,
        }


@dataclass
class MonitorAzure:
    """Acumulador de peticiones HTTP hacia Azure DevOps."""

    _total: int = 0
    _errores: int = 0
    _por_categoria: Counter = field(default_factory=Counter)
    _por_estado: Counter = field(default_factory=Counter)
    _recientes: Deque[PeticionAzure] = field(
        default_factory=lambda: deque(maxlen=MAX_RECIENTES)
    )
    _duraciones: List[int] = field(default_factory=list)
    _concurrentes: int = 0
    _concurrentes_pico: int = 0
    _limite: int = LIMITE_CONCURRENTES
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __init__(self, *, limite_concurrentes: int = LIMITE_CONCURRENTES) -> None:
        self._total = 0
        self._errores = 0
        self._por_categoria = Counter()
        self._por_estado = Counter()
        self._recientes = deque(maxlen=MAX_RECIENTES)
        self._duraciones = []
        self._concurrentes = 0
        self._concurrentes_pico = 0
        self._limite = limite_concurrentes
        self._lock = asyncio.Lock()

    async def entrar(self) -> None:
        """Incrementa el contador de peticiones simultáneas."""
        async with self._lock:
            self._concurrentes += 1
            if self._concurrentes > self._concurrentes_pico:
                self._concurrentes_pico = self._concurrentes

    async def salir(self) -> None:
        """Decrementa el contador de peticiones simultáneas."""
        async with self._lock:
            self._concurrentes = max(0, self._concurrentes - 1)

    async def registrar(
        self,
        *,
        metodo: str,
        url: str,
        estado: int,
        duracion_ms: int,
        error: str = "",
    ) -> None:
        """Anota una llamada terminada.

        Nunca lanza: la observabilidad no puede ser la causa de un fallo.
        """
        try:
            categoria = categorizar(url)
            duracion_ms = max(0, int(duracion_ms))
            self._total += 1
            if estado == 0 or estado >= 400:
                self._errores += 1
            self._por_categoria[categoria] += 1
            self._por_estado[str(estado)] += 1
            self._duraciones.append(duracion_ms)
            self._recientes.append(
                PeticionAzure(
                    hora=time.time(),
                    metodo=metodo,
                    categoria=categoria,
                    estado=estado,
                    duracion_ms=duracion_ms,
                    error=error[:200],
                )
            )
        except Exception as exc:  # noqa: BLE001 - la observación nunca falla
            logger.warning("No se pudo registrar la petición a Azure: %s", exc)

    async def estado(self) -> EstadoMonitor:
        """Resumen agregado listo para la API y para el frontend."""
        tasa_error = self._errores / self._total if self._total > 0 else 0.0
        avisos: List[str] = []

        if self._total > 0 and tasa_error > 0.1:
            avisos.append(
                f"Tasa de error alta: {tasa_error * 100:.1f}% "
                f"({self._errores} de {self._total})"
            )

        if self._por_estado.get("429", 0) > 0:
            avisos.append(
                "Azure devolvió 429 (límite de peticiones). "
                "Ve más despacio o espera."
            )

        if self._concurrentes >= self._limite * 0.8:
            avisos.append(
                f"Cerca del límite de conexiones simultáneas: "
                f"{self._concurrentes} de {self._limite}"
            )

        if self._duraciones and len(self._duraciones) >= 20:
            p95 = _percentil(self._duraciones, 95)
            if p95 > 5000:
                avisos.append(
                    f"Latencia 95 % alta: {p95} ms. "
                    f"Considera reducir la frecuencia de refresco."
                )

        return EstadoMonitor(
            activa=True,
            total=self._total,
            por_categoria=dict(
                sorted(self._por_categoria.items(), key=lambda kv: -kv[1])
            ),
            por_estado=dict(
                sorted(self._por_estado.items(), key=lambda kv: -kv[1])
            ),
            errores=self._errores,
            tasa_error=tasa_error,
            latencia_p50_ms=_percentil(self._duraciones, 50),
            latencia_p95_ms=_percentil(self._duraciones, 95),
            latencia_max_ms=max(self._duraciones) if self._duraciones else 0,
            concurrentes=self._concurrentes,
            concurrentes_pico=self._concurrentes_pico,
            limite_concurrentes=self._limite,
            llamadas_recientes=list(self._recientes),
            avisos=avisos,
        )


_monitor_global = MonitorAzure()


def obtener_monitor() -> MonitorAzure:
    """Instancia única compartida por la aplicación."""
    return _monitor_global


def reiniciar_monitor() -> None:
    """Pone el monitor a cero. Solo para pruebas."""
    global _monitor_global  # noqa: PLW0603
    _monitor_global = MonitorAzure()
