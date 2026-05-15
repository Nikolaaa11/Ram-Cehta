"""Round 42 — regresión tests: scopes voucher:* en RBAC matrix.

Bug histórico (Round 39): los endpoints /vouchers/{id}/submit, /approve,
/execute y /transferencia-masiva requerían voucher:read|write|execute,
pero estos scopes NUNCA estaban en `ROLE_SCOPES` → 403 universal.

Estos tests evitan que un refactor futuro borre nuevamente alguno.
"""
from __future__ import annotations

import pytest

from app.core.rbac import ROLE_SCOPES, scopes_for


REQUIRED_VOUCHER_SCOPES = ("voucher:read", "voucher:write", "voucher:execute")


def test_admin_tiene_los_3_scopes_voucher() -> None:
    """admin debe poder hacer cualquier operación sobre vouchers."""
    admin = ROLE_SCOPES["admin"]
    for s in REQUIRED_VOUCHER_SCOPES:
        assert s in admin, f"admin no tiene scope crítico {s!r}"


def test_finance_tiene_los_3_scopes_voucher() -> None:
    """finance es el rol operativo (tesorería) — debe ejecutar pagos."""
    fin = ROLE_SCOPES["finance"]
    for s in REQUIRED_VOUCHER_SCOPES:
        assert s in fin, f"finance no tiene scope operativo {s!r}"


def test_viewer_solo_lee_vouchers() -> None:
    """viewer puede leer pero NO escribir ni ejecutar (separation of duties)."""
    v = ROLE_SCOPES["viewer"]
    assert "voucher:read" in v
    assert "voucher:write" not in v
    assert "voucher:execute" not in v


def test_scopes_for_helper_devuelve_voucher_execute_a_admin() -> None:
    """`scopes_for("admin")` debe retornar el frozenset con voucher:execute."""
    assert "voucher:execute" in scopes_for("admin")


@pytest.mark.parametrize("rol_legacy", ["viewer", "finance", "admin"])
def test_ningun_rol_pierde_voucher_read(rol_legacy: str) -> None:
    """voucher:read es un mínimo para todos los roles (ver vouchers en la app)."""
    assert "voucher:read" in scopes_for(rol_legacy)
