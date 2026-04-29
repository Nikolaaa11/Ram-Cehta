"""F29 — obligaciones tributarias mensuales."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.schemas.common import Page
from app.schemas.f29 import F29Create, F29EstadoUpdate, F29Read, F29Update
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.dropbox_sync_service import DropboxSyncService

router = APIRouter()

_F29_COLS = (
    "f29_id, empresa_codigo, periodo_tributario, fecha_vencimiento, "
    "monto_a_pagar, fecha_pago, estado, comprobante_url, created_at, updated_at"
)


@router.get("", response_model=Page[F29Read])
async def list_f29(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 50,
    empresa_codigo: str | None = None,
    estado: str | None = None,
) -> Page[F29Read]:
    conditions = []
    params: dict = {}
    if empresa_codigo:
        conditions.append("empresa_codigo = :empresa")
        params["empresa"] = empresa_codigo
    if estado:
        conditions.append("estado = :estado")
        params["estado"] = estado

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params["limit"] = size
    params["offset"] = (page - 1) * size

    total = (
        await db.scalar(
            text(f"SELECT COUNT(*) FROM core.f29_obligaciones {where}"),
            params,
        )
    ) or 0

    rows = (
        await db.execute(
            text(
                f"SELECT {_F29_COLS} FROM core.f29_obligaciones {where} "
                "ORDER BY fecha_vencimiento DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
    ).mappings().all()

    items = [F29Read.model_validate(dict(r)) for r in rows]
    return Page.build(items=items, total=total, page=page, size=size)


@router.post("", response_model=F29Read, status_code=status.HTTP_201_CREATED)
async def create_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
    body: F29Create,
) -> F29Read:
    result = await db.execute(
        text("""
            INSERT INTO core.f29_obligaciones
                (empresa_codigo, periodo_tributario, fecha_vencimiento, monto_a_pagar, estado)
            VALUES (:empresa, :periodo, :vencimiento, :monto, :estado)
            ON CONFLICT (empresa_codigo, periodo_tributario) DO UPDATE
                SET monto_a_pagar = EXCLUDED.monto_a_pagar,
                    fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                    estado = EXCLUDED.estado,
                    updated_at = now()
            RETURNING f29_id
        """),
        {
            "empresa": body.empresa_codigo,
            "periodo": body.periodo_tributario,
            "vencimiento": body.fecha_vencimiento,
            "monto": body.monto_a_pagar,
            "estado": body.estado,
        },
    )
    await db.commit()
    f29_id = result.scalar_one()

    row = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().one()
    return F29Read.model_validate(dict(row))


@router.patch("/{f29_id}/estado", response_model=F29Read)
async def update_f29_estado(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
    f29_id: int,
    body: F29EstadoUpdate,
) -> F29Read:
    row = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="F29 no encontrado")

    await db.execute(
        text("""
            UPDATE core.f29_obligaciones
            SET estado = :estado,
                fecha_pago = :fecha_pago,
                comprobante_url = COALESCE(:url, comprobante_url),
                updated_at = now()
            WHERE f29_id = :id
        """),
        {"estado": body.estado, "fecha_pago": body.fecha_pago, "url": body.comprobante_url, "id": f29_id},
    )
    await db.commit()

    updated = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().one()
    return F29Read.model_validate(dict(updated))


@router.patch("/{f29_id}", response_model=F29Read)
async def update_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
    f29_id: int,
    body: F29Update,
) -> F29Read:
    """PATCH parcial. Validación cross-field en `F29Update.model_validator`:
    estado='pagado' exige fecha_pago no nula."""
    row = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="F29 no encontrado")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        # nada que actualizar — retornar el actual
        return F29Read.model_validate(dict(row))

    sets: list[str] = [f"{k} = :{k}" for k in fields]
    sets.append("updated_at = now()")
    sql = f"UPDATE core.f29_obligaciones SET {', '.join(sets)} WHERE f29_id = :id"
    params = dict(fields)
    params["id"] = f29_id
    await db.execute(text(sql), params)
    await db.commit()

    updated = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().one()
    return F29Read.model_validate(dict(updated))


@router.post("/sync-dropbox/{empresa_codigo}")
async def sync_f29_dropbox(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
    empresa_codigo: str,
) -> dict:
    """Escanea `Cehta Capital/01-Empresas/{empresa}/03-Legal/Declaraciones SII/F29/`
    y crea entries en `core.f29_obligaciones` para cada PDF cuyo nombre
    matchee `YYYY-MM` (interpretado como periodo tributario `MM_YY`).

    Idempotente: match por `(empresa_codigo, periodo_tributario)` con
    `ON CONFLICT DO NOTHING`. Setea fecha_vencimiento por default al día 12
    del mes siguiente (regla F29 CL).
    """
    integration_repo = IntegrationRepository(db)
    integration = await integration_repo.get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    service = DropboxSyncService(db, dbx)
    result = await service.sync_f29(empresa_codigo)
    await db.commit()
    return result.to_dict()


@router.delete(
    "/{f29_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def delete_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:delete"))],
    db: DBSession,
    f29_id: int,
) -> Response:
    """Hard-delete (admin only)."""
    result = await db.execute(
        text("DELETE FROM core.f29_obligaciones WHERE f29_id = :id"),
        {"id": f29_id},
    )
    rowcount: int = getattr(result, "rowcount", 0) or 0
    if rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="F29 no encontrado")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
