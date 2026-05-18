"""Endpoints CRUD de vouchers (V5).

Cubre:
  GET    /vouchers                 — list filtrable
  GET    /vouchers/{id}            — detalle con líneas
  POST   /vouchers                 — crear DRAFT con líneas en una transacción
  PATCH  /vouchers/{id}            — editar mientras DRAFT
  POST   /vouchers/{id}/submit     — DRAFT → PENDING (valida partida doble + adjuntos COMPRA/VENTA)
  POST   /vouchers/{id}/void       — anula con razón obligatoria
  DELETE /vouchers/{id}            — solo permitido si DRAFT

  GET    /vouchers/{id}/attachments        — lista adjuntos
  POST   /vouchers/{id}/attachments        — sube adjunto a Dropbox + persiste
  GET    /vouchers/{id}/attachments/{att}/url — URL temporal Dropbox (4h)
  DELETE /vouchers/{id}/attachments/{att}   — borra adjunto (DROPBOX + DB), solo DRAFT/PENDING

  GET    /vouchers/{id}/approvals          — lista firmas + estado del flujo
  POST   /vouchers/{id}/approve            — firma propia (rol activo en empresa)
  POST   /vouchers/{id}/reject             — rechaza con razón obligatoria

Lo que NO está acá (Fase 3+):
  POST /vouchers/{id}/execute      — marcar EXECUTED post pago bancario
  POST /vouchers/{id}/sync-nubox   — push a Nubox (Fase 3)
"""
from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from fastapi import Request

from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.services.approval_service import (
    compute_threshold_aplicado,
    find_matching_rule,
    get_voucher_approvals,
    get_voucher_balance_treatment_dominante,
    load_active_rules,
    load_user_roles_for_empresa,
    record_approval_signature,
)
from app.services.audit_service import audit_log
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.limiter import limiter
from app.core.security import AuthenticatedUser
from app.models.voucher import (
    Voucher,
    VoucherApproval,  # noqa: F401 — modelo registrado para metadata
    VoucherAttachment,  # noqa: F401
    VoucherLine,
)
from app.schemas.voucher import (
    BulkPdfRequest,
    VoucherCreate,
    VoucherListItem,
    VoucherRead,
    VoucherStatus,
    VoucherTipo,
    VoucherUpdate,
)
from app.services.voucher_service import (
    fetch_cuenta_metadata,
    fetch_proyecto_metadata,
    generate_voucher_code,
    is_area_aplica_a_empresa,
    is_cuenta_habilitada_para_empresa,
    is_period_locked_for,
    validate_corfo_eligibility,
)

router = APIRouter()


_VoucherScope = Literal["voucher:read", "voucher:write"]


# =====================================================================
# GET /vouchers — list
# =====================================================================


@router.get("/vouchers/search", response_model=list[VoucherListItem])
async def search_vouchers(
    user: CurrentUser,
    db: DBSession,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[VoucherListItem]:
    """Búsqueda full-text en vouchers usando Postgres tsvector + GIN.

    V5++ ola V: 10-100x más rápido que ILIKE para datasets grandes.
    Soporta stemming español ('proveedor' matchea 'provee').

    Ranking: codigo (peso A) > contraparte_rut (A) > contraparte_nombre (B)
             > doc_tributario_folio (B) > glosa (C). Ordenado por ts_rank desc.

    Si la migration 0046 no se aplicó todavía, fallback a ILIKE estándar.
    """
    # Construir tsquery seguro — websearch_to_tsquery acepta sintaxis natural
    # del usuario sin riesgo de inyección (Postgres parsea + sanitiza).
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT
                        voucher_id, codigo, empresa_codigo, tipo, status,
                        fecha_contable, glosa, total_debit, total_credit,
                        moneda, contraparte_nombre, threshold_aplicado,
                        created_at,
                        ts_rank(search_tsv, websearch_to_tsquery('spanish', :q)) AS rank
                    FROM core.vouchers
                    WHERE search_tsv @@ websearch_to_tsquery('spanish', :q)
                    ORDER BY rank DESC, fecha_contable DESC
                    LIMIT :lim
                    """
                ),
                {"q": q, "lim": limit},
            )
        ).mappings().all()
    except Exception:
        # Fallback ILIKE si search_tsv no existe (migration 0046 pending)
        await db.rollback()
        pattern = f"%{q}%"
        rows = (
            await db.execute(
                text(
                    """
                    SELECT
                        voucher_id, codigo, empresa_codigo, tipo, status,
                        fecha_contable, glosa, total_debit, total_credit,
                        moneda, contraparte_nombre, threshold_aplicado,
                        created_at
                    FROM core.vouchers
                    WHERE codigo ILIKE :p
                       OR glosa ILIKE :p
                       OR contraparte_nombre ILIKE :p
                       OR contraparte_rut ILIKE :p
                       OR doc_tributario_folio ILIKE :p
                    ORDER BY fecha_contable DESC
                    LIMIT :lim
                    """
                ),
                {"p": pattern, "lim": limit},
            )
        ).mappings().all()

    return [VoucherListItem.model_validate(dict(r)) for r in rows]


@router.get("/vouchers", response_model=list[VoucherListItem])
async def list_vouchers(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    empresa_codigo: str | None = Query(default=None),
    tipo: VoucherTipo | None = Query(default=None),
    voucher_status: VoucherStatus | None = Query(default=None, alias="status"),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    contraparte_rut: str | None = Query(default=None),
    source: str | None = Query(default=None, max_length=40),
    # Round 106 — Filtro por proyecto contable. Coincide si alguna linea
    # del voucher tiene ese proyecto_codigo. "OTROS" como valor especial
    # filtra los vouchers SIN proyecto en ninguna linea.
    proyecto_codigo: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[VoucherListItem]:
    """Lista vouchers con filtros. Order by fecha_contable DESC.

    V5++ ola AD: auto-filtra por empresas a las que el user tiene rol.
    Admin global ve todo. User con scope EVOQUE+CSL ve solo esas dos.

    V5++ ola CE: filtro `source` (ai_import, nubox_form, csv_bulk, etc.)
    para ver, por ejemplo, todos los vouchers cargados con IA.

    Round 106: filtro `proyecto_codigo` — encuentra vouchers cuya alguna
    linea tenga ese proyecto. Util para reportar gastos por proyecto/centro
    de costo sin abrir cada voucher.
    """
    stmt = select(Voucher)

    # V5++ ola AD — Multi-tenant scope: filtra por las empresas permitidas
    scoped_codes = scope.filter_codes(empresa_codigo)
    if scoped_codes is not None:
        stmt = stmt.where(Voucher.empresa_codigo.in_(scoped_codes))

    if tipo:
        stmt = stmt.where(Voucher.tipo == tipo)
    if voucher_status:
        stmt = stmt.where(Voucher.status == voucher_status)
    if fecha_desde:
        stmt = stmt.where(Voucher.fecha_contable >= fecha_desde)
    if fecha_hasta:
        stmt = stmt.where(Voucher.fecha_contable <= fecha_hasta)
    if contraparte_rut:
        stmt = stmt.where(Voucher.contraparte_rut == contraparte_rut)
    if source:
        stmt = stmt.where(Voucher.source == source)
    if proyecto_codigo:
        # Round 106 — EXISTS subquery: vouchers con al menos una linea que
        # matchea el proyecto. "OTROS" = todas las lineas sin proyecto.
        if proyecto_codigo.upper() == "OTROS":
            stmt = stmt.where(
                ~select(VoucherLine.line_id)
                .where(
                    VoucherLine.voucher_id == Voucher.voucher_id,
                    VoucherLine.proyecto_codigo.is_not(None),
                )
                .exists()
            )
        else:
            stmt = stmt.where(
                select(VoucherLine.line_id)
                .where(
                    VoucherLine.voucher_id == Voucher.voucher_id,
                    VoucherLine.proyecto_codigo == proyecto_codigo,
                )
                .exists()
            )
    stmt = stmt.order_by(Voucher.fecha_contable.desc(), Voucher.voucher_id.desc()).limit(
        limit
    )

    result = await db.execute(stmt)
    vouchers_list = result.scalars().all()

    # Round 104 — bulk fetch proyecto_dominante (primera linea con proyecto_codigo).
    # 1 query agregada en bulk en lugar de N+1 al cargar cada voucher.
    proyectos_map: dict[int, str] = {}
    if vouchers_list:
        ids = [v.voucher_id for v in vouchers_list]
        rows = await db.execute(
            text(
                """
                SELECT DISTINCT ON (voucher_id) voucher_id, proyecto_codigo
                FROM core.voucher_lines
                WHERE voucher_id = ANY(:ids)
                  AND proyecto_codigo IS NOT NULL
                ORDER BY voucher_id, line_number ASC
                """
            ),
            {"ids": ids},
        )
        proyectos_map = {r[0]: r[1] for r in rows.fetchall()}

    items = []
    for v in vouchers_list:
        item = VoucherListItem.model_validate(v)
        item.proyecto_dominante = proyectos_map.get(v.voucher_id)
        items.append(item)
    return items


# =====================================================================
# V5++ ola AG — GET /vouchers/paginated (cursor + total count)
# =====================================================================


class PaginatedVouchersResponse(BaseModel):
    items: list[VoucherListItem]
    total: int
    page: int
    size: int
    has_more: bool


# =====================================================================
# Etapa D — Cursor pagination (sin COUNT, O(log N) constant time)
# =====================================================================
#
# Para listas grandes (10k+ vouchers) la offset pagination tradicional
# degrada lineal: offset=5000 obliga al DB a leer y descartar 5000 rows
# antes de devolver. Cursor pagination es O(log N) independiente de la
# profundidad — el WHERE (fecha, id) < cursor usa el indice compuesto.
#
# Cursor format: base64("<fecha_iso>,<voucher_id>") — opaco para el FE,
# que solo lo guarda y lo devuelve como param.


class CursorVouchersResponse(BaseModel):
    items: list[VoucherListItem]
    next_cursor: str | None = None
    has_more: bool


def _encode_cursor(fecha: date, voucher_id: int) -> str:
    """fecha_iso,voucher_id → base64 url-safe."""
    import base64

    raw = f"{fecha.isoformat()},{voucher_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[date, int] | None:
    """base64 → (fecha, voucher_id). None si invalido."""
    import base64

    try:
        # Re-pad
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        fecha_str, vid_str = raw.split(",")
        return date.fromisoformat(fecha_str), int(vid_str)
    except (ValueError, TypeError):
        return None


@router.get("/vouchers/cursor", response_model=CursorVouchersResponse)
async def list_vouchers_cursor(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    size: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    empresa_codigo: str | None = Query(default=None),
    tipo: VoucherTipo | None = Query(default=None),
    voucher_status: VoucherStatus | None = Query(default=None, alias="status"),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    contraparte_rut: str | None = Query(default=None),
) -> CursorVouchersResponse:
    """Etapa D — paginacion cursor sobre (fecha_contable DESC, voucher_id DESC).

    Para listados infinite-scroll en la lista de vouchers. Si necesitas
    saber el total, usa /vouchers/paginated (mas caro). Para navegar
    paginas, este es ~10x mas rapido en deep pages.

    Usage:
      GET /vouchers/cursor?size=50 → primera pagina, response incluye next_cursor
      GET /vouchers/cursor?cursor={next_cursor} → segunda pagina, etc.
    """
    wheres = []
    scoped_codes = scope.filter_codes(empresa_codigo)
    if scoped_codes is not None:
        wheres.append(Voucher.empresa_codigo.in_(scoped_codes))
    if tipo:
        wheres.append(Voucher.tipo == tipo)
    if voucher_status:
        wheres.append(Voucher.status == voucher_status)
    if fecha_desde:
        wheres.append(Voucher.fecha_contable >= fecha_desde)
    if fecha_hasta:
        wheres.append(Voucher.fecha_contable <= fecha_hasta)
    if contraparte_rut:
        wheres.append(Voucher.contraparte_rut == contraparte_rut)

    # Cursor: (fecha_contable, voucher_id) < (cursor_fecha, cursor_id)
    # en DESC order. Usa el indice compuesto ix_vouchers_empresa_status_fecha
    # cuando hay filtros por empresa/status.
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cursor invalido. Pediste una pagina inexistente.",
            )
        cursor_fecha, cursor_id = decoded
        # Tuple comparison: (fecha, id) < (cursor_fecha, cursor_id)
        # equivale a: fecha < cursor_fecha OR (fecha = cursor_fecha AND id < cursor_id)
        from sqlalchemy import and_, or_

        wheres.append(
            or_(
                Voucher.fecha_contable < cursor_fecha,
                and_(
                    Voucher.fecha_contable == cursor_fecha,
                    Voucher.voucher_id < cursor_id,
                ),
            )
        )

    stmt = select(Voucher)
    for w in wheres:
        stmt = stmt.where(w)
    # Pedimos size + 1 para saber si hay mas paginas sin un count separado
    stmt = stmt.order_by(
        Voucher.fecha_contable.desc(),
        Voucher.voucher_id.desc(),
    ).limit(size + 1)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    has_more = len(rows) > size
    items_models = rows[:size]
    items = [VoucherListItem.model_validate(v) for v in items_models]

    next_cursor = None
    if has_more and items_models:
        last = items_models[-1]
        next_cursor = _encode_cursor(last.fecha_contable, last.voucher_id)

    return CursorVouchersResponse(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/vouchers/paginated", response_model=PaginatedVouchersResponse)
async def list_vouchers_paginated(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    empresa_codigo: str | None = Query(default=None),
    tipo: VoucherTipo | None = Query(default=None),
    voucher_status: VoucherStatus | None = Query(default=None, alias="status"),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    contraparte_rut: str | None = Query(default=None),
) -> PaginatedVouchersResponse:
    """V5++ ola AG: lista paginada con total count.

    Mejor que /vouchers (limit fijo) para listados largos:
      - Devuelve `total` para mostrar contador "X de Y vouchers"
      - `has_more` indica si hay más páginas
      - Ordenado por fecha_contable DESC para consistencia con UI

    Usa los índices de Ola AF para que el COUNT sea <50ms incluso con 100k rows.
    """
    from sqlalchemy import func as sql_func

    # Construir filtros como lista para reutilizarlos en count + select
    wheres = []
    scoped_codes = scope.filter_codes(empresa_codigo)
    if scoped_codes is not None:
        wheres.append(Voucher.empresa_codigo.in_(scoped_codes))
    if tipo:
        wheres.append(Voucher.tipo == tipo)
    if voucher_status:
        wheres.append(Voucher.status == voucher_status)
    if fecha_desde:
        wheres.append(Voucher.fecha_contable >= fecha_desde)
    if fecha_hasta:
        wheres.append(Voucher.fecha_contable <= fecha_hasta)
    if contraparte_rut:
        wheres.append(Voucher.contraparte_rut == contraparte_rut)

    # Count total
    count_stmt = select(sql_func.count()).select_from(Voucher)
    for w in wheres:
        count_stmt = count_stmt.where(w)
    total = await db.scalar(count_stmt) or 0

    # Página
    offset = (page - 1) * size
    page_stmt = select(Voucher)
    for w in wheres:
        page_stmt = page_stmt.where(w)
    page_stmt = (
        page_stmt
        .order_by(Voucher.fecha_contable.desc(), Voucher.voucher_id.desc())
        .offset(offset)
        .limit(size)
    )

    result = await db.execute(page_stmt)
    items = [VoucherListItem.model_validate(v) for v in result.scalars().all()]

    return PaginatedVouchersResponse(
        items=items,
        total=total,
        page=page,
        size=size,
        has_more=(offset + len(items)) < total,
    )


# =====================================================================
# V5++ ola AG — GET /vouchers/counts (dashboard kpi strip)
# =====================================================================


@router.get("/vouchers/stats/by-source")
async def vouchers_stats_by_source(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
) -> dict:
    """V5++ ola CE — Conteos de vouchers agrupados por origen.

    Devuelve `{source: count}` con todas las categorias presentes en la DB
    + `null` para vouchers legacy sin source seteado + `total` con la suma.

    Respeta el scope multi-tenant (un user que ve EVOQUE solo cuenta los
    suyos). Filtros opcionales fecha_desde/fecha_hasta sobre fecha_contable.

    Pensado para el widget "Resumen de automatizacion" en /vouchers que
    muestra "X% vienen de IA, Y% form manual, etc.".
    """
    scoped_codes = scope.filter_codes(None)
    sql = """
        SELECT COALESCE(source, '__null__') AS source, COUNT(*) AS n
        FROM core.vouchers
        WHERE 1=1
    """
    params: dict = {}
    if scoped_codes is not None:
        sql += " AND empresa_codigo = ANY(CAST(:codes AS text[]))"
        params["codes"] = scoped_codes
    if fecha_desde:
        sql += " AND fecha_contable >= :desde"
        params["desde"] = fecha_desde
    if fecha_hasta:
        sql += " AND fecha_contable <= :hasta"
        params["hasta"] = fecha_hasta
    sql += " GROUP BY source ORDER BY n DESC"
    rows = (await db.execute(text(sql), params)).mappings().all()
    by_source = {str(r["source"]): int(r["n"]) for r in rows}
    total = sum(by_source.values())
    # Porcentaje de automatizados (cualquier source != nubox_form|null|manual)
    automated = sum(
        v
        for k, v in by_source.items()
        if k not in ("nubox_form", "manual", "__null__")
    )
    return {
        "by_source": by_source,
        "total": total,
        "automated_count": automated,
        "automated_pct": round(automated / total * 100, 1) if total else 0.0,
    }


@router.get("/vouchers/counts")
async def vouchers_counts(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    empresa_codigo: str | None = Query(default=None),
) -> dict:
    """V5++ ola AG: counts agrupados por status para dashboard.

    Devuelve: {DRAFT: n, PENDING: n, APPROVED: n, EXECUTED: n, ...}
    Filtra por las empresas del user scope. Un solo query SQL agregado.
    """
    from sqlalchemy import func as sql_func

    scoped_codes = scope.filter_codes(empresa_codigo)

    stmt = select(Voucher.status, sql_func.count().label("n")).group_by(Voucher.status)
    if scoped_codes is not None:
        stmt = stmt.where(Voucher.empresa_codigo.in_(scoped_codes))

    rows = (await db.execute(stmt)).all()
    counts = {row.status: row.n for row in rows}
    total = sum(counts.values())
    return {"total": total, "by_status": counts}


# =====================================================================
# POST /vouchers/bulk-pdf — descarga ZIP con varios PDFs en una sola pasada
# =====================================================================
#
# Use case: cierre mensual. El COO selecciona 10-30 vouchers del mes y
# baja todos los PDFs en un ZIP. Cap defensivo de 50 elementos por request.
#
# IMPORTANTE: este endpoint DEBE estar registrado antes de /vouchers/{voucher_id}
# porque "bulk-pdf" matchearía como string ante {voucher_id: int} y produciría
# un 422.


@router.post("/vouchers/bulk-pdf")
async def bulk_voucher_pdf(
    user: CurrentUser,
    db: DBSession,
    body: BulkPdfRequest,
):
    """Genera un ZIP con los PDFs de varios vouchers (max 50 por request).

    Comportamiento robusto: si un voucher individual falla (no existe, no hay
    acceso, error de generación), agregamos `voucher-{id}-error.txt` al ZIP
    con el motivo y seguimos con el resto. El ZIP siempre se devuelve aunque
    todos hayan fallado — el cliente ve los errores y reintenta.

    Generación secuencial deliberada: en paralelo saturaríamos la pool de DB
    (cada voucher hace varias queries) y a Dropbox (descarga de adjuntos).
    Si el bundle toma >5s loggeamos progreso vía structured logging para que
    se vea en observability.
    """
    import io
    import logging
    import time
    import zipfile
    from datetime import datetime as _dt

    from fastapi.responses import StreamingResponse

    from app.services.voucher_pdf_service import generate_voucher_pdf_bundle

    log = logging.getLogger("app.api.vouchers.bulk_pdf")

    voucher_ids = body.voucher_ids
    # Dedup preservando orden (cap ya validado por pydantic 1..50)
    seen: set[int] = set()
    ordered_ids: list[int] = []
    for vid in voucher_ids:
        if vid not in seen:
            seen.add(vid)
            ordered_ids.append(vid)

    started = time.monotonic()
    progress_logged = False

    zip_buf = io.BytesIO()
    successes = 0
    failures = 0

    with zipfile.ZipFile(
        zip_buf,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=6,
    ) as zf:
        for idx, vid in enumerate(ordered_ids, start=1):
            # 1) Fetch voucher meta (existence + empresa)
            row = (
                await db.execute(
                    text(
                        "SELECT codigo, empresa_codigo FROM core.vouchers "
                        "WHERE voucher_id = :id"
                    ),
                    {"id": vid},
                )
            ).mappings().first()

            if row is None:
                msg = f"Voucher {vid} no encontrado"
                log.info(
                    "vouchers.bulk_pdf.skip_missing",
                    extra={"voucher_id": vid},
                )
                zf.writestr(f"voucher-{vid}-error.txt", msg)
                failures += 1
            else:
                # 2) Scope check — si falla, agregamos error.txt sin romper el ZIP
                try:
                    await assert_empresa_access(user, db, row["empresa_codigo"])
                except HTTPException as exc:
                    detail = (
                        exc.detail
                        if isinstance(exc.detail, str)
                        else "Sin acceso a la empresa del voucher"
                    )
                    log.warning(
                        "vouchers.bulk_pdf.scope_denied",
                        extra={
                            "voucher_id": vid,
                            "empresa": row["empresa_codigo"],
                        },
                    )
                    zf.writestr(
                        f"voucher-{vid}-error.txt",
                        f"Sin acceso: {detail}",
                    )
                    failures += 1
                else:
                    # 3) Generación PDF (best-effort)
                    try:
                        pdf_bytes = await generate_voucher_pdf_bundle(
                            voucher_id=vid,
                            db=db,
                            include_attachments=body.include_attachments,
                            # Round 13 — propagar email al footer notarial.
                            generated_by_email=getattr(user, "email", None),
                        )
                        # Normalizar codigo a un nombre de archivo seguro
                        codigo = str(row["codigo"] or vid)
                        safe = "".join(
                            ch if ch.isalnum() or ch in ("-", "_", ".") else "_"
                            for ch in codigo
                        )
                        zf.writestr(f"voucher-{safe}.pdf", pdf_bytes)
                        successes += 1
                    except Exception as exc:  # noqa: BLE001
                        log.warning(
                            "vouchers.bulk_pdf.generation_failed",
                            extra={"voucher_id": vid, "err": str(exc)},
                        )
                        zf.writestr(
                            f"voucher-{vid}-error.txt",
                            f"Error generando PDF: {exc}",
                        )
                        failures += 1

            # Structured progress log si tarda
            elapsed = time.monotonic() - started
            if not progress_logged and elapsed > 5.0:
                progress_logged = True
                log.info(
                    "vouchers.bulk_pdf.progress",
                    extra={
                        "processed": idx,
                        "total": len(ordered_ids),
                        "elapsed_s": round(elapsed, 2),
                    },
                )

    total_elapsed = time.monotonic() - started
    log.info(
        "vouchers.bulk_pdf.complete",
        extra={
            "total": len(ordered_ids),
            "succeeded": successes,
            "failed": failures,
            "elapsed_s": round(total_elapsed, 2),
            "include_attachments": body.include_attachments,
        },
    )

    zip_bytes = zip_buf.getvalue()
    filename = f"vouchers-bundle-{_dt.utcnow().strftime('%Y-%m-%d')}.zip"
    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(zip_bytes)),
            "X-Bulk-Total": str(len(ordered_ids)),
            "X-Bulk-Succeeded": str(successes),
            "X-Bulk-Failed": str(failures),
        },
    )


# =====================================================================
# GET /vouchers/{id} — detalle con líneas
# =====================================================================


@router.get("/vouchers/{voucher_id}", response_model=VoucherRead)
async def get_voucher(
    user: CurrentUser, db: DBSession, scope: EmpresaScopeDep, voucher_id: int
) -> VoucherRead:
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines))
        .where(Voucher.voucher_id == voucher_id)
    )
    v = (await db.execute(stmt)).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    # V5++ ola AD — Validar que el user tenga acceso a la empresa del voucher
    if not scope.can_access(v.empresa_codigo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Sin acceso a vouchers de empresa '{v.empresa_codigo}'",
        )
    return VoucherRead.model_validate(v)


@router.get("/vouchers/{voucher_id}.html")
async def get_voucher_html(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
):
    """V5++ HTML imprimible del voucher individual.

    Server-side render notarial con líneas + firmas SHA-256 (si APPROVED+).
    El user abre en pestaña nueva → Ctrl+P → guarda como PDF formal.
    """
    from fastapi.responses import HTMLResponse

    from app.services.report_renderer_service import render_voucher_html

    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines))
        .where(Voucher.voucher_id == voucher_id)
    )
    v = (await db.execute(stmt)).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )

    # Cargar nombres de cuentas (V5++ ola CG perf: 1 query con IN en vez de
    # N round-trips. Antes hacíamos `SELECT nombre FROM core.plan_cuentas
    # WHERE codigo = :c` por cada línea — con 5-15 líneas eso eran
    # 5-15 round-trips de ~80ms cada uno sobre Supabase Ohio. Ahora 1 sola.)
    lines_sorted = sorted(v.lines, key=lambda x: x.line_number)
    cuenta_codes = {ln.cuenta_codigo for ln in lines_sorted if ln.cuenta_codigo}
    cuenta_nombre_map: dict[str, str] = {}
    if cuenta_codes:
        cuenta_rows = await db.execute(
            text(
                "SELECT codigo, nombre FROM core.plan_cuentas "
                "WHERE codigo = ANY(CAST(:codes AS text[]))"
            ),
            {"codes": list(cuenta_codes)},
        )
        cuenta_nombre_map = {r[0]: r[1] for r in cuenta_rows}

    line_dicts = []
    for ln in lines_sorted:
        line_dicts.append({
            "line_number": ln.line_number,
            "cuenta_codigo": ln.cuenta_codigo,
            "cuenta_nombre": cuenta_nombre_map.get(ln.cuenta_codigo, ""),
            "proyecto_codigo": ln.proyecto_codigo,
            "area_codigo": ln.area_codigo,
            "descripcion": ln.descripcion or "",
            "debit": ln.debit,
            "credit": ln.credit,
        })

    # Cargar approvals si existen
    approvals_rows = (
        await db.execute(
            text(
                """
                SELECT order_num, role, decision, approver_user_id,
                       signed_at::text AS signed_at, signature_hash
                FROM core.voucher_approvals
                WHERE voucher_id = :id
                ORDER BY order_num
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()
    approvals = [dict(a) for a in approvals_rows]

    voucher_dict = {
        "voucher_id": v.voucher_id,
        "codigo": v.codigo,
        "empresa_codigo": v.empresa_codigo,
        "tipo": v.tipo,
        "status": v.status,
        "fecha_contable": v.fecha_contable.isoformat() if v.fecha_contable else "",
        "glosa": v.glosa or "",
        "contraparte_nombre": v.contraparte_nombre,
        "contraparte_rut": v.contraparte_rut,
        "doc_tributario_tipo": v.doc_tributario_tipo,
        "doc_tributario_folio": v.doc_tributario_folio,
        "banco": v.banco,
        "banco_cuenta_alias": v.banco_cuenta_alias,
    }

    html = render_voucher_html(
        voucher=voucher_dict,
        lines=line_dicts,
        approvals=approvals,
    )
    return HTMLResponse(content=html)


# =====================================================================
# GET /vouchers/{id}/pdf — descarga PDF branded + attachments mergeados
# =====================================================================


@router.get("/vouchers/{voucher_id}/pdf")
async def download_voucher_pdf(
    voucher_id: int,
    user: CurrentUser,
    db: DBSession,
    include_attachments: bool = True,
):
    """Genera un PDF branded del voucher con los adjuntos incrustados.

    El PDF cover trae header de la empresa (logo + razón social + RUT + dir),
    detalle del voucher (info grid, glosa, líneas, totales, aprobaciones).
    Si include_attachments=True (default), descarga cada adjunto desde Dropbox
    y los anexa al PDF final: PDFs nativos se merge-an, imágenes se renderizan
    a A4, otros formatos producen una página placeholder.

    Falla silenciosa: errores fetching del logo o de adjuntos no rompen el PDF.
    """
    from fastapi.responses import StreamingResponse

    from app.services.voucher_pdf_service import generate_voucher_pdf_bundle

    # Validar voucher existe + scope
    row = (
        await db.execute(
            text(
                "SELECT codigo, empresa_codigo FROM core.vouchers "
                "WHERE voucher_id = :id"
            ),
            {"id": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voucher no encontrado",
        )
    await assert_empresa_access(user, db, row["empresa_codigo"])

    try:
        pdf_bytes = await generate_voucher_pdf_bundle(
            voucher_id=voucher_id,
            db=db,
            include_attachments=include_attachments,
            # Round 13 — footer notarial registra el user que descargó.
            generated_by_email=getattr(user, "email", None),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generando PDF del voucher: {exc}",
        ) from exc

    filename = f"voucher-{row['codigo']}.pdf"

    # Round 17 — audit log de descarga PDF para forense.
    # Soft-fail: no rompe el download si audit_log falla. El footer
    # notarial (Round 13) tambien graba el email pero solo en el PDF;
    # esto deja huella server-side.
    try:
        await audit_log(
            db, request, user,
            action="download_pdf",
            entity_type="voucher",
            entity_id=str(voucher_id),
            entity_label=str(row["codigo"]),
            summary=(
                f"Descarga PDF de voucher {row['codigo']} "
                f"({len(pdf_bytes)} bytes, attachments={include_attachments})"
            ),
            before=None,
            after={
                "bytes": len(pdf_bytes),
                "include_attachments": include_attachments,
                "empresa_codigo": row["empresa_codigo"],
            },
        )
    except Exception:
        pass

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


# =====================================================================
# POST /vouchers/{id}/duplicate — skill "Crear voucher similar"
# =====================================================================
#
# Crea un voucher nuevo en DRAFT copiando todos los campos del original
# (incluyendo lines + imputación triple), con código nuevo y fechas hoy.
# No copia: status (DRAFT siempre), approvals, attachments, signature_hash,
# voucher_id, codigo. Use case típico: gastos recurrentes (arriendo,
# servicios mensuales), facturas similares entre periodos.


@router.post(
    "/vouchers/{voucher_id}/duplicate",
    response_model=VoucherRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def duplicate_voucher(
    voucher_id: int,
    user: CurrentUser,
    db: DBSession,
) -> VoucherRead:
    """Skill: duplica un voucher existente como nuevo DRAFT.

    El nuevo voucher conserva: empresa_codigo, tipo, contraparte_rut/nombre/tipo,
    doc_tributario_tipo, banco, glosa, moneda, lineas (con cuenta+proyecto+
    area+debit+credit+descripcion). No conserva: codigo (se genera nuevo),
    status (siempre DRAFT), folio (vacio), fecha_documento/contable (hoy),
    approvals, attachments, signature_hash, threshold_aplicado.

    Validación: scope check sobre la empresa del original.
    """
    # 1. Fetch original con scope check
    original = await db.scalar(
        select(Voucher).where(Voucher.voucher_id == voucher_id)
    )
    if original is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, original.empresa_codigo)

    # 2. Fetch lines del original
    lines_rows = await db.execute(
        select(VoucherLine)
        .where(VoucherLine.voucher_id == voucher_id)
        .order_by(VoucherLine.line_number)
    )
    original_lines = list(lines_rows.scalars().all())

    # 3. Generar codigo correlativo nuevo via función Postgres
    today = date.today()
    new_codigo = await db.scalar(
        text(
            "SELECT core.next_voucher_code(:emp, :year, :tipo)"
        ),
        {
            "emp": original.empresa_codigo,
            "year": today.year,
            "tipo": original.tipo,
        },
    )

    # 4. Crear voucher clon en DRAFT
    clone = Voucher(
        codigo=new_codigo,
        empresa_codigo=original.empresa_codigo,
        tipo=original.tipo,
        status="DRAFT",
        fecha_documento=today,
        fecha_contable=today,
        glosa=f"[COPIA de {original.codigo}] {original.glosa}",
        moneda=original.moneda,
        contraparte_rut=original.contraparte_rut,
        contraparte_nombre=original.contraparte_nombre,
        contraparte_tipo=original.contraparte_tipo,
        doc_tributario_tipo=original.doc_tributario_tipo,
        doc_tributario_folio=None,  # nuevo voucher, nuevo folio
        banco=original.banco,
        banco_cuenta_alias=original.banco_cuenta_alias,
        threshold_aplicado=False,
        source="duplicate",
        created_by_user_id=str(user.sub),
    )
    db.add(clone)
    await db.flush()

    # 5. Clonar lines
    for orig_line in original_lines:
        clone_line = VoucherLine(
            voucher_id=clone.voucher_id,
            line_number=orig_line.line_number,
            cuenta_codigo=orig_line.cuenta_codigo,
            proyecto_codigo=orig_line.proyecto_codigo,
            area_codigo=orig_line.area_codigo,
            debit=orig_line.debit,
            credit=orig_line.credit,
            descripcion=orig_line.descripcion,
            balance_treatment=orig_line.balance_treatment,
        )
        db.add(clone_line)

    await db.commit()
    await db.refresh(clone)

    return VoucherRead.model_validate(clone)


# =====================================================================
# POST /vouchers — crear con líneas en una transacción
# =====================================================================


@router.post(
    "/vouchers",
    response_model=VoucherRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    body: VoucherCreate,
) -> VoucherRead:
    """Crea voucher + líneas en una sola transacción.

    Validaciones (en orden):
      1. Pydantic ya validó: line_number único+correlativo, debit XOR credit,
         partida doble si !DRAFT, COMPRA/VENTA con doc tributario, REVERSO con
         reversal_of.
      2. Empresa existe + activa.
      3. fecha_contable NO está en período cerrado.
      4. Cada línea: cuenta existe + imputable + habilitada para empresa.
      5. Cada línea con proyecto: proyecto existe + pertenece a empresa.
      6. Cada línea con área: área existe + aplica a empresa.
      7. Para líneas CORFO: cuenta es elegible y tipo_gasto está en eligible_types.
      8. Genera código correlativo via core.next_voucher_code().
      9. INSERT voucher + lines en commit atómico.
    """
    # V5++ ola AD — Validar acceso del user a esta empresa (403 si no)
    await assert_empresa_access(user, db, body.empresa_codigo)

    # 2. Empresa existe + activa
    empresa_activa = await db.scalar(
        select(1).select_from(  # type: ignore[arg-type]
            Voucher.__table__.metadata.tables["core.empresas"]
        ).where(
            Voucher.__table__.metadata.tables["core.empresas"].c.codigo
            == body.empresa_codigo,
            Voucher.__table__.metadata.tables["core.empresas"].c.activo.is_(True),
        )
    )
    if not empresa_activa:
        # Fallback con SQL raw por si la metadata reflection no registró empresas
        from sqlalchemy import text as _text
        empresa_activa = await db.scalar(
            _text(
                "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
            ),
            {"c": body.empresa_codigo},
        )
    if not empresa_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe o está inactiva",
        )

    # 3. Período cerrado
    if await is_period_locked_for(db, body.empresa_codigo, body.fecha_contable):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Fecha contable {body.fecha_contable} está en período cerrado. "
                f"Para corregir, crear voucher de REVERSO."
            ),
        )

    # 4-7. Validar cada línea
    for line in body.lines:
        cuenta = await fetch_cuenta_metadata(db, line.cuenta_codigo)
        if cuenta is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' no existe",
            )
        if not cuenta["imputable"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"es nivel {cuenta['nivel']}, no imputable. Solo nivel 4 acepta líneas."
                ),
            )
        if not cuenta["activa"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' está inactiva",
            )
        if not await is_cuenta_habilitada_para_empresa(
            db, line.cuenta_codigo, body.empresa_codigo
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"no está habilitada para empresa '{body.empresa_codigo}'"
                ),
            )

        if line.proyecto_codigo:
            proy = await fetch_proyecto_metadata(db, line.proyecto_codigo)
            if proy is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Línea {line.line_number}: proyecto '{line.proyecto_codigo}' "
                        f"no existe"
                    ),
                )
            if proy["empresa_codigo"] != body.empresa_codigo:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Línea {line.line_number}: proyecto '{line.proyecto_codigo}' "
                        f"pertenece a {proy['empresa_codigo']}, no a {body.empresa_codigo}"
                    ),
                )
            # CORFO eligibility
            corfo_err = validate_corfo_eligibility(
                cuenta_corfo_elegible=cuenta["corfo_elegible"],
                cuenta_tipo_gasto_corfo=cuenta["tipo_gasto_corfo"],
                proyecto_es_corfo=(proy["tipo_financiamiento"] == "CORFO"),
                proyecto_eligible_types=list(proy["tipos_gasto_elegibles"] or []),
            )
            if corfo_err:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Línea {line.line_number}: {corfo_err}",
                )

        if line.area_codigo and not await is_area_aplica_a_empresa(
            db, line.area_codigo, body.empresa_codigo
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: área '{line.area_codigo}' "
                    f"no aplica a empresa '{body.empresa_codigo}'"
                ),
            )

    # 8. Generar correlativo
    anio = body.fecha_contable.year
    codigo = await generate_voucher_code(db, body.empresa_codigo, anio, body.tipo)

    # 9. Insertar voucher + lines
    total_debit = sum((line.debit for line in body.lines), start=Decimal("0"))
    total_credit = sum((line.credit for line in body.lines), start=Decimal("0"))

    voucher = Voucher(
        codigo=codigo,
        empresa_codigo=body.empresa_codigo,
        tipo=body.tipo,
        status=body.status,
        fecha_documento=body.fecha_documento,
        fecha_contable=body.fecha_contable,
        fecha_ejecucion=body.fecha_ejecucion,
        glosa=body.glosa.strip(),
        total_debit=total_debit,
        total_credit=total_credit,
        moneda=body.moneda,
        exchange_rate=body.exchange_rate,
        contraparte_rut=body.contraparte_rut,
        contraparte_nombre=body.contraparte_nombre,
        contraparte_tipo=body.contraparte_tipo,
        doc_tributario_tipo=body.doc_tributario_tipo,
        doc_tributario_folio=body.doc_tributario_folio,
        doc_tributario_sii_track_id=body.doc_tributario_sii_track_id,
        banco=body.banco,
        banco_cuenta_alias=body.banco_cuenta_alias,
        threshold_aplicado=body.threshold_aplicado,
        reversal_of=body.reversal_of,
        created_by=str(user.sub),
        requested_by=str(user.sub),
    )
    db.add(voucher)
    await db.flush()  # para tener voucher_id

    for line_data in body.lines:
        line = VoucherLine(
            voucher_id=voucher.voucher_id,
            line_number=line_data.line_number,
            cuenta_codigo=line_data.cuenta_codigo,
            proyecto_codigo=line_data.proyecto_codigo,
            area_codigo=line_data.area_codigo,
            debit=line_data.debit,
            credit=line_data.credit,
            descripcion=line_data.descripcion,
            iva_tratamiento=line_data.iva_tratamiento,
            iva_amount=line_data.iva_amount,
            neto_amount=line_data.neto_amount,
            balance_treatment=line_data.balance_treatment,
        )
        db.add(line)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # El trigger de partida doble puede dispararse acá si hay edge case
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"DB rechazó el voucher: {exc.orig}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error guardando voucher: {exc}",
        ) from exc

    # V5++ ola BL — Audit log de creación para Bitácora
    try:
        await audit_log(
            db, request, user,
            action="create",
            entity_type="voucher",
            entity_id=str(voucher.voucher_id),
            entity_label=voucher.codigo,
            summary=(
                f"Voucher {voucher.codigo} creado: "
                f"{voucher.empresa_codigo} · {voucher.tipo} · "
                f"${voucher.total_debit:,.0f} · {len(body.lines)} líneas"
            ),
            before=None,
            after={
                "voucher_id": voucher.voucher_id,
                "codigo": voucher.codigo,
                "empresa_codigo": voucher.empresa_codigo,
                "tipo": voucher.tipo,
                "status": voucher.status,
                "total_debit": str(voucher.total_debit),
                "glosa": voucher.glosa,
                "contraparte_nombre": voucher.contraparte_nombre,
                "lines_count": len(body.lines),
            },
        )
    except Exception:
        pass

    # Re-fetch con líneas cargadas
    # NOTE: get_voucher requires scope dep — bypass with None as we already validated
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines))
        .where(Voucher.voucher_id == voucher.voucher_id)
    )
    v_full = (await db.execute(stmt)).scalar_one()
    return VoucherRead.model_validate(v_full)


# =====================================================================
# PATCH /vouchers/{id} — solo si DRAFT
# =====================================================================


@router.patch(
    "/vouchers/{voucher_id}",
    response_model=VoucherRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    body: VoucherUpdate,
) -> VoucherRead:
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, v.empresa_codigo)
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo se pueden editar vouchers en DRAFT (este está en {v.status}). "
                f"Para corregir un voucher ya enviado, crear voucher de REVERSO."
            ),
        )

    update_data = body.model_dump(exclude_unset=True)
    for k, val in update_data.items():
        setattr(v, k, val)

    await db.commit()
    return await get_voucher(user, db, voucher_id)


# =====================================================================
# POST /vouchers/{id}/submit — DRAFT → PENDING
# =====================================================================


class SubmitResponse(BaseModel):
    voucher_id: int
    codigo: str
    new_status: VoucherStatus = "PENDING"
    message: str


@router.post(
    "/vouchers/{voucher_id}/submit",
    response_model=SubmitResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def submit_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
) -> SubmitResponse:
    """Pasa el voucher de DRAFT a PENDING (esperando aprobación).

    Validaciones:
      - Status actual debe ser DRAFT
      - Líneas cuadran (Σ debit == Σ credit) — el trigger DB lo valida
      - Vouchers tipo COMPRA/VENTA tienen al menos 1 adjunto
    """
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines), selectinload(Voucher.attachments))
        .where(Voucher.voucher_id == voucher_id)
    )
    v = (await db.execute(stmt)).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, v.empresa_codigo)
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers en DRAFT pueden ser enviados (este está en {v.status})",
        )
    if not v.lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El voucher no tiene líneas",
        )

    if v.tipo in ("COMPRA", "VENTA") and not v.attachments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Voucher de {v.tipo} requiere al menos un adjunto antes de enviarlo "
                f"(factura/boleta correspondiente)"
            ),
        )

    # Round 81 — Bloque E Ajuste E8 (regla bloqueante CORFO):
    # El IVA crédito fiscal NUNCA se distribuye al subsidio. Si una línea
    # con fuente=CORFO_SUBSIDIO tiene cuenta que matchea IVA (codigo
    # empieza con 1170/1180 según plan IFRS Nubox, o el nombre contiene
    # 'IVA'), bloqueamos el submit. Esto cubre el caso típico del operador
    # confundido que asigna el IVA al pozo del subsidio por error.
    iva_en_corfo_rows = await db.execute(
        text(
            """
            SELECT vl.line_number, vl.cuenta_codigo, vl.debit, vl.credit,
                   pc.nombre AS cuenta_nombre
            FROM core.voucher_lines vl
            LEFT JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
            WHERE vl.voucher_id = :v
              AND vl.fuente_financiamiento = 'CORFO_SUBSIDIO'
              AND (
                vl.cuenta_codigo LIKE '1170%'
                OR vl.cuenta_codigo LIKE '1180%'
                OR vl.cuenta_codigo LIKE '2170%'
                OR pc.nombre ILIKE '%IVA%'
              )
            """
        ),
        {"v": voucher_id},
    )
    iva_en_corfo = iva_en_corfo_rows.first()
    if iva_en_corfo is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Regla CORFO bloqueante: el IVA no es elegible al subsidio. "
                f"La línea {iva_en_corfo[0]} (cuenta {iva_en_corfo[1]}"
                f"{' - ' + iva_en_corfo[4] if iva_en_corfo[4] else ''}) "
                f"está marcada como fuente CORFO_SUBSIDIO. "
                f"Asignar IVA al 100% a la cuenta corporativa "
                f"(fuente IVA_CORPORATIVO o EMPRESA_DIRECTA)."
            ),
        )

    # Round 56 — auto-approve si la regla matched tiene required_roles=[].
    # Caso de uso: vouchers de bajo monto (ej. ≤ $200K) creados por finance,
    # con proveedor del catálogo y cuenta habitual → no requieren firma de
    # GG/DIRECTOR, pasan directamente a APPROVED. Reduce trabajo manual de
    # ~80% de vouchers recurrentes que igual se firmarían automáticamente.
    #
    # La regla con required_roles=[] solo aplica si su priority es < que la
    # regla "siempre 2 firmas" — para que sea opt-in explícito por umbral.
    from app.services.approval_service import (
        find_matching_rule,
        get_voucher_balance_treatment_dominante,
        load_active_rules,
    )

    auto_approved = False
    matched_rule: dict[str, Any] | None = None
    try:
        active_rules = await load_active_rules(db, v.empresa_codigo)
        balance_tx = await get_voucher_balance_treatment_dominante(
            db, voucher_id
        )
        matched_rule = find_matching_rule(
            active_rules,
            voucher_tipo=v.tipo,
            voucher_amount=Decimal(v.total_debit or 0),
            balance_treatment_dominante=balance_tx,
        )
        if matched_rule is not None:
            roles_req = matched_rule.get("required_roles") or []
            if isinstance(roles_req, (list, tuple)) and len(roles_req) == 0:
                auto_approved = True
    except Exception:
        # Si fallar la lookup de reglas no debe bloquear el flujo: caer
        # al comportamiento normal (PENDING).
        auto_approved = False
        matched_rule = None

    if auto_approved:
        v.status = "APPROVED"
        v.requested_by = str(user.sub)
    else:
        v.status = "PENDING"
        v.requested_by = str(user.sub)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # El trigger de partida doble puede tirar acá si descuadra
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"DB rechazó el cambio: {exc.orig}",
        ) from exc

    # V5++ ola BL — Audit log de submit (Round 56 distingue auto-approve).
    try:
        action_lbl = "submit_auto_approve" if auto_approved else "submit"
        summary_lbl = (
            f"Voucher {v.codigo} APROBADO AUTO por regla "
            f"#{matched_rule['rule_id']} ({matched_rule.get('descripcion','')[:40]}) "
            f"— monto {v.total_debit:,.0f} dentro del umbral"
            if auto_approved and matched_rule
            else f"Voucher {v.codigo} enviado a aprobación "
            f"({v.empresa_codigo} · {v.tipo} · ${v.total_debit:,.0f})"
        )
        await audit_log(
            db, request, user,
            action=action_lbl,
            entity_type="voucher",
            entity_id=str(v.voucher_id),
            entity_label=v.codigo,
            summary=summary_lbl,
            before={"status": "DRAFT"},
            after={
                "status": v.status,
                "requested_by": str(user.sub),
                "auto_approved": auto_approved,
                "matched_rule_id": (
                    matched_rule["rule_id"] if matched_rule else None
                ),
            },
        )
    except Exception:
        pass

    msg = (
        f"Voucher {v.codigo} aprobado automáticamente (sin firma manual requerida)"
        if auto_approved
        else f"Voucher {v.codigo} enviado a aprobación"
    )
    return SubmitResponse(
        voucher_id=voucher_id,
        codigo=v.codigo,
        message=msg,
    )


# =====================================================================
# POST /vouchers/{id}/void — anular con razón
# =====================================================================


class VoidRequest(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


@router.post(
    "/vouchers/{voucher_id}/void",
    response_model=VoucherRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def void_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: VoidRequest,
) -> VoucherRead:
    """V5++ ola CJ — scope check + audit_log (compliance gap reportado)."""
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, v.empresa_codigo)
    if v.status in ("VOID", "CLOSED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Voucher ya está en {v.status}",
        )
    status_prev = v.status
    v.status = "VOID"
    v.void_reason = body.reason.strip()
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="reject",
        entity_type="voucher",
        entity_id=str(voucher_id),
        entity_label=v.codigo,
        summary=f"Voucher {v.codigo} ANULADO (estado previo: {status_prev}). Razón: {body.reason[:200]}",
        before={"status": status_prev},
        after={"status": "VOID", "void_reason": body.reason},
    )
    return await get_voucher(user, db, voucher_id)


# =====================================================================
# DELETE /vouchers/{id} — solo si DRAFT
# =====================================================================


@router.delete(
    "/vouchers/{voucher_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
) -> Response:
    """Borra fisico, solo permitido si DRAFT.

    Para vouchers enviados (PENDING+), usar POST /vouchers/{id}/void.
    Para vouchers cerrados, crear voucher de REVERSO.

    V5++ ola CJ — scope check + audit_log (compliance gap).
    """
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, v.empresa_codigo)
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo vouchers en DRAFT pueden borrarse (este está en {v.status}). "
                f"Para anular usar POST /vouchers/{voucher_id}/void."
            ),
        )
    codigo_prev = v.codigo
    empresa_prev = v.empresa_codigo
    await db.delete(v)
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="voucher",
        entity_id=str(voucher_id),
        entity_label=codigo_prev,
        summary=f"Voucher DRAFT {codigo_prev} eliminado físicamente (empresa: {empresa_prev})",
        before={"status": "DRAFT", "codigo": codigo_prev},
        after=None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# ATTACHMENTS — adjuntos en Dropbox + metadata en DB
# =====================================================================


# Tipos de adjunto permitidos (espejo del CHECK de la migración 0035)
AttachmentTipo = Literal[
    "FACTURA", "BOLETA", "CONTRATO", "COTIZACION",
    "TRANSFERENCIA", "LIQUIDACION_SUELDO", "ACTA",
    "RESPALDO_TECNICO", "OTRO",
]


# Path Dropbox raíz para adjuntos de vouchers
_VOUCHER_ATTACHMENTS_ROOT = "/Cehta Capital/02-Fondo (FIP CEHTA)/Vouchers"

# Tamaño máximo por adjunto (50 MB) — facturas escaneadas a alta resolución
# pueden pesar 5-15 MB; 50 MB nos da margen sin permitir abuso.
_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

# Mime types aceptados — PDFs y scans
_ALLOWED_MIME_PREFIXES = (
    "application/pdf",
    "image/jpeg", "image/png", "image/webp",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/msword",
)


class VoucherAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attachment_id: int
    voucher_id: int
    tipo: AttachmentTipo
    file_name: str
    dropbox_path: str
    file_hash: str | None
    mime_type: str | None
    size_bytes: int | None
    uploaded_by: str | None
    uploaded_at: datetime


class VoucherAttachmentLink(BaseModel):
    """URL temporal de Dropbox para descargar el adjunto (vence en 4h)."""

    attachment_id: int
    file_name: str
    url: str
    expires_in_seconds: int = 4 * 60 * 60


def _voucher_dropbox_path(
    empresa_codigo: str, anio: int, voucher_codigo: str, file_name: str
) -> str:
    """Path Dropbox por convención: /Vouchers/{empresa}/{año}/{codigo}/{file}."""
    safe_file = file_name.replace("/", "_")
    return (
        f"{_VOUCHER_ATTACHMENTS_ROOT}/{empresa_codigo}/{anio}/"
        f"{voucher_codigo}/{safe_file}"
    )


async def _get_dropbox_service(db: DBSession) -> DropboxService:
    """Devuelve el cliente Dropbox autenticado o lanza 503 si no está conectado."""
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Dropbox no está conectado. Conectá la cuenta en /admin/integraciones "
                "antes de subir adjuntos."
            ),
        )
    try:
        return DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get(
    "/vouchers/{voucher_id}/attachments",
    response_model=list[VoucherAttachmentRead],
)
async def list_voucher_attachments(
    user: CurrentUser, db: DBSession, voucher_id: int
) -> list[VoucherAttachmentRead]:
    """Lista adjuntos del voucher (sin URLs temporales — esas se piden por adjunto).

    QA fix 14/05/2026 — antes solo verificaba existencia del voucher
    pero NO chequeaba scope: un user con acceso a empresa A podia leer
    adjuntos de empresa B si conocia el voucher_id. Ahora cargamos el
    voucher y validamos scope antes de devolver attachments.
    """
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, v.empresa_codigo)

    rows = (
        await db.execute(
            text(
                """
                SELECT attachment_id, voucher_id, tipo, file_name, dropbox_path,
                       file_hash, mime_type, size_bytes, uploaded_by, uploaded_at
                FROM core.voucher_attachments
                WHERE voucher_id = :id
                ORDER BY uploaded_at DESC
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()

    return [VoucherAttachmentRead.model_validate(dict(r)) for r in rows]


@router.post(
    "/vouchers/{voucher_id}/attachments",
    response_model=VoucherAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def upload_voucher_attachment(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    tipo: Annotated[AttachmentTipo, Form()],
    file: UploadFile = File(..., description="Factura, boleta, contrato, etc."),
) -> VoucherAttachmentRead:
    """Sube un adjunto a Dropbox + persiste metadata en DB.

    Path Dropbox: /Cehta Capital/02-Fondo (FIP CEHTA)/Vouchers/{empresa}/{año}/{codigo}/{file}
    """
    # 1. Validar voucher existe y permite adjuntos
    row = (
        await db.execute(
            text(
                "SELECT codigo, empresa_codigo, fecha_contable, status "
                "FROM core.vouchers WHERE voucher_id = :id"
            ),
            {"id": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    # QA fix 14/05/2026 — scope check antes de tocar Dropbox / DB. Un user
    # con legal:write a empresa A podia subir adjuntos a vouchers de
    # empresa B con voucher_id conocido. Ahora bloqueado.
    await assert_empresa_access(user, db, row["empresa_codigo"])
    if row["status"] in ("VOID", "CLOSED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pueden adjuntar archivos a un voucher en {row['status']}",
        )

    # 2. Validar archivo
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo sin nombre"
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo vacío"
        )
    if len(contents) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Archivo excede {_MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB. "
                "Comprimí o subí el original a Dropbox manualmente y referencialo."
            ),
        )

    mime = file.content_type or "application/octet-stream"
    if not any(mime.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tipo de archivo no permitido: {mime}. Solo PDF, imágenes "
                "(JPG/PNG/WebP), Excel y Word."
            ),
        )

    # 3. Hash SHA-256 (para detectar duplicados / verificar integridad)
    file_hash = hashlib.sha256(contents).hexdigest()

    # 4. Subir a Dropbox (sync API en threadpool para no bloquear el event loop)
    dbx = await _get_dropbox_service(db)
    anio = row["fecha_contable"].year
    target_path = _voucher_dropbox_path(
        row["empresa_codigo"], anio, row["codigo"], file.filename
    )

    try:
        # Crear estructura de carpetas + upload
        await asyncio.to_thread(
            dbx.ensure_folder,
            f"{_VOUCHER_ATTACHMENTS_ROOT}/{row['empresa_codigo']}/{anio}/{row['codigo']}",
        )
        await asyncio.to_thread(dbx.upload_file, target_path, contents, overwrite=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo subir a Dropbox: {exc}",
        ) from exc

    # 5. Persistir metadata
    result = await db.execute(
        text(
            """
            INSERT INTO core.voucher_attachments (
                voucher_id, tipo, file_name, dropbox_path, file_hash,
                mime_type, size_bytes, uploaded_by
            )
            VALUES (
                :v, :t, :n, :p, :h, :m, :s, CAST(:by AS UUID)
            )
            RETURNING attachment_id, voucher_id, tipo, file_name, dropbox_path,
                      file_hash, mime_type, size_bytes, uploaded_by, uploaded_at
            """
        ),
        {
            "v": voucher_id,
            "t": tipo,
            "n": file.filename,
            "p": target_path,
            "h": file_hash,
            "m": mime,
            "s": len(contents),
            "by": str(user.sub),
        },
    )
    await db.commit()
    new_row = result.mappings().one()
    return VoucherAttachmentRead.model_validate(dict(new_row))


@router.get(
    "/vouchers/{voucher_id}/origen-document-url",
    response_model=VoucherAttachmentLink,
)
async def get_voucher_origen_document_url(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    voucher_id: int,
) -> VoucherAttachmentLink:
    """V5++ ola CF — URL temporal del documento origen del voucher (Dropbox).

    Si el voucher fue creado via /vouchers/importar con archivo y se subio
    a Dropbox, su columna `documento_dropbox_path` tiene el path. Este
    endpoint genera un temporary link (4h) que el FE abre en pestaña nueva
    para que el user vea el PDF/imagen original.

    Diferente del endpoint /attachments/{id}/url: este es para el archivo
    de origen (extraido con IA), no para attachments uploaded manualmente.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT voucher_id, codigo, empresa_codigo, documento_dropbox_path
                FROM core.vouchers
                WHERE voucher_id = :v
                """
            ),
            {"v": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if not scope.can_access(row["empresa_codigo"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Sin acceso al voucher de empresa '{row['empresa_codigo']}'",
        )
    if not row["documento_dropbox_path"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este voucher no tiene documento origen en Dropbox.",
        )
    dbx = await _get_dropbox_service(db)
    try:
        url = await asyncio.to_thread(
            dbx.get_temporary_link, row["documento_dropbox_path"]
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo generar URL temporal: {exc}",
        ) from exc
    # File name: ultimo segmento del path
    file_name = row["documento_dropbox_path"].rsplit("/", 1)[-1]
    return VoucherAttachmentLink(
        attachment_id=0,  # no es un attachment_id real
        file_name=file_name,
        url=url,
    )


@router.get(
    "/vouchers/{voucher_id}/attachments/{attachment_id}/url",
    response_model=VoucherAttachmentLink,
)
async def get_voucher_attachment_url(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    attachment_id: int,
) -> VoucherAttachmentLink:
    """Genera URL temporal de Dropbox (vence en 4h) para descargar el archivo."""
    row = (
        await db.execute(
            text(
                "SELECT a.attachment_id, a.dropbox_path, a.file_name "
                "FROM core.voucher_attachments a "
                "WHERE a.attachment_id = :a AND a.voucher_id = :v"
            ),
            {"a": attachment_id, "v": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Adjunto no encontrado"
        )

    dbx = await _get_dropbox_service(db)
    try:
        url = await asyncio.to_thread(dbx.get_temporary_link, row["dropbox_path"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo generar URL temporal: {exc}",
        ) from exc

    return VoucherAttachmentLink(
        attachment_id=row["attachment_id"],
        file_name=row["file_name"],
        url=url,
    )


@router.delete(
    "/vouchers/{voucher_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_voucher_attachment(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    attachment_id: int,
) -> Response:
    """Borra adjunto de Dropbox + DB. Solo permitido en DRAFT/PENDING.

    Para vouchers aprobados o ejecutados, los adjuntos quedan inmutables
    (audit). Si necesitás reemplazar, anulá y reversá.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT a.dropbox_path, v.status
                FROM core.voucher_attachments a
                INNER JOIN core.vouchers v ON v.voucher_id = a.voucher_id
                WHERE a.attachment_id = :a AND a.voucher_id = :v
                """
            ),
            {"a": attachment_id, "v": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Adjunto no encontrado"
        )
    if row["status"] not in ("DRAFT", "PENDING"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No se pueden borrar adjuntos de un voucher en {row['status']}. "
                "Para corregir, anular el voucher o crear voucher de REVERSO."
            ),
        )

    # Borrar de Dropbox (best-effort — si falla seguimos con DB delete)
    try:
        dbx = await _get_dropbox_service(db)
        await asyncio.to_thread(dbx.delete, row["dropbox_path"])
    except Exception:  # noqa: BLE001 — Dropbox down no debe bloquear cleanup DB
        pass

    await db.execute(
        text("DELETE FROM core.voucher_attachments WHERE attachment_id = :a"),
        {"a": attachment_id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# APROBACIONES — firma digital (Fase 2)
# =====================================================================


class VoucherApprovalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    approval_id: int
    voucher_id: int
    approver_user_id: str
    role: str
    order_num: int
    decision: Literal["APPROVED", "REJECTED"]
    signed_at: datetime
    signature_hash: str
    ip_address: str | None
    user_agent: str | None
    comments: str | None


class VoucherApprovalsState(BaseModel):
    """Estado completo del flujo de aprobación de un voucher.

    Devuelve la regla matcheada + roles requeridos + firmas hechas +
    qué falta. Útil para que la UI muestre la botonera correcta.
    """

    voucher_id: int
    voucher_codigo: str
    voucher_status: str
    matched_rule_id: int | None
    matched_rule_descripcion: str | None
    required_roles: list[str]
    reinforced: bool
    approvals: list[VoucherApprovalRead]
    next_pending_role: str | None
    next_pending_order: int | None
    can_current_user_sign: bool
    current_user_eligible_role: str | None
    # Round 82 — UX firma: si el current user NO puede firmar, mostrar
    # quiénes SÍ pueden para que el operador sepa con qué cuenta loguearse.
    next_pending_signers_emails: list[str] = []
    # Round 82 — si el user ya firmó otro paso de este mismo voucher
    # (anti-doble-firma) el FE muestra mensaje distinto que "no tiene el rol".
    current_user_already_signed: bool = False


class ApproveRequest(BaseModel):
    """POST /vouchers/{id}/approve — firma propia con rol activo en empresa."""

    role: str = Field(
        description="Rol con el que firma (debe estar asignado al user en esa empresa)"
    )
    comments: str | None = Field(default=None, max_length=500)


class RejectRequest(BaseModel):
    """POST /vouchers/{id}/reject — rechaza con razón obligatoria."""

    reason: str = Field(min_length=10, max_length=500)


class ExecuteRequest(BaseModel):
    """Etapa A — POST /vouchers/bulk-execute body por voucher.

    Marca un voucher APPROVED como EXECUTED (pago confirmado).
    `fecha_ejecucion` y `nota` son opcionales — default fecha de hoy.
    `movimiento_id` es opcional: si lo pasas, vincula este voucher con
    un movimiento bancario existente (conciliacion explicita).
    """

    fecha_ejecucion: date | None = Field(
        default=None,
        description="Fecha real de la transferencia (default: hoy).",
    )
    nota: str | None = Field(
        default=None,
        max_length=300,
        description=(
            "Nota interna opcional (ej. 'lote BCI 2026-05-14' o "
            "'comprobante #12345'). Queda en audit log."
        ),
    )
    movimiento_id: int | None = Field(
        default=None,
        description="ID de core.movimientos a vincular (opcional).",
    )


class BulkExecuteRequest(BaseModel):
    """Etapa A — POST /vouchers/bulk-execute.

    Marca N vouchers APPROVED como EXECUTED en una sola llamada.
    Pensado para uso post-transferencia masiva: el user descargo el
    Excel desde /transferencias, subio al banco, y ahora confirma que
    se ejecutaron todos.
    """

    voucher_ids: list[int] = Field(min_length=1, max_length=500)
    fecha_ejecucion: date | None = Field(
        default=None,
        description="Fecha real de las transferencias (default: hoy).",
    )
    nota: str | None = Field(
        default=None,
        max_length=300,
        description="Nota comun a todos (ej. 'lote BCI 2026-05-14').",
    )


class BulkExecuteResponse(BaseModel):
    succeeded: int
    failed: int
    executed_codes: list[str] = []
    failures: list[dict] = []  # [{voucher_id, codigo?, reason}]


# =====================================================================
# V5++ ola CI — Mis aprobaciones pendientes
# =====================================================================
#
# Endpoint dedicado para que el aprobador vea de un golpe TODOS los
# vouchers que esperan SU firma como proximo paso (across empresas).
# Antes habia que ir a /vouchers, filtrar PENDING, y abrir cada uno
# para saber si era su turno. Ahora la pantalla /aprobaciones consume
# este endpoint y lista solo los que requieren su accion.


class MisPendientesItem(BaseModel):
    """Una fila de la pantalla "mis aprobaciones pendientes"."""

    voucher_id: int
    codigo: str
    empresa_codigo: str
    empresa_razon_social: str | None
    tipo: str
    fecha_contable: date
    fecha_creacion: datetime
    contraparte_nombre: str | None
    contraparte_rut: str | None
    doc_tributario_tipo: str | None
    doc_tributario_folio: str | None
    glosa: str | None
    moneda: str
    total: Decimal
    creador_email: str | None
    # Info del flujo de aprobacion para este voucher:
    mi_rol_para_firmar: str  # "GG" / "COO" / ...
    rol_label: str  # nombre humano del rol
    firmas_hechas: int
    firmas_totales: int
    matched_rule_descripcion: str | None
    reinforced: bool
    dias_pendiente: int
    # Adjunto: link al primer documento si existe (factura/boleta)
    primer_adjunto_dropbox_path: str | None
    # V5++ ola CJ — attachment_id del primer adjunto, para que el FE
    # pueda linkear directo a /vouchers/{vid}/attachments/{aid}/url
    primer_adjunto_id: int | None


class MisPendientesResponse(BaseModel):
    total: int
    items: list[MisPendientesItem]


_ROLE_LABELS: dict[str, str] = {
    "GG": "Gerente General",
    "COO": "COO / Compliance",
    "CONTADOR": "Contador",
    "OPERADOR": "Operador",
    "DIRECTOR": "Director",
    "TESORERIA": "Tesorería",
}


@router.get("/vouchers/mis-pendientes", response_model=MisPendientesResponse)
async def list_mis_pendientes(
    user: CurrentUser, db: DBSession
) -> MisPendientesResponse:
    """Lista los vouchers PENDING donde el current user es el proximo aprobador.

    Logica:
      1. Empresas donde el user tiene algun rol activo (user_company_roles)
      2. Vouchers PENDING en esas empresas
      3. Para cada voucher: cargar approval state (rule + approvals)
      4. Filtrar: solo los que `next_pending_role` esta en los roles del
         user en esa empresa. Excluir vouchers donde el user ya firmo
         (anti-doble-firma del flujo).
      5. Devolver ordenado por dias_pendiente DESC (los mas urgentes primero)

    Sin paginacion porque tipicamente el aprobador tiene <20 pendientes.
    Si crece, agregar `?limit=N&offset=M` despues.
    """
    # 1. Roles del user por empresa
    rows = (await db.execute(
        text(
            """
            SELECT empresa_codigo,
                   ARRAY_AGG(role ORDER BY role) AS roles
            FROM core.user_company_roles
            WHERE user_id = CAST(:u AS UUID)
              AND active = TRUE
            GROUP BY empresa_codigo
            """
        ),
        {"u": str(user.sub)},
    )).mappings().all()
    user_roles_by_empresa: dict[str, set[str]] = {
        r["empresa_codigo"]: set(r["roles"]) for r in rows
    }
    if not user_roles_by_empresa:
        return MisPendientesResponse(total=0, items=[])

    # 2. Vouchers PENDING en las empresas donde tengo roles
    vouchers_rows = (await db.execute(
        text(
            """
            SELECT
                v.voucher_id, v.codigo, v.empresa_codigo, v.tipo,
                v.fecha_contable, v.created_at AS fecha_creacion,
                v.contraparte_nombre, v.contraparte_rut,
                v.doc_tributario_tipo, v.doc_tributario_folio,
                v.glosa, v.moneda, v.total_debit AS total,
                v.created_by,
                e.razon_social AS empresa_razon_social,
                u.email AS creador_email,
                (SELECT dropbox_path FROM core.voucher_attachments va
                  WHERE va.voucher_id = v.voucher_id
                  ORDER BY va.uploaded_at ASC LIMIT 1) AS primer_adjunto,
                (SELECT attachment_id FROM core.voucher_attachments va2
                  WHERE va2.voucher_id = v.voucher_id
                  ORDER BY va2.uploaded_at ASC LIMIT 1) AS primer_adjunto_id
            FROM core.vouchers v
            LEFT JOIN core.empresas e ON e.codigo = v.empresa_codigo
            LEFT JOIN auth.users u ON u.id::TEXT = v.created_by::TEXT
            WHERE v.status = 'PENDING'
              AND v.empresa_codigo = ANY(CAST(:empresas AS text[]))
            ORDER BY v.created_at ASC
            """
        ),
        {"empresas": list(user_roles_by_empresa.keys())},
    )).mappings().all()

    if not vouchers_rows:
        return MisPendientesResponse(total=0, items=[])

    # V5++ ola CJ — PERF FIX para N+1 reportado por audit (4.8s con 30
    # vouchers PENDING). En lugar de hacer 2 queries por voucher dentro
    # del loop (`get_voucher_balance_treatment_dominante` + `get_voucher_approvals`),
    # cargamos AMBAS en bulk con un solo `WHERE voucher_id = ANY(:ids)`.

    voucher_ids = [vr["voucher_id"] for vr in vouchers_rows]

    # Bulk balance_treatment dominante: tipo dominante por voucher.
    # ACTIVACION > GASTO > NA (hipotesis pesimista).
    bt_rows = (await db.execute(
        text(
            """
            SELECT
                voucher_id,
                COUNT(*) FILTER (WHERE balance_treatment = 'ACTIVACION') AS act,
                COUNT(*) FILTER (WHERE balance_treatment = 'GASTO')      AS gas,
                COUNT(*) FILTER (WHERE balance_treatment = 'NA')         AS na
            FROM core.voucher_lines
            WHERE voucher_id = ANY(:ids)
            GROUP BY voucher_id
            """
        ),
        {"ids": voucher_ids},
    )).mappings().all()
    bt_by_voucher: dict[int, str | None] = {}
    for r in bt_rows:
        if (r["act"] or 0) > 0:
            bt_by_voucher[r["voucher_id"]] = "ACTIVACION"
        elif (r["gas"] or 0) > 0:
            bt_by_voucher[r["voucher_id"]] = "GASTO"
        elif (r["na"] or 0) > 0:
            bt_by_voucher[r["voucher_id"]] = "NA"
        else:
            bt_by_voucher[r["voucher_id"]] = None

    # Bulk approvals: todas las aprobaciones de todos los vouchers en una.
    appr_rows = (await db.execute(
        text(
            """
            SELECT voucher_id, order_num, role, decision,
                   approver_user_id::text AS approver_user_id
            FROM core.voucher_approvals
            WHERE voucher_id = ANY(:ids)
            ORDER BY voucher_id, order_num
            """
        ),
        {"ids": voucher_ids},
    )).mappings().all()
    approvals_by_voucher: dict[int, list[dict[str, Any]]] = {}
    for a in appr_rows:
        approvals_by_voucher.setdefault(a["voucher_id"], []).append(dict(a))

    items: list[MisPendientesItem] = []
    rules_cache: dict[str, list[dict[str, Any]]] = {}
    now = datetime.now(tz=UTC)

    for vr in vouchers_rows:
        empresa = vr["empresa_codigo"]
        if empresa not in rules_cache:
            rules_cache[empresa] = await load_active_rules(db, empresa)
        rules = rules_cache[empresa]
        bt = bt_by_voucher.get(vr["voucher_id"])
        rule = find_matching_rule(
            rules,
            voucher_tipo=vr["tipo"],
            voucher_amount=vr["total"],
            balance_treatment_dominante=bt,
        )
        if rule is None:
            # Sin regla matching no se puede aprobar → el endpoint NO
            # devuelve estos (mostraria el rol pendiente como undefined).
            continue
        required_roles = list(rule["required_roles"])
        approvals_raw = approvals_by_voucher.get(vr["voucher_id"], [])
        approved_orders = {
            a["order_num"] for a in approvals_raw if a["decision"] == "APPROVED"
        }
        # Identificar siguiente rol pendiente
        next_role: str | None = None
        for i, role in enumerate(required_roles, start=1):
            if i not in approved_orders:
                next_role = role
                break
        if next_role is None:
            # Ya tiene todas las firmas — no deberia estar PENDING pero
            # por defensa lo skipeamos.
            continue
        # ¿El user tiene ese rol activo en esa empresa?
        if next_role not in user_roles_by_empresa.get(empresa, set()):
            continue
        # Anti-doble-firma: si ya firmo otro paso en este voucher.
        if any(a["approver_user_id"] == str(user.sub) for a in approvals_raw):
            continue

        fecha_creacion = vr["fecha_creacion"]
        if fecha_creacion.tzinfo is None:
            fecha_creacion = fecha_creacion.replace(tzinfo=UTC)
        dias_pendiente = (now - fecha_creacion).days

        items.append(MisPendientesItem(
            voucher_id=vr["voucher_id"],
            codigo=vr["codigo"],
            empresa_codigo=empresa,
            empresa_razon_social=vr["empresa_razon_social"],
            tipo=vr["tipo"],
            fecha_contable=vr["fecha_contable"],
            fecha_creacion=fecha_creacion,
            contraparte_nombre=vr["contraparte_nombre"],
            contraparte_rut=vr["contraparte_rut"],
            doc_tributario_tipo=vr["doc_tributario_tipo"],
            doc_tributario_folio=vr["doc_tributario_folio"],
            glosa=vr["glosa"],
            moneda=vr["moneda"] or "CLP",
            total=Decimal(vr["total"] or 0),
            creador_email=vr["creador_email"],
            mi_rol_para_firmar=next_role,
            rol_label=_ROLE_LABELS.get(next_role, next_role),
            firmas_hechas=len(approved_orders),
            firmas_totales=len(required_roles),
            matched_rule_descripcion=rule.get("descripcion"),
            reinforced=bool(rule.get("reforzado")),
            dias_pendiente=dias_pendiente,
            primer_adjunto_dropbox_path=vr["primer_adjunto"],
            primer_adjunto_id=vr["primer_adjunto_id"],
        ))

    # Ordenar por dias_pendiente DESC (mas urgentes primero), luego total DESC.
    items.sort(key=lambda i: (-i.dias_pendiente, -float(i.total)))
    return MisPendientesResponse(total=len(items), items=items)


def _client_ip(request: Request) -> str | None:
    # Fly y Vercel suelen poner la IP real en X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


@router.get(
    "/vouchers/{voucher_id}/approvals",
    response_model=VoucherApprovalsState,
)
async def get_voucher_approvals_state(
    user: CurrentUser, db: DBSession, voucher_id: int
) -> VoucherApprovalsState:
    """Devuelve el estado completo del flujo de aprobación.

    Calcula:
      1. La regla que matchea (por monto + tipo + balance treatment).
      2. Roles requeridos (en orden) y cuáles ya firmaron.
      3. Cuál es el próximo rol pendiente.
      4. Si el usuario actual puede firmar el siguiente paso.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )

    # Match rule
    rules = await load_active_rules(db, voucher.empresa_codigo)
    bt = await get_voucher_balance_treatment_dominante(db, voucher_id)
    rule = find_matching_rule(
        rules,
        voucher_tipo=voucher.tipo,
        voucher_amount=voucher.total_debit,
        balance_treatment_dominante=bt,
    )

    required_roles = list(rule["required_roles"]) if rule else []
    reinforced = compute_threshold_aplicado(rule)

    # Approvals existentes
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    approvals = [
        VoucherApprovalRead.model_validate(dict(a)) for a in approvals_raw
    ]
    approved_orders = {a.order_num for a in approvals if a.decision == "APPROVED"}

    # Próximo pendiente
    next_pending_role: str | None = None
    next_pending_order: int | None = None
    for i, role in enumerate(required_roles, start=1):
        if i not in approved_orders:
            next_pending_role = role
            next_pending_order = i
            break

    # Puede el user actual firmar?
    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    # Round 82 — anti-doble-firma alineado con POST /approve (line 2558):
    # si el user ya firmó otro paso de este voucher NO puede firmar otro.
    already_signed = any(
        a.approver_user_id == str(user.sub) and a.decision == "APPROVED"
        for a in approvals
    )
    can_sign = bool(
        next_pending_role
        and voucher.status == "PENDING"
        and next_pending_role in user_roles
        and not already_signed
    )
    eligible_role = next_pending_role if can_sign else None

    # Round 82 — listar emails de quienes SI pueden firmar el next pending,
    # excluyendo a quienes ya firmaron otro paso del mismo voucher.
    next_signers_emails: list[str] = []
    if next_pending_role and voucher.status == "PENDING":
        signers_uids_already = {
            a.approver_user_id for a in approvals if a.decision == "APPROVED"
        }
        signers_rows = (
            await db.execute(
                text(
                    """
                    SELECT au.email, au.id::text AS uid
                    FROM core.user_company_roles ucr
                    JOIN auth.users au ON au.id = ucr.user_id
                    WHERE ucr.empresa_codigo = :e
                      AND ucr.role = :r
                      AND ucr.active = TRUE
                    ORDER BY au.email
                    """
                ),
                {"e": voucher.empresa_codigo, "r": next_pending_role},
            )
        ).mappings().all()
        next_signers_emails = [
            s["email"] for s in signers_rows if s["uid"] not in signers_uids_already
        ]

    return VoucherApprovalsState(
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        voucher_status=voucher.status,
        matched_rule_id=rule["rule_id"] if rule else None,
        matched_rule_descripcion=rule["descripcion"] if rule else None,
        required_roles=required_roles,
        reinforced=reinforced,
        approvals=approvals,
        next_pending_role=next_pending_role,
        next_pending_order=next_pending_order,
        can_current_user_sign=can_sign,
        current_user_eligible_role=eligible_role,
        next_pending_signers_emails=next_signers_emails,
        current_user_already_signed=already_signed,
    )


@router.post(
    "/vouchers/{voucher_id}/approve",
    response_model=VoucherApprovalsState,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def approve_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: ApproveRequest,
) -> VoucherApprovalsState:
    """Firma del rol indicado.

    Validaciones:
      - Voucher existe y está en PENDING
      - User tiene el rol declarado activo en la empresa del voucher
      - El rol corresponde al próximo paso pendiente del flujo
      - Una vez firmado el último paso, el voucher pasa a APPROVED
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if voucher.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers PENDING aceptan firmas (este está en {voucher.status})",
        )

    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    if body.role not in user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"No tenés el rol '{body.role}' activo en empresa "
                f"{voucher.empresa_codigo}. Roles disponibles: "
                f"{user_roles or 'ninguno'}"
            ),
        )

    rules = await load_active_rules(db, voucher.empresa_codigo)
    bt = await get_voucher_balance_treatment_dominante(db, voucher_id)
    rule = find_matching_rule(
        rules,
        voucher_tipo=voucher.tipo,
        voucher_amount=voucher.total_debit,
        balance_treatment_dominante=bt,
    )
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No hay regla de aprobación configurada para este voucher. "
                "Configurá las reglas en /admin/approval-rules antes de aprobar."
            ),
        )

    required_roles = list(rule["required_roles"])
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    approved_orders = {
        a["order_num"] for a in approvals_raw if a["decision"] == "APPROVED"
    }

    # Identificar próximo paso pendiente
    next_order: int | None = None
    expected_role: str | None = None
    for i, role in enumerate(required_roles, start=1):
        if i not in approved_orders:
            next_order = i
            expected_role = role
            break

    # Round 84 — idempotencia: si el user YA firmó el rol que esta solicitando
    # (escenario tipico de doble-click rapido o reintento de cliente), devolver
    # 200 con el state actual en vez de tirar 400 confuso. Solo idempotente
    # cuando el user pidio firmar como X y ya hay una firma APPROVED de X por
    # este mismo user.
    user_already_signed_this_role = any(
        a["approver_user_id"] == str(user.sub)
        and a["role"] == body.role
        and a["decision"] == "APPROVED"
        for a in approvals_raw
    )
    if user_already_signed_this_role:
        return await get_voucher_approvals_state(user, db, voucher_id)

    if next_order is None or expected_role is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El voucher ya tiene todas las firmas requeridas",
        )
    if body.role != expected_role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El próximo rol que debe firmar es '{expected_role}', "
                f"no '{body.role}'. Las firmas son secuenciales."
            ),
        )

    # Anti-doble-firma: el mismo user no puede firmar dos pasos del mismo voucher
    user_already_signed = any(
        a["approver_user_id"] == str(user.sub) for a in approvals_raw
    )
    if user_already_signed and len(required_roles) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ya firmaste este voucher con otro rol. La separación de "
                "responsabilidades exige firmas de personas distintas."
            ),
        )

    # Firmar
    await record_approval_signature(
        db,
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        approver_user_id=str(user.sub),
        role=body.role,
        order_num=next_order,
        decision="APPROVED",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        comments=body.comments,
    )

    # Si fue la última firma, voucher → APPROVED
    just_approved = False
    if next_order == len(required_roles):
        voucher.status = "APPROVED"
        voucher.threshold_aplicado = compute_threshold_aplicado(rule)
        just_approved = True

    await db.commit()

    # V5++ ola BL — Audit log de la firma para la Bitácora
    try:
        await audit_log(
            db, request, user,
            action="approve",
            entity_type="voucher",
            entity_id=str(voucher.voucher_id),
            entity_label=voucher.codigo,
            summary=(
                f"Voucher {voucher.codigo} firmado como {body.role} "
                f"({next_order}/{len(required_roles)}) "
                f"— {voucher.empresa_codigo} — "
                f"${voucher.total_debit:,.0f}"
                + (" → APPROVED ✓" if just_approved else "")
            ),
            before=None,
            after={
                "voucher_id": voucher.voucher_id,
                "role_signed": body.role,
                "step": f"{next_order}/{len(required_roles)}",
                "new_status": voucher.status,
                "just_approved": just_approved,
                "comments": body.comments,
            },
        )
    except Exception:
        pass

    # V5++ ola N: webhook saliente voucher.approved → sistemas externos.
    # Soft-fail: si nadie está suscripto, no hace nada. Ejecuta async
    # en background para no demorar la response del approve.
    if just_approved:
        try:
            from app.services.webhook_dispatcher import publish_event

            await publish_event(
                db,
                "voucher.approved",
                {
                    "voucher_id": voucher.voucher_id,
                    "voucher_codigo": voucher.codigo,
                    "empresa_codigo": voucher.empresa_codigo,
                    "tipo": voucher.tipo,
                    "total_debit": str(voucher.total_debit),
                    "fecha_contable": voucher.fecha_contable.isoformat()
                    if voucher.fecha_contable
                    else None,
                    "approved_by": str(user.sub),
                    "approved_at": datetime.utcnow().isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            # Webhook no crítico — no romper la firma del voucher
            import structlog

            structlog.get_logger(__name__).warning(
                "voucher.approved.webhook_failed",
                voucher_id=voucher.voucher_id,
                error=str(exc),
            )

        # V5++ ola O: Slack ping si el monto supera threshold
        try:
            from app.services.slack_service import notify_voucher_approved

            await notify_voucher_approved(
                voucher_codigo=voucher.codigo,
                empresa_codigo=voucher.empresa_codigo,
                tipo=voucher.tipo,
                total_clp=int(voucher.total_debit),
                approved_by=str(user.sub),
            )
        except Exception:
            pass  # Soft-fail

    return await get_voucher_approvals_state(user, db, voucher_id)


@router.post(
    "/vouchers/{voucher_id}/reject",
    response_model=VoucherApprovalsState,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def reject_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: RejectRequest,
) -> VoucherApprovalsState:
    """Rechaza el voucher con razón. Pasa a REJECTED.

    Cualquier rol asignado en la empresa puede rechazar (no solo el
    aprobador del paso actual). Esto permite que un Director frene un
    voucher dudoso aunque no le toque firmar el siguiente paso.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if voucher.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers PENDING pueden rechazarse (este está en {voucher.status})",
        )

    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    if not user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"No tenés rol asignado en empresa {voucher.empresa_codigo}. "
                "El rechazo lo hace alguien con rol operativo en la empresa."
            ),
        )

    # Registrar rechazo en approvals (orden_num = siguiente disponible)
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    next_order = (
        max((a["order_num"] for a in approvals_raw), default=0) + 1
    )

    await record_approval_signature(
        db,
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        approver_user_id=str(user.sub),
        role=user_roles[0],  # cualquiera de los roles activos
        order_num=next_order,
        decision="REJECTED",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        comments=body.reason,
    )

    voucher.status = "REJECTED"
    voucher.rejection_reason = body.reason.strip()
    await db.commit()

    # V5++ ola BL — Audit log de rechazo para la Bitácora
    try:
        await audit_log(
            db, request, user,
            action="reject",
            entity_type="voucher",
            entity_id=str(voucher.voucher_id),
            entity_label=voucher.codigo,
            summary=(
                f"Voucher {voucher.codigo} RECHAZADO por {user.email} — "
                f"razón: {body.reason[:80]}"
            ),
            before={"status": "PENDING"},
            after={
                "status": "REJECTED",
                "rejection_reason": body.reason,
                "rejected_by_role": user_roles[0],
            },
        )
    except Exception:
        pass

    return await get_voucher_approvals_state(user, db, voucher_id)


# ============================================================================
# Etapa B — Timeline visual + navegacion prev/next
# ============================================================================


@router.get("/vouchers/{voucher_id}/timeline")
async def get_voucher_timeline(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
) -> dict:
    """Devuelve la timeline cronologica del voucher.

    Combina:
      - audit.action_log filtrado por entity_type='voucher' + entity_id
      - voucher.created_at como evento inicial (created)
      - voucher_approvals (firmas individuales con role + comments)

    Ordenado cronologicamente del mas antiguo al mas reciente. Pensado
    para mostrar como timeline visual en el detail del voucher.
    """
    # Existence + scope
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    # action_log entries para este voucher
    log_rows = (
        await db.execute(
            text(
                """
                SELECT
                    action_log_id, user_email, action, summary,
                    diff_before, diff_after, created_at
                FROM audit.action_log
                WHERE entity_type = 'voucher' AND entity_id = :eid
                ORDER BY created_at ASC
                LIMIT 200
                """
            ),
            {"eid": str(voucher_id)},
        )
    ).mappings().all()

    # Approvals para enriquecer firmas con rol + comments
    appr_rows = (
        await db.execute(
            text(
                """
                SELECT
                    role, decision, order_num, comments, signed_at,
                    approver_user_id
                FROM core.voucher_approvals
                WHERE voucher_id = :vid
                ORDER BY signed_at ASC
                """
            ),
            {"vid": voucher_id},
        )
    ).mappings().all()

    # Resolver emails de los approvers para mostrar nombre amigable
    approver_emails: dict[str, str] = {}
    if appr_rows:
        approver_ids = list({str(r["approver_user_id"]) for r in appr_rows if r["approver_user_id"]})
        if approver_ids:
            emails_rows = (
                await db.execute(
                    text(
                        """
                        SELECT id::text AS uid, email
                        FROM auth.users
                        WHERE id::text = ANY(:ids)
                        """
                    ),
                    {"ids": approver_ids},
                )
            ).mappings().all()
            approver_emails = {r["uid"]: r["email"] for r in emails_rows}

    events: list[dict] = []

    # Evento "creado"
    events.append(
        {
            "type": "created",
            "icon": "plus",
            "title": "Voucher creado",
            "subtitle": f"Status inicial: DRAFT — {voucher.codigo}",
            "user_email": None,  # action_log de "create" si existe lo enriquece
            "timestamp": voucher.created_at.isoformat() if voucher.created_at else None,
            "color": "ink",
        }
    )

    # Eventos del action_log
    for r in log_rows:
        action = r["action"]
        # Mapear action → tipo visual
        if action.startswith("approve"):
            ev_type = "approved"
            color = "green"
            icon = "check"
        elif action.startswith("reject"):
            ev_type = "rejected"
            color = "red"
            icon = "x"
        elif action.startswith("execute"):
            ev_type = "executed"
            color = "blue"
            icon = "wallet"
        elif action.startswith("create"):
            # Ya emitido como evento inicial, salteamos
            continue
        elif action.startswith("update") or action.startswith("edit"):
            ev_type = "updated"
            color = "amber"
            icon = "edit"
        elif action.startswith("void") or action.startswith("delete"):
            ev_type = "voided"
            color = "red"
            icon = "trash"
        elif action.startswith("export"):
            ev_type = "exported"
            color = "purple"
            icon = "download"
        else:
            ev_type = "other"
            color = "ink"
            icon = "dot"

        events.append(
            {
                "type": ev_type,
                "icon": icon,
                "title": _action_to_title(action),
                "subtitle": (r["summary"] or "")[:200],
                "user_email": r["user_email"],
                "timestamp": (
                    r["created_at"].isoformat() if r["created_at"] else None
                ),
                "color": color,
                "action_raw": action,
            }
        )

    # Eventos de firma individual (mas detalle que action_log resumido)
    for r in appr_rows:
        if r["decision"] != "APPROVED":
            continue  # rejects ya aparecen en action_log
        email = approver_emails.get(str(r["approver_user_id"]), None)
        events.append(
            {
                "type": "signature",
                "icon": "signature",
                "title": f"Firma {r['role']} (paso {r['order_num']})",
                "subtitle": r["comments"] or "Sin comentarios",
                "user_email": email,
                "timestamp": (
                    r["signed_at"].isoformat() if r["signed_at"] else None
                ),
                "color": "green",
            }
        )

    # Sort por timestamp (algunos pueden ser None)
    events.sort(key=lambda e: e["timestamp"] or "")

    return {
        "voucher_id": voucher_id,
        "codigo": voucher.codigo,
        "current_status": voucher.status,
        "events": events,
        "count": len(events),
    }


def _action_to_title(action: str) -> str:
    """Mapea action_log.action → titulo legible para timeline."""
    mapping = {
        "create": "Voucher creado",
        "create_nubox_form": "Voucher creado (form Nubox)",
        "update": "Voucher editado",
        "submit": "Enviado a aprobación",
        "approve": "Firmado",
        "approve_bulk": "Firmado en bulk",
        "reject": "Rechazado",
        "execute": "Marcado como pagado",
        "execute_bulk": "Marcado pagado en bulk",
        "void": "Anulado",
        "delete": "Eliminado",
        "export_transferencia_masiva": "Exportado a Excel transferencia",
    }
    return mapping.get(action, action.replace("_", " ").capitalize())


@router.get("/vouchers/{voucher_id}/neighbors")
async def get_voucher_neighbors(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    voucher_id: int,
) -> dict:
    """Etapa B — devuelve prev_id y next_id para navegacion en detail page.

    Considera solo vouchers a los que el user tiene scope. Order por
    voucher_id DESC (consistente con la lista por default).
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    where_scope = ""
    params: dict = {"vid": voucher_id}
    if not scope.is_global:
        allowed = list(scope.allowed_codes or [])
        if not allowed:
            return {"prev_id": None, "next_id": None}
        where_scope = "AND empresa_codigo = ANY(CAST(:scope AS text[]))"
        params["scope"] = allowed

    # next_id (mas reciente que el actual, en order DESC eso significa
    # voucher_id menor) — pero para navegacion natural (siguiente al
    # mas reciente), el "siguiente" es voucher_id > actual.
    # Convencion: next = "mas reciente que el actual" (voucher_id > vid)
    #             prev = "mas antiguo" (voucher_id < vid)
    next_row = (
        await db.execute(
            text(
                f"""
                SELECT voucher_id
                FROM core.vouchers
                WHERE voucher_id > :vid
                  {where_scope}
                ORDER BY voucher_id ASC
                LIMIT 1
                """
            ),
            params,
        )
    ).first()
    prev_row = (
        await db.execute(
            text(
                f"""
                SELECT voucher_id
                FROM core.vouchers
                WHERE voucher_id < :vid
                  {where_scope}
                ORDER BY voucher_id DESC
                LIMIT 1
                """
            ),
            params,
        )
    ).first()

    return {
        "current_id": voucher_id,
        "prev_id": prev_row[0] if prev_row else None,
        "next_id": next_row[0] if next_row else None,
    }


# ============================================================================
# Etapa A — bulk-execute: marcar N vouchers APPROVED como EXECUTED
# ============================================================================
#
# Cierra el loop de Round 11 (transferencia masiva). Despues de descargar
# el Excel y subirlo al banco, el user vuelve a /transferencias y marca
# en bulk los que ya se ejecutaron. Sin esto, tendria que entrar a cada
# voucher uno por uno — friccion alta para 20+ pagos.


@router.post(
    "/vouchers/{voucher_id}/execute",
    dependencies=[Depends(require_scope("voucher:execute"))],
)
async def execute_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("voucher:execute"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: ExecuteRequest,
) -> dict:
    """Marca un voucher APPROVED como EXECUTED (pago confirmado).

    Validaciones:
      - voucher debe existir y estar APPROVED.
      - scope multi-tenant: user debe tener acceso a la empresa.
      - fecha_ejecucion no puede ser futura (>1d permitido por timezone).
      - movimiento_id opcional, si se pasa debe existir y ser de la misma
        empresa (conciliacion explicita).
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    await assert_empresa_access(user, db, voucher.empresa_codigo)

    if voucher.status != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo vouchers APPROVED pueden marcarse como EXECUTED "
                f"(este esta en {voucher.status})"
            ),
        )

    fecha_ej = body.fecha_ejecucion or date.today()
    if fecha_ej > date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"fecha_ejecucion {fecha_ej.isoformat()} es futura. La "
                "transferencia tuvo que haber pasado para marcarla como EXECUTED."
            ),
        )

    # Conciliacion opcional con movimiento bancario
    if body.movimiento_id is not None:
        mov_check = (
            await db.execute(
                text(
                    """
                    SELECT empresa_codigo FROM core.movimientos
                    WHERE movimiento_id = :mid
                    """
                ),
                {"mid": body.movimiento_id},
            )
        ).first()
        if not mov_check:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Movimiento {body.movimiento_id} no existe",
            )
        if mov_check[0] != voucher.empresa_codigo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Movimiento {body.movimiento_id} pertenece a otra "
                    f"empresa ({mov_check[0]} vs {voucher.empresa_codigo})"
                ),
            )
        voucher.movimiento_id = body.movimiento_id

    voucher.status = "EXECUTED"
    voucher.fecha_ejecucion = fecha_ej
    await db.commit()

    try:
        await audit_log(
            db, request, user,
            action="execute",
            entity_type="voucher",
            entity_id=str(voucher.voucher_id),
            entity_label=voucher.codigo,
            summary=(
                f"Voucher {voucher.codigo} EXECUTED — fecha {fecha_ej.isoformat()}"
                + (f" — {body.nota[:80]}" if body.nota else "")
                + (f" — link mov #{body.movimiento_id}" if body.movimiento_id else "")
            ),
            before={"status": "APPROVED"},
            after={
                "status": "EXECUTED",
                "fecha_ejecucion": fecha_ej.isoformat(),
                "nota": body.nota,
                "movimiento_id": body.movimiento_id,
            },
        )
    except Exception:
        pass

    return {
        "voucher_id": voucher.voucher_id,
        "codigo": voucher.codigo,
        "status": "EXECUTED",
        "fecha_ejecucion": fecha_ej.isoformat(),
    }


@router.post(
    "/vouchers/bulk-execute",
    response_model=BulkExecuteResponse,
    dependencies=[Depends(require_scope("voucher:execute"))],
)
@limiter.limit("10/minute")
async def bulk_execute_vouchers(
    user: Annotated[AuthenticatedUser, Depends(require_scope("voucher:execute"))],
    db: DBSession,
    request: Request,
    body: BulkExecuteRequest,
) -> BulkExecuteResponse:
    """Marca N vouchers APPROVED como EXECUTED en una sola llamada.

    Procesa secuencialmente con commit por voucher para que un fallo
    parcial no rollback todo. Devuelve resumen con succeeded/failed +
    detalles para que el FE muestre que paso con cada uno.

    Validaciones por voucher:
      - existe + scope.
      - status APPROVED (skip los que no).
      - fecha_ejecucion no futura.
    """
    fecha_ej = body.fecha_ejecucion or date.today()
    if fecha_ej > date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"fecha_ejecucion {fecha_ej.isoformat()} es futura.",
        )

    succeeded: list[str] = []
    failures: list[dict] = []

    for vid in body.voucher_ids:
        try:
            voucher = await db.get(Voucher, vid)
            if voucher is None:
                failures.append(
                    {"voucher_id": vid, "reason": "Voucher no encontrado"}
                )
                continue
            # Scope check inline (sin raise — capturamos como failure)
            try:
                await assert_empresa_access(user, db, voucher.empresa_codigo)
            except HTTPException as exc:
                failures.append(
                    {
                        "voucher_id": vid,
                        "codigo": voucher.codigo,
                        "reason": f"Sin acceso a empresa {voucher.empresa_codigo}",
                    }
                )
                continue

            if voucher.status != "APPROVED":
                failures.append(
                    {
                        "voucher_id": vid,
                        "codigo": voucher.codigo,
                        "reason": (
                            f"Status actual {voucher.status} — solo APPROVED es elegible"
                        ),
                    }
                )
                continue

            voucher.status = "EXECUTED"
            voucher.fecha_ejecucion = fecha_ej
            await db.commit()
            succeeded.append(voucher.codigo)

            # Audit log per voucher (no rompe si falla)
            try:
                await audit_log(
                    db, request, user,
                    action="execute_bulk",
                    entity_type="voucher",
                    entity_id=str(voucher.voucher_id),
                    entity_label=voucher.codigo,
                    summary=(
                        f"Voucher {voucher.codigo} EXECUTED (bulk) — "
                        f"{fecha_ej.isoformat()}"
                        + (f" — {body.nota[:80]}" if body.nota else "")
                    ),
                    before={"status": "APPROVED"},
                    after={
                        "status": "EXECUTED",
                        "fecha_ejecucion": fecha_ej.isoformat(),
                        "nota": body.nota,
                        "via": "bulk",
                    },
                )
            except Exception:
                pass

        except Exception as exc:
            # Errores inesperados — log y siguiente
            await db.rollback()
            import structlog

            structlog.get_logger(__name__).warning(
                "bulk_execute_voucher_failed",
                voucher_id=vid,
                error=str(exc),
            )
            failures.append({"voucher_id": vid, "reason": "Error interno"})

    return BulkExecuteResponse(
        succeeded=len(succeeded),
        failed=len(failures),
        executed_codes=succeeded,
        failures=failures,
    )


# ============================================================================
# Etapa K — bulk-delete-drafts: limpieza de borradores acumulados
# ============================================================================


class BulkDeleteDraftsRequest(BaseModel):
    """POST /vouchers/bulk-delete-drafts — borrar N vouchers en estado DRAFT.

    Solo procesa los que efectivamente esten en DRAFT (skip los que cambiaron
    de estado entre la seleccion y la ejecucion). Otros estados van a
    `failures`. No tocamos PENDING+ (esos requieren VOID).
    """

    voucher_ids: list[int] = Field(min_length=1, max_length=200)


class BulkDeleteDraftsResponse(BaseModel):
    succeeded: int
    failed: int
    deleted_codes: list[str] = []
    failures: list[dict] = []


@router.post(
    "/vouchers/bulk-delete-drafts",
    response_model=BulkDeleteDraftsResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
@limiter.limit("10/minute")
async def bulk_delete_drafts(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    body: BulkDeleteDraftsRequest,
) -> BulkDeleteDraftsResponse:
    """Etapa K — limpia DRAFT acumulados que el operador nunca envio a aprobacion.

    Caso de uso: import IA crea 30 borradores, 15 son utiles y 15 son
    duplicados/incorrectos. Borrarlos uno por uno = 15 clicks + 15 confirms.
    Aca = 1 modal con N IDs.

    Validaciones por voucher (errores van a failures, no rompen lote):
      - existe + scope
      - status DRAFT (otros van a failures con razon explicita)
    """
    succeeded: list[str] = []
    failures: list[dict] = []

    for vid in body.voucher_ids:
        try:
            v = await db.get(Voucher, vid)
            if v is None:
                failures.append({"voucher_id": vid, "reason": "No encontrado"})
                continue
            try:
                await assert_empresa_access(user, db, v.empresa_codigo)
            except HTTPException:
                failures.append(
                    {
                        "voucher_id": vid,
                        "codigo": v.codigo,
                        "reason": f"Sin acceso a empresa {v.empresa_codigo}",
                    }
                )
                continue
            if v.status != "DRAFT":
                failures.append(
                    {
                        "voucher_id": vid,
                        "codigo": v.codigo,
                        "reason": (
                            f"Status {v.status} — solo DRAFT puede borrarse. "
                            "Para anular usar void."
                        ),
                    }
                )
                continue
            codigo_prev = v.codigo
            empresa_prev = v.empresa_codigo
            await db.delete(v)
            await db.commit()
            succeeded.append(codigo_prev)
            try:
                await audit_log(
                    db, request, user,
                    action="delete_bulk",
                    entity_type="voucher",
                    entity_id=str(vid),
                    entity_label=codigo_prev,
                    summary=(
                        f"Voucher {codigo_prev} DRAFT borrado en bulk "
                        f"({empresa_prev})"
                    ),
                    before={"status": "DRAFT"},
                    after={"deleted": True, "via": "bulk"},
                )
            except Exception:
                pass
        except Exception as exc:
            await db.rollback()
            import structlog
            structlog.get_logger(__name__).warning(
                "bulk_delete_voucher_failed",
                voucher_id=vid,
                error=str(exc),
            )
            failures.append({"voucher_id": vid, "reason": "Error interno"})

    return BulkDeleteDraftsResponse(
        succeeded=len(succeeded),
        failed=len(failures),
        deleted_codes=succeeded,
        failures=failures,
    )


# ============================================================================
# AI auto-fill — V5++: crear voucher DRAFT desde factura PDF en Dropbox
# ============================================================================


class VoucherFromFacturaRequest(BaseModel):
    """POST /vouchers/from-factura-pdf — crea voucher DRAFT desde factura PDF.

    Usa document_analyzer_service (Claude) para extraer:
      - proveedor_rut + proveedor_nombre
      - numero_factura (folio)
      - fecha
      - monto_neto + iva + total
      - descripcion (glosa)

    Y crea un voucher tipo COMPRA en estado DRAFT con esos datos
    pre-llenados. El user revisa, completa imputación contable
    (cuenta + proyecto + área), y envía a aprobación.
    """

    empresa_codigo: str = Field(..., description="Empresa que recibe la factura")
    dropbox_path: str = Field(..., description="Path en Dropbox del PDF")


class VoucherFromFacturaResponse(BaseModel):
    voucher_id: int
    voucher_codigo: str
    extracted: dict
    warnings: list[str] = []


@router.post(
    "/vouchers/from-factura-pdf",
    response_model=VoucherFromFacturaResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_voucher_from_factura_pdf(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: VoucherFromFacturaRequest,
) -> VoucherFromFacturaResponse:
    """Crea voucher COMPRA DRAFT con datos extraídos de un PDF factura.

    Flujo:
      1. Descarga el PDF de Dropbox
      2. Extrae texto con pypdf (fallback OCR si está configurado)
      3. Llama Claude con schema 'factura' → obtiene proveedor, monto, fecha
      4. Genera código voucher (next_voucher_code en DB)
      5. INSERT voucher con líneas vacías — user completa imputación

    El voucher queda en DRAFT con líneas con descripción de la factura
    pero sin cuenta_codigo / proyecto / area (los completa el user).

    Soft-fail: si Claude no está configurado o el PDF está corrupto,
    devuelve 503/422 con detalle.
    """
    from app.services.document_analyzer_service import (
        DocumentAnalyzerNotConfigured,
        analyze_document,
        extract_text_pdf_with_fallback,
    )
    from app.services.dropbox_service import (
        DropboxNotConfigured,
        DropboxService,
    )

    # 1. Descargar PDF
    try:
        dbx = DropboxService()
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        content = dbx.download_file(body.dropbox_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se pudo descargar {body.dropbox_path}: {exc}",
        ) from exc

    # 2. Extraer texto
    try:
        text_extracted, extraction_meta = extract_text_pdf_with_fallback(content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No se pudo extraer texto del PDF: {exc}",
        ) from exc

    if not text_extracted or len(text_extracted.strip()) < 30:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "PDF parece escaneado y OCR no está disponible. "
                "Convertí el PDF a digital o pegá los datos manualmente."
            ),
        )

    # 3. Analizar con Claude
    try:
        extraction = await analyze_document(
            text_extracted,
            tipo="factura",
            filename=body.dropbox_path.rsplit("/", 1)[-1],
            extraction_method=extraction_meta.get("method"),
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    fields = extraction.fields if hasattr(extraction, "fields") else {}
    warnings = list(getattr(extraction, "warnings", []) or [])

    # 4. Validar empresa
    empresa_existe = await db.scalar(
        text(
            "SELECT 1 FROM core.empresas WHERE codigo = :c"
        ),
        {"c": body.empresa_codigo},
    )
    if not empresa_existe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe",
        )

    # 5. Generar código voucher
    fecha_str = fields.get("fecha") or date.today().isoformat()
    try:
        fecha_voucher = date.fromisoformat(fecha_str)
    except (ValueError, TypeError):
        fecha_voucher = date.today()
        warnings.append(f"Fecha de factura inválida: {fecha_str} (usando hoy)")

    codigo_row = (
        await db.execute(
            text(
                "SELECT core.next_voucher_code(:emp, :anio, 'COMPRA') AS codigo"
            ),
            {"emp": body.empresa_codigo, "anio": fecha_voucher.year},
        )
    ).first()
    voucher_codigo = codigo_row[0] if codigo_row else f"COMPRA-{body.empresa_codigo}-{fecha_voucher.year}-AUTO"

    # 6. INSERT voucher DRAFT
    proveedor_rut = fields.get("proveedor_rut")
    proveedor_nombre = fields.get("proveedor_nombre", "")
    numero_factura = fields.get("numero_factura")
    glosa = (
        fields.get("descripcion")
        or f"Factura {numero_factura or ''} de {proveedor_nombre or 'proveedor'}"
    )[:500]

    voucher_total = (
        Decimal(str(fields.get("total") or 0))
        if fields.get("total")
        else Decimal("0")
    )

    voucher_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.vouchers (
                    codigo, empresa_codigo, tipo, status,
                    fecha_documento, fecha_contable, glosa,
                    contraparte_tipo, contraparte_rut, contraparte_nombre,
                    doc_tributario_tipo, doc_tributario_folio,
                    total_debit, total_credit,
                    created_by
                )
                VALUES (
                    :codigo, :emp, 'COMPRA', 'DRAFT',
                    :fecha, :fecha, :glosa,
                    'PROVEEDOR', :rut, :nombre,
                    'FACTURA', :folio,
                    0, 0,
                    :user
                )
                RETURNING voucher_id
                """
            ),
            {
                "codigo": voucher_codigo,
                "emp": body.empresa_codigo,
                "fecha": fecha_voucher,
                "glosa": glosa,
                "rut": proveedor_rut,
                "nombre": proveedor_nombre[:255] if proveedor_nombre else None,
                "folio": str(numero_factura) if numero_factura else None,
                "user": str(user.sub),
            },
        )
    ).first()
    voucher_id = int(voucher_row[0]) if voucher_row else 0
    await db.commit()

    return VoucherFromFacturaResponse(
        voucher_id=voucher_id,
        voucher_codigo=voucher_codigo,
        extracted={
            "proveedor_rut": proveedor_rut,
            "proveedor_nombre": proveedor_nombre,
            "numero_factura": numero_factura,
            "fecha": fecha_str,
            "monto_neto": fields.get("monto_neto"),
            "iva": fields.get("iva"),
            "total": fields.get("total"),
        },
        warnings=warnings,
    )


# ============================================================================
# Bulk approve — V5+: firma múltiples vouchers PENDING con un solo rol
# ============================================================================


class BulkApproveRequest(BaseModel):
    """POST /vouchers/bulk-approve — firma N vouchers con el mismo rol.

    Caso de uso: el COO (Nicolás) revisa la cola de vouchers PENDING
    al final del día y firma todos los que ya validó técnicamente.
    Cada voucher se valida individualmente — si uno falla, no aborta
    el resto.
    """

    voucher_ids: list[int] = Field(..., min_length=1, max_length=100)
    role: str = Field(description="Rol con el que firma (debe estar activo en cada empresa)")


class BulkApproveItemResult(BaseModel):
    voucher_id: int
    success: bool
    error: str | None = None
    new_status: str | None = None


class BulkApproveResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    items: list[BulkApproveItemResult]


@router.post(
    "/vouchers/bulk-approve",
    response_model=BulkApproveResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
@limiter.limit("10/minute")
async def bulk_approve_vouchers(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    body: BulkApproveRequest,
) -> BulkApproveResponse:
    """Firma múltiples vouchers con el rol indicado. Operación best-effort:
    cada voucher se procesa en su propia transacción; los que fallan no
    abortan los exitosos.

    Validaciones por voucher (mismas que /approve individual):
    - Voucher existe y está en PENDING
    - User tiene el rol activo en la empresa del voucher
    - El rol corresponde al próximo paso pendiente del flujo
    - Una vez firmado el último paso, el voucher pasa a APPROVED

    Idempotente: si un voucher ya fue firmado por este user con este rol,
    no falla — devuelve success=True con su status actual.
    """
    items: list[BulkApproveItemResult] = []

    # Pre-cargar user_id real una sola vez
    user_sub = str(user.sub)

    for vid in body.voucher_ids:
        try:
            voucher = await db.get(Voucher, vid)
            if voucher is None:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error="Voucher no encontrado",
                ))
                continue
            if voucher.status != "PENDING":
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=f"Status {voucher.status} (solo PENDING acepta firmas)",
                    new_status=voucher.status,
                ))
                continue

            user_roles = await load_user_roles_for_empresa(
                db, user_sub, voucher.empresa_codigo
            )
            if body.role not in user_roles:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        f"Sin rol '{body.role}' en {voucher.empresa_codigo}"
                    ),
                ))
                continue

            rules = await load_active_rules(db, voucher.empresa_codigo)
            bt = await get_voucher_balance_treatment_dominante(db, vid)
            rule = find_matching_rule(
                rules,
                voucher_tipo=voucher.tipo,
                voucher_amount=voucher.total_debit,
                balance_treatment_dominante=bt,
            )
            if rule is None:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error="Sin regla de aprobación configurada",
                ))
                continue

            required_roles = list(rule["required_roles"])
            approvals_raw = await get_voucher_approvals(db, vid)
            approved_orders = {
                a["order_num"] for a in approvals_raw if a["decision"] == "APPROVED"
            }

            # Próximo paso pendiente
            next_order = None
            expected_role = None
            for i, role in enumerate(required_roles, start=1):
                if i not in approved_orders:
                    next_order = i
                    expected_role = role
                    break

            if next_order is None:
                # Ya tiene todas las firmas — no debería estar PENDING
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=True,
                    new_status=voucher.status,
                    error="Ya tenía todas las firmas (no-op)",
                ))
                continue

            if expected_role != body.role:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        f"Próximo rol esperado: '{expected_role}', "
                        f"vos firmás como '{body.role}'"
                    ),
                ))
                continue

            # Anti-doble-firma: si flow tiene múltiples roles, mismo user
            # no puede firmar dos pasos. Skipear este voucher.
            user_already_signed = any(
                a["approver_user_id"] == user_sub for a in approvals_raw
            )
            if user_already_signed and len(required_roles) > 1:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        "Ya firmaste este voucher con otro rol "
                        "(separación de responsabilidades)"
                    ),
                ))
                continue

            # Firmar (mismo flow que /approve individual)
            await record_approval_signature(
                db,
                voucher_id=vid,
                voucher_codigo=voucher.codigo,
                approver_user_id=user_sub,
                role=body.role,
                order_num=next_order,
                decision="APPROVED",
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                comments=None,
            )

            # Si firmó el último paso → APPROVED
            just_approved = False
            if next_order == len(required_roles):
                voucher.status = "APPROVED"
                voucher.threshold_aplicado = compute_threshold_aplicado(rule)
                just_approved = True

            items.append(BulkApproveItemResult(
                voucher_id=vid, success=True,
                new_status=voucher.status,
            ))

            # V5++ ola N: webhook por cada voucher recién aprobado en el bulk
            if just_approved:
                try:
                    from app.services.webhook_dispatcher import publish_event

                    await publish_event(
                        db,
                        "voucher.approved",
                        {
                            "voucher_id": voucher.voucher_id,
                            "voucher_codigo": voucher.codigo,
                            "empresa_codigo": voucher.empresa_codigo,
                            "tipo": voucher.tipo,
                            "total_debit": str(voucher.total_debit),
                            "approved_by": user_sub,
                            "via_bulk_approve": True,
                        },
                    )
                except Exception:
                    pass  # Soft-fail
        except Exception as exc:  # noqa: BLE001
            items.append(BulkApproveItemResult(
                voucher_id=vid, success=False,
                error=f"Error inesperado: {exc}",
            ))

    await db.commit()

    succeeded = sum(1 for r in items if r.success)

    # V5++ ola BL — Audit log del bulk approve
    try:
        await audit_log(
            db, request, user,
            action="bulk_approve",
            entity_type="voucher_bulk",
            entity_id=f"bulk_{len(body.voucher_ids)}",
            entity_label=f"Bulk approve {body.role}: {succeeded}/{len(body.voucher_ids)}",
            summary=(
                f"Bulk approve como {body.role}: "
                f"{succeeded} OK · {len(body.voucher_ids) - succeeded} fallaron · "
                f"total {len(body.voucher_ids)}"
            ),
            before=None,
            after={
                "role": body.role,
                "requested_ids": body.voucher_ids[:50],
                "succeeded": succeeded,
                "failed": len(body.voucher_ids) - succeeded,
            },
        )
    except Exception:
        pass

    return BulkApproveResponse(
        total=len(body.voucher_ids),
        succeeded=succeeded,
        failed=len(body.voucher_ids) - succeeded,
        items=items,
    )


# =====================================================================
# V5++ ola Y — POST /vouchers/import-csv (bulk import desde Excel chileno)
# =====================================================================


class ImportCsvResponse(BaseModel):
    total_rows: int
    total_vouchers_intended: int
    vouchers_created_count: int
    errors_count: int
    vouchers_created: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


@router.post(
    "/vouchers/import-csv",
    response_model=ImportCsvResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def import_vouchers_csv(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
) -> ImportCsvResponse:
    """Bulk-import de vouchers desde CSV (Excel chileno).

    Formato esperado:
        - Separador: `;`  (Excel chileno)
        - Encoding: UTF-8 (BOM opcional)
        - Una fila por LÍNEA del voucher; mismo `voucher_ref` agrupa
          filas en un voucher con sus líneas.

    Columnas obligatorias (case-insensitive, aliases en español OK):
        voucher_ref, empresa_codigo, tipo, fecha_documento, fecha_contable,
        glosa, line_number, cuenta_codigo

    Columnas opcionales:
        contraparte_rut, contraparte_nombre, doc_tributario_tipo,
        doc_tributario_folio, proyecto_codigo, area_codigo, debit, credit,
        descripcion

    Todos los vouchers se crean en `DRAFT` (descuadre permitido). El user
    revisa y submit manualmente, o usa /vouchers/bulk-approve después.

    `dry_run=true` valida y devuelve el reporte sin insertar nada — útil
    para previsualizar antes de commitear el import.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe tener extensión .csv",
        )

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:  # 10 MB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV excede 10 MB. Dividir en partes más chicas.",
        )

    from app.services.voucher_csv_import_service import parse_csv_to_vouchers

    parsed_vouchers, report = parse_csv_to_vouchers(raw)

    if dry_run or not parsed_vouchers:
        return ImportCsvResponse(**report.to_dict())

    # Insertar best-effort: cada voucher en su propia transacción lógica.
    # Si uno falla por validación contra DB (cuenta no existe, empresa
    # inactiva), seguimos con los demás.
    for vc in parsed_vouchers:
        try:
            # Re-usar el handler create_voucher hubiera sido lindo pero
            # depende de Pydantic-as-body. Replicamos la lógica esencial:
            #
            # 1. Empresa activa
            from sqlalchemy import text as _text
            empresa_activa = await db.scalar(
                _text(
                    "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
                ),
                {"c": vc.empresa_codigo},
            )
            if not empresa_activa:
                report.errors.append(
                    _make_csv_error(
                        vc, f"Empresa '{vc.empresa_codigo}' inactiva o inexistente"
                    )
                )
                continue

            # 2. Período cerrado
            if await is_period_locked_for(
                db, vc.empresa_codigo, vc.fecha_contable
            ):
                report.errors.append(
                    _make_csv_error(
                        vc,
                        f"Período {vc.fecha_contable} cerrado para {vc.empresa_codigo}",
                    )
                )
                continue

            # 3. Cuentas existen + imputables (validación por línea)
            cuentas_ok = True
            for line in vc.lines:
                cuenta = await fetch_cuenta_metadata(db, line.cuenta_codigo)
                if cuenta is None or not cuenta["imputable"] or not cuenta["activa"]:
                    report.errors.append(
                        _make_csv_error(
                            vc,
                            f"Cuenta '{line.cuenta_codigo}' no existe / no imputable / inactiva",
                        )
                    )
                    cuentas_ok = False
                    break
            if not cuentas_ok:
                continue

            # 4. Generar correlativo
            anio = vc.fecha_contable.year
            codigo = await generate_voucher_code(
                db, vc.empresa_codigo, anio, vc.tipo
            )

            # 5. Insertar voucher + líneas
            from decimal import Decimal as _D
            total_debit = sum(
                (line.debit for line in vc.lines), start=_D("0")
            )
            total_credit = sum(
                (line.credit for line in vc.lines), start=_D("0")
            )

            voucher = Voucher(
                codigo=codigo,
                empresa_codigo=vc.empresa_codigo,
                tipo=vc.tipo,
                status="DRAFT",
                fecha_documento=vc.fecha_documento,
                fecha_contable=vc.fecha_contable,
                glosa=vc.glosa.strip(),
                total_debit=total_debit,
                total_credit=total_credit,
                moneda=vc.moneda,
                contraparte_rut=vc.contraparte_rut,
                contraparte_nombre=vc.contraparte_nombre,
                doc_tributario_tipo=vc.doc_tributario_tipo,
                doc_tributario_folio=vc.doc_tributario_folio,
                created_by=str(user.sub),
                requested_by=str(user.sub),
            )
            db.add(voucher)
            await db.flush()

            for line_data in vc.lines:
                line = VoucherLine(
                    voucher_id=voucher.voucher_id,
                    line_number=line_data.line_number,
                    cuenta_codigo=line_data.cuenta_codigo,
                    proyecto_codigo=line_data.proyecto_codigo,
                    area_codigo=line_data.area_codigo,
                    debit=line_data.debit,
                    credit=line_data.credit,
                    descripcion=line_data.descripcion,
                )
                db.add(line)

            await db.flush()
            report.vouchers_created.append({
                "voucher_id": voucher.voucher_id,
                "codigo": voucher.codigo,
                "empresa_codigo": voucher.empresa_codigo,
                "total_debit": str(total_debit),
                "total_credit": str(total_credit),
                "lines": len(vc.lines),
            })
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            report.errors.append(_make_csv_error(vc, f"error: {exc}"))

    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error commiteando vouchers: {exc}",
        ) from exc

    return ImportCsvResponse(**report.to_dict())


def _make_csv_error(vc, message: str):
    """Helper para construir CsvImportError sin imports circulares."""
    from app.services.voucher_csv_import_service import CsvImportError

    return CsvImportError(
        voucher_ref=f"{vc.empresa_codigo}-{vc.fecha_contable}",
        row=0,
        field=None,
        message=message,
    )


# Forward reference resolution para datetime no usado pero importado por
# Voucher/VoucherLine schemas (ruff F401 lo flaggearía sino).
_ = datetime
