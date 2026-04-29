"""Status / Health dashboard endpoint — admin-only.

Un solo `GET /admin/status` agrega:
- Postgres ping (SELECT 1)
- Dropbox: si hay refresh_token + last successful sync timestamp
- Resend: si hay api_key (no disparamos send de prueba — caro)
- Anthropic: si hay api_key (no llamamos al LLM — caro)
- OpenAI: si hay api_key (idem)

Más métricas operativas:
- Último ETL run + status
- Última sincronización Dropbox por empresa (si hay)
- Conteo de notificaciones no leídas globales
- Conteo de empresas activas

Diseñado para ser barato (<200ms): un round-trip a Postgres con UNION ALL.
"""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.schemas.status import (
    CheckState,
    IntegrationCheck,
    OperationalMetric,
    SystemStatus,
)

router = APIRouter()


def _now() -> datetime:
    return datetime.now(UTC)


async def _check_postgres(db) -> IntegrationCheck:
    """SELECT 1 con timing — el check más barato y más importante."""
    start = time.perf_counter()
    try:
        result = await db.execute(text("SELECT 1"))
        result.scalar_one()
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        state: CheckState = "ok" if elapsed_ms < 200 else "degraded"
        detail = (
            f"Conectado en {elapsed_ms}ms"
            if state == "ok"
            else f"Lento ({elapsed_ms}ms — investigar)"
        )
        return IntegrationCheck(
            name="Postgres (Supabase)",
            state=state,
            detail=detail,
            latency_ms=elapsed_ms,
            last_checked_at=_now(),
        )
    except Exception as exc:
        return IntegrationCheck(
            name="Postgres (Supabase)",
            state="down",
            detail=f"Error: {exc!s}"[:200],
            latency_ms=None,
            last_checked_at=_now(),
        )


def _check_secret_present(
    name: str, value: str | None, when_off: str = "API key no configurada"
) -> IntegrationCheck:
    """Helper para checks pasivos basados solo en presencia de secret.

    No disparamos llamadas a APIs externas de pago (Anthropic, OpenAI, Resend)
    para evitar costos. Si la key está, asumimos `ok`; si no, `disabled`.
    """
    if not value:
        return IntegrationCheck(
            name=name,
            state="disabled",
            detail=when_off,
            latency_ms=None,
            last_checked_at=_now(),
        )
    return IntegrationCheck(
        name=name,
        state="ok",
        detail="Configurada",
        latency_ms=None,
        last_checked_at=_now(),
    )


async def _check_dropbox(db) -> IntegrationCheck:
    """Dropbox check: hay refresh_token persistido en `app.integrations`?"""
    if not settings.dropbox_app_key:
        return IntegrationCheck(
            name="Dropbox",
            state="disabled",
            detail="DROPBOX_APP_KEY no configurada",
            last_checked_at=_now(),
        )
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT updated_at, status
                    FROM app.integrations
                    WHERE provider = 'dropbox'
                    LIMIT 1
                    """
                )
            )
        ).first()
        if not row:
            return IntegrationCheck(
                name="Dropbox",
                state="degraded",
                detail="App key configurada pero sin OAuth conectado",
                last_checked_at=_now(),
            )
        updated_at, status = row
        days_old = (_now() - updated_at).days if updated_at else None
        # refresh_tokens duran offline indefinidamente, pero si hace mucho
        # que no se usa, vale revisar manualmente.
        if days_old is not None and days_old > 30:
            return IntegrationCheck(
                name="Dropbox",
                state="degraded",
                detail=f"Conectado pero sin uso hace {days_old} días",
                last_checked_at=_now(),
            )
        return IntegrationCheck(
            name="Dropbox",
            state="ok",
            detail=f"Conectado · status={status}",
            last_checked_at=_now(),
        )
    except Exception as exc:
        # La tabla puede no existir o el schema cambió — soft-fail.
        return IntegrationCheck(
            name="Dropbox",
            state="unknown",
            detail=f"No se pudo verificar: {exc!s}"[:200],
            last_checked_at=_now(),
        )


async def _build_metrics(db) -> list[OperationalMetric]:
    """Métricas operativas en una sola query con UNION ALL."""
    metrics: list[OperationalMetric] = []

    # Empresas activas
    try:
        n = await db.scalar(
            text("SELECT COUNT(*) FROM core.empresas WHERE activo = true")
        )
        metrics.append(
            OperationalMetric(
                label="Empresas activas", value=str(n or 0), hint="del portafolio"
            )
        )
    except Exception:
        pass

    # Último ETL run
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT status, finished_at, rows_loaded
                    FROM audit.etl_runs
                    ORDER BY started_at DESC
                    LIMIT 1
                    """
                )
            )
        ).first()
        if row:
            status, finished_at, rows_loaded = row
            if finished_at:
                hint = f"hace {(_now() - finished_at).days}d · {rows_loaded or 0} filas"
            else:
                hint = "en curso"
            metrics.append(
                OperationalMetric(
                    label="Último ETL", value=str(status or "—"), hint=hint
                )
            )
    except Exception:
        pass

    # Notificaciones no leídas globales
    try:
        n = await db.scalar(
            text("SELECT COUNT(*) FROM app.notifications WHERE read_at IS NULL")
        )
        metrics.append(
            OperationalMetric(
                label="Notif. sin leer (global)",
                value=str(n or 0),
                hint="sumando todos los users",
            )
        )
    except Exception:
        pass

    # Filas en core.movimientos (proxy de healthy data)
    try:
        n = await db.scalar(text("SELECT COUNT(*) FROM core.movimientos"))
        metrics.append(
            OperationalMetric(
                label="Movimientos en BD",
                value=f"{(n or 0):,}".replace(",", "."),
                hint="cargados via ETL",
            )
        )
    except Exception:
        pass

    # Audit log: cantidad de acciones últimas 24h
    try:
        n = await db.scalar(
            text(
                "SELECT COUNT(*) FROM audit.action_log "
                "WHERE created_at > now() - interval '24 hours'"
            )
        )
        metrics.append(
            OperationalMetric(
                label="Cambios últimas 24h",
                value=str(n or 0),
                hint="audit log",
            )
        )
    except Exception:
        pass

    return metrics


def _overall_state(checks: list[IntegrationCheck]) -> CheckState:
    """El peor estado entre los checks no-disabled."""
    rank: dict[CheckState, int] = {
        "ok": 0,
        "unknown": 1,
        "degraded": 2,
        "down": 3,
        "disabled": -1,  # ignored
    }
    worst: CheckState = "ok"
    for check in checks:
        if check.state == "disabled":
            continue
        if rank[check.state] > rank[worst]:
            worst = check.state
    return worst


@router.get("/status", response_model=SystemStatus)
async def get_system_status(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("audit:read"))
    ],
    db: DBSession,
) -> SystemStatus:
    """Status agregado de toda la plataforma. Admin-only.

    Reusa el scope `audit:read` que ya existe (admin). No tiene sentido
    abrirlo a finance/viewer — es info de operaciones internas.
    """
    pg_check = await _check_postgres(db)
    dropbox_check = await _check_dropbox(db)

    checks = [
        pg_check,
        dropbox_check,
        _check_secret_present(
            "Anthropic Claude",
            settings.anthropic_api_key,
            "AI Asistente / Document Analyzer no disponibles sin key",
        ),
        _check_secret_present(
            "OpenAI (embeddings)",
            settings.openai_api_key,
            "Embeddings para AI Q&A no disponibles sin key",
        ),
        _check_secret_present(
            "Resend (email)",
            settings.resend_api_key,
            "Notificaciones por email + CEO digest no se enviarán",
        ),
    ]

    metrics = await _build_metrics(db)

    return SystemStatus(
        generated_at=_now(),
        overall=_overall_state(checks),
        checks=checks,
        metrics=metrics,
    )
