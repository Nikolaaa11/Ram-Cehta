"""Repositories para Avance / Gantt (V3 fase 5).

`commit` lo hace el endpoint, acá `flush + refresh` solamente.
Listados y mutaciones siempre filtran por `empresa_codigo` directa o
indirectamente (via proyecto_id).
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.proyecto import Hito, ProyectoEmpresa, Riesgo
from app.schemas.avance import (
    HitoCreate,
    HitoUpdate,
    ProyectoCreate,
    ProyectoUpdate,
    RiesgoCreate,
    RiesgoUpdate,
)


class ProyectoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_empresa(
        self, empresa_codigo: str
    ) -> list[ProyectoEmpresa]:
        q = (
            select(ProyectoEmpresa)
            .where(ProyectoEmpresa.empresa_codigo == empresa_codigo)
            .order_by(ProyectoEmpresa.created_at.desc())
        )
        return list((await self._session.scalars(q)).all())

    async def get(self, proyecto_id: int) -> ProyectoEmpresa | None:
        return await self._session.get(ProyectoEmpresa, proyecto_id)

    async def create(self, data: ProyectoCreate) -> ProyectoEmpresa:
        payload = data.model_dump(exclude_none=True)
        proyecto = ProyectoEmpresa(**payload)
        self._session.add(proyecto)
        await self._session.flush()
        await self._session.refresh(proyecto)
        return proyecto

    async def update(
        self, proyecto: ProyectoEmpresa, data: ProyectoUpdate
    ) -> ProyectoEmpresa:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(proyecto, k, v)
        await self._session.flush()
        await self._session.refresh(proyecto)
        return proyecto

    async def delete(self, proyecto: ProyectoEmpresa) -> None:
        await self._session.delete(proyecto)
        await self._session.flush()


class HitoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_proyecto(self, proyecto_id: int) -> list[Hito]:
        q = (
            select(Hito)
            .where(Hito.proyecto_id == proyecto_id)
            .order_by(Hito.orden, Hito.fecha_planificada)
        )
        return list((await self._session.scalars(q)).all())

    async def get(self, hito_id: int) -> Hito | None:
        return await self._session.get(Hito, hito_id)

    async def create(self, proyecto_id: int, data: HitoCreate) -> Hito:
        payload = data.model_dump(exclude_none=True)
        hito = Hito(proyecto_id=proyecto_id, **payload)
        self._session.add(hito)
        await self._session.flush()
        await self._session.refresh(hito)
        return hito

    async def update(self, hito: Hito, data: HitoUpdate) -> Hito:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(hito, k, v)
        await self._session.flush()
        await self._session.refresh(hito)
        return hito

    async def delete(self, hito: Hito) -> None:
        await self._session.delete(hito)
        await self._session.flush()


class RiesgoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_empresa(
        self, empresa_codigo: str, severidad: str | None = None
    ) -> list[Riesgo]:
        q = select(Riesgo).where(Riesgo.empresa_codigo == empresa_codigo)
        if severidad:
            q = q.where(Riesgo.severidad == severidad)
        q = q.order_by(Riesgo.severidad.desc(), Riesgo.created_at.desc())
        return list((await self._session.scalars(q)).all())

    async def list_for_proyecto(self, proyecto_id: int) -> list[Riesgo]:
        q = (
            select(Riesgo)
            .where(Riesgo.proyecto_id == proyecto_id)
            .order_by(Riesgo.severidad.desc(), Riesgo.created_at.desc())
        )
        return list((await self._session.scalars(q)).all())

    async def count_abiertos_for_proyecto(self, proyecto_id: int) -> int:
        q = (
            select(func.count())
            .select_from(Riesgo)
            .where(Riesgo.proyecto_id == proyecto_id)
            .where(Riesgo.estado == "abierto")
        )
        return await self._session.scalar(q) or 0

    async def get(self, riesgo_id: int) -> Riesgo | None:
        return await self._session.get(Riesgo, riesgo_id)

    async def create(
        self,
        data: RiesgoCreate,
        *,
        empresa_codigo_default: str | None = None,
    ) -> Riesgo:
        payload = data.model_dump(exclude_none=True)
        # Si no vino empresa_codigo, derivarlo del proyecto
        if "empresa_codigo" not in payload and empresa_codigo_default:
            payload["empresa_codigo"] = empresa_codigo_default
        riesgo = Riesgo(**payload)
        self._session.add(riesgo)
        await self._session.flush()
        await self._session.refresh(riesgo)
        return riesgo

    async def update(self, riesgo: Riesgo, data: RiesgoUpdate) -> Riesgo:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(riesgo, k, v)
        await self._session.flush()
        await self._session.refresh(riesgo)
        return riesgo

    async def delete(self, riesgo: Riesgo) -> None:
        await self._session.delete(riesgo)
        await self._session.flush()
