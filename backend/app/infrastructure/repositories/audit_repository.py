"""Repositorio read-only para `audit.etl_runs` y `audit.rejected_rows`.

Por contrato, este módulo NO expone create/update/delete: la trazabilidad
ETL es inmutable desde la app. Sólo el job ETL escribe en estas tablas.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.etl_run import EtlRun
from app.models.rejected_row import RejectedRow


class AuditRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_etl_runs(
        self,
        status: str | None = None,
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[EtlRun], int]:
        q = select(EtlRun)
        if status:
            q = q.where(EtlRun.status == status)
        q = q.order_by(EtlRun.started_at.desc())

        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (await self._session.scalars(q.offset((page - 1) * size).limit(size))).all()
        )
        return items, total

    async def get_etl_run(self, run_id: str) -> EtlRun | None:
        return await self._session.get(EtlRun, run_id)

    async def list_rejected_rows(
        self,
        run_id: str,
        page: int = 1,
        size: int = 50,
    ) -> tuple[list[RejectedRow], int]:
        q = (
            select(RejectedRow)
            .where(RejectedRow.run_id == run_id)
            .order_by(RejectedRow.rejected_id.asc())
        )
        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (await self._session.scalars(q.offset((page - 1) * size).limit(size))).all()
        )
        return items, total

    async def latest_run_id(self) -> str | None:
        q = select(EtlRun.run_id).order_by(EtlRun.started_at.desc()).limit(1)
        result: str | None = await self._session.scalar(q)
        return result
