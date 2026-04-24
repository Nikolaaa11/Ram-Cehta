from __future__ import annotations

import pytest
from httpx import AsyncClient

# GET /api/v1/validate/rut
# Response schema (RutValidationResponse):
#   valid: bool
#   formatted: str | None
#   message: str | None
# No authentication required.

VALID_RUT = "77.221.203-8"
INVALID_RUT = "12.345.678-0"


@pytest.mark.integration
async def test_validate_valid_rut(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/validate/rut", params={"rut": VALID_RUT})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["formatted"] == VALID_RUT
    assert data["message"] is None


@pytest.mark.integration
async def test_validate_valid_rut_unformatted_input(test_client: AsyncClient) -> None:
    # Input without dots — still valid, should return canonical form
    response = await test_client.get("/api/v1/validate/rut", params={"rut": "772212038"})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["formatted"] == VALID_RUT


@pytest.mark.integration
async def test_validate_invalid_rut(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/validate/rut", params={"rut": INVALID_RUT})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert data["formatted"] is None


@pytest.mark.integration
async def test_validate_rut_no_auth_required(test_client: AsyncClient) -> None:
    # Must succeed with no Authorization header
    response = await test_client.get("/api/v1/validate/rut", params={"rut": VALID_RUT})
    assert response.status_code == 200


@pytest.mark.integration
async def test_validate_rut_missing_param_returns_422(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/validate/rut")
    assert response.status_code == 422
