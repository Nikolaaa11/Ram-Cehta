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
