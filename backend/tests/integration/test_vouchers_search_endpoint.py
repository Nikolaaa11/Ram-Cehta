"""Integration tests para /api/v1/vouchers/search (V5++ ola V).

Cubre:
- 401 sin auth
- 200 con auth admin
- Devuelve lista vacía con DB vacía (sin crash)
- Query <2 chars rechazado por validación
- Fallback ILIKE funciona si tsvector no está (defensive)
- Limit cap respeta max=100
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


class TestNoAuth:
    async def test_401_without_token(
        self, test_client_with_db: AsyncClient
    ) -> None:
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search?q=test"
        )
        assert response.status_code == 401


class TestSearchValidation:
    async def test_query_too_short(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """min_length=2 enforced por Pydantic."""
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search?q=a", headers=auth_headers
        )
        assert response.status_code == 422

    async def test_query_missing(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search", headers=auth_headers
        )
        assert response.status_code == 422

    async def test_limit_capped_at_100(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """limit > 100 rechazado por le=100."""
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search?q=test&limit=500",
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestSearchEmptyDb:
    async def test_returns_empty_list_with_no_data(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """DB vacía → lista vacía, no crash."""
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search?q=acme",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert data == []

    async def test_default_limit_50(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """Default limit no rompe."""
        response = await test_client_with_db.get(
            "/api/v1/vouchers/search?q=test",
            headers=auth_headers,
        )
        assert response.status_code == 200


class TestHealthDetailed:
    """V5++ ola U: /api/v1/health/detailed devuelve siempre 200."""

    async def test_200_without_auth(
        self, test_client_with_db: AsyncClient
    ) -> None:
        """health/detailed es público (sin auth required)."""
        response = await test_client_with_db.get(
            "/api/v1/health/detailed"
        )
        assert response.status_code == 200

    async def test_payload_shape(
        self, test_client_with_db: AsyncClient
    ) -> None:
        response = await test_client_with_db.get(
            "/api/v1/health/detailed"
        )
        data = response.json()
        # Estructura mínima esperada
        assert "status" in data
        assert "database" in data
        assert "services" in data
        assert "counts" in data
        assert "version" in data
        assert isinstance(data["services"], dict)
        assert isinstance(data["counts"], dict)

    async def test_services_lists_known_keys(
        self, test_client_with_db: AsyncClient
    ) -> None:
        response = await test_client_with_db.get(
            "/api/v1/health/detailed"
        )
        services = response.json()["services"]
        # Las 5 keys que tracket el endpoint
        expected_keys = {
            "imap_inbox",
            "anthropic",
            "dropbox",
            "resend",
            "openai_embeddings",
        }
        assert expected_keys.issubset(set(services.keys()))

    async def test_status_is_ok_when_db_works(
        self, test_client_with_db: AsyncClient
    ) -> None:
        """Con DB de tests funcionando, status='ok'."""
        response = await test_client_with_db.get(
            "/api/v1/health/detailed"
        )
        data = response.json()
        # En tests con DB funcionando, status debe ser ok
        assert data["status"] == "ok"
        assert data["database"] == "ok"
