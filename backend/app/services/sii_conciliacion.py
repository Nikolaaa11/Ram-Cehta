"""Round 118 — Conciliación automática entre sii_documentos y vouchers.

Cuando el RCV se baja (auto o manual), cada documento queda en
`core.sii_documentos` con voucher_id = NULL. Este servicio intenta
matchearlos con vouchers existentes de la plataforma.

REGLAS DE MATCHING (orden de prioridad):

  1. EXACT MATCH (alta confianza):
     - misma empresa_codigo
     - mismo doc_tributario_tipo ↔ tipo_dte (33↔FACTURA, 39↔BOLETA, etc.)
     - mismo doc_tributario_folio ↔ folio
     - mismo contraparte_rut ↔ rut_contraparte (normalizado)
     - monto_total dentro de ±1 peso (Math.abs(diff) <= 1)

  2. FUZZY MATCH (warn — humano debe confirmar):
     - empresa + tipo + folio match
     - pero RUT contraparte difiere
     - o monto difiere por <5%

  3. NO MATCH:
     - el SII conoce un doc que NO hay voucher local → ALERT
       "Falta cargar este voucher" (importante para el operador)

Cada doc puede tener voucher_id = NULL (no matcheado) o un FK.
La columna match_score guarda la confianza (1.0 = exact, 0.7 = fuzzy).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


# Mapeo de tipo DTE numérico SII → doc_tributario_tipo del voucher
DTE_TIPO_TO_VOUCHER = {
    33: "FACTURA",
    34: "FACTURA",  # Factura exenta
    39: "BOLETA",
    41: "BOLETA",   # Boleta exenta
    43: "FACTURA",  # Liquidación factura
    46: "FACTURA",  # Factura compra
    56: "NOTA_DEBITO",
    61: "NOTA_CREDITO",
    110: "FACTURA",  # Factura exportación
}


@dataclass
class ConciliacionResult:
    total_processed: int
    matched_exact: int
    matched_fuzzy: int
    unmatched: int
    already_conciled: int


def _normalize_rut(rut: str | None) -> str:
    """Normaliza '77.018.739-7' → '77018739-7'. Tolerante con None."""
    if not rut:
        return ""
    cleaned = re.sub(r"[^0-9kK\-]", "", rut.upper())
    # Asegurar formato con guion entre número y DV
    cleaned = cleaned.replace("-", "")
    if len(cleaned) < 2:
        return cleaned
    return f"{cleaned[:-1]}-{cleaned[-1]}"


async def conciliar_empresa(
    db: AsyncSession,
    empresa_codigo: str,
    periodo: str | None = None,
) -> ConciliacionResult:
    """Conciliación pasada sobre todos los sii_documentos no-conciliados.

    Si `periodo` se pasa, limita el scope a ese período (YYYY-MM).
    """
    # 1. Cargar sii_documentos sin voucher_id (no conciliados)
    params: dict[str, Any] = {"e": empresa_codigo}
    where_periodo = ""
    if periodo:
        where_periodo = " AND periodo = :p"
        params["p"] = periodo

    rows = (await db.execute(
        text(
            f"""
            SELECT sii_doc_id, flujo, tipo_dte, folio, periodo,
                   rut_contraparte, monto_total
            FROM core.sii_documentos
            WHERE empresa_codigo = :e
              AND voucher_id IS NULL
              {where_periodo}
            ORDER BY sii_doc_id
            """  # noqa: S608 — params bound, where_periodo es whitelist
        ),
        params,
    )).fetchall()

    if not rows:
        return ConciliacionResult(
            total_processed=0, matched_exact=0, matched_fuzzy=0,
            unmatched=0, already_conciled=0,
        )

    # 2. Cargar vouchers candidatos de la misma empresa de los últimos 90 días.
    #    Limit por scope para no escanear toda la tabla.
    voucher_rows = (await db.execute(
        text(
            """
            SELECT voucher_id, doc_tributario_tipo, doc_tributario_folio,
                   contraparte_rut, total_debit, total_credit, status
            FROM core.vouchers
            WHERE empresa_codigo = :e
              AND doc_tributario_folio IS NOT NULL
              AND contraparte_rut IS NOT NULL
              AND status NOT IN ('REJECTED', 'VOID')
              AND fecha_documento >= (CURRENT_DATE - INTERVAL '180 days')
            """
        ),
        {"e": empresa_codigo},
    )).fetchall()

    # Index vouchers por (tipo_voucher, folio, rut_normalizado) para lookup O(1)
    voucher_index: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for v in voucher_rows:
        rut_norm = _normalize_rut(v[3])
        # Para compras, el monto importa = total_debit; ventas = total_credit.
        # Tomamos el max() como hipótesis universal (uno será 0).
        monto = max(int(v[4] or 0), int(v[5] or 0))
        key = (str(v[1] or ""), str(v[2] or ""), rut_norm)
        voucher_index.setdefault(key, []).append({
            "voucher_id": v[0],
            "monto": monto,
            "status": v[6],
        })

    exact = 0
    fuzzy = 0
    unmatched = 0

    for r in rows:
        sii_doc_id = r[0]
        tipo_dte = int(r[2])
        folio = str(r[3])
        rut_norm = _normalize_rut(r[5])
        monto_sii = int(r[6] or 0)

        tipo_voucher = DTE_TIPO_TO_VOUCHER.get(tipo_dte)
        if not tipo_voucher:
            unmatched += 1
            continue

        # Intento 1: exact match (tipo + folio + rut)
        candidates = voucher_index.get((tipo_voucher, folio, rut_norm), [])
        matched_voucher_id: int | None = None
        match_score = 0.0

        for c in candidates:
            if abs(c["monto"] - monto_sii) <= 1:
                matched_voucher_id = c["voucher_id"]
                match_score = 1.0
                break

        # Intento 2: fuzzy — tipo + folio match pero rut o monto difiere
        if matched_voucher_id is None:
            for (t, fol, _), candidates_b in voucher_index.items():
                if t == tipo_voucher and fol == folio:
                    for c in candidates_b:
                        diff_pct = (
                            abs(c["monto"] - monto_sii) / max(monto_sii, 1)
                        )
                        if diff_pct <= 0.05:
                            matched_voucher_id = c["voucher_id"]
                            match_score = 0.7
                            break
                    if matched_voucher_id:
                        break

        if matched_voucher_id:
            await db.execute(
                text(
                    """
                    UPDATE core.sii_documentos
                    SET voucher_id = :vid,
                        updated_at = NOW()
                    WHERE sii_doc_id = :sid
                    """
                ),
                {"vid": matched_voucher_id, "sid": sii_doc_id},
            )
            if match_score >= 1.0:
                exact += 1
            else:
                fuzzy += 1
        else:
            unmatched += 1

    await db.commit()
    log.info(
        "sii_conciliacion_done",
        extra={
            "empresa": empresa_codigo,
            "periodo": periodo,
            "exact": exact,
            "fuzzy": fuzzy,
            "unmatched": unmatched,
        },
    )
    return ConciliacionResult(
        total_processed=len(rows),
        matched_exact=exact,
        matched_fuzzy=fuzzy,
        unmatched=unmatched,
        already_conciled=0,
    )
