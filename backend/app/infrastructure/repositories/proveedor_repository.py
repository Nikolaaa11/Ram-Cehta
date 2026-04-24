from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.proveedor import Proveedor
from app.schemas.proveedor import ProveedorCreate, ProveedorUpdate


class ProveedorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        page: int = 1,
        size: int = 20,
        search: str | None = None,
    ) -> tuple[list[Proveedor], int]:
        q = select(Proveedor).where(Proveedor.activo.is_(True))
        if search:
            pattern = f"%{search}%"
            q = q.where(
                or_(
                    Proveedor.razon_social.ilike(pattern),
                    Proveedor.rut.ilike(pattern),
                )
            )
        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (await self._session.scalars(q.offset((page - 1) * size).limit(size))).all()
        )
        return items, total

    async def get(self, proveedor_id: int) -> Proveedor | None:
        return await self._session.get(Proveedor, proveedor_id)

    async def get_by_rut(self, rut: str) -> Proveedor | None:
        result = await self._session.scalars(
            select(Proveedor).where(Proveedor.rut == rut)
        )
        return result.first()

    async def create(self, data: ProveedorCreate) -> Proveedor:
        proveedor = Proveedor(**data.model_dump(exclude_none=True))
        self._session.add(proveedor)
        await self._session.flush()
        await self._session.refresh(proveedor)
        return proveedor

    async def update(self, proveedor: Proveedor, data: ProveedorUpdate) -> Proveedor:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(proveedor, k, v)
        await self._session.flush()
        await self._session.refresh(proveedor)
        return proveedor

    async def soft_delete(self, proveedor: Proveedor) -> None:
        proveedor.activo = False  # type: ignore[assignment]
        await self._session.flush()
