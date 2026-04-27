"""Repository para `core.integrations` — tokens OAuth (Dropbox, etc.).

Single-tenant en V3: `get_by_provider` devuelve la única integración activa
del proveedor (la cuenta corporativa de Cehta). El `upsert` está pensado
para ser llamado desde el callback OAuth tras el intercambio
`code → access_token + refresh_token`.

Nota: el flush + commit lo orquesta el endpoint que invoca al repo
(consistente con el resto de repos del proyecto).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration


class IntegrationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_provider(self, provider: str) -> Integration | None:
        """Devuelve la integración activa para el provider (single-tenant)."""
        result = await self._session.scalars(
            select(Integration).where(Integration.provider == provider).limit(1)
        )
        return result.first()

    async def upsert(
        self,
        provider: str,
        access_token: str,
        refresh_token: str | None,
        account_info: dict[str, Any] | None,
        scopes: list[str] | None,
    ) -> Integration:
        existing = await self.get_by_provider(provider)
        if existing is not None:
            existing.access_token = access_token
            if refresh_token:  # Dropbox no siempre re-emite refresh_token
                existing.refresh_token = refresh_token
            existing.account_info = account_info
            existing.scopes = scopes
            await self._session.flush()
            await self._session.refresh(existing)
            return existing

        new = Integration(
            provider=provider,
            access_token=access_token,
            refresh_token=refresh_token,
            account_info=account_info,
            scopes=scopes,
        )
        self._session.add(new)
        await self._session.flush()
        await self._session.refresh(new)
        return new

    async def delete_by_provider(self, provider: str) -> bool:
        existing = await self.get_by_provider(provider)
        if existing is None:
            return False
        await self._session.delete(existing)
        await self._session.flush()
        return True
