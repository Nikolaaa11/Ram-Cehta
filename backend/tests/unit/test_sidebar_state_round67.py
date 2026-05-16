"""Unit tests Round 67 — _count_voucher_approved_ready_to_pay + sidebar state.

Tests del helper que cuenta vouchers APPROVED filtrados por scope del user
para el badge del sidebar /validacion. Mockean el DB scalar() para evitar
dependencia de Postgres real (eso queda para integration tests).

También valida que el endpoint /me/sidebar-state incluye el nuevo campo
en su response model.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.api.v1.me_preferences import (
    SidebarStateResponse,
    _count_voucher_approved_ready_to_pay,
)


@pytest.mark.asyncio
async def test_count_devuelve_int_desde_db_scalar() -> None:
    """Happy path: el helper hace db.scalar(text(...)) y castea a int."""
    db = AsyncMock()
    db.scalar = AsyncMock(return_value=7)
    result = await _count_voucher_approved_ready_to_pay(
        db, user_id="b4307866-f9c9-4230-aad6-41b61d07a830"
    )
    assert result == 7
    # Verificamos que se llamó al scalar() exactamente 1 vez
    assert db.scalar.await_count == 1


@pytest.mark.asyncio
async def test_count_devuelve_cero_si_scalar_returns_none() -> None:
    """Edge case: si el query no devuelve filas (improbable con COUNT(*))."""
    db = AsyncMock()
    db.scalar = AsyncMock(return_value=None)
    result = await _count_voucher_approved_ready_to_pay(
        db, user_id="b4307866-f9c9-4230-aad6-41b61d07a830"
    )
    assert result == 0


@pytest.mark.asyncio
async def test_count_soft_fail_devuelve_cero_si_db_falla() -> None:
    """Soft-fail: si la tabla no existe (entorno antiguo), devuelve 0
    sin propagar excepción — pattern consistente con los otros helpers."""
    db = AsyncMock()
    db.scalar = AsyncMock(side_effect=Exception("simulated DB error"))
    result = await _count_voucher_approved_ready_to_pay(
        db, user_id="b4307866-f9c9-4230-aad6-41b61d07a830"
    )
    assert result == 0


def test_sidebar_response_incluye_campo_round67() -> None:
    """El modelo Pydantic SidebarStateResponse debe tener el campo nuevo
    con default=0 (para que clientes legacy no rompan al deserializar)."""
    resp = SidebarStateResponse(
        unread_notifications=0,
        critical_obligations=0,
        critical_entregables=0,
        mailbox_pending=0,
    )
    # El campo nuevo existe y tiene default 0
    assert hasattr(resp, "voucher_approved_ready_to_pay")
    assert resp.voucher_approved_ready_to_pay == 0


def test_sidebar_response_acepta_valor_custom() -> None:
    """Cuando viene un valor concreto, se preserva."""
    resp = SidebarStateResponse(
        unread_notifications=0,
        critical_obligations=0,
        critical_entregables=0,
        mailbox_pending=0,
        voucher_approved_ready_to_pay=42,
    )
    assert resp.voucher_approved_ready_to_pay == 42


def test_sidebar_response_serializa_campo_en_json() -> None:
    """El campo aparece en el JSON output (no es field hidden)."""
    resp = SidebarStateResponse(
        unread_notifications=0,
        critical_obligations=0,
        critical_entregables=0,
        mailbox_pending=0,
        voucher_approved_ready_to_pay=5,
    )
    data = resp.model_dump()
    assert "voucher_approved_ready_to_pay" in data
    assert data["voucher_approved_ready_to_pay"] == 5
