"""V5++ ola CB — tests del scope multi-tenant.

Verifica que `EmpresaScope.filter_codes()` y `assert_empresa_access()`
funcionan correctamente para:
- Admin global (sin restricción)
- User scoped (intersect con empresa_codigo del query)
- User sin empresas (resultados vacíos)
- Empresa requested fuera de scope (403)
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import EmpresaScope


def _admin() -> AuthenticatedUser:
    return AuthenticatedUser(
        sub="admin-uuid", email="admin@test", app_role="admin", raw_claims={}
    )


def _scoped(role: str = "director") -> AuthenticatedUser:
    return AuthenticatedUser(
        sub="user-uuid", email="user@test", app_role=role, raw_claims={}
    )


# ----------------------------------------------------------------------------
# is_global / can_access
# ----------------------------------------------------------------------------


def test_admin_is_global() -> None:
    scope = EmpresaScope(user=_admin(), allowed_codes=None)
    assert scope.is_global is True


def test_admin_can_access_any() -> None:
    scope = EmpresaScope(user=_admin(), allowed_codes=None)
    assert scope.can_access("EVOQUE") is True
    assert scope.can_access("CENERGY") is True
    assert scope.can_access("CUALQUIERA") is True


def test_scoped_user_not_global() -> None:
    scope = EmpresaScope(user=_scoped(), allowed_codes=frozenset({"EVOQUE"}))
    assert scope.is_global is False


def test_scoped_user_can_access_only_allowed() -> None:
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"EVOQUE", "RHO"})
    )
    assert scope.can_access("EVOQUE") is True
    assert scope.can_access("RHO") is True
    assert scope.can_access("CENERGY") is False
    assert scope.can_access("DTE") is False


def test_user_without_empresas_can_access_nothing() -> None:
    scope = EmpresaScope(user=_scoped(), allowed_codes=frozenset())
    assert scope.is_global is False
    assert scope.can_access("EVOQUE") is False


# ----------------------------------------------------------------------------
# filter_codes
# ----------------------------------------------------------------------------


def test_admin_no_filter_no_query() -> None:
    """Admin sin filtro de query → None (sin restricción SQL)."""
    scope = EmpresaScope(user=_admin(), allowed_codes=None)
    assert scope.filter_codes(None) is None


def test_admin_with_query_returns_single() -> None:
    """Admin con filtro de query → solo esa empresa."""
    scope = EmpresaScope(user=_admin(), allowed_codes=None)
    assert scope.filter_codes("EVOQUE") == ["EVOQUE"]


def test_scoped_no_query_returns_all_allowed() -> None:
    """Scoped sin filtro de query → sus empresas permitidas (sorted)."""
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"RHO", "EVOQUE", "DTE"})
    )
    assert scope.filter_codes(None) == ["DTE", "EVOQUE", "RHO"]


def test_scoped_with_allowed_query() -> None:
    """Scoped con filtro de empresa permitida → solo esa."""
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"EVOQUE", "RHO"})
    )
    assert scope.filter_codes("EVOQUE") == ["EVOQUE"]


def test_scoped_with_forbidden_query_raises_403() -> None:
    """Scoped con filtro de empresa NO permitida → 403 inmediato."""
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"EVOQUE"})
    )
    with pytest.raises(HTTPException) as excinfo:
        scope.filter_codes("CENERGY")
    assert excinfo.value.status_code == 403
    assert "CENERGY" in excinfo.value.detail


def test_scoped_without_empresas_returns_sentinel() -> None:
    """User scoped sin ninguna empresa → lista con sentinel para que SQL
    devuelva 0 rows."""
    scope = EmpresaScope(user=_scoped(), allowed_codes=frozenset())
    result = scope.filter_codes(None)
    assert result == ["__NO_EMPRESA__"]


def test_scoped_without_empresas_forbidden_query_raises() -> None:
    """User sin empresas + query con empresa → 403 (no tiene CENERGY)."""
    scope = EmpresaScope(user=_scoped(), allowed_codes=frozenset())
    with pytest.raises(HTTPException) as excinfo:
        scope.filter_codes("CENERGY")
    assert excinfo.value.status_code == 403


# ----------------------------------------------------------------------------
# Edge cases
# ----------------------------------------------------------------------------


def test_empty_string_treated_as_no_filter() -> None:
    """Falsy strings ('') deben tratarse como None (sin filtro)."""
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"EVOQUE"})
    )
    # filter_codes('') es falsy → como None → retorna todas
    result = scope.filter_codes("")
    assert result == ["EVOQUE"]


def test_admin_with_empty_string_returns_none() -> None:
    """Admin con '' → None (sin filtro)."""
    scope = EmpresaScope(user=_admin(), allowed_codes=None)
    assert scope.filter_codes("") is None


def test_sorted_output_for_consistency() -> None:
    """Output debe ser sorted para consistency en tests/cache keys."""
    scope = EmpresaScope(
        user=_scoped(), allowed_codes=frozenset({"ZETA", "ALFA", "MIKE"})
    )
    assert scope.filter_codes(None) == ["ALFA", "MIKE", "ZETA"]
