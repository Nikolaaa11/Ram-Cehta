"""AI Data Q&A — preguntas naturales sobre la data del fondo.

Diseño:
  1. User envía pregunta tipo "¿cuánto debe TRONGKAI a proveedores este mes?"
  2. Backend ejecuta queries pre-definidas + agrega counts/totales del period
  3. Pasa el resumen estructurado + la pregunta a Claude
  4. Claude responde en lenguaje natural citando los números

NO es text-to-SQL — ese tiene riesgo de inyección + queries pesadas.
En su lugar pre-computamos un context fijo (snapshot del fondo) y dejamos
a Claude razonar sobre datos ya agregados.

Esto es seguro, predecible y barato (~$0.005 por pregunta).
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger(__name__)


class AiDataQANotConfigured(Exception):
    """ANTHROPIC_API_KEY ausente."""


async def build_context_snapshot(
    db: AsyncSession,
    *,
    empresa_codigo: str | None = None,
    allowed_codes: list[str] | None = None,
) -> dict[str, Any]:
    """Construye un snapshot estructurado del estado financiero.

    Si `empresa_codigo` se especifica, filtra; si no, devuelve cross-empresa.

    Output (JSON-serializable):
      {
        "as_of": "2026-05-06",
        "vouchers": {
          "total": int,
          "by_status": {"DRAFT": N, "PENDING": N, ...},
          "by_tipo": {"COMPRA": N, "VENTA": N, ...},
          "monto_pendiente_firma": Decimal,
        },
        "f29": {"pendientes_proximos": N, "vencidos": N},
        "f22": {"pendientes_proximos_60d": N},
        "ocs": {"pendientes_pago": N, "monto_pendiente": Decimal},
        "movimientos": {"total_30d": N, "ultimo_saldo_clp": Decimal},
        "inbox": {"pendientes_revision": N, "by_category": {...}}
      }
    """
    where_emp = ""
    params: dict[str, Any] = {}
    if empresa_codigo:
        where_emp = "AND empresa_codigo = :emp"
        params["emp"] = empresa_codigo
    elif allowed_codes is not None:
        # R152YYYYYY — scope multi-tenant: sin empresa explicita, el snapshot
        # se restringe a las empresas permitidas del usuario (antes devolvia
        # el estado financiero CROSS-EMPRESA de todo el fondo a cualquier
        # user con ai:chat, incluido viewer).
        where_emp = "AND empresa_codigo = ANY(:allowed)"
        params["allowed"] = list(allowed_codes)

    snapshot: dict[str, Any] = {
        "as_of": date.today().isoformat(),
        "scope": (
            empresa_codigo
            or (",".join(allowed_codes) if allowed_codes is not None else "all_empresas")
        ),
    }

    # ── Vouchers ────────────────────────────────────────────────────────
    try:
        rows = (
            await db.execute(
                text(
                    f"""
                    SELECT status, tipo, COUNT(*) AS cnt,
                           SUM(total_debit) AS total
                    FROM core.vouchers
                    WHERE 1=1 {where_emp}
                    GROUP BY status, tipo
                    """
                ),
                params,
            )
        ).mappings().all()
        by_status: dict[str, int] = {}
        by_tipo: dict[str, int] = {}
        monto_pending = Decimal("0")
        total_vouchers = 0
        for r in rows:
            total_vouchers += int(r["cnt"])
            by_status[r["status"]] = (
                by_status.get(r["status"], 0) + int(r["cnt"])
            )
            by_tipo[r["tipo"]] = by_tipo.get(r["tipo"], 0) + int(r["cnt"])
            if r["status"] == "PENDING":
                monto_pending += Decimal(str(r["total"] or 0))
        snapshot["vouchers"] = {
            "total": total_vouchers,
            "by_status": by_status,
            "by_tipo": by_tipo,
            "monto_pendiente_firma_clp": str(monto_pending),
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("ai_qa.snapshot.vouchers_failed", error=str(exc))

    # ── F29 ─────────────────────────────────────────────────────────────
    try:
        f29 = (
            await db.execute(
                text(
                    f"""
                    SELECT
                      COUNT(*) FILTER (WHERE estado = 'pendiente'
                        AND fecha_vencimiento <= current_date + INTERVAL '14 days') AS proximos,
                      COUNT(*) FILTER (WHERE estado = 'pendiente'
                        AND fecha_vencimiento < current_date) AS vencidos
                    FROM core.f29_obligaciones
                    WHERE 1=1 {where_emp}
                    """
                ),
                params,
            )
        ).first()
        if f29:
            snapshot["f29"] = {
                "pendientes_proximos_14d": int(f29[0] or 0),
                "vencidos": int(f29[1] or 0),
            }
    except Exception as exc:  # noqa: BLE001
        log.warning("ai_qa.snapshot.f29_failed", error=str(exc))

    # ── F22 ─────────────────────────────────────────────────────────────
    try:
        f22 = (
            await db.execute(
                text(
                    f"""
                    SELECT COUNT(*) FROM core.f22_obligaciones
                    WHERE estado = 'pendiente'
                      AND fecha_vencimiento <= current_date + INTERVAL '60 days'
                      {where_emp}
                    """
                ),
                params,
            )
        ).first()
        snapshot["f22"] = {"pendientes_proximos_60d": int(f22[0] or 0) if f22 else 0}
    except Exception:
        pass

    # ── OCs ─────────────────────────────────────────────────────────────
    try:
        oc = (
            await db.execute(
                text(
                    f"""
                    SELECT
                      COUNT(*) AS pendientes,
                      COALESCE(SUM(total), 0) AS monto
                    FROM core.ordenes_compra
                    WHERE estado IN ('aprobada', 'enviada')
                    {where_emp}
                    """
                ),
                params,
            )
        ).first()
        if oc:
            snapshot["ocs"] = {
                "pendientes_pago": int(oc[0] or 0),
                "monto_pendiente_clp": str(Decimal(str(oc[1] or 0))),
            }
    except Exception:
        pass

    # ── Inbox ───────────────────────────────────────────────────────────
    try:
        inbox = (
            await db.execute(
                text(
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE status IN ('received','classified')) AS pendientes,
                      COUNT(*) FILTER (WHERE category = 'factura_proveedor') AS facturas,
                      COUNT(*) FILTER (WHERE category = 'notif_sii') AS notif_sii,
                      COUNT(*) FILTER (WHERE category = 'pago_confirmado') AS pagos
                    FROM core.inbox_messages
                    WHERE received_at >= NOW() - INTERVAL '30 days'
                    """
                )
            )
        ).first()
        if inbox:
            snapshot["inbox_30d"] = {
                "pendientes_revision": int(inbox[0] or 0),
                "facturas_proveedor": int(inbox[1] or 0),
                "notificaciones_sii": int(inbox[2] or 0),
                "pagos_confirmados": int(inbox[3] or 0),
            }
    except Exception:
        pass

    return snapshot


_SYSTEM_PROMPT = """Sos "Claudia Data", el agente de Q&A de Cehta Capital
(FIP chileno). Recibís un snapshot estructurado del estado financiero del
fondo y una pregunta del usuario en español/chileno.

Reglas estrictas:
1. SOLO usá datos del snapshot. Si la pregunta requiere data que NO está
   en el snapshot, decílo explícitamente: "No tengo ese dato, te paso
   este link a /reportes/contables".
2. Citá los números con CLP formato chileno: $1.234.567.
3. Sé directo, máximo 4 oraciones de respuesta. Sin disclaimers de IA.
4. Si hay alertas (vencidos, pendientes), enfatizalo arriba.
5. Tono: profesional pero conversacional, como un colega contador
   reportándole al COO.
6. NO inventes números ni hagas proyecciones — solo refleja el snapshot.

Si la pregunta es ambigua, preguntá clarificación corta.
"""


async def answer_question(
    db: AsyncSession,
    *,
    question: str,
    empresa_codigo: str | None = None,
    allowed_codes: list[str] | None = None,
) -> dict[str, Any]:
    """Responde una pregunta sobre el estado del fondo.

    Returns:
        {
          "answer": str,
          "snapshot": dict,
          "model": str,
          "tokens_input": int,
          "tokens_output": int,
        }

    Raises AiDataQANotConfigured si Anthropic API key falta.
    """
    if not settings.anthropic_api_key:
        raise AiDataQANotConfigured("ANTHROPIC_API_KEY no configurado")

    snapshot = await build_context_snapshot(
        db, empresa_codigo=empresa_codigo, allowed_codes=allowed_codes
    )

    # MEGAPROMPT PERF (patrón R152UUUUU, igual que vouchers_extract) —
    # devolver la conexión al pool ANTES de la llamada a Claude (hasta 90s ×
    # 3 retries). El resto de la función no usa la BD. Sin esto, 4 preguntas
    # concurrentes a Claudia Data agotaban el pool (3+1) y TODA la API
    # esperaba pool_timeout=30s.
    await db.close()

    import json

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=90.0, max_retries=3)  # R152FFFFFF

    prompt = f"""Snapshot del fondo (JSON):
```json
{json.dumps(snapshot, indent=2, ensure_ascii=False)}
```

Pregunta del usuario: {question}

Responde en español chileno, citando datos del snapshot."""

    message = await client.messages.create(
        model=settings.ai_chat_model,
        max_tokens=1500,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    answer = ""
    for block in getattr(message, "content", []) or []:
        text_attr = getattr(block, "text", None)
        if text_attr:
            answer += text_attr

    usage = getattr(message, "usage", None)
    return {
        "answer": answer.strip(),
        "snapshot": snapshot,
        "model": settings.ai_chat_model,
        "tokens_input": getattr(usage, "input_tokens", 0) if usage else 0,
        "tokens_output": getattr(usage, "output_tokens", 0) if usage else 0,
    }
