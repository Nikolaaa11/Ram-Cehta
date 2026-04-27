from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.v1 import api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.observability import init_sentry

configure_logging()
log = get_logger(__name__)

# Sentry se inicializa antes de instanciar FastAPI para que los integrations capturen
# el ciclo completo de la app. Si no hay SENTRY_DSN seteado queda silenciosamente apagado.
sentry_active = init_sentry()
log.info("sentry", active=sentry_active)

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    log.info("starting", env=settings.app_env)
    yield
    log.info("shutting_down")


app = FastAPI(
    title="Cehta Capital API",
    version="0.1.0",
    description="Backend para la Plataforma Cehta Capital (FIP CEHTA ESG).",
    lifespan=lifespan,
    openapi_url="/openapi.json" if not settings.is_production else None,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Requested-With",
        "Accept",
    ],
    max_age=600,
)

app.include_router(api_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": "0.1.0"}


@app.get("/health", include_in_schema=False)
async def liveness() -> dict[str, str]:
    # Liveness check: no DB dependency. La readiness con DB está en /api/v1/health.
    return {"status": "alive"}
