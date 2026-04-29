"""Repository para `app.saved_views` (V3 fase 11).

Privacy invariant: TODA query filtra por `user_id`. No exponemos
helpers que escapen ese check. Update / delete / toggle_pin verifican
ownership en el WHERE y devuelven None si la fila no es del usuario.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.saved_view import SavedView


class SavedViewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_user(
        self,
        user_id: str,
        *,
        page: str | None = None,
    ) -> list[SavedView]:
        """Lista las vistas del usuario, opcionalmente filtradas por página.

        Orden: pinned primero (DESC en is_pinned), luego nombre alfabético.
        """
        conditions = [SavedView.user_id == user_id]
        if page is not None:
            conditions.append(SavedView.page == page)

        q = (
            select(SavedView)
            .where(and_(*conditions))
            .order_by(SavedView.is_pinned.desc(), SavedView.name.asc())
        )
        return list((await self._session.scalars(q)).all())

    async def get_for_user(
        self, view_id: str, user_id: str
    ) -> SavedView | None:
        q = select(SavedView).where(
            and_(SavedView.id == view_id, SavedView.user_id == user_id)
        )
        return (await self._session.scalars(q)).first()

    async def create(
        self,
        *,
        user_id: str,
        page: str,
        name: str,
        filters: dict[str, Any] | None = None,
    ) -> SavedView:
        view = SavedView(
            user_id=user_id,
            page=page,
            name=name,
            filters=filters or {},
        )
        self._session.add(view)
        await self._session.flush()
        await self._session.refresh(view)
        return view

    async def update(
        self,
        view_id: str,
        user_id: str,
        *,
        name: str | None = None,
        filters: dict[str, Any] | None = None,
        is_pinned: bool | None = None,
    ) -> SavedView | None:
        """Update parcial. Devuelve None si la vista no es del usuario."""
        view = await self.get_for_user(view_id, user_id)
        if view is None:
            return None
        if name is not None:
            view.name = name
        if filters is not None:
            view.filters = filters
        if is_pinned is not None:
            view.is_pinned = is_pinned
        await self._session.flush()
        await self._session.refresh(view)
        return view

    async def delete(self, view_id: str, user_id: str) -> bool:
        """Elimina si pertenece al usuario. Devuelve True si borró algo."""
        stmt = delete(SavedView).where(
            and_(SavedView.id == view_id, SavedView.user_id == user_id)
        )
        result = await self._session.execute(stmt)
        return int(getattr(result, "rowcount", 0) or 0) > 0

    async def toggle_pin(
        self, view_id: str, user_id: str
    ) -> SavedView | None:
        """Flip is_pinned. Idempotente vía dos calls (true→false→true)."""
        view = await self.get_for_user(view_id, user_id)
        if view is None:
            return None
        view.is_pinned = not view.is_pinned
        await self._session.flush()
        await self._session.refresh(view)
        return view
