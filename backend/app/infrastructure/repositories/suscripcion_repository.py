"""Repositorio para `core.suscripciones_acciones`."""
from __future__ import annotations

import builtins

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.suscripcion_accion import SuscripcionAccion
from app.schemas.suscripcion import SuscripcionCreate, SuscripcionResumen


class SuscripcionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        empresa_codigo: str | None = None,
        page: int = 1,
        size: int = 20,
    ) -> tuple[builtins.list[SuscripcionAccion], int]:
        q = select(SuscripcionAccion)
        if empresa_codigo:
            q = q.where(SuscripcionAccion.empresa_codigo == empresa_codigo)
        q = q.order_by(SuscripcionAccion.fecha_recibo.desc())

        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (await self._session.scalars(q.offset((page - 1) * size).limit(size))).all()
        )
        return items, total

    async def get(self, suscripcion_id: int) -> SuscripcionAccion | None:
        return await self._session.get(SuscripcionAccion, suscripcion_id)

    async def create(self, data: SuscripcionCreate) -> SuscripcionAccion:
        obj = SuscripcionAccion(**data.model_dump(exclude_none=True))
        self._session.add(obj)
        await self._session.flush()
        await self._session.refresh(obj)
        return obj

    async def totals_by_empresa(self) -> builtins.list[SuscripcionResumen]:
        """Agregado por empresa para reporte a inversionistas."""
        q = (
            select(
                SuscripcionAccion.empresa_codigo,
                func.coalesce(func.sum(SuscripcionAccion.acciones_pagadas), 0).label(
                    "total_acciones"
                ),
                func.coalesce(func.sum(SuscripcionAccion.monto_clp), 0).label("total_clp"),
                func.coalesce(func.sum(SuscripcionAccion.monto_uf), 0).label("total_uf"),
                func.count().label("recibos_count"),
                func.coalesce(
                    func.sum(
                        case((SuscripcionAccion.firmado.is_(True), 1), else_=0)
                    ),
                    0,
                ).label("recibos_firmados"),
            )
            .group_by(SuscripcionAccion.empresa_codigo)
            .order_by(SuscripcionAccion.empresa_codigo)
        )
        rows = (await self._session.execute(q)).all()
        result: list[SuscripcionResumen] = []
        for row in rows:
            result.append(
                SuscripcionResumen(
                    empresa_codigo=row.empresa_codigo,
                    total_acciones=row.total_acciones,
                    total_clp=row.total_clp,
                    total_uf=row.total_uf if row.total_uf else None,
                    recibos_count=int(row.recibos_count or 0),
                    recibos_firmados=int(row.recibos_firmados or 0),
                )
            )
        return result
