"""Lógica de negocio del flujo de aprobación de vouchers (V5 Fase 2).

Funciones puras testeables:
  - find_matching_rule
  - compute_threshold_aplicado
  - is_user_authorized_to_sign

Funciones con DB:
  - load_active_rules
  - load_user_roles_for_empresa
  - get_voucher_balance_treatment_summary
  - record_approval_signature
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------
# Lógica pura — find_matching_rule
# ---------------------------------------------------------------------


def find_matching_rule(
    rules: list[dict[str, Any]],
    *,
    voucher_tipo: str,
    voucher_amount: Decimal,
    balance_treatment_dominante: str | None,
) -> dict[str, Any] | None:
    """Devuelve la regla más específica que matchea, o None si no hay match.

    Orden de matching:
      1. Filtra por empresa (caller ya las trajo filtradas, asumimos misma empresa).
      2. Filtra por monto (min <= amount <= max | NULL).
      3. Filtra por voucher_tipo (NULL en regla = comodín).
      4. Filtra por balance_treatment (NULL en regla = comodín).
      5. Ordena por priority ASC (menor número = más específica).
      6. Devuelve la primera.

    `balance_treatment_dominante` es el del voucher: si todas las líneas son
    'GASTO' -> 'GASTO'. Si hay al menos una 'ACTIVACION' -> 'ACTIVACION'.
    Si todas son 'NA' -> None (regla con balance_treatment NULL aplica).
    """
    matches: list[dict[str, Any]] = []
    for r in rules:
        # Monto
        if voucher_amount < Decimal(r["min_amount"] or 0):
            continue
        if r["max_amount"] is not None and voucher_amount > Decimal(r["max_amount"]):
            continue
        # Tipo de voucher
        if r["voucher_tipo"] is not None and r["voucher_tipo"] != voucher_tipo:
            continue
        # Balance treatment
        if (
            r["balance_treatment"] is not None
            and r["balance_treatment"] != balance_treatment_dominante
        ):
            continue
        matches.append(r)

    if not matches:
        return None
    # Priority ASC = más específica primero
    return sorted(matches, key=lambda r: r["priority"])[0]


def compute_threshold_aplicado(rule: dict[str, Any] | None) -> bool:
    """`threshold_aplicado` = la regla matcheada está marcada como reinforced."""
    return bool(rule and rule.get("reinforced"))


def compute_signature_hash(
    *,
    voucher_codigo: str,
    user_id: str,
    timestamp: datetime,
    ip_address: str | None,
) -> str:
    """SHA-256 de los inputs canónicos de la firma.

    Permite verificar después que la firma corresponde al voucher exacto
    en ese timestamp y desde esa IP. Si alguien manipula el row de
    approvals, el hash no cuadra.
    """
    payload = (
        f"{voucher_codigo}|{user_id}|{timestamp.isoformat()}|{ip_address or ''}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------
# Lógica con DB
# ---------------------------------------------------------------------


async def load_active_rules(
    db: AsyncSession, empresa_codigo: str
) -> list[dict[str, Any]]:
    """Trae todas las reglas activas de la empresa, ordenadas por priority."""
    rows = (
        await db.execute(
            text(
                """
                SELECT rule_id, empresa_codigo, voucher_tipo, min_amount,
                       max_amount, balance_treatment, required_roles,
                       reinforced, priority, descripcion
                FROM core.approval_rules
                WHERE empresa_codigo = :e AND active = TRUE
                ORDER BY priority ASC
                """
            ),
            {"e": empresa_codigo},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def load_user_roles_for_empresa(
    db: AsyncSession, user_id: str, empresa_codigo: str
) -> list[str]:
    """Roles activos del usuario en esa empresa."""
    rows = (
        await db.execute(
            text(
                """
                SELECT role FROM core.user_company_roles
                WHERE user_id = CAST(:u AS UUID)
                  AND empresa_codigo = :e
                  AND active = TRUE
                """
            ),
            {"u": user_id, "e": empresa_codigo},
        )
    ).scalars().all()
    return list(rows)


async def get_voucher_balance_treatment_dominante(
    db: AsyncSession, voucher_id: int
) -> str | None:
    """Calcula el balance_treatment dominante del voucher.

    Si CUALQUIER línea es ACTIVACION → ACTIVACION (hipótesis pesimista
    para activar regla reforzada).
    Si todas las líneas son GASTO → GASTO.
    Si todas son NA → None (matchea reglas con balance_treatment NULL).
    """
    row = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) FILTER (WHERE balance_treatment = 'ACTIVACION') AS act,
                    COUNT(*) FILTER (WHERE balance_treatment = 'GASTO')      AS gas,
                    COUNT(*) FILTER (WHERE balance_treatment = 'NA')         AS na,
                    COUNT(*)                                                 AS total
                FROM core.voucher_lines
                WHERE voucher_id = :v
                """
            ),
            {"v": voucher_id},
        )
    ).mappings().one()

    if row["act"] > 0:
        return "ACTIVACION"
    if row["gas"] > 0 and row["gas"] == (row["total"] - row["na"]):
        return "GASTO"
    if row["na"] == row["total"]:
        return None
    # Mezcla weird → tratamos como GASTO (default conservador)
    return "GASTO"


async def get_voucher_approvals(
    db: AsyncSession, voucher_id: int
) -> list[dict[str, Any]]:
    """Lista las firmas/rechazos ya registradas para este voucher."""
    rows = (
        await db.execute(
            text(
                """
                SELECT approval_id, voucher_id, approver_user_id::text AS approver_user_id,
                       role, order_num, decision, signed_at, signature_hash,
                       ip_address, user_agent, comments
                FROM core.voucher_approvals
                WHERE voucher_id = :v
                ORDER BY order_num ASC, signed_at ASC
                """
            ),
            {"v": voucher_id},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def record_approval_signature(
    db: AsyncSession,
    *,
    voucher_id: int,
    voucher_codigo: str,
    approver_user_id: str,
    role: str,
    order_num: int,
    decision: str,  # 'APPROVED' | 'REJECTED'
    ip_address: str | None,
    user_agent: str | None,
    comments: str | None,
) -> dict[str, Any]:
    """Registra una firma con hash SHA-256 canónico."""
    now = datetime.now(tz=UTC)
    sig_hash = compute_signature_hash(
        voucher_codigo=voucher_codigo,
        user_id=approver_user_id,
        timestamp=now,
        ip_address=ip_address,
    )

    result = await db.execute(
        text(
            """
            INSERT INTO core.voucher_approvals (
                voucher_id, approver_user_id, role, order_num,
                decision, signed_at, signature_hash, ip_address,
                user_agent, comments
            )
            VALUES (
                :v, CAST(:u AS UUID), :r, :o, :d, :ts, :h, :ip, :ua, :c
            )
            RETURNING approval_id, voucher_id, approver_user_id::text AS approver_user_id,
                      role, order_num, decision, signed_at, signature_hash,
                      ip_address, user_agent, comments
            """
        ),
        {
            "v": voucher_id,
            "u": approver_user_id,
            "r": role,
            "o": order_num,
            "d": decision,
            "ts": now,
            "h": sig_hash,
            "ip": ip_address,
            "ua": user_agent,
            "c": comments,
        },
    )
    return dict(result.mappings().one())
