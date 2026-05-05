"""Tests unitarios del approval_service (sin DB)."""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.services.approval_service import (
    compute_signature_hash,
    compute_threshold_aplicado,
    find_matching_rule,
)


# Reglas de prueba — espejo del seed default
def _default_rules(empresa: str = "CSL") -> list[dict]:
    return [
        {
            "rule_id": 1,
            "empresa_codigo": empresa,
            "voucher_tipo": None,
            "min_amount": Decimal("0"),
            "max_amount": Decimal("5000000"),
            "balance_treatment": None,
            "required_roles": ["GG"],
            "reinforced": False,
            "priority": 100,
            "descripcion": "Default chico",
        },
        {
            "rule_id": 2,
            "empresa_codigo": empresa,
            "voucher_tipo": None,
            "min_amount": Decimal("5000000"),
            "max_amount": None,
            "balance_treatment": "GASTO",
            "required_roles": ["GG", "COO"],
            "reinforced": True,
            "priority": 50,
            "descripcion": "Reforzado gasto",
        },
        {
            "rule_id": 3,
            "empresa_codigo": empresa,
            "voucher_tipo": None,
            "min_amount": Decimal("20000000"),
            "max_amount": None,
            "balance_treatment": "ACTIVACION",
            "required_roles": ["GG", "DIRECTOR"],
            "reinforced": True,
            "priority": 40,
            "descripcion": "Reforzado activación",
        },
    ]


# ---------------------------------------------------------------------
# find_matching_rule
# ---------------------------------------------------------------------


def test_voucher_chico_match_default():
    """1M CLP gasto → matchea regla 1 (0-5M)."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="EGRESO",
        voucher_amount=Decimal("1000000"),
        balance_treatment_dominante="GASTO",
    )
    assert rule is not None
    assert rule["rule_id"] == 1
    assert rule["required_roles"] == ["GG"]
    assert rule["reinforced"] is False


def test_voucher_mediano_gasto_reforzado():
    """10M CLP gasto → matchea regla 2 (5M+ GASTO reforzado, priority 50)."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="EGRESO",
        voucher_amount=Decimal("10000000"),
        balance_treatment_dominante="GASTO",
    )
    assert rule is not None
    assert rule["rule_id"] == 2
    assert rule["required_roles"] == ["GG", "COO"]
    assert rule["reinforced"] is True


def test_voucher_grande_activacion_reforzado_director():
    """30M CLP activación → matchea regla 3 (20M+ ACTIVACION priority 40)."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="COMPRA",
        voucher_amount=Decimal("30000000"),
        balance_treatment_dominante="ACTIVACION",
    )
    assert rule is not None
    assert rule["rule_id"] == 3
    assert rule["required_roles"] == ["GG", "DIRECTOR"]


def test_voucher_grande_gasto_no_matchea_regla_activacion():
    """30M CLP gasto NO matchea regla 3 (que es ACTIVACION) — matchea regla 2."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="EGRESO",
        voucher_amount=Decimal("30000000"),
        balance_treatment_dominante="GASTO",
    )
    assert rule is not None
    assert rule["rule_id"] == 2  # GG + COO


def test_voucher_balance_na_matchea_regla_sin_treatment():
    """Voucher sin balance_treatment dominante (todas líneas NA) matchea
    solo reglas con balance_treatment=NULL."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="TRASPASO",
        voucher_amount=Decimal("1000000"),
        balance_treatment_dominante=None,
    )
    assert rule is not None
    assert rule["rule_id"] == 1  # default chico (sin treatment)


def test_voucher_grande_traspaso_sin_treatment_no_matchea_regla_2():
    """100M CLP traspaso (treatment=None) NO matchea regla 2 (treatment=GASTO).
    No matchea ninguna en este set → None.
    """
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="TRASPASO",
        voucher_amount=Decimal("100000000"),
        balance_treatment_dominante=None,
    )
    # Regla 1: max 5M → no matchea
    # Regla 2 y 3: requieren treatment → no matchean
    assert rule is None


def test_voucher_zero_matchea_regla_1():
    """Voucher 0 (apertura por ej) matchea regla 1 (min=0)."""
    rule = find_matching_rule(
        _default_rules(),
        voucher_tipo="APERTURA",
        voucher_amount=Decimal("0"),
        balance_treatment_dominante=None,
    )
    assert rule is not None
    assert rule["rule_id"] == 1


def test_voucher_sin_reglas_devuelve_none():
    rule = find_matching_rule(
        [],
        voucher_tipo="EGRESO",
        voucher_amount=Decimal("1000000"),
        balance_treatment_dominante="GASTO",
    )
    assert rule is None


# ---------------------------------------------------------------------
# compute_threshold_aplicado
# ---------------------------------------------------------------------


def test_threshold_sin_regla_es_false():
    assert compute_threshold_aplicado(None) is False


def test_threshold_regla_no_reinforced_es_false():
    rule = {"reinforced": False}
    assert compute_threshold_aplicado(rule) is False


def test_threshold_regla_reinforced_es_true():
    rule = {"reinforced": True}
    assert compute_threshold_aplicado(rule) is True


# ---------------------------------------------------------------------
# compute_signature_hash
# ---------------------------------------------------------------------


def test_signature_hash_es_deterministico():
    """Mismos inputs → mismo hash."""
    ts = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)
    h1 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="abc-123",
        timestamp=ts,
        ip_address="201.214.1.1",
    )
    h2 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="abc-123",
        timestamp=ts,
        ip_address="201.214.1.1",
    )
    assert h1 == h2
    assert len(h1) == 64  # SHA-256 hex


def test_signature_hash_distinto_user_distinto_hash():
    ts = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)
    h1 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="user-A",
        timestamp=ts,
        ip_address=None,
    )
    h2 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="user-B",
        timestamp=ts,
        ip_address=None,
    )
    assert h1 != h2


def test_signature_hash_distinta_ip_distinto_hash():
    ts = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)
    h1 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="user-A",
        timestamp=ts,
        ip_address="201.214.1.1",
    )
    h2 = compute_signature_hash(
        voucher_codigo="CSL-2026-EGR-00001",
        user_id="user-A",
        timestamp=ts,
        ip_address="201.214.1.2",
    )
    assert h1 != h2
