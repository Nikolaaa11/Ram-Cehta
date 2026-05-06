"""F22 — declaración anual de impuesto a la renta (SII Chile).

Endpoints:
  GET    /f22                           — lista paginada filtrable
  GET    /f22/{id}                      — detalle
  POST   /f22                           — crear
  PATCH  /f22/{id}                      — editar parcial
  POST   /f22/{id}/marcar-pagado        — shortcut para registrar pago
  DELETE /f22/{id}                      — borrar (admin only)
  POST   /f22/sync-dropbox/{empresa}    — escanear Dropbox y crear faltantes

Cadencia: una declaración por empresa por año tributario. F22 2025 vence
en abril 2026 (fecha exacta varía pero típicamente abril 30).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.common import Page
from app.schemas.f22 import F22Create, F22EstadoUpdate, F22Read, F22Update
from app.services.audit_service import audit_log

router = APIRouter()

_F22_COLS = (
    "f22_id, empresa_codigo, ano_tributario, fecha_vencimiento, "
    "monto_a_pagar, fecha_pago, estado, comprobante_url, dropbox_path, "
    "notas, created_at, updated_at"
)


def _row_to_read(row: dict) -> F22Read:
    return F22Read.model_validate(dict(row))


@router.get("", response_model=Page[F22Read])
async def list_f22(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 50,
    empresa_codigo: str | None = None,
    estado: str | None = None,
    ano_tributario: int | None = None,
) -> Page[F22Read]:
    conditions: list[str] = []
    params: dict = {}
    if empresa_codigo:
        conditions.append("empresa_codigo = :empresa")
        params["empresa"] = empresa_codigo
    if estado:
        conditions.append("estado = :estado")
        params["estado"] = estado
    if ano_tributario:
        conditions.append("ano_tributario = :ano")
        params["ano"] = ano_tributario

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    total = (
        await db.scalar(
            text(f"SELECT COUNT(*) FROM core.f22_obligaciones {where}"),
            params,
        )
    ) or 0

    params["limit"] = size
    params["offset"] = (page - 1) * size
    rows = (
        await db.execute(
            text(
                f"SELECT {_F22_COLS} FROM core.f22_obligaciones "
                f"{where} ORDER BY ano_tributario DESC, empresa_codigo "
                f"LIMIT :limit OFFSET :offset"
            ),
            params,
        )
    ).mappings().all()

    return Page.build(
        items=[_row_to_read(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.get("/{f22_id}", response_model=F22Read)
async def get_f22(
    f22_id: int,
    user: CurrentUser,
    db: DBSession,
) -> F22Read:
    row = (
        await db.execute(
            text(f"SELECT {_F22_COLS} FROM core.f22_obligaciones WHERE f22_id = :id"),
            {"id": f22_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"F22 {f22_id} no encontrado",
        )
    return _row_to_read(row)


@router.post(
    "",
    response_model=F22Read,
    status_code=status.HTTP_201_CREATED,
)
async def create_f22(
    body: F22Create,
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
) -> F22Read:
    """Crea un F22. Reusa el scope `f29:create` (mismo dominio tributario)."""
    # Validar empresa
    exists = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c"),
        {"c": body.empresa_codigo},
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe",
        )

    try:
        row = (
            await db.execute(
                text(f"""
                    INSERT INTO core.f22_obligaciones (
                        empresa_codigo, ano_tributario, fecha_vencimiento,
                        monto_a_pagar, estado, notas
                    )
                    VALUES (:e, :a, :fv, :m, :est, :notas)
                    RETURNING {_F22_COLS}
                """),
                {
                    "e": body.empresa_codigo,
                    "a": body.ano_tributario,
                    "fv": body.fecha_vencimiento,
                    "m": body.monto_a_pagar,
                    "est": body.estado,
                    "notas": body.notas,
                },
            )
        ).mappings().one()
        await db.commit()
        return _row_to_read(row)
    except IntegrityError as exc:
        # Detección estricta del UNIQUE constraint (no string matching frágil)
        await db.rollback()
        constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", "")
        if "f22_obligaciones" in str(constraint_name) or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Ya existe F22 para empresa {body.empresa_codigo} "
                    f"año {body.ano_tributario}"
                ),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error de integridad DB: {exc.orig if exc.orig else exc}",
        ) from exc


@router.patch("/{f22_id}", response_model=F22Read)
async def update_f22(
    f22_id: int,
    body: F22Update,
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
) -> F22Read:
    """Editar campos parciales del F22. Solo los enviados se actualizan."""
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sin campos para actualizar",
        )

    # Construir SET dinámico
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = f22_id

    row = (
        await db.execute(
            text(f"""
                UPDATE core.f22_obligaciones
                SET {sets}
                WHERE f22_id = :id
                RETURNING {_F22_COLS}
            """),
            fields,
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"F22 {f22_id} no encontrado",
        )
    await db.commit()
    return _row_to_read(row)


@router.post(
    "/{f22_id}/marcar-pagado",
    response_model=F22Read,
)
async def marcar_pagado(
    f22_id: int,
    body: F22EstadoUpdate,
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
) -> F22Read:
    """Shortcut para marcar como pagado con fecha + comprobante."""
    if body.estado == "pagado" and body.fecha_pago is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="estado='pagado' requiere fecha_pago",
        )

    row = (
        await db.execute(
            text(f"""
                UPDATE core.f22_obligaciones
                SET estado = :est,
                    fecha_pago = :fp,
                    comprobante_url = COALESCE(:cu, comprobante_url)
                WHERE f22_id = :id
                RETURNING {_F22_COLS}
            """),
            {
                "id": f22_id,
                "est": body.estado,
                "fp": body.fecha_pago,
                "cu": body.comprobante_url,
            },
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"F22 {f22_id} no encontrado",
        )
    await db.commit()
    return _row_to_read(row)


@router.delete(
    "/{f22_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_f22(
    f22_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:delete"))],
    db: DBSession,
) -> Response:
    res = await db.execute(
        text("DELETE FROM core.f22_obligaciones WHERE f22_id = :id"),
        {"id": f22_id},
    )
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"F22 {f22_id} no encontrado",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sync-dropbox/{empresa_codigo}",
)
async def sync_dropbox(
    empresa_codigo: str,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
) -> dict:
    """Escanea `/Cehta Capital/01-Empresas/{COD}/03-Legal/Declaraciones SII/F22/`
    y crea filas para los `{YYYY}.pdf` que no existan en DB.

    Idempotente: el UNIQUE (empresa, año) evita duplicados.
    Soft-fail: si Dropbox no está configurado, devuelve 503.

    Auditoría: cada sync se registra en core.audit_log con `created` y
    `errors` para trazabilidad — quién corrió el sync, cuándo, qué pasó.

    La lógica vive en `app.services.f22_sync_service.sync_f22_dropbox`
    para que `/empresa/{cod}/sync-all-dropbox` la reuse sin duplicar.
    """
    from app.services.dropbox_service import DropboxNotConfigured, DropboxService
    from app.services.f22_sync_service import sync_f22_dropbox

    try:
        dbx = DropboxService()
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    result = await sync_f22_dropbox(db, dbx, empresa_codigo)

    # Audit log — solo si hubo cambios o errores (no spamear logs)
    if result.get("created", 0) > 0 or result.get("errors"):
        await audit_log(
            db,
            request,
            user,
            action="sync",
            entity_type="f22",
            entity_id=empresa_codigo,
            entity_label=f"F22 sync {empresa_codigo}",
            summary=(
                f"Sync F22 desde Dropbox · {result.get('created', 0)} creados · "
                f"{result.get('skipped', 0)} skipped · "
                f"{len(result.get('errors', []))} errores"
            ),
            before=None,
            after=result,
        )

    return result
