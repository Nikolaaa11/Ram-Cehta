"""Unit tests Round 56 — auto-approve si regla matched tiene required_roles=[].

La lógica que automatiza la aprobación está en `submit_voucher` del
endpoint /vouchers/{id}/submit. Estos tests validan SOLO la decisión de
auto-approve usando find_matching_rule directamente, sin necesidad de DB
ni request HTTP completo.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.approval_service import find_matching_rule


def _rule(
    *,
    rule_id: int,
    min_amount: float = 0,
    max_amount: float | None = None,
    voucher_tipo: str | None = None,
    balance_treatment: str | None = None,
    required_roles: list[str] | None = None,
    priority: int = 100,
    reinforced: bool = False,
    descripcion: str = "test",
) -> dict:
    """Factory de regla — defaults razonables."""
    return {
        "rule_id": rule_id,
        "min_amount": min_amount,
        "max_amount": max_amount,
        "voucher_tipo": voucher_tipo,
        "balance_treatment": balance_treatment,
        "required_roles": required_roles or [],
        "priority": priority,
        "reinforced": reinforced,
        "descripcion": descripcion,
    }


def test_regla_required_roles_vacia_matchea_y_seria_auto_approve() -> None:
    """Voucher por debajo del umbral matchea la regla de auto-approve."""
    rules = [
        _rule(
            rule_id=10,
            min_amount=0,
            max_amount=200_000,
            required_roles=[],  # ← auto-approve
            priority=50,  # más específica que la default
            descripcion="Auto $200K",
        ),
        _rule(
            rule_id=20,
            min_amount=0,
            max_amount=None,
            required_roles=["GG", "DIRECTOR"],
            priority=100,
            descripcion="Default 2 firmas",
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("150000"),
        balance_treatment_dominante="GASTO",
    )
    assert matched is not None
    assert matched["rule_id"] == 10
    # Round 56: la decisión de auto-approve es exactamente:
    auto_approve = (
        isinstance(matched["required_roles"], (list, tuple))
        and len(matched["required_roles"]) == 0
    )
    assert auto_approve is True


def test_voucher_por_encima_del_umbral_va_al_workflow_normal() -> None:
    """Voucher arriba de 200K matchea la regla default (2 firmas)."""
    rules = [
        _rule(
            rule_id=10, min_amount=0, max_amount=200_000,
            required_roles=[], priority=50,
        ),
        _rule(
            rule_id=20, min_amount=0, max_amount=None,
            required_roles=["GG", "DIRECTOR"], priority=100,
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("500000"),
        balance_treatment_dominante="GASTO",
    )
    assert matched is not None
    assert matched["rule_id"] == 20
    auto_approve = len(matched["required_roles"]) == 0
    assert auto_approve is False


def test_voucher_exactamente_en_umbral_aplica_auto() -> None:
    """Borde: monto == max_amount → todavía dentro de la regla auto."""
    rules = [
        _rule(
            rule_id=10, min_amount=0, max_amount=200_000,
            required_roles=[], priority=50,
        ),
        _rule(
            rule_id=20, required_roles=["GG", "DIRECTOR"], priority=100,
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("200000"),  # exactamente en el límite
        balance_treatment_dominante="GASTO",
    )
    assert matched["rule_id"] == 10


def test_sin_reglas_auto_aprobadas_siempre_normal() -> None:
    """Sin reglas con required_roles=[], todos los vouchers van a PENDING."""
    rules = [
        _rule(
            rule_id=20, required_roles=["GG", "DIRECTOR"], priority=100,
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("100"),
        balance_treatment_dominante="GASTO",
    )
    assert matched is not None
    assert len(matched["required_roles"]) == 2


def test_activacion_balance_treatment_excluye_auto() -> None:
    """Una regla auto con balance_treatment='GASTO' NO matchea voucher ACTIVACION."""
    rules = [
        _rule(
            rule_id=10, min_amount=0, max_amount=200_000,
            balance_treatment="GASTO", required_roles=[], priority=50,
        ),
        _rule(
            rule_id=20, required_roles=["GG", "DIRECTOR"], priority=100,
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("100000"),
        balance_treatment_dominante="ACTIVACION",
    )
    # No matchea regla 10 por balance_treatment, cae a regla 20 (default).
    assert matched["rule_id"] == 20


def test_priority_decide_entre_dos_auto_aprobadas() -> None:
    """Si hay 2 reglas auto que matchean, gana la de priority menor (más específica)."""
    rules = [
        _rule(
            rule_id=10, min_amount=0, max_amount=200_000,
            required_roles=[], priority=50,
        ),
        _rule(
            rule_id=11, min_amount=0, max_amount=50_000,
            voucher_tipo="EGRESO", required_roles=[], priority=30,
        ),
        _rule(
            rule_id=20, required_roles=["GG", "DIRECTOR"], priority=100,
        ),
    ]
    matched = find_matching_rule(
        rules,
        voucher_tipo="EGRESO",
        voucher_amount=Decimal("30000"),
        balance_treatment_dominante="GASTO",
    )
    # Ambas (10 y 11) matchean por monto. La 11 es más específica (priority=30).
    assert matched["rule_id"] == 11
