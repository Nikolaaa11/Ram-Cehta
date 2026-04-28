"""Repository para `core.legal_documents` y `core.v_legal_alerts`.

Patrón consistente con otros repos:
- `commit` lo hace el endpoint, acá sólo `flush + refresh`.
- Listado y lookup siempre filtran por `empresa_codigo` (empresa-scoped).
"""
from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.legal_document import LegalDocument
from app.schemas.legal import LegalDocumentCreate, LegalDocumentUpdate

DROPBOX_ROOT_LEGAL = "/Cehta Capital/01-Empresas"


def _sanitize(value: str) -> str:
    """Sanitiza un fragmento de path Dropbox (mismo patrón que trabajadores)."""
    cleaned = "".join(
        c for c in value if c not in {"/", "\\", "<", ">", ":", '"', "|", "?", "*"}
    )
    return " ".join(cleaned.split()).strip()


def compute_legal_folder(empresa_codigo: str, categoria: str) -> str:
    """`/Cehta Capital/01-Empresas/{codigo}/03-Legal/{categoria_capitalized}/`."""
    cat = _sanitize(categoria.replace("_", " ").title())
    return f"{DROPBOX_ROOT_LEGAL}/{empresa_codigo}/03-Legal/{cat}"


class LegalRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # -----------------------------------------------------------------
    # Listado / lookup
    # -----------------------------------------------------------------

    async def list(
        self,
        empresa_codigo: str | None,
        categoria: str | None,
        estado: str | None,
        search: str | None,
        page: int,
        size: int,
    ) -> tuple[list[LegalDocument], int]:
        q = select(LegalDocument)
        if empresa_codigo:
            q = q.where(LegalDocument.empresa_codigo == empresa_codigo)
        if categoria:
            q = q.where(LegalDocument.categoria == categoria)
        if estado:
            q = q.where(LegalDocument.estado == estado)
        if search:
            like = f"%{search.lower()}%"
            q = q.where(func.lower(LegalDocument.nombre).like(like))
        q = q.order_by(LegalDocument.uploaded_at.desc())

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

    async def get(self, documento_id: int) -> LegalDocument | None:
        return await self._session.get(LegalDocument, documento_id)

    # -----------------------------------------------------------------
    # Mutaciones
    # -----------------------------------------------------------------

    async def create(
        self, data: LegalDocumentCreate, uploaded_by: str | None
    ) -> LegalDocument:
        payload = data.model_dump(exclude_none=True)
        doc = LegalDocument(**payload, uploaded_by=uploaded_by)
        self._session.add(doc)
        await self._session.flush()
        await self._session.refresh(doc)
        return doc

    async def update(
        self, doc: LegalDocument, data: LegalDocumentUpdate
    ) -> LegalDocument:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(doc, k, v)
        await self._session.flush()
        await self._session.refresh(doc)
        return doc

    async def set_dropbox_path(
        self, doc: LegalDocument, dropbox_path: str
    ) -> LegalDocument:
        doc.dropbox_path = dropbox_path
        await self._session.flush()
        await self._session.refresh(doc)
        return doc

    async def soft_delete(self, doc: LegalDocument) -> LegalDocument:
        doc.estado = "cancelado"
        await self._session.flush()
        await self._session.refresh(doc)
        return doc

    # -----------------------------------------------------------------
    # Vista de alertas
    # -----------------------------------------------------------------

    async def alerts(
        self, empresa_codigo: str | None, dias_max: int
    ) -> list[dict]:
        """Devuelve filas de `core.v_legal_alerts` filtradas por empresa.

        `dias_max` filtra por `dias_para_vencer <= dias_max` (incluye vencidos
        si negativos). Default razonable: 90.
        """
        params: dict = {"dias": dias_max}
        where_empresa = ""
        if empresa_codigo:
            where_empresa = "AND empresa_codigo = :empresa"
            params["empresa"] = empresa_codigo
        sql = f"""
            SELECT documento_id, empresa_codigo, categoria, nombre,
                   contraparte, fecha_vigencia_hasta::text,
                   dias_para_vencer, alerta_nivel
            FROM core.v_legal_alerts
            WHERE dias_para_vencer <= :dias
              {where_empresa}
            ORDER BY dias_para_vencer
            LIMIT 200
        """  # noqa: S608 — where_empresa es literal server-side
        rows = (await self._session.execute(text(sql), params)).fetchall()
        return [
            {
                "documento_id": int(r[0]),
                "empresa_codigo": r[1],
                "categoria": r[2],
                "nombre": r[3],
                "contraparte": r[4],
                "fecha_vigencia_hasta": r[5],
                "dias_para_vencer": int(r[6]),
                "alerta_nivel": r[7],
            }
            for r in rows
        ]

    async def list_with_alerts(
        self,
        empresa_codigo: str | None,
        categoria: str | None,
        estado: str | None,
        search: str | None,
        page: int,
        size: int,
    ) -> tuple[list[dict], int]:
        """Listado para la tabla del frontend con `dias_para_vencer` ya calculado.

        Devuelve dicts (no models) — los alimentamos con LEFT JOIN a la vista
        de alertas para evitar N+1 en el frontend.
        """
        params: dict = {
            "limit": size,
            "offset": (page - 1) * size,
        }
        where: list[str] = []
        if empresa_codigo:
            where.append("ld.empresa_codigo = :empresa")
            params["empresa"] = empresa_codigo
        if categoria:
            where.append("ld.categoria = :categoria")
            params["categoria"] = categoria
        if estado:
            where.append("ld.estado = :estado")
            params["estado"] = estado
        if search:
            where.append("LOWER(ld.nombre) LIKE :search")
            params["search"] = f"%{search.lower()}%"
        where_clause = ("WHERE " + " AND ".join(where)) if where else ""

        sql_count = f"""
            SELECT COUNT(*)
            FROM core.legal_documents ld
            {where_clause}
        """  # noqa: S608
        total = (await self._session.execute(text(sql_count), params)).scalar() or 0

        sql_rows = f"""
            SELECT
                ld.documento_id,
                ld.empresa_codigo,
                ld.categoria,
                ld.subcategoria,
                ld.nombre,
                ld.contraparte,
                ld.fecha_vigencia_hasta::text,
                ld.monto,
                ld.moneda,
                ld.estado,
                CASE
                    WHEN ld.fecha_vigencia_hasta IS NULL THEN NULL
                    ELSE (ld.fecha_vigencia_hasta - CURRENT_DATE)
                END AS dias_para_vencer,
                CASE
                    WHEN ld.fecha_vigencia_hasta IS NULL THEN NULL
                    WHEN ld.fecha_vigencia_hasta < CURRENT_DATE THEN 'vencido'
                    WHEN ld.fecha_vigencia_hasta - CURRENT_DATE <= 30 THEN 'critico'
                    WHEN ld.fecha_vigencia_hasta - CURRENT_DATE <= 90 THEN 'proximo'
                    ELSE 'ok'
                END AS alerta_nivel
            FROM core.legal_documents ld
            {where_clause}
            ORDER BY ld.uploaded_at DESC
            LIMIT :limit OFFSET :offset
        """  # noqa: S608

        rows = (await self._session.execute(text(sql_rows), params)).fetchall()
        items = [
            {
                "documento_id": int(r[0]),
                "empresa_codigo": r[1],
                "categoria": r[2],
                "subcategoria": r[3],
                "nombre": r[4],
                "contraparte": r[5],
                "fecha_vigencia_hasta": r[6],
                "monto": r[7],
                "moneda": r[8],
                "estado": r[9],
                "dias_para_vencer": int(r[10]) if r[10] is not None else None,
                "alerta_nivel": r[11],
            }
            for r in rows
        ]
        return items, total
