from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import get_session
from app.core.logging import configure_logging, get_logger
from app.core.observability import init_sentry
from app.services.notification_generator_service import (
    NotificationGeneratorService,
)

configure_logging()
log = get_logger(__name__)

# Sentry se inicializa antes de instanciar FastAPI para que los integrations capturen
# el ciclo completo de la app. Si no hay SENTRY_DSN seteado queda silenciosamente apagado.
sentry_active = init_sentry()
log.info("sentry", active=sentry_active)

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])


async def _run_alert_generator_on_startup() -> None:
    """Corre el generador de alertas in-app en background al startup.

    Solo si `settings.generate_alerts_on_startup` está activo. Soft-fail:
    si la DB no responde o la tabla no está migrada, loggea warning pero
    no rompe el boot.
    """
    try:
        async for session in get_session():
            svc = NotificationGeneratorService(session)
            report = await svc.run_all()
            await session.commit()
            log.info(
                "alerts_generated_on_startup",
                f29_due=report.f29_due,
                contrato_due=report.contrato_due,
                oc_pending=report.oc_pending,
                total=report.total,
            )
            break
    except Exception as exc:
        log.warning("alerts_on_startup_failed", error=str(exc))


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    log.info("starting", env=settings.app_env)
    bg_tasks: set[asyncio.Task[None]] = set()
    if settings.generate_alerts_on_startup:
        # En background — no bloqueamos el startup.
        task = asyncio.create_task(_run_alert_generator_on_startup())
        bg_tasks.add(task)
        task.add_done_callback(bg_tasks.discard)
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

# Gzip — comprime respuestas >500 bytes (60-80% reducción típica en JSON
# de dashboards / lists). Beneficio neto en latencia es mayor mientras
# más grande la respuesta. CPU overhead despreciable a este volumen.
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)

app.include_router(api_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": "0.1.0"}


@app.get("/health", include_in_schema=False)
async def liveness() -> dict[str, str]:
    # Liveness check: no DB dependency. La readiness con DB está en /api/v1/health.
    return {"status": "alive"}
