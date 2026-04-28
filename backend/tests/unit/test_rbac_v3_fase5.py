"""Unit tests para los scopes V3 fase 5 (Avance, Calendar, Fondos)."""
from __future__ import annotations

import pytest

from app.core.rbac import scopes_for


@pytest.mark.parametrize(
    "scope",
    [
        "avance:read",
        "avance:create",
        "avance:update",
        "avance:delete",
        "calendar:read",
        "calendar:create",
        "calendar:update",
        "calendar:delete",
        "calendar:admin",
        "fondo:read",
        "fondo:create",
        "fondo:update",
        "fondo:delete",
    ],
)
def test_admin_has_v3_fase5_scopes(scope: str) -> None:
    assert scope in scopes_for("admin")


@pytest.mark.parametrize(
    "scope",
    [
        "avance:read",
        "avance:create",
        "avance:update",
        "calendar:read",
        "calendar:create",
        "calendar:update",
        "fondo:read",
        "fondo:create",
        "fondo:update",
    ],
)
def test_finance_has_v3_fase5_write_except_delete(scope: str) -> None:
    assert scope in scopes_for("finance")


@pytest.mark.parametrize(
    "scope",
    [
        "avance:delete",
        "calendar:delete",
        "calendar:admin",
        "fondo:delete",
    ],
)
def test_finance_no_destructive_v3_fase5(scope: str) -> None:
    assert scope not in scopes_for("finance")


@pytest.mark.parametrize(
    "scope",
    ["avance:read", "calendar:read", "fondo:read"],
)
def test_viewer_can_read_v3_fase5(scope: str) -> None:
    assert scope in scopes_for("viewer")


@pytest.mark.parametrize(
    "scope",
    [
        "avance:create",
        "avance:update",
        "calendar:create",
        "fondo:create",
    ],
)
def test_viewer_no_writes_v3_fase5(scope: str) -> None:
    assert scope not in scopes_for("viewer")
