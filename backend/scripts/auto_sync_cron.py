"""Round 126 — Auto-sync cron · trae data externa SII + Nubox diariamente.

Diseño:
  Para cada empresa con credencial válida:
    1. SII RCV: si última validación OK → sync RCV mes anterior
    2. Nubox API REST: si última validación OK → sync ventas mes anterior
    3. Tras ambos: ejecutar conciliación SII↔vouchers
  Registra run completo en core.auto_sync_runs.

SCOPE:
  - Solo TRAE data (lee del SII/Nubox e inserta filas en sii_documentos /
    nubox_ventas)
  - NO emite documentos
  - NO crea vouchers (eso queda manual con el operador)
  - NO modifica vouchers existentes
  - Sí actualiza voucher_id de sii_documentos vía conciliación
    (eso es lectura/match, no creación)

Setup Fly:
    [processes]
        auto_sync_cron = "python -m scripts.auto_sync_cron"

    fly machine update <id> --schedule "0 6 * * *"   # 06:00 GMT (03:00 CL)

Idempotente: los UPSERT por nubox_document_id / (empresa+folio+tipo+rut)
hacen que correr 2x no duplique. Reintentos seguros.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from app.core.database import SessionLocal
from app.services.credentials_service import (
    CredentialDecryptError,
    decrypt_credential,
)

# R152HHHHHH — Throttle entre empresas para no gatillar el rate-limit del
# SII ("consultas recurrentes" → ban de IP 24h+). El portal es muy sensible
# a ráfagas. Default conservador: 8s entre empresas. Configurable por env.
try:
    _INTER_EMPRESA_DELAY = float(os.environ.get("SII_SYNC_INTER_EMPRESA_DELAY", "8"))
except (TypeError, ValueError):
    _INTER_EMPRESA_DELAY = 8.0

# Marcadores que indican que el SII nos está rate-limiteando. Si aparecen,
# ABORTAMOS el resto del run — seguir pegándole solo profundiza el ban.
_RATE_LIMIT_MARKERS = ("consultas recurrentes", "rate-limit", "rate limit", "429")


def _periodo_mes_anterior() -> str:
    """Devuelve YYYY-MM del mes anterior al actual."""
    today = datetime.now(timezone.utc).date()
    # Primer día del mes actual menos 1 → último día del mes anterior
    first_of_month = today.replace(day=1)
    prev_month_last = first_of_month - timedelta(days=1)
    return f"{prev_month_last.year:04d}-{prev_month_last.month:02d}"


async def empresas_con_sii_ok(db: Any) -> list[dict[str, str]]:
    """Lista empresas con credencial SII validada exitosamente."""
    rows = (
        await db.execute(
            text(
                """
                SELECT empresa_codigo, rut_usuario, password_encrypted
                FROM core.empresa_credenciales
                WHERE sistema = 'sii'
                  AND COALESCE(ultima_validacion_ok, FALSE) = TRUE
                """
            )
        )
    ).fetchall()
    return [
        {"empresa_codigo": r[0], "rut": r[1], "pwd_enc": r[2]}
        for r in rows
    ]


async def empresas_con_nubox_api_ok(db: Any) -> list[dict[str, str]]:
    """Lista empresas con credencial Nubox API validada."""
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT empresa_codigo, partner_token_encrypted,
                           company_api_key_encrypted, base_url, environment
                    FROM core.nubox_api_credenciales
                    WHERE COALESCE(ultima_validacion_ok, FALSE) = TRUE
                    """
                )
            )
        ).fetchall()
        return [
            {
                "empresa_codigo": r[0],
                "partner_enc": r[1],
                "api_key_enc": r[2],
                "base_url": r[3],
                "environment": r[4],
            }
            for r in rows
        ]
    except Exception:
        return []  # tabla no existe aún


async def sync_sii_empresa(
    db: Any, empresa: dict[str, str], periodo: str,
) -> dict[str, Any]:
    """Intenta sync RCV de 1 empresa. Retorna dict con resultado."""
    from app.services.sii_client import (
        SiiAuthError, SiiClient, SiiClientError,
    )

    empresa_codigo = empresa["empresa_codigo"]
    try:
        clave = decrypt_credential(empresa["pwd_enc"])
    except CredentialDecryptError as exc:
        return {
            "ok": False, "empresa": empresa_codigo,
            "error": f"decrypt: {exc}", "documents": 0,
        }

    # Crear run en sii_sync_runs (esto deja audit trail compartido)
    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.sii_sync_runs
                    (empresa_codigo, tipo, periodo, status, notas)
                VALUES (:c, 'rcv_compras', :p, 'STARTED', 'auto_sync_cron')
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "p": periodo},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    total = 0
    error_msg: str | None = None
    try:
        cli = await SiiClient.login(empresa["rut"], clave, timeout=60.0)
        try:
            compras = await cli.descargar_rcv_compras(periodo)
            ventas = await cli.descargar_rcv_ventas(periodo)
        finally:
            await cli.close()
        # Persistir docs vía UPSERT (idempotente)
        for docs in (compras, ventas):
            for d in docs:
                await db.execute(
                    text(
                        """
                        INSERT INTO core.sii_documentos (
                            empresa_codigo, flujo, tipo_dte, folio, periodo,
                            rut_contraparte, razon_social_contraparte,
                            fecha_emision, monto_neto, monto_iva, monto_total,
                            estado_sii, run_id, raw_data
                        ) VALUES (
                            :c, :f, :t, :folio, :p,
                            :rut, :rsoc, :fem, :neto, :iva, :tot,
                            :est, :rid, CAST(:raw AS jsonb)
                        )
                        ON CONFLICT (empresa_codigo, flujo, tipo_dte, folio, rut_contraparte)
                        DO UPDATE SET
                            monto_total = EXCLUDED.monto_total,
                            monto_iva = EXCLUDED.monto_iva,
                            monto_neto = EXCLUDED.monto_neto,
                            estado_sii = EXCLUDED.estado_sii,
                            run_id = EXCLUDED.run_id,
                            updated_at = NOW()
                        """
                    ),
                    {
                        "c": empresa_codigo, "f": d.flujo, "t": d.tipo_dte,
                        "folio": d.folio, "p": d.periodo,
                        "rut": d.rut_contraparte,
                        "rsoc": d.razon_social_contraparte,
                        "fem": d.fecha_emision, "neto": d.monto_neto,
                        "iva": d.monto_iva, "tot": d.monto_total,
                        "est": d.estado_sii, "rid": run_id,
                        "raw": json.dumps(d.raw, default=str),
                    },
                )
        total = len(compras) + len(ventas)
    except SiiAuthError as exc:
        error_msg = f"auth: {exc}"
    except SiiClientError as exc:
        error_msg = f"client: {exc}"
    except Exception as exc:  # noqa: BLE001
        error_msg = f"unexpected: {exc}"[:300]

    await db.execute(
        text(
            """
            UPDATE core.sii_sync_runs
            SET status = :s, documentos_count = :n,
                finished_at = NOW(), error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": "OK" if error_msg is None else "FAILED",
            "n": total, "err": error_msg, "id": run_id,
        },
    )
    await db.commit()
    return {
        "ok": error_msg is None,
        "empresa": empresa_codigo,
        "documents": total,
        "error": error_msg,
    }


async def conciliar_empresa(db: Any, empresa_codigo: str, periodo: str) -> dict[str, Any]:
    """Ejecuta conciliación SII ↔ vouchers post-sync."""
    from app.services.sii_conciliacion import conciliar_empresa as do_conciliar
    try:
        result = await do_conciliar(db, empresa_codigo, periodo=periodo)
        return {
            "ok": True,
            "empresa": empresa_codigo,
            "exact": result.matched_exact,
            "fuzzy": result.matched_fuzzy,
            "unmatched": result.unmatched,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False, "empresa": empresa_codigo,
            "error": str(exc)[:200],
        }


async def _migration_applied(db: Any) -> bool:
    """Verifica si la migración Round 126 está aplicada."""
    row = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.tables
                               WHERE table_schema = 'core'
                                 AND table_name = 'auto_sync_runs')
                """
            )
        )
    ).fetchone()
    return bool(row[0])


async def main() -> int:
    started = datetime.now(timezone.utc)
    periodo = _periodo_mes_anterior()

    async with SessionLocal() as db:
        # Defensive: si la migración Round 126 no está aplicada, salir
        # limpiamente sin reventar. Evita loops de reinicio en Fly.
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
            return 0

        # Crear master run
        run_row = (
            await db.execute(
                text(
                    """
                    INSERT INTO core.auto_sync_runs (status) VALUES ('STARTED')
                    RETURNING run_id
                    """
                )
            )
        ).fetchone()
        master_run_id = run_row[0]
        await db.commit()

        sii_empresas = await empresas_con_sii_ok(db)
        nubox_empresas = await empresas_con_nubox_api_ok(db)

        empresa_results: list[dict[str, Any]] = []
        sii_ok = 0
        sii_failed = 0
        nubox_ok = 0
        nubox_failed = 0
        conciliations_run = 0

        # SII sync por empresa — con throttle anti-ban + abort en rate-limit.
        rate_limited = False
        for idx, empresa in enumerate(sii_empresas):
            r = await sync_sii_empresa(db, empresa, periodo)
            empresa_results.append({"system": "sii", **r})
            if r["ok"]:
                sii_ok += 1
                # Conciliar post-sync
                c = await conciliar_empresa(db, empresa["empresa_codigo"], periodo)
                empresa_results.append({"system": "conciliacion", **c})
                if c["ok"]:
                    conciliations_run += 1
            else:
                sii_failed += 1
                # R152HHHHHH — Si el SII nos rate-limiteó, cortar el run.
                # Seguir con las empresas restantes solo profundiza el ban.
                err_low = str(r.get("error") or "").lower()
                if any(m in err_low for m in _RATE_LIMIT_MARKERS):
                    rate_limited = True
                    empresa_results.append({
                        "system": "sii",
                        "aborted": True,
                        "reason": "SII rate-limit detectado — run abortado para evitar ban de IP",
                        "remaining_empresas": len(sii_empresas) - idx - 1,
                    })
                    break

            # Throttle entre empresas (no después de la última).
            if idx < len(sii_empresas) - 1:
                await asyncio.sleep(_INTER_EMPRESA_DELAY)

        # Nubox API sync (placeholder — futuro round agrega cliente real)
        # Por ahora solo registramos las empresas que ya están configuradas
        for empresa in nubox_empresas:
            empresa_results.append({
                "system": "nubox_api",
                "empresa": empresa["empresa_codigo"],
                "skipped": "auto-sync via Nubox API se agrega en Round 127",
            })

        # Update master run
        final_status = "OK"
        if sii_failed > 0 or nubox_failed > 0:
            final_status = "PARTIAL"
        if sii_ok == 0 and nubox_ok == 0 and (len(sii_empresas) + len(nubox_empresas)) > 0:
            final_status = "FAILED"
        if rate_limited:
            # Estado explícito: el operador debe esperar antes de reintentar.
            final_status = "RATE_LIMITED"

        await db.execute(
            text(
                """
                UPDATE core.auto_sync_runs
                SET finished_at = NOW(),
                    status = :s,
                    empresas_processed = :ep,
                    sii_sync_ok = :sok, sii_sync_failed = :sfail,
                    nubox_sync_ok = :nok, nubox_sync_failed = :nfail,
                    conciliations_run = :cr,
                    empresa_results = CAST(:res AS jsonb)
                WHERE run_id = :id
                """
            ),
            {
                "s": final_status,
                "ep": len(sii_empresas) + len(nubox_empresas),
                "sok": sii_ok, "sfail": sii_failed,
                "nok": nubox_ok, "nfail": nubox_failed,
                "cr": conciliations_run,
                "res": json.dumps(empresa_results, default=str),
                "id": master_run_id,
            },
        )
        await db.commit()

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(json.dumps({
        "ok": True,
        "master_run_id": master_run_id,
        "periodo": periodo,
        "elapsed_seconds": elapsed,
        "sii_empresas": len(sii_empresas),
        "sii_ok": sii_ok, "sii_failed": sii_failed,
        "nubox_empresas": len(nubox_empresas),
        "conciliations_run": conciliations_run,
        "rate_limited": rate_limited,
        "final_status": final_status,
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
