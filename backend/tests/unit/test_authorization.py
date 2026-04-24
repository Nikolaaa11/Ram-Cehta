from __future__ import annotations

import pytest

from app.core.security import AuthenticatedUser
from app.services.authorization_service import AuthorizationService


def _user(role: str) -> AuthenticatedUser:
    return AuthenticatedUser(sub="u", email=None, app_role=role, raw_claims={})


@pytest.fixture
def svc() -> AuthorizationService:
    return AuthorizationService()


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------


def test_admin_emitida_gets_all_actions(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), "emitida")
    assert set(actions) == {"download_pdf", "approve", "cancel", "mark_paid"}


def test_admin_pagada_gets_download_only(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), "pagada")
    assert actions == ["download_pdf"]


def test_admin_anulada_gets_download_only(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), "anulada")
    assert actions == ["download_pdf"]


# ---------------------------------------------------------------------------
# Finance
# ---------------------------------------------------------------------------


def test_finance_emitida_gets_correct_actions(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("finance"), "emitida")
    assert set(actions) == {"download_pdf", "approve", "mark_paid"}


def test_finance_cannot_cancel(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("finance"), "emitida")
    assert "cancel" not in actions


# ---------------------------------------------------------------------------
# Viewer
# ---------------------------------------------------------------------------


def test_viewer_emitida_gets_download_only(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("viewer"), "emitida")
    assert actions == ["download_pdf"]


def test_viewer_pagada_gets_download_only(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("viewer"), "pagada")
    assert actions == ["download_pdf"]


# ---------------------------------------------------------------------------
# cancel — only available for emitida and parcial
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("estado", ["emitida", "parcial"])
def test_admin_cancel_available_for_emitida_and_parcial(svc: AuthorizationService, estado: str) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), estado)
    assert "cancel" in actions


@pytest.mark.parametrize("estado", ["pagada", "anulada"])
def test_admin_cancel_not_available_for_pagada_or_anulada(svc: AuthorizationService, estado: str) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), estado)
    assert "cancel" not in actions


# ---------------------------------------------------------------------------
# mark_paid — only available for emitida
# ---------------------------------------------------------------------------


def test_admin_mark_paid_available_for_emitida(svc: AuthorizationService) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), "emitida")
    assert "mark_paid" in actions


@pytest.mark.parametrize("estado", ["pagada", "anulada", "parcial"])
def test_admin_mark_paid_not_available_for_non_emitida(svc: AuthorizationService, estado: str) -> None:
    actions = svc.allowed_actions_for_oc(_user("admin"), estado)
    assert "mark_paid" not in actions
