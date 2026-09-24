"""Arranque local del backend del dashboard.

Uso:  python run.py  (lee configuración de .env y escucha en HOST:PUERTO)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn  # noqa: E402

from app.config import obtener_settings  # noqa: E402


def main() -> None:
    cfg = obtener_settings()
    uvicorn.run(
        "app.main:app",
        host=cfg.host,
        port=cfg.puerto,
        log_level=(cfg.log_nivel or "info").lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()