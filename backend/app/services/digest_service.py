"""Digest Service — CEO Weekly Digest (V3 fase 10).

Construye el payload semanal del CEO y lo manda por email vía Resend.

**Diseño**:

- Cada bloque del digest se calcula con su propia query try/except — si
  una vista no existe (schema drift) o una tabla está vacía, el bloque
  vuelve con valores cero y el resto del payload sigue construyéndose.
  Misma filosofía que `/dashboard/ceo-consolidated`.

- El render HTML es **inline-styled** (no `<link>`, no `<style>` block,
  no fonts externas). Esto es necesario para compatibilidad universal
  de mailboxes (Gmail, Outlook, Apple Mail, etc.).

- Soft-fail con email: si `RESEND_API_KEY` no está seteada,
  `send_to_ceo()` devuelve `{"sent": 0, "failed": [...]}` sin romper.
  El endpoint `/send-now` además devuelve 503.

- Cron: NO arrancamos cron desde startup de FastAPI (mala separación de
  concerns). El endpoint `POST /digest/ceo-weekly/send-now` lo dispara
  un Vercel cron / GitHub Action externo cada lunes 8am.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from html import escape
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.schemas.digest import (
    CEODigestPayload,
    DigestAlert,
    DigestSendResult,
    EmpresaDigestRow,
    EntregableDigestRow,
    EntregablesDigestPayload,
    MovimientoDigestRow,
)
from app.services.email_service import EmailService

log = structlog.get_logger(__name__)

ZERO = Decimal("0")

# Threshold para movimientos "significativos" en el digest (CLP).
MOVIMIENTO_SIGNIFICATIVO_THRESHOLD = Decimal("5000000")

# Severity rank para ordenar alertas (critical primero).
_SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}

# Apple-ish palette inline (para el HTML del email).
_C_INK_900 = "#1f2937"
_C_INK_700 = "#374151"
_C_INK_500 = "#6b7280"
_C_INK_300 = "#9ca3af"
_C_INK_100 = "#f3f4f6"
_C_GREEN = "#10b981"
_C_WARNING = "#f59e0b"
_C_NEGATIVE = "#ef4444"
_C_BG = "#f7f7f8"


def _fmt_clp(value: Decimal | int | float | None) -> str:
    """Formato CLP corto: $1.234.567 (sin decimales)."""
    if value is None:
        return "$0"
    n = int(round(float(value)))
    sign = "-" if n < 0 else ""
    parts = f"{abs(n):,}".replace(",", ".")
    return f"{sign}${parts}"


def _color_for_severity(sev: str) -> str:
    return {
        "critical": _C_NEGATIVE,
        "warning": _C_WARNING,
        "info": _C_GREEN,
    }.get(sev, _C_INK_500)


def _color_for_health(score: int) -> str:
    if score >= 80:
        return _C_GREEN
    if score >= 60:
        return _C_WARNING
    return _C_NEGATIVE


def sort_alerts(alerts: list[DigestAlert]) -> list[DigestAlert]:
    """Ordena alertas: critical → warning → info, preservando orden interno."""
    return sorted(
        alerts, key=lambda a: _SEVERITY_RANK.get(a.severity, 9)
    )


class DigestService:
    """Construye y envía el digest semanal CEO."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._email = EmailService()

    # ------------------------------------------------------------------
    # Aggregation
    # ------------------------------------------------------------------

    async def build_ceo_weekly_digest(self) -> CEODigestPayload:
        """Construye el payload completo del digest para la semana actual."""
        # Import lazy para evitar circular import (dashboard router también
        # importa schemas/services que terminan importando este módulo).
        from app.api.v1.dashboard import compute_health_score

        now = datetime.now(tz=UTC)
        period_to = now.date()
        period_from = period_to - timedelta(days=7)
        period_from_prev = period_from - timedelta(days=7)

        empresas_rows = await self._fetch_empresas_kpis(period_from)
        empresas_prev_health = await self._fetch_empresas_health_prev(period_from_prev)

        empresas: list[EmpresaDigestRow] = []
        total_saldo = ZERO
        total_flujo_7d = ZERO
        total_oc_pendientes = 0
        total_f29_vencidas = 0

        for r in empresas_rows:
            saldo = Decimal(r["saldo_actual"] or 0)
            flujo_7d = Decimal(r["flujo_7d"] or 0)
            oc_pend = int(r["oc_pendientes"] or 0)
            f29_venc = int(r["f29_vencidas"] or 0)
            f29_prox = int(r["f29_proximas_week"] or 0)

            score = compute_health_score(
                saldo_contable=saldo,
                flujo_neto_30d=flujo_7d,  # usamos flujo 7d como proxy
                f29_vencidas=f29_venc,
                f29_proximas=f29_prox,
                oc_pendientes=oc_pend,
            )
            prev_score = empresas_prev_health.get(r["codigo"], score)
            delta_health = score - prev_score

            empresas.append(
                EmpresaDigestRow(
                    codigo=r["codigo"],
                    razon_social=r["razon_social"],
                    health_score=score,
                    saldo_actual=saldo,
                    flujo_7d=flujo_7d,
                    oc_pendientes=oc_pend,
                    f29_vencidas=f29_venc,
                    delta_health=delta_health,
                )
            )

            total_saldo += saldo
            total_flujo_7d += flujo_7d
            total_oc_pendientes += oc_pend
            total_f29_vencidas += f29_venc

        # Alerts: F29 vencidas/próximas, contratos due, OCs estancadas
        alerts = await self._build_alerts(period_to)

        # Movimientos significativos últimos 7 días
        movs = await self._fetch_movimientos_significativos(period_from, period_to)

        # Comparison vs prev week
        vs_prev = await self._fetch_vs_prev_week(period_from, period_to)

        top_kpis: dict[str, float | int | str] = {
            "total_saldo": float(total_saldo),
            "total_flujo_7d": float(total_flujo_7d),
            "total_oc_pendientes": total_oc_pendientes,
            "total_f29_vencidas": total_f29_vencidas,
            "n_empresas": len(empresas),
        }

        return CEODigestPayload(
            generated_at=now,
            period_from=period_from,
            period_to=period_to,
            top_kpis=top_kpis,
            empresas=empresas,
            alerts=sort_alerts(alerts),
            movimientos_significativos=movs,
            vs_prev_week=vs_prev,
        )

    async def _fetch_empresas_kpis(self, period_from: date) -> list[dict[str, Any]]:
        """KPIs por empresa para el digest. Try/except por bloque."""
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        WITH saldo AS (
                            SELECT DISTINCT ON (empresa_codigo)
                                empresa_codigo,
                                COALESCE(saldo_contable, 0) AS saldo_actual
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND saldo_contable IS NOT NULL
                            ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                        ),
                        flujo AS (
                            SELECT empresa_codigo,
                                   COALESCE(SUM(abono), 0) - COALESCE(SUM(egreso), 0) AS flujo_7d
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND fecha >= :period_from
                            GROUP BY empresa_codigo
                        ),
                        oc AS (
                            SELECT empresa_codigo,
                                   COUNT(*) FILTER (WHERE estado = 'emitida') AS oc_pendientes
                            FROM core.ordenes_compra
                            GROUP BY empresa_codigo
                        ),
                        f29 AS (
                            SELECT empresa_codigo,
                                   COUNT(*) FILTER (
                                       WHERE estado = 'pendiente'
                                       AND fecha_vencimiento < CURRENT_DATE
                                   ) AS f29_vencidas,
                                   COUNT(*) FILTER (
                                       WHERE estado = 'pendiente'
                                       AND fecha_vencimiento >= CURRENT_DATE
                                       AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days'
                                   ) AS f29_proximas_week
                            FROM core.f29_obligaciones
                            GROUP BY empresa_codigo
                        )
                        SELECT
                            e.codigo,
                            e.razon_social,
                            COALESCE(s.saldo_actual, 0) AS saldo_actual,
                            COALESCE(f.flujo_7d, 0)     AS flujo_7d,
                            COALESCE(o.oc_pendientes, 0) AS oc_pendientes,
                            COALESCE(t.f29_vencidas, 0)  AS f29_vencidas,
                            COALESCE(t.f29_proximas_week, 0) AS f29_proximas_week
                        FROM core.empresas e
                        LEFT JOIN saldo s ON s.empresa_codigo = e.codigo
                        LEFT JOIN flujo f ON f.empresa_codigo = e.codigo
                        LEFT JOIN oc o    ON o.empresa_codigo = e.codigo
                        LEFT JOIN f29 t   ON t.empresa_codigo = e.codigo
                        WHERE e.activo = true
                        ORDER BY e.codigo
                        """
                    ),
                    {"period_from": period_from},
                )
            ).mappings().all()
            return [dict(r) for r in rows]
        except Exception as exc:
            log.warning("digest.empresas_kpis_failed", error=str(exc))
            return []

    async def _fetch_empresas_health_prev(
        self, period_from_prev: date
    ) -> dict[str, int]:
        """Health score aproximado de la semana previa para `delta_health`.

        Para no replicar toda la query, calculamos sobre snapshot equivalente
        7 días atrás. Si falla, devolvemos {} (delta=0 implícito).
        """
        from app.api.v1.dashboard import compute_health_score

        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        WITH saldo AS (
                            SELECT DISTINCT ON (empresa_codigo)
                                empresa_codigo,
                                COALESCE(saldo_contable, 0) AS saldo_prev
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND saldo_contable IS NOT NULL
                              AND fecha <= :period_from_prev + INTERVAL '7 days'
                            ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                        ),
                        flujo AS (
                            SELECT empresa_codigo,
                                   COALESCE(SUM(abono), 0) - COALESCE(SUM(egreso), 0) AS flujo_prev
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND fecha BETWEEN :period_from_prev
                                            AND :period_from_prev + INTERVAL '7 days'
                            GROUP BY empresa_codigo
                        )
                        SELECT
                            e.codigo,
                            COALESCE(s.saldo_prev, 0) AS saldo_prev,
                            COALESCE(f.flujo_prev, 0) AS flujo_prev
                        FROM core.empresas e
                        LEFT JOIN saldo s ON s.empresa_codigo = e.codigo
                        LEFT JOIN flujo f ON f.empresa_codigo = e.codigo
                        WHERE e.activo = true
                        """
                    ),
                    {"period_from_prev": period_from_prev},
                )
            ).mappings().all()
            out: dict[str, int] = {}
            for r in rows:
                # Aproximación simplificada: usamos solo saldo+flujo, sin F29.
                out[r["codigo"]] = compute_health_score(
                    saldo_contable=Decimal(r["saldo_prev"] or 0),
                    flujo_neto_30d=Decimal(r["flujo_prev"] or 0),
                    f29_vencidas=0,
                    f29_proximas=0,
                    oc_pendientes=0,
                )
            return out
        except Exception as exc:
            log.warning("digest.empresas_health_prev_failed", error=str(exc))
            return {}

    async def _build_alerts(self, today: date) -> list[DigestAlert]:
        """Top alerts del digest: F29 vencidas, F29 próximas, contratos, OCs."""
        alerts: list[DigestAlert] = []

        # F29 vencidas — critical
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT empresa_codigo, periodo_tributario, fecha_vencimiento
                        FROM core.f29_obligaciones
                        WHERE estado = 'pendiente'
                          AND fecha_vencimiento < :today
                        ORDER BY fecha_vencimiento
                        LIMIT 10
                        """
                    ),
                    {"today": today},
                )
            ).mappings().all()
            for r in rows:
                alerts.append(
                    DigestAlert(
                        tipo="f29_vencida",
                        severity="critical",
                        title=(
                            f"F29 vencida — {r['empresa_codigo']} "
                            f"({r['periodo_tributario']})"
                        ),
                        body=(
                            f"La F29 de {r['empresa_codigo']} (periodo "
                            f"{r['periodo_tributario']}) venció el "
                            f"{r['fecha_vencimiento'].isoformat()} y sigue pendiente."
                        ),
                        link="/f29",
                    )
                )
        except Exception as exc:
            log.warning("digest.alerts_f29_vencidas_failed", error=str(exc))

        # F29 que vencen esta semana — warning
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT empresa_codigo, periodo_tributario, fecha_vencimiento
                        FROM core.f29_obligaciones
                        WHERE estado = 'pendiente'
                          AND fecha_vencimiento BETWEEN :today AND :today + INTERVAL '7 days'
                        ORDER BY fecha_vencimiento
                        LIMIT 10
                        """
                    ),
                    {"today": today},
                )
            ).mappings().all()
            for r in rows:
                dias = (r["fecha_vencimiento"] - today).days
                alerts.append(
                    DigestAlert(
                        tipo="f29_due_week",
                        severity="warning",
                        title=(
                            f"F29 vence en {dias}d — {r['empresa_codigo']}"
                        ),
                        body=(
                            f"F29 {r['periodo_tributario']} vence el "
                            f"{r['fecha_vencimiento'].isoformat()}."
                        ),
                        link="/f29",
                    )
                )
        except Exception as exc:
            log.warning("digest.alerts_f29_due_failed", error=str(exc))

        # Contratos por vencer ≤14 días — warning
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT empresa_codigo, nombre, fecha_vigencia_hasta
                        FROM core.legal_documents
                        WHERE fecha_vigencia_hasta BETWEEN :today
                                                       AND :today + INTERVAL '14 days'
                        ORDER BY fecha_vigencia_hasta
                        LIMIT 10
                        """
                    ),
                    {"today": today},
                )
            ).mappings().all()
            for r in rows:
                dias = (r["fecha_vigencia_hasta"] - today).days
                alerts.append(
                    DigestAlert(
                        tipo="contrato_due",
                        severity="warning" if dias > 7 else "critical",
                        title=(
                            f"Contrato vence en {dias}d — {r['empresa_codigo']}"
                        ),
                        body=(
                            f"Contrato '{r['nombre']}' de {r['empresa_codigo']} "
                            f"vence el {r['fecha_vigencia_hasta'].isoformat()}."
                        ),
                        link=f"/empresa/{r['empresa_codigo']}/legal",
                    )
                )
        except Exception as exc:
            log.warning("digest.alerts_contratos_failed", error=str(exc))

        # OCs estancadas >14 días — warning
        try:
            threshold = today - timedelta(days=14)
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT numero_oc, empresa_codigo, fecha_emision, total
                        FROM core.ordenes_compra
                        WHERE estado = 'emitida'
                          AND fecha_emision <= :threshold
                        ORDER BY fecha_emision
                        LIMIT 10
                        """
                    ),
                    {"threshold": threshold},
                )
            ).mappings().all()
            for r in rows:
                dias = (today - r["fecha_emision"]).days
                alerts.append(
                    DigestAlert(
                        tipo="oc_estancada",
                        severity="warning" if dias < 30 else "critical",
                        title=(
                            f"OC estancada {dias}d — {r['empresa_codigo']} "
                            f"({r['numero_oc']})"
                        ),
                        body=(
                            f"OC {r['numero_oc']} por "
                            f"{_fmt_clp(r['total'])} sigue sin pagarse."
                        ),
                        link="/ordenes-compra",
                    )
                )
        except Exception as exc:
            log.warning("digest.alerts_oc_failed", error=str(exc))

        return alerts[:5]  # top 5

    async def _fetch_movimientos_significativos(
        self, period_from: date, period_to: date
    ) -> list[MovimientoDigestRow]:
        """Movimientos >= 5M CLP en últimos 7 días."""
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT fecha, empresa_codigo,
                               COALESCE(descripcion, '(sin descripción)') AS descripcion,
                               COALESCE(abono, 0) AS abono,
                               COALESCE(egreso, 0) AS egreso
                        FROM core.movimientos
                        WHERE real_proyectado = 'Real'
                          AND fecha BETWEEN :period_from AND :period_to
                          AND (abono >= :threshold OR egreso >= :threshold)
                        ORDER BY GREATEST(COALESCE(abono, 0), COALESCE(egreso, 0)) DESC,
                                 fecha DESC
                        LIMIT 10
                        """
                    ),
                    {
                        "period_from": period_from,
                        "period_to": period_to,
                        "threshold": MOVIMIENTO_SIGNIFICATIVO_THRESHOLD,
                    },
                )
            ).mappings().all()
            out: list[MovimientoDigestRow] = []
            for r in rows:
                abono = Decimal(r["abono"] or 0)
                egreso = Decimal(r["egreso"] or 0)
                if abono >= egreso:
                    monto = abono
                    tipo = "abono"
                else:
                    monto = egreso
                    tipo = "egreso"
                out.append(
                    MovimientoDigestRow(
                        fecha=r["fecha"],
                        empresa_codigo=r["empresa_codigo"],
                        descripcion=r["descripcion"][:120],
                        monto=monto,
                        tipo=tipo,
                    )
                )
            return out
        except Exception as exc:
            log.warning("digest.movimientos_significativos_failed", error=str(exc))
            return []

    async def _fetch_vs_prev_week(
        self, period_from: date, period_to: date
    ) -> dict[str, float | int | str]:
        """Comparación semana actual vs semana previa."""
        period_from_prev = period_from - timedelta(days=7)

        out: dict[str, float | int | str] = {}

        # Flujo neto semana actual y previa
        try:
            row = (
                await self._db.execute(
                    text(
                        """
                        SELECT
                            COALESCE(SUM(abono) FILTER (WHERE fecha >= :pf), 0)
                              - COALESCE(SUM(egreso) FILTER (WHERE fecha >= :pf), 0) AS flujo_now,
                            COALESCE(SUM(abono) FILTER (WHERE fecha < :pf), 0)
                              - COALESCE(SUM(egreso) FILTER (WHERE fecha < :pf), 0) AS flujo_prev
                        FROM core.movimientos
                        WHERE real_proyectado = 'Real'
                          AND fecha BETWEEN :pf_prev AND :pt
                        """
                    ),
                    {
                        "pf": period_from,
                        "pf_prev": period_from_prev,
                        "pt": period_to,
                    },
                )
            ).fetchone()
            if row:
                flujo_now = float(row[0] or 0)
                flujo_prev = float(row[1] or 0)
                out["flujo_now"] = flujo_now
                out["flujo_prev"] = flujo_prev
                out["flujo_delta"] = flujo_now - flujo_prev
        except Exception as exc:
            log.warning("digest.vs_prev_flujo_failed", error=str(exc))

        # OCs creadas semana actual y previa
        try:
            row = (
                await self._db.execute(
                    text(
                        """
                        SELECT
                            COUNT(*) FILTER (WHERE fecha_emision >= :pf) AS oc_now,
                            COUNT(*) FILTER (WHERE fecha_emision < :pf
                                            AND fecha_emision >= :pf_prev) AS oc_prev
                        FROM core.ordenes_compra
                        WHERE fecha_emision BETWEEN :pf_prev AND :pt
                        """
                    ),
                    {
                        "pf": period_from,
                        "pf_prev": period_from_prev,
                        "pt": period_to,
                    },
                )
            ).fetchone()
            if row:
                out["oc_creadas_now"] = int(row[0] or 0)
                out["oc_creadas_prev"] = int(row[1] or 0)
                out["oc_creadas_delta"] = int(row[0] or 0) - int(row[1] or 0)
        except Exception as exc:
            log.warning("digest.vs_prev_oc_failed", error=str(exc))

        # F29 pagadas semana actual y previa
        try:
            row = (
                await self._db.execute(
                    text(
                        """
                        SELECT
                            COUNT(*) FILTER (WHERE estado = 'pagado'
                                            AND fecha_pago >= :pf) AS now,
                            COUNT(*) FILTER (WHERE estado = 'pagado'
                                            AND fecha_pago < :pf
                                            AND fecha_pago >= :pf_prev) AS prev
                        FROM core.f29_obligaciones
                        WHERE fecha_pago BETWEEN :pf_prev AND :pt
                        """
                    ),
                    {
                        "pf": period_from,
                        "pf_prev": period_from_prev,
                        "pt": period_to,
                    },
                )
            ).fetchone()
            if row:
                out["f29_pagadas_now"] = int(row[0] or 0)
                out["f29_pagadas_prev"] = int(row[1] or 0)
                out["f29_pagadas_delta"] = int(row[0] or 0) - int(row[1] or 0)
        except Exception as exc:
            log.warning("digest.vs_prev_f29_failed", error=str(exc))

        return out

    # ------------------------------------------------------------------
    # Render
    # ------------------------------------------------------------------

    def build_html(self, payload: CEODigestPayload) -> str:
        """Render HTML con estilos inline. Compatible con Gmail/Outlook/Apple Mail.

        Sin <link>, sin <style>, sin fonts externas. Roboto/Helvetica fallback.
        Width clamp 600px (mailbox-safe), Apple-ish colors.
        """
        font_stack = (
            "-apple-system,BlinkMacSystemFont,'Segoe UI',"
            "Roboto,Helvetica,Arial,sans-serif"
        )

        period_from = payload.period_from.isoformat()
        period_to = payload.period_to.isoformat()

        # Hero KPIs
        kpis = payload.top_kpis
        total_saldo = _fmt_clp(kpis.get("total_saldo", 0))
        total_flujo = _fmt_clp(kpis.get("total_flujo_7d", 0))
        total_oc = int(kpis.get("total_oc_pendientes", 0) or 0)
        total_f29 = int(kpis.get("total_f29_vencidas", 0) or 0)
        n_emp = int(kpis.get("n_empresas", 0) or 0)

        kpi_cards_html = (
            f'<table role="presentation" width="100%" cellspacing="0" '
            f'cellpadding="0" style="border-collapse:separate;border-spacing:8px 0;'
            f'margin:0 0 24px;">'
            f'<tr>'
            f'<td style="padding:14px;background:{_C_INK_100};border-radius:12px;width:50%;">'
            f'<div style="font-size:11px;color:{_C_INK_500};text-transform:uppercase;'
            f'letter-spacing:0.04em;">Saldo total</div>'
            f'<div style="margin-top:4px;font-size:20px;font-weight:600;color:{_C_INK_900};'
            f'font-feature-settings:\'tnum\';">{escape(total_saldo)}</div>'
            f'</td>'
            f'<td style="padding:14px;background:{_C_INK_100};border-radius:12px;width:50%;">'
            f'<div style="font-size:11px;color:{_C_INK_500};text-transform:uppercase;'
            f'letter-spacing:0.04em;">Flujo neto 7d</div>'
            f'<div style="margin-top:4px;font-size:20px;font-weight:600;'
            f'color:{_C_GREEN if (kpis.get("total_flujo_7d", 0) or 0) >= 0 else _C_NEGATIVE};'
            f'font-feature-settings:\'tnum\';">{escape(total_flujo)}</div>'
            f'</td>'
            f'</tr>'
            f'<tr><td colspan="2" style="height:8px;"></td></tr>'
            f'<tr>'
            f'<td style="padding:14px;background:{_C_INK_100};border-radius:12px;width:50%;">'
            f'<div style="font-size:11px;color:{_C_INK_500};text-transform:uppercase;'
            f'letter-spacing:0.04em;">OCs pendientes</div>'
            f'<div style="margin-top:4px;font-size:20px;font-weight:600;color:{_C_INK_900};'
            f'font-feature-settings:\'tnum\';">{total_oc}</div>'
            f'</td>'
            f'<td style="padding:14px;background:{_C_INK_100};border-radius:12px;width:50%;">'
            f'<div style="font-size:11px;color:{_C_INK_500};text-transform:uppercase;'
            f'letter-spacing:0.04em;">F29 vencidas</div>'
            f'<div style="margin-top:4px;font-size:20px;font-weight:600;'
            f'color:{_C_NEGATIVE if total_f29 > 0 else _C_INK_900};'
            f'font-feature-settings:\'tnum\';">{total_f29}</div>'
            f'</td>'
            f'</tr>'
            f'</table>'
        )

        # Empresas table
        empresas_rows_html = ""
        for e in payload.empresas:
            color_health = _color_for_health(e.health_score)
            delta_str = (
                f"+{e.delta_health}" if e.delta_health > 0 else str(e.delta_health)
            )
            delta_color = (
                _C_GREEN if e.delta_health > 0
                else _C_NEGATIVE if e.delta_health < 0
                else _C_INK_500
            )
            empresas_rows_html += (
                f'<tr>'
                f'<td style="padding:10px 8px;font-size:13px;color:{_C_INK_900};'
                f'border-bottom:1px solid {_C_INK_100};">{escape(e.codigo)}</td>'
                f'<td style="padding:10px 8px;font-size:13px;color:{_C_INK_900};'
                f'border-bottom:1px solid {_C_INK_100};">'
                f'<span style="color:{color_health};font-weight:600;'
                f'font-feature-settings:\'tnum\';">{e.health_score}</span>'
                f' <span style="color:{delta_color};font-size:11px;'
                f'font-feature-settings:\'tnum\';">({escape(delta_str)})</span>'
                f'</td>'
                f'<td style="padding:10px 8px;font-size:13px;color:{_C_INK_900};'
                f'text-align:right;font-feature-settings:\'tnum\';'
                f'border-bottom:1px solid {_C_INK_100};">'
                f'{escape(_fmt_clp(e.saldo_actual))}</td>'
                f'<td style="padding:10px 8px;font-size:13px;'
                f'color:{_C_GREEN if e.flujo_7d >= 0 else _C_NEGATIVE};'
                f'text-align:right;font-feature-settings:\'tnum\';'
                f'border-bottom:1px solid {_C_INK_100};">'
                f'{escape(_fmt_clp(e.flujo_7d))}</td>'
                f'<td style="padding:10px 8px;font-size:13px;color:{_C_INK_900};'
                f'text-align:right;font-feature-settings:\'tnum\';'
                f'border-bottom:1px solid {_C_INK_100};">{e.oc_pendientes}</td>'
                f'<td style="padding:10px 8px;font-size:13px;'
                f'color:{_C_NEGATIVE if e.f29_vencidas > 0 else _C_INK_900};'
                f'text-align:right;font-feature-settings:\'tnum\';'
                f'border-bottom:1px solid {_C_INK_100};">{e.f29_vencidas}</td>'
                f'</tr>'
            )
        if not empresas_rows_html:
            empresas_rows_html = (
                f'<tr><td colspan="6" style="padding:16px;font-size:13px;'
                f'color:{_C_INK_500};text-align:center;">Sin empresas activas.</td></tr>'
            )

        empresas_table_html = (
            f'<h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;'
            f'color:{_C_INK_900};letter-spacing:-0.01em;">Empresas</h2>'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
            f'style="border-collapse:collapse;">'
            f'<thead><tr>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:left;border-bottom:1px solid {_C_INK_100};">Empresa</th>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:left;border-bottom:1px solid {_C_INK_100};">Health</th>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:right;border-bottom:1px solid {_C_INK_100};">Saldo</th>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:right;border-bottom:1px solid {_C_INK_100};">Flujo 7d</th>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:right;border-bottom:1px solid {_C_INK_100};">OC pend</th>'
            f'<th style="padding:8px;font-size:10px;font-weight:600;'
            f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
            f'text-align:right;border-bottom:1px solid {_C_INK_100};">F29 venc</th>'
            f'</tr></thead><tbody>{empresas_rows_html}</tbody></table>'
        )

        # Alerts
        alerts_html = ""
        for a in payload.alerts:
            color = _color_for_severity(a.severity)
            alerts_html += (
                f'<div style="margin:0 0 8px;padding:12px;'
                f'border-left:3px solid {color};background:{_C_INK_100};'
                f'border-radius:8px;">'
                f'<div style="font-size:13px;font-weight:600;color:{_C_INK_900};">'
                f'{escape(a.title)}</div>'
                f'<div style="margin-top:4px;font-size:12px;color:{_C_INK_700};">'
                f'{escape(a.body)}</div>'
                f'</div>'
            )
        alerts_block = ""
        if alerts_html:
            alerts_block = (
                f'<h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;'
                f'color:{_C_INK_900};letter-spacing:-0.01em;">Top alertas</h2>'
                f'{alerts_html}'
            )

        # Movimientos
        movs_html = ""
        for m in payload.movimientos_significativos:
            color = _C_GREEN if m.tipo == "abono" else _C_NEGATIVE
            sign = "+" if m.tipo == "abono" else "-"
            movs_html += (
                f'<tr>'
                f'<td style="padding:8px;font-size:12px;color:{_C_INK_500};'
                f'border-bottom:1px solid {_C_INK_100};font-feature-settings:\'tnum\';">'
                f'{m.fecha.isoformat()}</td>'
                f'<td style="padding:8px;font-size:12px;color:{_C_INK_900};'
                f'border-bottom:1px solid {_C_INK_100};">{escape(m.empresa_codigo)}</td>'
                f'<td style="padding:8px;font-size:12px;color:{_C_INK_700};'
                f'border-bottom:1px solid {_C_INK_100};">{escape(m.descripcion)}</td>'
                f'<td style="padding:8px;font-size:12px;color:{color};text-align:right;'
                f'font-weight:600;font-feature-settings:\'tnum\';'
                f'border-bottom:1px solid {_C_INK_100};">'
                f'{sign}{escape(_fmt_clp(m.monto))}</td>'
                f'</tr>'
            )
        movs_block = ""
        if movs_html:
            movs_block = (
                f'<h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;'
                f'color:{_C_INK_900};letter-spacing:-0.01em;">'
                f'Movimientos significativos (≥ $5M)</h2>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
                f'style="border-collapse:collapse;">'
                f'<thead><tr>'
                f'<th style="padding:6px 8px;font-size:10px;font-weight:600;'
                f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
                f'text-align:left;border-bottom:1px solid {_C_INK_100};">Fecha</th>'
                f'<th style="padding:6px 8px;font-size:10px;font-weight:600;'
                f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
                f'text-align:left;border-bottom:1px solid {_C_INK_100};">Empresa</th>'
                f'<th style="padding:6px 8px;font-size:10px;font-weight:600;'
                f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
                f'text-align:left;border-bottom:1px solid {_C_INK_100};">Descripción</th>'
                f'<th style="padding:6px 8px;font-size:10px;font-weight:600;'
                f'color:{_C_INK_500};text-transform:uppercase;letter-spacing:0.06em;'
                f'text-align:right;border-bottom:1px solid {_C_INK_100};">Monto</th>'
                f'</tr></thead><tbody>{movs_html}</tbody></table>'
            )

        # vs prev week
        vs_prev = payload.vs_prev_week
        vs_prev_block = ""
        if vs_prev:
            flujo_delta = float(vs_prev.get("flujo_delta", 0) or 0)
            oc_delta = int(vs_prev.get("oc_creadas_delta", 0) or 0)
            f29_delta = int(vs_prev.get("f29_pagadas_delta", 0) or 0)
            vs_prev_block = (
                f'<h2 style="margin:24px 0 12px;font-size:16px;font-weight:600;'
                f'color:{_C_INK_900};letter-spacing:-0.01em;">vs semana previa</h2>'
                f'<div style="font-size:13px;color:{_C_INK_700};line-height:1.7;">'
                f'<div>Flujo neto: '
                f'<strong style="color:{_C_GREEN if flujo_delta >= 0 else _C_NEGATIVE};">'
                f'{"+" if flujo_delta >= 0 else ""}{escape(_fmt_clp(flujo_delta))}</strong></div>'
                f'<div>OCs creadas: '
                f'<strong style="color:{_C_INK_900};">'
                f'{"+" if oc_delta >= 0 else ""}{oc_delta}</strong></div>'
                f'<div>F29 pagadas: '
                f'<strong style="color:{_C_INK_900};">'
                f'{"+" if f29_delta >= 0 else ""}{f29_delta}</strong></div>'
                f'</div>'
            )

        frontend_url = (settings.frontend_url or "").rstrip("/")
        cta_block = (
            f'<a href="{escape(frontend_url)}/ceo" '
            f'style="display:inline-block;margin-top:24px;background:{_C_GREEN};'
            f'color:#ffffff;text-decoration:none;border-radius:12px;padding:10px 16px;'
            f'font-size:14px;font-weight:500;">Abrir Dashboard CEO</a>'
            if frontend_url else ""
        )

        return (
            f'<!doctype html><html lang="es"><head>'
            f'<meta charset="utf-8" />'
            f'<meta name="viewport" content="width=device-width,initial-scale=1" />'
            f'<title>Digest semanal CEO — Cehta Capital</title>'
            f'</head>'
            f'<body style="margin:0;padding:0;background:{_C_BG};'
            f'font-family:{font_stack};color:{_C_INK_900};">'
            f'<div style="max-width:600px;margin:24px auto;background:#ffffff;'
            f'border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04);'
            f'padding:32px;">'
            f'<div style="margin-bottom:8px;font-size:11px;color:{_C_INK_500};'
            f'text-transform:uppercase;letter-spacing:0.08em;">'
            f'Cehta Capital · Digest semanal</div>'
            f'<h1 style="margin:0 0 4px;font-size:24px;font-weight:600;'
            f'color:{_C_INK_900};letter-spacing:-0.02em;">Resumen del CEO</h1>'
            f'<p style="margin:0 0 20px;font-size:13px;color:{_C_INK_500};'
            f'font-feature-settings:\'tnum\';">'
            f'Periodo {escape(period_from)} → {escape(period_to)} · '
            f'{n_emp} empresa{"s" if n_emp != 1 else ""}</p>'
            f'{kpi_cards_html}'
            f'{empresas_table_html}'
            f'{alerts_block}'
            f'{movs_block}'
            f'{vs_prev_block}'
            f'{cta_block}'
            f'<p style="margin-top:32px;color:{_C_INK_300};font-size:11px;">'
            f'Generado automáticamente por la Plataforma Cehta Capital. '
            f'Para configurar destinatarios o frecuencia, contactar al admin.</p>'
            f'</div></body></html>'
        )

    def build_plain_text(self, payload: CEODigestPayload) -> str:
        """Plain-text fallback para clientes que no renderizan HTML."""
        lines: list[str] = []
        lines.append("CEHTA CAPITAL — DIGEST SEMANAL CEO")
        lines.append(
            f"Periodo: {payload.period_from.isoformat()} → "
            f"{payload.period_to.isoformat()}"
        )
        lines.append("")

        k = payload.top_kpis
        lines.append("KPIS CONSOLIDADOS")
        lines.append(f"  Saldo total:      {_fmt_clp(k.get('total_saldo', 0))}")
        lines.append(f"  Flujo neto 7d:    {_fmt_clp(k.get('total_flujo_7d', 0))}")
        lines.append(f"  OCs pendientes:   {k.get('total_oc_pendientes', 0)}")
        lines.append(f"  F29 vencidas:     {k.get('total_f29_vencidas', 0)}")
        lines.append("")

        if payload.empresas:
            lines.append("EMPRESAS")
            for e in payload.empresas:
                delta = (
                    f"+{e.delta_health}" if e.delta_health > 0 else str(e.delta_health)
                )
                lines.append(
                    f"  {e.codigo:<10s} health={e.health_score:>3d} ({delta:>4s})  "
                    f"saldo={_fmt_clp(e.saldo_actual):>14s}  "
                    f"flujo7d={_fmt_clp(e.flujo_7d):>14s}  "
                    f"oc={e.oc_pendientes}  f29_venc={e.f29_vencidas}"
                )
            lines.append("")

        if payload.alerts:
            lines.append("TOP ALERTAS")
            for a in payload.alerts:
                lines.append(f"  [{a.severity.upper()}] {a.title}")
                lines.append(f"    {a.body}")
            lines.append("")

        if payload.movimientos_significativos:
            lines.append("MOVIMIENTOS SIGNIFICATIVOS (>= $5M)")
            for m in payload.movimientos_significativos:
                sign = "+" if m.tipo == "abono" else "-"
                lines.append(
                    f"  {m.fecha.isoformat()}  {m.empresa_codigo:<8s}  "
                    f"{sign}{_fmt_clp(m.monto):>12s}  {m.descripcion}"
                )
            lines.append("")

        if payload.vs_prev_week:
            v = payload.vs_prev_week
            lines.append("VS SEMANA PREVIA")
            lines.append(
                f"  Flujo neto delta:  {_fmt_clp(v.get('flujo_delta', 0))}"
            )
            lines.append(
                f"  OCs creadas delta: {v.get('oc_creadas_delta', 0)}"
            )
            lines.append(
                f"  F29 pagadas delta: {v.get('f29_pagadas_delta', 0)}"
            )
            lines.append("")

        lines.append(
            "Generado automáticamente por la Plataforma Cehta Capital."
        )
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Send
    # ------------------------------------------------------------------

    async def send_to_ceo(
        self, recipients: list[str] | None = None
    ) -> DigestSendResult:
        """Envía el digest semanal al CEO (o lista provista).

        - Si `recipients=None`, usa `settings.email_admin_recipients`.
        - Si Resend no está configurado, devuelve `{sent:0, failed:[...]}` y
          loggea warning. NO levanta exception (el endpoint decide 503).
        """
        targets = recipients if recipients is not None else (
            settings.email_admin_recipients or []
        )
        if not targets:
            log.warning("digest.send.no_recipients")
            return DigestSendResult(sent=0, failed=[], preview_url=None)

        payload = await self.build_ceo_weekly_digest()
        html = self.build_html(payload)

        if not self._email.enabled:
            log.warning("digest.send.email_disabled", to=targets)
            return DigestSendResult(
                sent=0,
                failed=list(targets),
                preview_url=None,
            )

        sent = 0
        failed: list[str] = []
        subject = (
            f"Cehta Capital — Digest semanal "
            f"{payload.period_from.isoformat()} → {payload.period_to.isoformat()}"
        )
        for r in targets:
            result = self._email.send(to=[r], subject=subject, html=html)
            if result is not None:
                sent += 1
            else:
                failed.append(r)

        log.info(
            "digest.sent",
            sent=sent,
            failed=len(failed),
            recipients=len(targets),
        )
        return DigestSendResult(sent=sent, failed=failed, preview_url=None)

    # ──────────────────────────────────────────────────────────────────
    # Entregables Weekly Digest — V4 fase 7.8
    # ──────────────────────────────────────────────────────────────────

    async def build_entregables_digest(self) -> EntregablesDigestPayload:
        """Snapshot de entregables regulatorios pendientes para el equipo.

        Genera buckets vencidos / hoy / próximos 7d / próximos 30d.
        Calcula tasa cumplimiento YTD para que vea el progreso.
        """
        now = datetime.now(tz=UTC)
        today = now.date()

        # Buckets — todas las queries son try-safe para no romper si la
        # tabla no existe en algún env legacy.
        try:
            rows = (
                await self._db.execute(
                    text(
                        """
                        SELECT entregable_id, nombre, categoria, periodo,
                               fecha_limite, responsable, estado,
                               (fecha_limite - CURRENT_DATE) AS dias
                        FROM app.entregables_regulatorios
                        WHERE estado IN ('pendiente','en_proceso')
                          AND fecha_limite <= (CURRENT_DATE + INTERVAL '30 days')
                        ORDER BY fecha_limite ASC
                        LIMIT 200
                        """
                    )
                )
            ).mappings().all()
        except Exception as exc:
            log.warning("entregables_digest.fetch_fail", err=str(exc))
            rows = []

        def _classify(dias: int) -> str:
            if dias < 0:
                return "vencido"
            if dias == 0:
                return "hoy"
            if dias <= 5:
                return "critico"
            if dias <= 10:
                return "urgente"
            if dias <= 15:
                return "proximo"
            if dias <= 30:
                return "en_rango"
            return "normal"

        vencidos: list[EntregableDigestRow] = []
        hoy: list[EntregableDigestRow] = []
        proximos_7d_full: list[EntregableDigestRow] = []
        proximos_30d_count = 0

        for r in rows:
            dias = int(r["dias"] or 0)
            nivel = _classify(dias)
            row = EntregableDigestRow(
                entregable_id=int(r["entregable_id"]),
                nombre=str(r["nombre"]),
                categoria=str(r["categoria"]),
                periodo=str(r["periodo"]),
                fecha_limite=r["fecha_limite"],
                dias_restantes=dias,
                responsable=str(r["responsable"]),
                estado=str(r["estado"]),
                nivel_alerta=nivel,
            )
            proximos_30d_count += 1
            if dias < 0:
                vencidos.append(row)
            elif dias == 0:
                hoy.append(row)
            elif dias <= 7:
                proximos_7d_full.append(row)

        # Tasa de cumplimiento YTD
        try:
            ytd_total = (
                await self._db.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM app.entregables_regulatorios
                        WHERE fecha_limite >=
                              make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1)
                          AND fecha_limite < CURRENT_DATE
                        """
                    )
                )
            ).scalar() or 0
            ytd_entregados = (
                await self._db.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM app.entregables_regulatorios
                        WHERE fecha_limite >=
                              make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1)
                          AND fecha_limite < CURRENT_DATE
                          AND estado = 'entregado'
                        """
                    )
                )
            ).scalar() or 0
            tasa = (
                round((ytd_entregados / ytd_total * 100.0), 1)
                if ytd_total > 0
                else 100.0
            )
        except Exception:
            tasa = 0.0

        return EntregablesDigestPayload(
            generated_at=now,
            period_from=today,
            period_to=today + timedelta(days=7),
            vencidos_count=len(vencidos),
            hoy_count=len(hoy),
            proximos_7d_count=len(proximos_7d_full),
            proximos_30d_count=proximos_30d_count,
            tasa_cumplimiento_ytd=tasa,
            vencidos=vencidos[:20],  # cap para email lectura razonable
            hoy=hoy[:20],
            proximos_7d=proximos_7d_full[:20],
        )

    def build_entregables_html(self, payload: EntregablesDigestPayload) -> str:
        """HTML inline-styled del digest de entregables.

        Patrón: tarjeta header → 4 KPIs → tablas vencidos/hoy/próximos.
        """
        def _row_html(rows: list[EntregableDigestRow], color: str) -> str:
            if not rows:
                return (
                    f'<p style="margin:0;padding:8px 0;color:{_C_INK_500};'
                    f'font-size:13px;font-style:italic;">— Ninguno —</p>'
                )
            cells = []
            for r in rows:
                fecha = r.fecha_limite.strftime("%d-%b")
                dias_text = (
                    f"Vencido {abs(r.dias_restantes)}d"
                    if r.dias_restantes < 0
                    else "HOY"
                    if r.dias_restantes == 0
                    else f"En {r.dias_restantes}d"
                )
                cells.append(
                    f'<tr>'
                    f'<td style="padding:6px 8px;border-bottom:1px solid {_C_INK_100};'
                    f'font-size:12px;color:{_C_INK_700};white-space:nowrap;">{fecha}</td>'
                    f'<td style="padding:6px 8px;border-bottom:1px solid {_C_INK_100};'
                    f'font-size:11px;color:{color};font-weight:600;white-space:nowrap;">'
                    f'{escape(r.categoria)}</td>'
                    f'<td style="padding:6px 8px;border-bottom:1px solid {_C_INK_100};'
                    f'font-size:13px;color:{_C_INK_900};">{escape(r.nombre)}</td>'
                    f'<td style="padding:6px 8px;border-bottom:1px solid {_C_INK_100};'
                    f'font-size:11px;color:{_C_INK_500};white-space:nowrap;">'
                    f'{escape(r.responsable)}</td>'
                    f'<td style="padding:6px 8px;border-bottom:1px solid {_C_INK_100};'
                    f'font-size:11px;color:{color};font-weight:600;'
                    f'white-space:nowrap;text-align:right;">{dias_text}</td>'
                    f"</tr>"
                )
            return (
                '<table style="width:100%;border-collapse:collapse;'
                'margin:6px 0 12px 0;">'
                + "".join(cells)
                + "</table>"
            )

        vencidos_html = _row_html(payload.vencidos, _C_NEGATIVE)
        hoy_html = _row_html(payload.hoy, _C_NEGATIVE)
        proximos_html = _row_html(payload.proximos_7d, _C_WARNING)
        tasa_color = (
            _C_GREEN
            if payload.tasa_cumplimiento_ytd >= 95
            else _C_WARNING
            if payload.tasa_cumplimiento_ytd >= 85
            else _C_NEGATIVE
        )

        return f"""<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Digest semanal · Entregables FIP CEHTA ESG</title>
</head>
<body style="margin:0;padding:0;background:{_C_BG};
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <p style="margin:0;font-size:11px;color:{_C_INK_500};
text-transform:uppercase;letter-spacing:0.12em;">
      Digest semanal · Entregables Regulatorios
    </p>
    <h1 style="margin:6px 0 4px 0;font-size:22px;color:{_C_INK_900};
letter-spacing:-0.01em;">
      FIP CEHTA ESG · AFIS S.A.
    </h1>
    <p style="margin:0;font-size:12px;color:{_C_INK_500};">
      Generado el {payload.generated_at.strftime('%d %b %Y · %H:%M')}
    </p>

    <table style="width:100%;border-collapse:separate;border-spacing:8px;
margin:16px 0;">
      <tr>
        <td style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:12px;width:25%;">
          <p style="margin:0;font-size:10px;color:{_C_INK_500};
text-transform:uppercase;letter-spacing:0.08em;">Vencidos</p>
          <p style="margin:4px 0 0 0;font-size:24px;font-weight:700;
color:{_C_NEGATIVE if payload.vencidos_count > 0 else _C_INK_300};">
            {payload.vencidos_count}
          </p>
        </td>
        <td style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:12px;width:25%;">
          <p style="margin:0;font-size:10px;color:{_C_INK_500};
text-transform:uppercase;letter-spacing:0.08em;">Hoy</p>
          <p style="margin:4px 0 0 0;font-size:24px;font-weight:700;
color:{_C_NEGATIVE if payload.hoy_count > 0 else _C_INK_300};">
            {payload.hoy_count}
          </p>
        </td>
        <td style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:12px;width:25%;">
          <p style="margin:0;font-size:10px;color:{_C_INK_500};
text-transform:uppercase;letter-spacing:0.08em;">Próx. 7d</p>
          <p style="margin:4px 0 0 0;font-size:24px;font-weight:700;
color:{_C_WARNING if payload.proximos_7d_count > 0 else _C_INK_300};">
            {payload.proximos_7d_count}
          </p>
        </td>
        <td style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:12px;width:25%;">
          <p style="margin:0;font-size:10px;color:{_C_INK_500};
text-transform:uppercase;letter-spacing:0.08em;">Tasa YTD</p>
          <p style="margin:4px 0 0 0;font-size:24px;font-weight:700;
color:{tasa_color};">
            {payload.tasa_cumplimiento_ytd:.1f}%
          </p>
        </td>
      </tr>
    </table>

    <div style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:16px;margin-bottom:12px;">
      <h2 style="margin:0 0 4px 0;font-size:14px;color:{_C_NEGATIVE};">
        🔴 Vencidos sin entregar ({payload.vencidos_count})
      </h2>
      <p style="margin:0 0 8px 0;font-size:11px;color:{_C_INK_500};">
        Cada uno requiere explicación documentada para acta del Comité.
      </p>
      {vencidos_html}
    </div>

    <div style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:16px;margin-bottom:12px;">
      <h2 style="margin:0 0 4px 0;font-size:14px;color:{_C_NEGATIVE};">
        ⏰ Vencen hoy ({payload.hoy_count})
      </h2>
      <p style="margin:0 0 8px 0;font-size:11px;color:{_C_INK_500};">
        Cierre del día — resolver antes que se vuelva atrasado.
      </p>
      {hoy_html}
    </div>

    <div style="background:#fff;border:1px solid {_C_INK_100};
border-radius:12px;padding:16px;margin-bottom:12px;">
      <h2 style="margin:0 0 4px 0;font-size:14px;color:{_C_WARNING};">
        🟠 Próximos 7 días ({payload.proximos_7d_count})
      </h2>
      <p style="margin:0 0 8px 0;font-size:11px;color:{_C_INK_500};">
        Empezar a preparar — semana en curso.
      </p>
      {proximos_html}
    </div>

    <p style="margin:24px 0 8px 0;font-size:11px;color:{_C_INK_500};
text-align:center;">
      Total ventana 30 días: <strong>{payload.proximos_30d_count}</strong>
      entregables ·
      <a href="{settings.frontend_url}/entregables"
         style="color:{_C_GREEN};text-decoration:none;">
        Ver módulo completo →
      </a>
    </p>
    <p style="margin:0;font-size:10px;color:{_C_INK_300};text-align:center;">
      Plataforma de gobernanza interna · FIP CEHTA ESG · AFIS S.A.
    </p>
  </div>
</body></html>"""

    async def send_entregables_digest(
        self, recipients: list[str] | None = None
    ) -> DigestSendResult:
        """Envía el digest semanal operativo de entregables.

        Mismo flujo que `send_to_ceo()`: soft-fail si Resend no está,
        loop por recipient, audit-friendly logging.
        """
        targets = recipients if recipients is not None else (
            settings.email_admin_recipients or []
        )
        if not targets:
            log.warning("entregables_digest.send.no_recipients")
            return DigestSendResult(sent=0, failed=[], preview_url=None)

        payload = await self.build_entregables_digest()
        html = self.build_entregables_html(payload)

        if not self._email.enabled:
            log.warning("entregables_digest.send.email_disabled", to=targets)
            return DigestSendResult(
                sent=0, failed=list(targets), preview_url=None
            )

        sent = 0
        failed: list[str] = []
        subject = (
            f"Cehta — Entregables {payload.period_from.isoformat()} · "
            f"{payload.vencidos_count} vencidos · {payload.hoy_count} hoy"
        )
        for r in targets:
            result = self._email.send(to=[r], subject=subject, html=html)
            if result is not None:
                sent += 1
            else:
                failed.append(r)

        log.info(
            "entregables_digest.sent",
            sent=sent,
            failed=len(failed),
            recipients=len(targets),
            vencidos=payload.vencidos_count,
            hoy=payload.hoy_count,
        )
        return DigestSendResult(sent=sent, failed=failed, preview_url=None)
