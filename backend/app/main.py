"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.dataset import router as dataset_router
from app.api.routes import router
from app.api.ws import inference_socket
from app.config import get_settings
from app.services import Services, build_services


class _NoContentFilter(logging.Filter):
    """Defence in depth: drop any log record that looks like it carries image payloads."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "base64," not in msg


def create_app(services: Services | None = None) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for h in logging.getLogger().handlers:
        h.addFilter(_NoContentFilter())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if getattr(app.state, "services", None) is None:
            app.state.services = build_services()
        yield

    app = FastAPI(title="AI Health Mirror API", version=__version__, lifespan=lifespan)
    app.state.services = services
    app.add_middleware(CORSMiddleware, allow_origins=list(get_settings().cors_origins), allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["content-type"])
    app.include_router(router)
    app.include_router(dataset_router)

    @app.websocket("/ws/inference")
    async def ws_endpoint(ws: WebSocket):
        await inference_socket(ws, app.state.services)

    return app


app = create_app()
