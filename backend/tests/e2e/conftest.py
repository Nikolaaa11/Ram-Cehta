"""R152QQQQQ · Configuración de smoke tests E2E contra producción.

Estos tests corren contra la URL real de Fly.io (cehta-backend.fly.dev) y
validan que los endpoints críticos respondan 200 después de cada deploy.

Requisitos para correrlos:
    1. SMOKE_BASE_URL          (default: https://cehta-backend.fly.dev)
    2. SMOKE_ADMIN_JWT          (token JWT válido de un user admin)
    3. SMOKE_TIMEOUT_SECONDS    (default: 10)

Cómo obtener SMOKE_ADMIN_JWT:
    - Abrir https://cehta-capital.vercel.app y loguearse como admin
    - DevTools (F12) → Application → Local Storage
    - Buscar `sb-mowkckwvezudbdcyhwyj-auth-token`
    - Copiar el `access_token` (string que empieza con `eyJ...`)

NUNCA commitear el JWT. Usar env vars o GitHub Secrets.
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session")
def base_url() -> str:
    """URL del backend en producción."""
    return os.environ.get("SMOKE_BASE_URL", "https://cehta-backend.fly.dev").rstrip("/")


@pytest.fixture(scope="session")
def admin_jwt() -> str:
    """JWT de un user admin. Skip si no está seteado."""
    jwt = os.environ.get("SMOKE_ADMIN_JWT", "").strip()
    if not jwt:
        pytest.skip(
            "SMOKE_ADMIN_JWT no seteado — los tests autenticados se saltean. "
            "Para correrlos: export SMOKE_ADMIN_JWT='<jwt-de-admin>'"
        )
    return jwt


@pytest.fixture(scope="session")
def timeout() -> int:
    """Timeout en segundos. Default 10 (suficiente para cold-start Fly)."""
    return int(os.environ.get("SMOKE_TIMEOUT_SECONDS", "10"))


@pytest.fixture(scope="session")
def auth_headers(admin_jwt: str) -> dict:
    """Headers con Authorization Bearer."""
    return {
        "Authorization": f"Bearer {admin_jwt}",
        "Accept": "application/json",
    }
