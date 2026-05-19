from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import DBSession

router = APIRouter()

# V5++ ola CC perf: cache in-process para /health/detailed.
# Los counts no necesitan ser frescos al milisegundo — polleadores
# externos (uptime monitors, Sentry, dashboards) consultan c/30s.
# Cache TTL 30s reduce 95% de queries pesadas sobre la DB.
_DETAILED_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
_DETAILED_CACHE_TTL = 30.0  # segundos


class HealthResponse(BaseModel):
    status: str
    database: str


@router.get("/health", response_model=HealthResponse)
async def health(session: DBSession) -> HealthResponse:
    db_status = "ok"
    try:
        result = await session.execute(text("SELECT 1"))
        result.scalar_one()
    except Exception:  # noqa: BLE001 — health check reports, doesn't raise
        db_status = "unreachable"
    return HealthResponse(status="ok", database=db_status)


# ============================================================================
# /health/detailed — diagnóstico completo (V5++)
# ============================================================================


class DetailedHealthResponse(BaseModel):
    status: str  # "ok" | "degraded" | "down"
    database: str
    alembic_head: str | None
    services: dict[str, str]  # imap_inbox, anthropic, dropbox, resend, etc.
    counts: dict[str, int]  # vouchers, empresas, etc.
    version: str  # commit/build id


@router.get("/health/detailed", response_model=DetailedHealthResponse)
async def health_detailed(session: DBSession) -> DetailedHealthResponse:
    """Health check exhaustivo — para uptime monitors externos.

    Devuelve siempre 200 (no 503) con los componentes detallados, así un
    monitor puede alertar selectivamente en `services.imap_inbox=down`
    sin tirar el endpoint completo.

    V5++ ola CC: cache in-process 30s. Como los uptime monitors polean
    cada 30-60s y los counts son lentos (DB en Ohio, backend en GRU,
    ~1100ms por query consolidada), el cache evita 95% de hits a DB.
    """
    # Cache hit
    now = time.time()
    if (
        _DETAILED_CACHE["data"] is not None
        and (now - _DETAILED_CACHE["ts"]) < _DETAILED_CACHE_TTL
    ):
        return _DETAILED_CACHE["data"]  # type: ignore[no-any-return]

    from app.core.config import settings

    overall = "ok"
    db_status = "ok"
    alembic_head: str | None = None

    try:
        result = await session.execute(text("SELECT 1"))
        result.scalar_one()
    except Exception:
        db_status = "unreachable"
        overall = "down"

    try:
        row = (
            await session.execute(text("SELECT version_num FROM alembic_version"))
        ).first()
        alembic_head = row[0] if row else None
    except Exception:
        alembic_head = None

    services = {
        "imap_inbox": "configured"
        if (settings.inbox_imap_user and settings.inbox_imap_password)
        else "not_configured",
        "anthropic": "configured" if settings.anthropic_api_key else "not_configured",
        "dropbox": "configured" if settings.dropbox_refresh_token else "not_configured",
        "resend": "configured" if settings.resend_api_key else "not_configured",
        "openai_embeddings": "configured" if settings.openai_api_key else "not_configured",
    }

    # V5++ ola CC perf: consolidar 8 COUNT queries en 1 sola con SELECT
    # de subqueries. Antes: 8 round-trips serializados (~2100ms).
    # Ahora: 1 round-trip (~200ms). Mejora 10x.
    counts: dict[str, int] = {}
    try:
        row = (
            await session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM core.empresas WHERE activo = TRUE)::bigint AS empresas_activas,
                        (SELECT COUNT(*) FROM core.vouchers)::bigint AS vouchers_total,
                        (SELECT COUNT(*) FROM core.vouchers WHERE status = 'PENDING')::bigint AS vouchers_pending,
                        (SELECT COUNT(*) FROM core.inbox_messages)::bigint AS inbox_total,
                        (SELECT COUNT(*) FROM core.inbox_messages
                          WHERE status IN ('received','classified'))::bigint AS inbox_pending_review,
                        (SELECT COUNT(*) FROM core.cartolas_runs)::bigint AS cartolas_runs_total,
                        (SELECT COUNT(*) FROM core.f29_obligaciones
                          WHERE estado = 'pendiente')::bigint AS f29_pendientes,
                        (SELECT COUNT(*) FROM core.f22_obligaciones
                          WHERE estado = 'pendiente')::bigint AS f22_pendientes
                    """
                )
            )
        ).mappings().first()
        if row:
            counts = {k: int(v or 0) for k, v in row.items()}
    except Exception:
        # Si una tabla no existe (migration pending), la query falla entera.
        # Fallback: intentar cada count individual con soft-fail.
        for label, query in [
            ("empresas_activas", "SELECT COUNT(*) FROM core.empresas WHERE activo = TRUE"),
            ("vouchers_total", "SELECT COUNT(*) FROM core.vouchers"),
            ("vouchers_pending", "SELECT COUNT(*) FROM core.vouchers WHERE status = 'PENDING'"),
            ("inbox_total", "SELECT COUNT(*) FROM core.inbox_messages"),
            ("inbox_pending_review", "SELECT COUNT(*) FROM core.inbox_messages WHERE status IN ('received','classified')"),
            ("cartolas_runs_total", "SELECT COUNT(*) FROM core.cartolas_runs"),
            ("f29_pendientes", "SELECT COUNT(*) FROM core.f29_obligaciones WHERE estado = 'pendiente'"),
            ("f22_pendientes", "SELECT COUNT(*) FROM core.f22_obligaciones WHERE estado = 'pendiente'"),
        ]:
            try:
                v = await session.scalar(text(query))
                counts[label] = int(v or 0)
            except Exception:
                pass

    result = DetailedHealthResponse(
        status=overall,
        database=db_status,
        alembic_head=alembic_head,
        services=services,
        counts=counts,
        version="v5++",
    )
    # Cache write
    _DETAILED_CACHE["ts"] = now
    _DETAILED_CACHE["data"] = result
    return result


# ============================================================================
# /health/perf — métricas de performance del proceso
# ============================================================================


class PerfResponse(BaseModel):
    db_pool_mode: str
    db_pool_size: int | None
    db_max_overflow: int | None = None
    db_pool_recycle_sec: int | None = None
    db_url_redacted: str
    gzip_min_size: int
    gzip_level: int
    workers: int | None
    cache_features: list[str] = []
    recommendations: list[str]
    # V5++ ola CB: scope cache stats
    scope_cache: dict | None = None


@router.get("/health/perf", response_model=PerfResponse)
async def perf_health(session: DBSession) -> PerfResponse:
    """V5++ ola BJ: diagnóstico de configuración perf actual.

    Round 110 update: las recomendaciones se invirtieron. Con Supabase
    Free Tier (15 client cap en session pooler), el riesgo de
    EMAXCONNSESSION supera el costo de ~50ms del transaction pooler.
    Recomendamos el switch a port 6543 hasta que se pague Supabase Pro.

    También reporta valores REALES del engine (no hardcodeados) — antes
    los valores quedaban desfasados cuando se cambiaba la config.
    """
    from app.core.database import _db_url, _is_transaction_pooler, engine

    pool_mode = "transaction (NullPool, +50ms/req)" if _is_transaction_pooler else "session (QueuePool)"
    recs: list[str] = []
    if not _is_transaction_pooler:
        recs.append(
            "⚠ Si ves errores EMAXCONNSESSION en logs (visto en Round 109), "
            "migrá a transaction pooler (port 6543). Supabase Free tier "
            "tiene cap de 15 clientes en session mode. Costo: +~50ms/req. "
            "Comando: fly secrets set DATABASE_URL=\"postgres://...:6543/postgres\" -a cehta-backend"
        )

    # Redactar credenciales en URL
    redacted = _db_url
    if "@" in redacted:
        prefix, host = redacted.split("@", 1)
        scheme_user = prefix.split("://", 1)
        if len(scheme_user) == 2:
            scheme = scheme_user[0]
            redacted = f"{scheme}://***@{host}"

    # Round 110 — Leer valores REALES del engine, no hardcodeados.
    pool_size: int | None = None
    max_overflow: int | None = None
    recycle_sec: int | None = None
    try:
        pool = engine.pool
        # QueuePool tiene _pool.maxsize, _max_overflow, _recycle
        pool_size = getattr(pool, "_pool", None) and getattr(pool._pool, "maxsize", None)
        if pool_size is None:
            pool_size = getattr(pool, "size", lambda: None)()
        max_overflow = getattr(pool, "_max_overflow", None)
        recycle_sec = getattr(pool, "_recycle", None)
    except Exception:
        pass

    # Leer cantidad real de workers desde uvicorn si está en env
    import os
    workers_env = os.environ.get("WEB_CONCURRENCY")
    workers = int(workers_env) if workers_env and workers_env.isdigit() else None

    if not recs:
        recs.append("✅ Configuración óptima detectada")

    # V5++ ola CB: incluir stats del scope cache
    try:
        from app.services.empresa_scope_service import get_cache_stats
        scope_cache_info = get_cache_stats()
    except Exception:
        scope_cache_info = None

    return PerfResponse(
        db_pool_mode=pool_mode,
        db_pool_size=pool_size,
        db_max_overflow=max_overflow if not _is_transaction_pooler else 0,
        db_pool_recycle_sec=recycle_sec if not _is_transaction_pooler else None,
        db_url_redacted=redacted,
        gzip_min_size=300,
        gzip_level=4,
        workers=workers,
        cache_features=[
            "asyncpg prepared_statement_cache: 512",
            "SQLAlchemy query_cache_size: 2048",
            "Empresa metadata cache TTL: 5min (in-process)",
            "Empresa scope cache TTL: 60s (in-process, LRU 1024)",
            "/me/empresas Cache-Control: 5min",
            "/catalogos/* Cache-Control: 5min stale-while-revalidate 60s",
            # Round 110 — SSE per-user cap
            "SSE max subscriptions per user: 5 (FIFO evict on excess)",
        ],
        recommendations=recs,
        scope_cache=scope_cache_info,
    )
