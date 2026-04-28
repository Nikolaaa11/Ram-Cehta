"""Repository para `core.fondos` (V3 fase 5)."""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fondo import Fondo
from app.schemas.fondo import FondoCreate, FondoUpdate


class FondoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        tipo: str | None = None,
        estado: str | None = None,
        sector: str | None = None,
        search: str | None = None,
        page: int = 1,
        size: int = 50,
    ) -> tuple[list[Fondo], int]:
        q = select(Fondo)
        if tipo:
            q = q.where(Fondo.tipo == tipo)
        if estado:
            q = q.where(Fondo.estado_outreach == estado)
        if sector:
            q = q.where(Fondo.sectores.any(sector))
        if search:
            like = f"%{search.lower()}%"
            q = q.where(
                or_(
                    func.lower(Fondo.nombre).like(like),
                    func.lower(func.coalesce(Fondo.thesis, "")).like(like),
                    func.lower(func.coalesce(Fondo.descripcion, "")).like(like),
                )
            )
        q = q.order_by(Fondo.created_at.desc())

        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0

        items = list(
            (
                await self._session.scalars(
                    q.offset((page - 1) * size).limit(size)
                )
            ).all()
        )
        return items, total

    async def get(self, fondo_id: int) -> Fondo | None:
        return await self._session.get(Fondo, fondo_id)

    async def find_by_nombre(self, nombre: str) -> Fondo | None:
        q = select(Fondo).where(func.lower(Fondo.nombre) == nombre.lower())
        return (await self._session.scalars(q)).first()

    async def create(self, data: FondoCreate) -> Fondo:
        payload = data.model_dump(exclude_none=True)
        fondo = Fondo(**payload)
        self._session.add(fondo)
        await self._session.flush()
        await self._session.refresh(fondo)
        return fondo

    async def update(self, fondo: Fondo, data: FondoUpdate) -> Fondo:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(fondo, k, v)
        await self._session.flush()
        await self._session.refresh(fondo)
        return fondo

    async def delete(self, fondo: Fondo) -> None:
        await self._session.delete(fondo)
        await self._session.flush()

    async def stats(self) -> tuple[int, dict[str, int], dict[str, int]]:
        total = await self._session.scalar(select(func.count(Fondo.fondo_id))) or 0
        por_tipo_rows = (
            await self._session.execute(
                select(Fondo.tipo, func.count(Fondo.fondo_id)).group_by(Fondo.tipo)
            )
        ).all()
        por_estado_rows = (
            await self._session.execute(
                select(Fondo.estado_outreach, func.count(Fondo.fondo_id)).group_by(
                    Fondo.estado_outreach
                )
            )
        ).all()
        return (
            int(total),
            {row[0]: int(row[1]) for row in por_tipo_rows},
            {row[0]: int(row[1]) for row in por_estado_rows},
        )
