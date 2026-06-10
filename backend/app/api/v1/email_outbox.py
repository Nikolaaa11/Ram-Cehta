"""R152ZZZZZ · Email outbox admin endpoints.

Endpoints:
  POST /admin/email-outbox/retry  → Cron que reintenta emails failed
  GET  /admin/email-outbox/stats  → Counters by status para monitoring

El cron Fly debería pegar a POST /retry cada 2 min con header
Authorization: Bearer <SMOKE_ADMIN_JWT> o similar. Si querés un sistema
sin JWT (más simple para crons), agregar X-Cron-Secret header.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.services.email_outbox_service import retry_failed_emails

router = APIRouter(prefix="/admin/email-outbox", tags=["admin-email-outbox"])


@router.post("/retry", summary="Retry emails failed en outbox (admin/cron)")
async def retry_outbox(
    user: CurrentUser, db: DBSession, limit: int = 50
) -> dict:
    """Procesa hasta `limit` emails en status='failed' que están listos.

    Para automatizar:
      fly machine update <id> --schedule "*/2 * * * *" \\
                              --command "curl -X POST -H 'Authorization: ...' \\
                              https://cehta-backend.fly.dev/api/v1/admin/email-outbox/retry"

    O un machine dedicado de cron con este endpoint en su loop.
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admins pueden disparar retry del outbox.",
        )
    counters = await retry_failed_emails(db, limit=limit)
    return {"ok": True, **counters}


@router.get("/stats", summary="Counters del outbox por status (admin)")
async def outbox_stats(user: CurrentUser, db: DBSession) -> dict:
    """Stats para dashboard de salud del envío de emails."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admins pueden ver stats del outbox.",
        )

    by_status = (
        await db.execute(
            text(
                """SELECT status, COUNT(*) AS cnt
                   FROM core.email_outbox
                   WHERE created_at > NOW() - INTERVAL '30 days'
                   GROUP BY status
                   ORDER BY status"""
            )
        )
    ).fetchall()

    recent_dead = (
        await db.execute(
            text(
                """SELECT outbox_id, to_emails, subject, last_error, last_attempt_at
                   FROM core.email_outbox
                   WHERE status = 'dead'
                   ORDER BY last_attempt_at DESC NULLS LAST
                   LIMIT 10"""
            )
        )
    ).fetchall()

    return {
        "window_days": 30,
        "by_status": {r[0]: r[1] for r in by_status},
        "recent_dead": [
            {
                "outbox_id": r[0],
                "to": list(r[1]) if r[1] else [],
                "subject": r[2],
                "last_error": (r[3] or "")[:200],
                "last_attempt_at": r[4].isoformat() if r[4] else None,
            }
            for r in recent_dead
        ],
    }
