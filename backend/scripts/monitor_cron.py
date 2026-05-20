"""Round 126 — Monitor cron · health checks cada 10 min.

Diseño:
  - Pega a /health para latencia + status del backend
  - Lee métricas de pool DB
  - Cuenta vouchers stuck (DRAFT >7d, PENDING >5d)
  - Cuenta sii_documentos no conciliados >30d
  - Insert una fila en core.system_health_checks
  - Si detecta anomalías, abre incident en core.system_incidents

Setup en Fly:
    [processes]
        monitor_cron = "python -m scripts.monitor_cron"

    fly machine update <id> --schedule "*/10 * * * *"

El script tiene timeout duro de 60s. Si demora más, exit 1 y la machine
intenta de nuevo en el próximo tick. No bloquea otros crons (machine
dedicada).

NO toca código, NO emite vouchers, NO sincroniza nada.
Solo OBSERVA y registra.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import text

from app.core.database import SessionLocal


HEALTH_URL = "https://cehta-backend.fly.dev/health"
PERF_URL = "https://cehta-backend.fly.dev/api/v1/health/perf"


# Umbrales para abrir incidente
ANOMALY_THRESHOLDS = {
    "backend_response_ms_critical": 5000,
    "backend_response_ms_warning": 2000,
    "errors_5xx_critical": 5,        # 5+ errores en 10 min
    "errors_5xx_warning": 1,
    "emaxconn_warning": 1,            # cualquier EMAXCONNSESSION es problema
    "drafts_over_7d_warning": 10,
    "pendings_over_5d_warning": 5,
    "sii_unmatched_30d_warning": 50,
    "backup_age_hours_warning": 36,
    "backup_age_hours_critical": 72,
}


async def check_backend_health() -> dict[str, Any]:
    """Pega a /health y mide latencia."""
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            resp = await cli.get(HEALTH_URL)
            elapsed_ms = int((time.monotonic() - started) * 1000)
            if resp.status_code == 200:
                return {"status": "alive", "response_ms": elapsed_ms}
            return {
                "status": "degraded",
                "response_ms": elapsed_ms,
                "http_status": resp.status_code,
            }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "down",
            "response_ms": int((time.monotonic() - started) * 1000),
            "error": str(exc)[:200],
        }


async def collect_metrics(db: Any) -> dict[str, Any]:
    """Lee métricas de la DB en una sola query batch."""
    metrics: dict[str, Any] = {}

    # Vouchers stuck
    row = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) FILTER (
                        WHERE status = 'DRAFT'
                          AND created_at < NOW() - INTERVAL '7 days'
                    ) AS drafts_over_7d,
                    COUNT(*) FILTER (
                        WHERE status = 'PENDING'
                          AND created_at < NOW() - INTERVAL '5 days'
                    ) AS pendings_over_5d
                FROM core.vouchers
                """
            )
        )
    ).fetchone()
    metrics["drafts_over_7d"] = int(row[0] or 0)
    metrics["pendings_over_5d"] = int(row[1] or 0)

    # SII docs sin voucher >30d (solo si tabla existe)
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT COUNT(*) FROM core.sii_documentos
                    WHERE voucher_id IS NULL
                      AND created_at < NOW() - INTERVAL '30 days'
                    """
                )
            )
        ).fetchone()
        metrics["sii_docs_unmatched_30d"] = int(row[0] or 0)
    except Exception:
        metrics["sii_docs_unmatched_30d"] = 0  # tabla no existe aún

    # Último backup
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT MAX(uploaded_at)
                    FROM core.system_backups
                    WHERE status = 'OK'
                    """
                )
            )
        ).fetchone()
        if row and row[0]:
            last = row[0]
            metrics["last_backup_at"] = last
            metrics["last_backup_age_hours"] = int(
                (datetime.now(timezone.utc) - last).total_seconds() // 3600
            )
        else:
            metrics["last_backup_at"] = None
            metrics["last_backup_age_hours"] = None
    except Exception:
        metrics["last_backup_at"] = None
        metrics["last_backup_age_hours"] = None

    return metrics


def detect_anomalies(
    health: dict[str, Any], metrics: dict[str, Any]
) -> list[dict[str, Any]]:
    """Compara métricas contra umbrales. Devuelve list de anomalías."""
    anomalies: list[dict[str, Any]] = []

    # Backend salud
    if health.get("status") == "down":
        anomalies.append({
            "severity": "CRITICAL",
            "category": "backend_down",
            "title": "Backend no responde a /health",
            "metric": "backend_status", "value": "down",
        })
    elif health.get("status") == "degraded":
        anomalies.append({
            "severity": "WARNING",
            "category": "backend_degraded",
            "title": f"Backend responde con status {health.get('http_status')}",
            "metric": "http_status", "value": health.get("http_status"),
        })

    # Latencia alta
    rt = health.get("response_ms", 0)
    if rt > ANOMALY_THRESHOLDS["backend_response_ms_critical"]:
        anomalies.append({
            "severity": "CRITICAL",
            "category": "backend_slow",
            "title": f"Backend lento: {rt}ms (umbral crítico 5000ms)",
            "metric": "backend_response_ms", "value": rt,
        })
    elif rt > ANOMALY_THRESHOLDS["backend_response_ms_warning"]:
        anomalies.append({
            "severity": "WARNING",
            "category": "backend_slow",
            "title": f"Backend lento: {rt}ms",
            "metric": "backend_response_ms", "value": rt,
        })

    # Vouchers stuck
    if metrics["drafts_over_7d"] > ANOMALY_THRESHOLDS["drafts_over_7d_warning"]:
        anomalies.append({
            "severity": "WARNING",
            "category": "vouchers_stuck",
            "title": f"{metrics['drafts_over_7d']} drafts >7 días",
            "metric": "drafts_over_7d", "value": metrics["drafts_over_7d"],
        })
    if metrics["pendings_over_5d"] > ANOMALY_THRESHOLDS["pendings_over_5d_warning"]:
        anomalies.append({
            "severity": "WARNING",
            "category": "vouchers_stuck",
            "title": f"{metrics['pendings_over_5d']} pendings >5 días esperando firma",
            "metric": "pendings_over_5d", "value": metrics["pendings_over_5d"],
        })

    # Gaps SII
    if metrics["sii_docs_unmatched_30d"] > ANOMALY_THRESHOLDS["sii_unmatched_30d_warning"]:
        anomalies.append({
            "severity": "WARNING",
            "category": "sii_gap",
            "title": (
                f"{metrics['sii_docs_unmatched_30d']} documentos SII "
                "sin voucher local >30 días"
            ),
            "metric": "sii_docs_unmatched_30d",
            "value": metrics["sii_docs_unmatched_30d"],
        })

    # Backups
    age = metrics.get("last_backup_age_hours")
    if age is not None:
        if age > ANOMALY_THRESHOLDS["backup_age_hours_critical"]:
            anomalies.append({
                "severity": "CRITICAL",
                "category": "backup_stale",
                "title": f"Último backup tiene {age}h (umbral crítico 72h)",
                "metric": "last_backup_age_hours", "value": age,
            })
        elif age > ANOMALY_THRESHOLDS["backup_age_hours_warning"]:
            anomalies.append({
                "severity": "WARNING",
                "category": "backup_stale",
                "title": f"Último backup tiene {age}h",
                "metric": "last_backup_age_hours", "value": age,
            })

    return anomalies


async def persist_check(
    db: Any,
    health: dict[str, Any],
    metrics: dict[str, Any],
    anomalies: list[dict[str, Any]],
) -> int:
    """Insert health check + abre incidentes si hay anomalías. Devuelve check_id."""
    row = (
        await db.execute(
            text(
                """
                INSERT INTO core.system_health_checks (
                    backend_status, backend_response_ms,
                    drafts_over_7d, pendings_over_5d,
                    sii_docs_unmatched_30d,
                    last_backup_at, last_backup_age_hours,
                    anomalies_detected
                ) VALUES (
                    :st, :rt, :d7, :p5, :sii,
                    :bk_at, :bk_age,
                    CAST(:anom AS jsonb)
                )
                RETURNING check_id
                """
            ),
            {
                "st": health.get("status", "unknown"),
                "rt": health.get("response_ms"),
                "d7": metrics["drafts_over_7d"],
                "p5": metrics["pendings_over_5d"],
                "sii": metrics["sii_docs_unmatched_30d"],
                "bk_at": metrics.get("last_backup_at"),
                "bk_age": metrics.get("last_backup_age_hours"),
                "anom": json.dumps(anomalies, default=str) if anomalies else None,
            },
        )
    ).fetchone()
    check_id = row[0]

    # Abrir incidentes solo si NO hay uno OPEN del mismo category en últimos 30 min
    for anomaly in anomalies:
        # Verificar si ya hay incidente abierto reciente
        existing = (
            await db.execute(
                text(
                    """
                    SELECT incident_id FROM core.system_incidents
                    WHERE category = :cat
                      AND status != 'RESOLVED'
                      AND detected_at > NOW() - INTERVAL '30 minutes'
                    LIMIT 1
                    """
                ),
                {"cat": anomaly["category"]},
            )
        ).fetchone()
        if existing:
            continue  # ya hay uno abierto, no duplicar
        await db.execute(
            text(
                """
                INSERT INTO core.system_incidents (
                    severity, category, title, metrics, health_check_id
                ) VALUES (:sev, :cat, :title, CAST(:m AS jsonb), :cid)
                """
            ),
            {
                "sev": anomaly["severity"],
                "cat": anomaly["category"],
                "title": anomaly["title"][:300],
                "m": json.dumps(anomaly, default=str),
                "cid": check_id,
            },
        )
    await db.commit()
    return check_id


async def _migration_applied(db: Any) -> bool:
    """Verifica si la migración Round 126 ya fue aplicada."""
    row = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.tables
                               WHERE table_schema = 'core'
                                 AND table_name = 'system_health_checks')
                """
            )
        )
    ).fetchone()
    return bool(row[0])


async def main() -> int:
    started = datetime.now(timezone.utc)
    try:
        # 1. Pegar a /health en paralelo con queries DB
        health_task = asyncio.create_task(check_backend_health())

        async with SessionLocal() as db:
            # Defensive: si la migración Round 126 no está aplicada, exit
            # cleanly con mensaje. Evita loops de reinicio en Fly.
            if not await _migration_applied(db):
                print(json.dumps({
                    "ok": False,
                    "skipped": True,
                    "reason": (
                        "Migración Round 126 no aplicada. "
                        "Aplicar scripts/sql/round126_monitor_migration.sql "
                        "en Supabase Studio."
                    ),
                }))
                # Cancelar la task de health para no dejarla huérfana
                health_task.cancel()
                return 0

            metrics = await collect_metrics(db)
            health = await health_task
            anomalies = detect_anomalies(health, metrics)
            check_id = await persist_check(db, health, metrics, anomalies)

        elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        result = {
            "ok": True,
            "check_id": check_id,
            "elapsed_ms": elapsed_ms,
            "backend_status": health.get("status"),
            "backend_response_ms": health.get("response_ms"),
            "anomalies_count": len(anomalies),
            "anomaly_categories": [a["category"] for a in anomalies],
            "metrics": metrics,
        }
        print(json.dumps(result, default=str))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({
            "ok": False, "error": str(exc)[:500],
            "elapsed_ms": int(
                (datetime.now(timezone.utc) - started).total_seconds() * 1000
            ),
        }), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
