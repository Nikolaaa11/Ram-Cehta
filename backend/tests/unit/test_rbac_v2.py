"""Unit tests para la matriz canónica RBAC tras los scopes V2."""
from __future__ import annotations

import pytest

from app.core.rbac import ROLE_SCOPES, scopes_for

# ---------------------------------------------------------------------------
# Admin: super-set de permisos
# ---------------------------------------------------------------------------


def test_admin_has_user_delete() -> None:
    assert "user:delete" in scopes_for("admin")


def test_admin_has_audit_read() -> None:
    assert "audit:read" in scopes_for("admin")


def test_admin_has_suscripcion_full() -> None:
    s = scopes_for("admin")
    assert {"suscripcion:read", "suscripcion:create", "suscripcion:delete"} <= s


def test_admin_has_oc_update() -> None:
    assert "oc:update" in scopes_for("admin")


def test_admin_has_f29_delete() -> None:
    assert "f29:delete" in scopes_for("admin")


# ---------------------------------------------------------------------------
# Finance: operativo, sin permisos destructivos / administrativos
# ---------------------------------------------------------------------------


def test_finance_does_not_have_user_write() -> None:
    assert "user:write" not in scopes_for("finance")


def test_finance_does_not_have_user_delete() -> None:
    assert "user:delete" not in scopes_for("finance")


def test_finance_does_not_have_audit_read() -> None:
    assert "audit:read" not in scopes_for("finance")


def test_finance_does_not_have_oc_cancel() -> None:
    assert "oc:cancel" not in scopes_for("finance")


def test_finance_does_not_have_f29_delete() -> None:
    assert "f29:delete" not in scopes_for("finance")


def test_finance_does_not_have_suscripcion_delete() -> None:
    assert "suscripcion:delete" not in scopes_for("finance")


def test_finance_can_create_suscripcion() -> None:
    assert "suscripcion:create" in scopes_for("finance")


def test_finance_can_update_oc() -> None:
    assert "oc:update" in scopes_for("finance")


# ---------------------------------------------------------------------------
# Viewer: read-only y sin acceso a auditoría/usuarios (privacy)
# ---------------------------------------------------------------------------


def test_viewer_does_not_have_audit_read() -> None:
    assert "audit:read" not in scopes_for("viewer")


def test_viewer_does_not_have_user_read() -> None:
    assert "user:read" not in scopes_for("viewer")


def test_viewer_can_read_suscripcion() -> None:
    assert "suscripcion:read" in scopes_for("viewer")


def test_viewer_cannot_create_suscripcion() -> None:
    assert "suscripcion:create" not in scopes_for("viewer")


@pytest.mark.parametrize(
    "scope",
    ["oc:create", "oc:update", "f29:create", "f29:update", "f29:delete", "proveedor:create"],
)
def test_viewer_has_no_write_scopes(scope: str) -> None:
    assert scope not in scopes_for("viewer")


# ---------------------------------------------------------------------------
# Estructura general
# ---------------------------------------------------------------------------


def test_unknown_role_returns_empty_frozenset() -> None:
    assert scopes_for("foo") == frozenset()


def test_all_roles_use_frozenset() -> None:
    for role, scopes in ROLE_SCOPES.items():
        assert isinstance(scopes, frozenset), f"{role} no usa frozenset"


def test_admin_is_superset_of_finance_and_viewer() -> None:
    """Invariante: admin contiene todo lo que tiene finance y viewer (excepto
    quizá un par de scopes deliberadamente). Acá comprobamos containment
    completo, lo cual es la política V2."""
    admin = scopes_for("admin")
    assert scopes_for("finance") <= admin
    assert scopes_for("viewer") <= admin
