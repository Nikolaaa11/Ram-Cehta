from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orden_compra import OrdenCompra, OrdenCompraDetalle
from app.schemas.orden_compra import OrdenCompraCreate, OrdenCompraUpdate

# Columnas NOT NULL con default en la BD: un `null` explícito en el PATCH no
# significa "borrar" sino "no tocar". Mandarlo igual dispara un
# NotNullViolation que le llega al operador como un 500 sin explicación.
_NO_NULEABLES = frozenset(
    {
        "tipo_documento",
        "iva_porcentaje",
        "retencion_porcentaje",
        "validez_dias",
    }
)


class OrdenCompraRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        page: int = 1,
        size: int = 20,
        empresa_codigo: str | None = None,
        estado: str | None = None,
        empresa_codigos_in: list[str] | None = None,
    ) -> tuple[list[OrdenCompra], int]:
        """V5++ ola AD: `empresa_codigos_in` permite filtrar por una lista
        (multi-tenant scope). Si se pasa junto con empresa_codigo, gana
        empresa_codigo (más restrictivo)."""
        q = select(OrdenCompra)
        if empresa_codigo:
            q = q.where(OrdenCompra.empresa_codigo == empresa_codigo)
        elif empresa_codigos_in is not None:
            q = q.where(OrdenCompra.empresa_codigo.in_(empresa_codigos_in))
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

    async def create(
        self, data: OrdenCompraCreate, derived: dict | None = None
    ) -> OrdenCompra:
        """Alta de la OC con sus ítems.

        `derived` son los montos que el endpoint ya calculó server-side: iva,
        total, retencion_monto, total_a_pagar y las tasas ya pisadas según el
        tipo de documento (ver `_derivar_totales_oc` en
        `api/v1/ordenes_compra.py`). Es el camino normal — la aritmética vive
        en una sola función y el repositorio sólo persiste.

        Si no viene (llamador viejo), se cae a las propiedades del schema, que
        sólo saben de FACTURA/BOLETA: IVA sobre el neto, sin retención y el
        líquido igual al total. Las tres columnas nuevas se escriben SIEMPRE:
        `total_a_pagar` es NOT NULL en la BD y omitirla revienta el INSERT.
        """
        d = derived or {}

        def _der(clave: str, por_defecto: Decimal) -> Decimal:
            # `is not None`, nunca `or`: un IVA de 0 (exenta, honorarios) o una
            # retención de 0 son valores legítimos, y `or` los reemplazaría por
            # el default — la trampa del cero falso que ya se cometió en esta
            # misma tabla.
            valor = d.get(clave)
            return valor if valor is not None else por_defecto

        total = _der("total", data.total_calculado)
        oc = OrdenCompra(
            numero_oc=data.numero_oc,
            empresa_codigo=data.empresa_codigo,
            proveedor_id=data.proveedor_id,
            fecha_emision=data.fecha_emision,
            validez_dias=data.validez_dias,
            moneda=data.moneda,
            # `neto` sale del derived cuando el endpoint lo derivó: en CLP
            # viene redondeado a peso entero, y ese es el valor que tiene que
            # quedar en la fila para que `total = neto + iva` cierre en BD.
            neto=_der("neto", data.neto),
            iva=_der("iva", data.iva_calculado),
            total=total,
            forma_pago=data.forma_pago,
            plazo_pago=data.plazo_pago,
            plazo_entrega=data.plazo_entrega,
            observaciones=data.observaciones,
            proveedor_contacto_id=data.proveedor_contacto_id,
            atte_nombre=data.atte_nombre,
            atte_cargo=data.atte_cargo,
            tipo_documento=data.tipo_documento,
            iva_porcentaje=_der("iva_porcentaje", data.iva_porcentaje),
            retencion_porcentaje=_der("retencion_porcentaje", Decimal("0")),
            retencion_monto=_der("retencion_monto", Decimal("0")),
            # Sin retención el líquido ES el total — así una OC creada por un
            # llamador que no derivó nada queda igual a como estaba antes de
            # este cambio, no en NULL.
            total_a_pagar=_der("total_a_pagar", total),
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

    async def update_fields(
        self,
        oc: OrdenCompra,
        data: OrdenCompraUpdate,
        derived: dict | None = None,
    ) -> OrdenCompra:
        """Edita sólo campos no-críticos. Validación de estado en el endpoint.

        `derived` son columnas que el endpoint calculó server-side — iva,
        total, retencion_monto, total_a_pagar y las tasas ya pisadas según el
        tipo de documento. No vienen del schema porque el schema no permite
        mandarlas directo (son derivadas, no editables).

        El orden importa: primero lo que mandó el cliente, después lo
        derivado. Si el body trae `iva_porcentaje: 19` y `tipo_documento:
        HONORARIOS`, el 19 se escribe y el derivado lo pisa con 0 — que es
        exactamente la regla de §4.3 (pisar, no rechazar).
        """
        for k, v in data.model_dump(exclude_unset=True).items():
            if v is None and k in _NO_NULEABLES:
                continue
            setattr(oc, k, v)
        for k, v in (derived or {}).items():
            setattr(oc, k, v)
        await self._session.flush()
        await self._session.refresh(oc)
        return oc
