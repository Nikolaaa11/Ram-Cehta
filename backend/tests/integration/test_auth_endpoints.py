from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
async def test_me_admin_returns_correct_role_and_actions(
    test_client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await test_client.get("/api/v1/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["app_role"] == "admin"
    assert "manage_users" in data["allowed_actions"]


@pytest.mark.integration
async def test_me_viewer_returns_correct_role(
    test_client: AsyncClient,
    viewer_headers: dict[str, str],
) -> None:
    response = await test_client.get("/api/v1/auth/me", headers=viewer_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["app_role"] == "viewer"
    assert "manage_users" not in data["allowed_actions"]


@pytest.mark.integration
async def test_me_without_token_returns_401(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.integration
async def test_me_with_malformed_token_returns_401(test_client: AsyncClient) -> None:
    headers = {"Authorization": "Bearer this.is.not.valid"}
    response = await test_client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 401


@pytest.mark.integration
async def test_me_finance_has_create_oc_action(
    test_client: AsyncClient,
    finance_headers: dict[str, str],
) -> None:
    response = await test_client.get("/api/v1/auth/me", headers=finance_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["app_role"] == "finance"
    assert "create_oc" in data["allowed_actions"]
    assert "manage_users" not in data["allowed_actions"]
