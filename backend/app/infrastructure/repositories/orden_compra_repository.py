from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orden_compra import OrdenCompra, OrdenCompraDetalle
from app.schemas.orden_compra import OrdenCompraCreate


class OrdenCompraRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        page: int = 1,
        size: int = 20,
        empresa_codigo: str | None = None,
        estado: str | None = None,
    ) -> tuple[list[OrdenCompra], int]:
        q = select(OrdenCompra)
        if empresa_codigo:
            q = q.where(OrdenCompra.empresa_codigo == empresa_codigo)
        if estado:
            q = q.where(OrdenCompra.estado == estado)
        q = q.order_by(OrdenCompra.fecha_emision.desc())

        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (await self._session.scalars(q.offset((page - 1) * size).limit(size))).all()
        )
        return items, total

    async def get(self, oc_id: int) -> OrdenCompra | None:
        return await self._session.get(OrdenCompra, oc_id)

    async def exists_numero_oc(self, empresa_codigo: str, numero_oc: str) -> bool:
        result = await self._session.scalar(
            select(func.count()).where(
                OrdenCompra.empresa_codigo == empresa_codigo,
                OrdenCompra.numero_oc == numero_oc,
            )
        )
        return (result or 0) > 0

    async def create(self, data: OrdenCompraCreate) -> OrdenCompra:
        oc = OrdenCompra(
            numero_oc=data.numero_oc,
            empresa_codigo=data.empresa_codigo,
            proveedor_id=data.proveedor_id,
            fecha_emision=data.fecha_emision,
            validez_dias=data.validez_dias,
            moneda=data.moneda,
            neto=data.neto,
            iva=data.iva_calculado,
            total=data.total_calculado,
            forma_pago=data.forma_pago,
            plazo_pago=data.plazo_pago,
            observaciones=data.observaciones,
        )
        self._session.add(oc)
        await self._session.flush()

        for idx, item_data in enumerate(data.items, start=1):
            detalle = OrdenCompraDetalle(
                oc_id=oc.oc_id,
                item=item_data.item,
                descripcion=item_data.descripcion,
                precio_unitario=item_data.precio_unitario,
                cantidad=item_data.cantidad,
            )
            self._session.add(detalle)

        await self._session.flush()
        await self._session.refresh(oc)
        return oc

    async def update_estado(self, oc: OrdenCompra, nuevo_estado: str) -> OrdenCompra:
        oc.estado = nuevo_estado  # type: ignore[assignment]
        await self._session.flush()
        await self._session.refresh(oc)
        return oc
