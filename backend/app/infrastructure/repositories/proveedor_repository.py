from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.value_objects.rut import format_rut, validate_rut
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
        """Busca proveedor por RUT, normalizando el input al formato canonico.

        Acepta cualquier formato de entrada ('76.123.456-7', '761234567',
        '76123456-7') y busca por la forma canonica '76.123.456-7' que es
        como ProveedorCreate normaliza al insertar. Si el RUT es invalido
        (checksum), devuelve None sin lanzar.
        """
        if not rut or not validate_rut(rut):
            return None
        canonical = format_rut(rut)
        result = await self._session.scalars(
            select(Proveedor).where(Proveedor.rut == canonical)
        )
        return result.first()

    async def quick_search(
        self, q: str, limit: int = 10
    ) -> list[Proveedor]:
        """Busqueda rapida para autocompletado: matchea RUT o razon_social.

        Si `q` parsea como RUT valido, busca prioridad alta por RUT canonical.
        En paralelo, hace ILIKE sobre razon_social. Devuelve hasta `limit`
        resultados, sin paginacion, ordenados por: match exacto RUT primero,
        luego razon_social alfabetica.

        Activos solamente.
        """
        if not q or len(q.strip()) < 2:
            return []
        cleaned = q.strip()
        pattern = f"%{cleaned}%"
        clauses = [Proveedor.razon_social.ilike(pattern)]
        if validate_rut(cleaned):
            canonical = format_rut(cleaned)
            clauses.append(Proveedor.rut == canonical)
        else:
            # RUT no valido pero quizas el user esta tipeando un fragmento
            clauses.append(Proveedor.rut.ilike(pattern))
        stmt = (
            select(Proveedor)
            .where(Proveedor.activo.is_(True))
            .where(or_(*clauses))
            .order_by(Proveedor.razon_social)
            .limit(limit)
        )
        return list((await self._session.scalars(stmt)).all())

    async def counts_by_proveedor(
        self, proveedor_ids: list[int]
    ) -> dict[int, dict[str, int]]:
        """Cuenta vouchers (por contraparte_rut) y OCs (por proveedor_id)
        asociados a cada proveedor en la lista.

        Devuelve `{proveedor_id: {"vouchers": N, "ordenes_compra": M}}`.

        Notas:
        - Vouchers se vinculan por `contraparte_rut` (string), no por FK.
        - OCs se vinculan por `proveedor_id` (FK).
        - Si la lista esta vacia, devuelve dict vacio sin tocar la DB.
        """
        if not proveedor_ids:
            return {}
        # Para vouchers necesitamos los RUTs canonicos de los proveedores
        provs = (
            await self._session.scalars(
                select(Proveedor).where(Proveedor.proveedor_id.in_(proveedor_ids))
            )
        ).all()
        rut_to_id = {p.rut: p.proveedor_id for p in provs if p.rut}
        result: dict[int, dict[str, int]] = {
            p.proveedor_id: {"vouchers": 0, "ordenes_compra": 0} for p in provs
        }

        from sqlalchemy import text

        if rut_to_id:
            rows = (
                await self._session.execute(
                    text(
                        """
                        SELECT contraparte_rut, COUNT(*) AS n
                        FROM core.vouchers
                        WHERE contraparte_rut = ANY(CAST(:ruts AS text[]))
                        GROUP BY contraparte_rut
                        """
                    ),
                    {"ruts": list(rut_to_id.keys())},
                )
            ).all()
            for rut, n in rows:
                pid = rut_to_id.get(rut)
                if pid is not None:
                    result[pid]["vouchers"] = int(n)

        rows_oc = (
            await self._session.execute(
                text(
                    """
                    SELECT proveedor_id, COUNT(*) AS n
                    FROM core.ordenes_compra
                    WHERE proveedor_id = ANY(CAST(:ids AS int[]))
                    GROUP BY proveedor_id
                    """
                ),
                {"ids": proveedor_ids},
            )
        ).all()
        for pid, n in rows_oc:
            if pid in result:
                result[pid]["ordenes_compra"] = int(n)

        return result

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
