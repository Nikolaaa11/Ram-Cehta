"""Integration tests para `/api/v1/admin/users`.

Estos tests requieren `auth.users` (Supabase). En el entorno de tests:
- Si la tabla `auth.users` no existe (DB local sin Supabase), skipeamos los
  tests que dependen de email lookup.
- Mantenemos los tests de RBAC violations, que sólo verifican el 401/403/400
  sin tocar `auth.users`.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.integration


async def _has_auth_users(session: AsyncSession) -> bool:
    res = await session.execute(
        text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'auth' AND table_name = 'users'"
        )
    )
    return res.first() is not None


@pytest_asyncio.fixture
async def seeded_user(db_session: AsyncSession) -> dict[str, str]:
    """Inserta un usuario directamente en core.user_roles (sin auth.users
    para no depender de Supabase). Devuelve user_id + email pseudo."""
    if not await _has_auth_users(db_session):
        pytest.skip("auth.users no disponible en esta DB")
    uid = str(uuid.uuid4())
    email = f"u{uid[:8]}@test.cl"
    # Algunos schemas de auth.users tienen muchas columnas obligatorias.
    # Insertamos sólo (id, email) y dejamos defaults para el resto;
    # si el schema lo rechaza, skipeamos.
    try:
        await db_session.execute(
            text(
                "INSERT INTO auth.users (id, email) VALUES (:uid, :email)"
            ),
            {"uid": uid, "email": email},
        )
    except Exception:
        pytest.skip("auth.users requiere columnas adicionales que no podemos cumplir en test")
    await db_session.execute(
        text(
            "INSERT INTO core.user_roles (user_id, app_role, assigned_by) "
            "VALUES (:uid, 'viewer', 'fixture')"
        ),
        {"uid": uid},
    )
    return {"user_id": uid, "email": email}


# ---------- GET /admin/users ----------
async def test_list_users_with_admin_returns_200(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/admin/users", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


async def test_list_users_with_finance_returns_403(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/admin/users", headers=finance_headers
    )
    assert r.status_code == 403


async def test_list_users_with_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/admin/users", headers=viewer_headers
    )
    assert r.status_code == 403


async def test_admin_users_unauthenticated(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/admin/users")
    assert r.status_code == 401


# ---------- POST /admin/users ----------
async def test_assign_user_unknown_email_returns_404(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/admin/users",
        json={"email": "nadie@ningun-lugar.cl", "app_role": "viewer"},
        headers=auth_headers,
    )
    # Esperamos 404 (email no existe en auth.users) — funciona aunque
    # auth.users esté vacía o no exista (en cuyo caso el SELECT devuelve None).
    assert r.status_code == 404


async def test_assign_user_invalid_role_returns_422(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/admin/users",
        json={"email": "x@y.cl", "app_role": "superuser"},
        headers=auth_headers,
    )
    assert r.status_code == 422


async def test_assign_user_with_finance_returns_403(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/admin/users",
        json={"email": "x@y.cl", "app_role": "viewer"},
        headers=finance_headers,
    )
    assert r.status_code == 403


async def test_assign_user_existing_email_upserts(
    test_client_with_db: AsyncClient,
    seeded_user: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/admin/users",
        json={"email": seeded_user["email"], "app_role": "finance"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user_id"] == seeded_user["user_id"]
    assert body["app_role"] == "finance"


# ---------- PATCH /admin/users/{id}/role ----------
async def test_update_role_with_admin(
    test_client_with_db: AsyncClient,
    seeded_user: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    uid = seeded_user["user_id"]
    r = await test_client_with_db.patch(
        f"/api/v1/admin/users/{uid}/role",
        json={"app_role": "admin"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["app_role"] == "admin"


async def test_update_role_unknown_user_returns_404(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    fake_uid = str(uuid.uuid4())
    r = await test_client_with_db.patch(
        f"/api/v1/admin/users/{fake_uid}/role",
        json={"app_role": "viewer"},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_update_role_with_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    fake_uid = str(uuid.uuid4())
    r = await test_client_with_db.patch(
        f"/api/v1/admin/users/{fake_uid}/role",
        json={"app_role": "viewer"},
        headers=viewer_headers,
    )
    assert r.status_code == 403


# ---------- DELETE /admin/users/{id} ----------
async def test_delete_user_with_admin(
    test_client_with_db: AsyncClient,
    seeded_user: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.delete(
        f"/api/v1/admin/users/{seeded_user['user_id']}", headers=auth_headers
    )
    assert r.status_code == 204


async def test_delete_user_self_returns_400(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """`auth_headers` usa sub='admin-uid'. No puede borrarse a sí mismo."""
    r = await test_client_with_db.delete(
        "/api/v1/admin/users/admin-uid", headers=auth_headers
    )
    assert r.status_code == 400


async def test_delete_user_with_finance_returns_403(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    fake_uid = str(uuid.uuid4())
    r = await test_client_with_db.delete(
        f"/api/v1/admin/users/{fake_uid}", headers=finance_headers
    )
    assert r.status_code == 403


async def test_delete_user_not_found(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    fake_uid = str(uuid.uuid4())
    r = await test_client_with_db.delete(
        f"/api/v1/admin/users/{fake_uid}", headers=auth_headers
    )
    assert r.status_code == 404
