from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.main import app

SECRET = "test-secret"
ISSUER = "https://example.supabase.co/auth/v1"


def make_token(sub: str = "test-uid", role: str = "admin", secret: str = SECRET) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "email": f"{sub}@test.cl",
        "app_role": role,
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest_asyncio.fixture
async def test_client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    token = make_token(sub="admin-uid", role="admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def finance_headers() -> dict[str, str]:
    token = make_token(sub="finance-uid", role="finance")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_headers() -> dict[str, str]:
    token = make_token(sub="viewer-uid", role="viewer")
    return {"Authorization": f"Bearer {token}"}
