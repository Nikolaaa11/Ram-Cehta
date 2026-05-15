"""F29 — obligaciones tributarias mensuales."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.schemas.bulk import (
    BulkItemError,
    BulkUpdateEstadoRequest,
    BulkUpdateResult,
)
from app.schemas.common import Page
from app.schemas.f29 import F29Create, F29EstadoUpdate, F29Read, F29Update
from app.services.audit_service import audit_log
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.dropbox_sync_service import DropboxSyncService
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.webhook_dispatcher import publish_event

router = APIRouter()

_F29_COLS = (
    "f29_id, empresa_codigo, periodo_tributario, fecha_vencimiento, "
    "monto_a_pagar, fecha_pago, estado, comprobante_url, created_at, updated_at"
)


@router.get("", response_model=Page[F29Read])
async def list_f29(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 50,
    empresa_codigo: str | None = None,
    estado: str | None = None,
) -> Page[F29Read]:
    """V5++ ola AK: scope multi-tenant aplicado."""
    conditions = []
    params: dict = {}

    # Aplicar scope automático
    scoped_codes = scope.filter_codes(empresa_codigo)
    if scoped_codes is not None:
        if len(scoped_codes) == 1:
            conditions.append("empresa_codigo = :empresa")
            params["empresa"] = scoped_codes[0]
        else:
            conditions.append("empresa_codigo = ANY(:empresas)")
            params["empresas"] = scoped_codes

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
    request: Request,
    body: F29Create,
) -> F29Read:
    # V5++ ola AK: scope check
    await assert_empresa_access(user, db, body.empresa_codigo)
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
    created = F29Read.model_validate(dict(row))
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="f29",
        entity_id=str(f29_id),
        entity_label=f"{body.empresa_codigo}/{body.periodo_tributario}",
        summary=f"F29 {body.empresa_codigo} {body.periodo_tributario} creada",
        before=None,
        after=created.model_dump(mode="json"),
    )
    # Webhook: f29.created — alta de obligación tributaria.
    await publish_event(
        db,
        "f29.created",
        {
            "f29_id": f29_id,
            "empresa_codigo": created.empresa_codigo,
            "periodo_tributario": created.periodo_tributario,
            "fecha_vencimiento": str(created.fecha_vencimiento)
            if created.fecha_vencimiento
            else None,
            "monto_a_pagar": float(created.monto_a_pagar)
            if created.monto_a_pagar
            else None,
            "estado": created.estado,
            "created_by": str(user.sub),
        },
    )
    return created


@router.patch("/{f29_id}/estado", response_model=F29Read)
async def update_f29_estado(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
    request: Request,
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
    before = F29Read.model_validate(dict(row)).model_dump(mode="json")

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
    refreshed = F29Read.model_validate(dict(updated))
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="f29",
        entity_id=str(f29_id),
        entity_label=f"{refreshed.empresa_codigo}/{refreshed.periodo_tributario}",
        summary=f"F29 estado: {before['estado']} -> {body.estado}",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    # Webhook: solo dispara `f29.paid` cuando estado=pagado. Los estados
    # pendiente/vencido no disparan desde aquí — `f29.due` lo dispara el
    # alerts_cron cuando detecta vencimientos en los próximos 7 días.
    if body.estado == "pagado":
        await publish_event(
            db,
            "f29.paid",
            {
                "f29_id": f29_id,
                "empresa_codigo": refreshed.empresa_codigo,
                "periodo_tributario": refreshed.periodo_tributario,
                "estado_before": before["estado"],
                "estado_after": body.estado,
                "fecha_vencimiento": str(refreshed.fecha_vencimiento)
                if refreshed.fecha_vencimiento
                else None,
                "fecha_pago": str(refreshed.fecha_pago)
                if refreshed.fecha_pago
                else None,
                "monto_a_pagar": float(refreshed.monto_a_pagar)
                if refreshed.monto_a_pagar
                else None,
                "changed_by": str(user.sub),
            },
        )
    return refreshed


@router.patch("/{f29_id}", response_model=F29Read)
async def update_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
    request: Request,
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

    before = F29Read.model_validate(dict(row)).model_dump(mode="json")

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
    refreshed = F29Read.model_validate(dict(updated))
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="f29",
        entity_id=str(f29_id),
        entity_label=f"{refreshed.empresa_codigo}/{refreshed.periodo_tributario}",
        summary=f"F29 {refreshed.empresa_codigo}/{refreshed.periodo_tributario} editado",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    return refreshed


@router.post("/sync-dropbox/{empresa_codigo}")
async def sync_f29_dropbox(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
) -> dict:
    """V5++ ola CB: sync F29 desde Dropbox con scope check."""
    await assert_empresa_access(user, db, empresa_codigo)
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
    payload = result.to_dict()
    await audit_log(
        db,
        request,
        user,
        action="sync",
        entity_type="f29_batch",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=f"Sync F29 desde Dropbox para {empresa_codigo}",
        before=None,
        after=payload,
    )
    return payload


@router.delete(
    "/{f29_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def delete_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:delete"))],
    db: DBSession,
    request: Request,
    f29_id: int,
) -> Response:
    """Hard-delete (admin only)."""
    row = (
        await db.execute(
            text(f"SELECT {_F29_COLS} FROM core.f29_obligaciones WHERE f29_id = :id"),
            {"id": f29_id},
        )
    ).mappings().first()
    before = F29Read.model_validate(dict(row)).model_dump(mode="json") if row else None

    result = await db.execute(
        text("DELETE FROM core.f29_obligaciones WHERE f29_id = :id"),
        {"id": f29_id},
    )
    rowcount: int = getattr(result, "rowcount", 0) or 0
    if rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="F29 no encontrado")
    await db.commit()
    label = (
        f"{before['empresa_codigo']}/{before['periodo_tributario']}"
        if before
        else None
    )
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="f29",
        entity_id=str(f29_id),
        entity_label=label,
        summary=f"F29 id={f29_id} eliminado",
        before=before,
        after=None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bulk-update-estado", response_model=BulkUpdateResult)
async def bulk_update_estado_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:update"))],
    db: DBSession,
    request: Request,
    body: BulkUpdateEstadoRequest,
) -> BulkUpdateResult:
    """Cambio masivo de estado en hasta 200 F29.

    Patrón calcado de OCs: chequea existencia + estado distinto, marca como
    fallidos los que no aplican, commit único al final.
    """
    failed: list[BulkItemError] = []
    succeeded = 0

    # QA fix 14/05/2026 — antes hacia 2 queries por id (200 ids = 400
    # round-trips). Ahora 1 SELECT batched para validar + 1 UPDATE
    # batched. Mismo contract (BulkUpdateResult), mismas validaciones.
    existing = {
        r[0]: r[1]
        for r in (
            await db.execute(
                text(
                    "SELECT f29_id, estado FROM core.f29_obligaciones "
                    "WHERE f29_id = ANY(:ids)"
                ),
                {"ids": body.ids},
            )
        ).all()
    }
    to_update: list = []
    for f29_id in body.ids:
        if f29_id not in existing:
            failed.append(BulkItemError(id=f29_id, detail="not found"))
            continue
        if existing[f29_id] == body.estado:
            failed.append(BulkItemError(id=f29_id, detail="ya en ese estado"))
            continue
        to_update.append(f29_id)

    if to_update:
        await db.execute(
            text(
                """
                UPDATE core.f29_obligaciones
                SET estado = :estado, updated_at = now()
                WHERE f29_id = ANY(:ids)
                """
            ),
            {"estado": body.estado, "ids": to_update},
        )
        succeeded = len(to_update)

    if succeeded:
        await db.commit()
        await audit_log(
            db,
            request,
            user,
            action="update",
            entity_type="f29",
            entity_id=f"bulk:{succeeded}",
            entity_label=f"{succeeded} F29 → {body.estado}",
            summary=(
                f"Bulk update estado={body.estado}: {succeeded} F29 ok, "
                f"{len(failed)} fallaron"
            ),
            before=None,
            after={"estado": body.estado, "ids": body.ids[:50]},
        )

    return BulkUpdateResult(
        operation="update_estado",
        requested=len(body.ids),
        succeeded=succeeded,
        failed=failed,
    )
