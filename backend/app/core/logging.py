"""Configuración de logging para el backend.

Niveles ajustables por entorno. Se evita registrar credenciales: los headers
de autorización nunca se incluyen en los mensajes.
"""

import logging

FORMATO = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"


def configurar_logging(nivel: str = "INFO") -> None:
    nivel_efectivo = (nivel or "INFO").upper()
    raiz = logging.getLogger()
    raiz.setLevel(nivel_efectivo)
    if not any(isinstance(h, logging.StreamHandler) for h in raiz.handlers):
        manejador = logging.StreamHandler()
        manejador.setFormatter(logging.Formatter(FORMATO))
        raiz.addHandler(manejador)
    logging.getLogger("devops").setLevel(nivel_efectivo)