"""Repositorio para `core.user_roles` con join a `auth.users` para emails.

Nota: `auth.users` es de Supabase y vive en otro schema; sólo lee email
para mostrar en la UI admin. Las tablas `auth.*` no las modelamos como
SQLAlchemy ORM porque pertenecen a Supabase, así que usamos SQL directo.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.admin_user import UserRoleRead


class UserRoleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_with_emails(self) -> list[UserRoleRead]:
        """JOIN core.user_roles ↔ auth.users para devolver email + rol."""
        result = await self._session.execute(
            text(
                """
                SELECT
                    ur.user_id::text   AS user_id,
                    au.email           AS email,
                    ur.app_role        AS app_role,
                    ur.created_at      AS assigned_at,
                    ur.assigned_by     AS assigned_by
                FROM core.user_roles ur
                LEFT JOIN auth.users au ON au.id = ur.user_id
                ORDER BY ur.created_at ASC
                """
            )
        )
        return [UserRoleRead.model_validate(dict(r)) for r in result.mappings().all()]

    async def get_user_id_by_email(self, email: str) -> str | None:
        result: str | None = await self._session.scalar(
            text("SELECT id::text FROM auth.users WHERE email = :email"),
            {"email": email},
        )
        return result

    async def get_role(self, user_id: str) -> UserRoleRead | None:
        row = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        ur.user_id::text   AS user_id,
                        au.email           AS email,
                        ur.app_role        AS app_role,
                        ur.created_at      AS assigned_at,
                        ur.assigned_by     AS assigned_by
                    FROM core.user_roles ur
                    LEFT JOIN auth.users au ON au.id = ur.user_id
                    WHERE ur.user_id = :uid
                    """
                ),
                {"uid": user_id},
            )
        ).mappings().first()
        return UserRoleRead.model_validate(dict(row)) if row else None

    async def upsert(
        self, user_id: str, app_role: str, assigned_by: str
    ) -> UserRoleRead:
        await self._session.execute(
            text(
                """
                INSERT INTO core.user_roles (user_id, app_role, assigned_by)
                VALUES (:uid, :role, :by)
                ON CONFLICT (user_id) DO UPDATE
                    SET app_role    = EXCLUDED.app_role,
                        assigned_by = EXCLUDED.assigned_by,
                        updated_at  = now()
                """
            ),
            {"uid": user_id, "role": app_role, "by": assigned_by},
        )
        result = await self.get_role(user_id)
        if result is None:  # pragma: no cover — invariant violated
            raise RuntimeError("upsert no devolvió fila")
        return result

    async def delete(self, user_id: str) -> bool:
        result = await self._session.execute(
            text("DELETE FROM core.user_roles WHERE user_id = :uid"),
            {"uid": user_id},
        )
        # CursorResult tiene rowcount; SQLAlchemy 2.x lo expone para DML.
        rowcount: int = getattr(result, "rowcount", 0) or 0
        return rowcount > 0
