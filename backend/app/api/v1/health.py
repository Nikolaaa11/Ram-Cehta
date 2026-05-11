from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import DBSession

router = APIRouter()


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
    """
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

    counts: dict[str, int] = {}
    try:
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
                # Tabla no existe (migration pending) — skip
                pass
    except Exception:
        pass

    return DetailedHealthResponse(
        status=overall,
        database=db_status,
        alembic_head=alembic_head,
        services=services,
        counts=counts,
        version="v5++",
    )


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


@router.get("/health/perf", response_model=PerfResponse)
async def perf_health(session: DBSession) -> PerfResponse:
    """V5++ ola BJ: diagnóstico de configuración perf actual.

    Detecta cuellos de botella comunes y devuelve recomendaciones.
    Ejemplo: si DATABASE_URL usa transaction pooler (port 6543), recomienda
    cambiar a session pooler (5432) para 10x más velocidad.
    """
    from app.core.database import _db_url, _is_transaction_pooler, engine

    pool_mode = "transaction (NullPool, +50ms/req)" if _is_transaction_pooler else "session (QueuePool)"
    recs: list[str] = []
    if _is_transaction_pooler:
        recs.append(
            "⚡ CRÍTICO: DATABASE_URL usa transaction pooler (port 6543). "
            "Cambiar a session pooler (port 5432) → ~50ms más rápido por request. "
            "Comando: fly secrets set DATABASE_URL=\"postgres://...:5432/postgres\" -a cehta-backend"
        )

    # Redactar credenciales en URL
    redacted = _db_url
    if "@" in redacted:
        prefix, host = redacted.split("@", 1)
        scheme_user = prefix.split("://", 1)
        if len(scheme_user) == 2:
            scheme = scheme_user[0]
            redacted = f"{scheme}://***@{host}"

    pool_size = None
    try:
        pool_size = getattr(engine.pool, "_pool_size", None) or getattr(
            engine.pool, "size", lambda: None
        )()
    except Exception:
        pass

    if not recs:
        recs.append("✅ Configuración óptima detectada")

    return PerfResponse(
        db_pool_mode=pool_mode,
        db_pool_size=pool_size,
        db_max_overflow=15 if not _is_transaction_pooler else 0,
        db_pool_recycle_sec=900 if not _is_transaction_pooler else None,
        db_url_redacted=redacted,
        gzip_min_size=300,
        gzip_level=4,
        workers=2,
        cache_features=[
            "asyncpg prepared_statement_cache: 512",
            "SQLAlchemy query_cache_size: 2048",
            "Empresa metadata cache TTL: 5min (in-process)",
            "Empresa scope cache TTL: 60s (in-process, LRU 1024)",
            "/me/empresas Cache-Control: 5min",
            "/catalogos/* Cache-Control: 5min stale-while-revalidate 60s",
        ],
        recommendations=recs,
    )
