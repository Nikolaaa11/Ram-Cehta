from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1 import api_router
from app.core.config import settings
from app.core.database import get_session
from app.core.limiter import limiter
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

# `limiter` ahora vive en app/core/limiter.py para que los routers lo
# puedan importar y aplicar `@limiter.limit("X/minute")` a sus endpoints.

# V5++ ola X: rate limits específicos por endpoint costoso.
# Cada uno se aplica como decorator @limiter.limit("X/minute") en el handler.
# Estos son los caps internos para evitar abuso y controlar costos:
#
# AI endpoints (cuestan tokens Anthropic):
#   /ai/data-qa             → 10/min  (caro, ~$0.005 cada uno)
#   /vouchers/from-factura-pdf → 5/min  (Claude vision + análisis)
#   /admin/mailbox/classify → 5/min  (procesa hasta 50 emails)
#
# Search endpoints (heavy DB query):
#   /vouchers/search        → 30/min  (full-text con tsvector)
#   /search                 → 30/min  (global cmd+k)
#
# IMAP/sync endpoints (procesos largos):
#   /admin/mailbox/poll     → 4/min  (1 cada 15s, suficiente para retry burst)
#   /cartolas/sync/{e}      → 6/min
#   /cartolas/sync-all      → 2/min  (procesa 9 empresas, bajo)


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
    # R152RRRRR — Flush final del buffer de telemetría antes de cerrar.
    # Sin esto perdemos hasta 100 rows por deploy.
    try:
        from app.core.usage_tracking_middleware import flush_on_shutdown
        await flush_on_shutdown()
    except Exception as exc:
        log.warning("usage_tracking.shutdown_flush_failed", error=str(exc))
    log.info("shutting_down")


app = FastAPI(
    title="Cehta Capital API",
    version="0.1.0",
    description=(
        "Backend para la Plataforma Cehta Capital (FIP CEHTA ESG).\n\n"
        "Auth: Bearer JWT (Supabase) o Bearer API token (`cak_...`)."
    ),
    lifespan=lifespan,
    # En producción exponemos `/openapi.json` para que el frontend pueda
    # renderizar /admin/api-docs (V4 fase 4). El JSON describe la API
    # surface — no contiene secretos. /docs (Swagger UI nativo) y /redoc
    # quedan disponibles también; cualquier scrapeo del API surface es
    # equivalente a leer este código abierto.
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Round 78 — regex cubre preview deploys de Vercel del proyecto Cehta
    # sin tener que actualizar CORS_ORIGINS por deploy. Ver config.py.
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Requested-With",
        "Accept",
        # R152BBBBB — Idempotency middleware lee este header.
        "Idempotency-Key",
    ],
    max_age=600,
)

# Gzip — comprime respuestas >500 bytes (60-80% reducción típica en JSON
# de dashboards / lists). Beneficio neto en latencia es mayor mientras
# más grande la respuesta. CPU overhead despreciable a este volumen.
# V5++ ola BJ: compresslevel=4 (era 6) — sweet spot CPU/size:
#   level 6: ~2ms CPU, 78% reducción → buena calidad, costo CPU notable
#   level 4: ~0.5ms CPU, 75% reducción → 4x más rápido, casi mismo size
#   level 1: 0.2ms CPU, 65% reducción → muy rápido, peor size
# minimum_size=300 (era 500) — comprimimos respuestas más chicas también
# (la mayoría de JSON de la app está entre 300-2000 bytes)
app.add_middleware(GZipMiddleware, minimum_size=300, compresslevel=4)

# V5++ ola AE — Audit middleware: cada POST/PATCH/PUT/DELETE va a
# audit.http_mutations con method/path/status/latency. Best-effort,
# nunca bloquea ni rompe response al cliente.
from app.core.audit_middleware import HttpMutationAuditMiddleware
app.add_middleware(HttpMutationAuditMiddleware)

# R152BBBBB — Idempotency-Key middleware. Cachea respuestas de mutaciones
# (POST/PATCH/PUT/DELETE) por header Idempotency-Key durante 5 minutos.
# Cierra el ciclo de protección contra double-submit que empezó en
# R152AAAAA (apiClient genera UUID v4 por mutación).
#
# Orden importa: este middleware corre ANTES del audit middleware en el
# stack de Starlette (los middlewares se aplican en orden inverso al
# add_middleware). El audit captura tanto cache-hits como cache-misses;
# eso es lo que queremos — el trail debe registrar TODOS los requests
# llegados, incluso los que respondió la cache.
from app.core.idempotency_middleware import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)

# R152PPPPP — Telemetría de uso por endpoint (feature_usage table).
# Buffer in-memory + flush async cada 10s. NUNCA bloquea ni rompe requests.
# Útil para decidir qué features apagar con datos reales (no asumiendo).
from app.core.usage_tracking_middleware import UsageTrackingMiddleware
app.add_middleware(UsageTrackingMiddleware)

app.include_router(api_router)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "version": "0.1.0"}


@app.get("/health", include_in_schema=False)
async def liveness() -> dict[str, str]:
    # Liveness check: no DB dependency. La readiness con DB está en /api/v1/health.
    return {"status": "alive"}
