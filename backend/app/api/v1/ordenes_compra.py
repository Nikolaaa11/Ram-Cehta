"""CRUD Órdenes de Compra — Session 2.5."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.orden_compra_repository import OrdenCompraRepository
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.models.orden_compra import OrdenCompra
from app.schemas.proveedor import ProveedorCreate
from app.schemas.bulk import (
    BulkItemError,
    BulkUpdateEstadoRequest,
    BulkUpdateResult,
)
from app.schemas.common import Page
from app.schemas.orden_compra import (
    DuplicateOcRequest,
    EstadoUpdateRequest,
    OCDetalleCreate,
    OCDetalleRead,
    OrdenCompraCreate,
    OrdenCompraListItem,
    OrdenCompraRead,
    OrdenCompraUpdate,
)
from app.services.audit_service import audit_log
from app.services.authorization_service import AuthorizationService
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.webhook_dispatcher import publish_event

router = APIRouter()
_authz = AuthorizationService()


def _to_list_item(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraListItem:
    return OrdenCompraListItem(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        moneda=oc.moneda,
        neto=oc.neto,
        total=oc.total,
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


def _to_read(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraRead:
    return OrdenCompraRead(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        validez_dias=oc.validez_dias,
        moneda=oc.moneda,
        neto=oc.neto,
        iva=oc.iva,
        total=oc.total,
        forma_pago=oc.forma_pago,
        plazo_pago=oc.plazo_pago,
        observaciones=oc.observaciones,
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        items=[OCDetalleRead.model_validate(d) for d in (oc.items or [])],
        created_at=oc.created_at,
        updated_at=oc.updated_at,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


@router.get("", response_model=Page[OrdenCompraListItem])
async def list_ocs(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    empresa_codigo: str | None = None,
    estado: str | None = None,
) -> Page[OrdenCompraListItem]:
    """V5++ ola AD: auto-filtra por empresas a las que el user tiene rol."""
    repo = OrdenCompraRepository(db)

    # Multi-tenant scope
    scoped_codes = scope.filter_codes(empresa_codigo)
    # Si scope retornó 1 código, usamos empresa_codigo. Si retornó lista, usamos in.
    if scoped_codes is not None and len(scoped_codes) == 1:
        empresa_codigo = scoped_codes[0]
        scoped_codes = None

    items, total = await repo.list(
        page=page,
        size=size,
        empresa_codigo=empresa_codigo,
        estado=estado,
        empresa_codigos_in=scoped_codes,
    )
    return Page.build(
        items=[_to_list_item(user, oc) for oc in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=OrdenCompraRead, status_code=status.HTTP_201_CREATED)
async def create_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    request: Request,
    body: OrdenCompraCreate,
) -> OrdenCompraRead:
    # V5++ ola AD: validar acceso a empresa
    await assert_empresa_access(user, db, body.empresa_codigo)

    # V5++ ola CE: auto-resolver/crear proveedor si vino RUT+nombre en lugar
    # de proveedor_id. Mismo patron que el form Nubox de vouchers.
    if body.proveedor_id is None and body.proveedor_rut:
        if not validate_rut(body.proveedor_rut):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"RUT proveedor '{body.proveedor_rut}' invalido "
                    "(digito verificador incorrecto)."
                ),
            )
        rut_canonical = format_rut(body.proveedor_rut)
        prov_repo = ProveedorRepository(db)
        proveedor = await prov_repo.get_by_rut(rut_canonical)
        if proveedor is None:
            if not body.proveedor_nombre or not body.proveedor_nombre.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Proveedor no existe y falta proveedor_nombre para "
                        "crearlo automaticamente."
                    ),
                )
            proveedor = await prov_repo.create(
                ProveedorCreate(
                    rut=rut_canonical,
                    razon_social=body.proveedor_nombre.strip(),
                )
            )
        # Reemplazamos el body con proveedor_id resuelto.
        body = body.model_copy(update={"proveedor_id": proveedor.proveedor_id})

    repo = OrdenCompraRepository(db)
    # Optimistic check para feedback rápido — pero el verdadero gate es el
    # IntegrityError abajo (cierra ventana TOCTOU en alta concurrencia).
    if await repo.exists_numero_oc(body.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        )
    try:
        oc = await repo.create(body)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        ) from exc
    oc_id_created = oc.oc_id
    oc = await repo.get(oc_id_created)  # re-fetch para cargar items via selectin
    if not oc:
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_create",
            oc_id=oc_id_created,
            empresa=body.empresa_codigo,
            numero_oc=body.numero_oc,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{oc_id_created} creada pero no se pudo recargar para "
                "devolver. Refrescá la lista en unos segundos."
            ),
        )
    after = _to_read(user, oc).model_dump(mode="json")
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(oc.oc_id),
        entity_label=oc.numero_oc,
        summary=f"OC {oc.numero_oc} creada para {oc.empresa_codigo}",
        before=None,
        after=after,
    )
    # Webhook: oc.created — suscriptores externos reciben el alta de OC.
    await publish_event(
        db,
        "oc.created",
        {
            "oc_id": oc.oc_id,
            "numero_oc": oc.numero_oc,
            "empresa_codigo": oc.empresa_codigo,
            "proveedor_id": oc.proveedor_id,
            "total": float(oc.total) if oc.total else None,
            "moneda": oc.moneda,
            "estado": oc.estado,
            "created_by": str(user.sub),
        },
    )
    return _to_read(user, oc)


@router.get("/{oc_id:int}", response_model=OrdenCompraRead)
async def get_oc(
    user: CurrentUser, db: DBSession, scope: EmpresaScopeDep, oc_id: int
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    # V5++ ola AD: scope check
    if not scope.can_access(oc.empresa_codigo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Sin acceso a OCs de empresa '{oc.empresa_codigo}'",
        )
    return _to_read(user, oc)


_OC_EDITABLE_ESTADOS = {"emitida", "parcial"}


# V5++ ola CG — Renderizado HTML branded de OC (para print → PDF)
@router.get("/{oc_id:int}.html", response_class=Response)
async def get_oc_html(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    oc_id: int,
) -> Response:
    """Renderiza la OC como HTML branded (con logo de la empresa emisora).

    Print-friendly: el browser convierte a PDF con Ctrl+P sin perder
    formato. No genera PDF server-side para mantenerlo simple y
    multi-plataforma.

    Si la empresa tiene logo_dropbox_path, se incluye via URL temporal
    Dropbox (4h). Sino, fallback a razón social en texto grande.
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=404, detail="OC no encontrada")
    if not scope.can_access(oc.empresa_codigo):
        raise HTTPException(status_code=403, detail="Sin acceso a esta OC")

    # Datos de la empresa emisora
    from sqlalchemy import text as _text

    empresa_row = (
        await db.execute(
            _text(
                """
                SELECT codigo, razon_social, rut, direccion, ciudad, telefono,
                       representante_legal, email_firmante, logo_dropbox_path
                FROM core.empresas
                WHERE codigo = :cod
                """
            ),
            {"cod": oc.empresa_codigo},
        )
    ).mappings().first()

    empresa_dict = dict(empresa_row) if empresa_row else {"codigo": oc.empresa_codigo}

    # Logo URL temporal si hay path
    logo_url: str | None = None
    if empresa_dict.get("logo_dropbox_path"):
        try:
            from app.infrastructure.repositories.integration_repository import (
                IntegrationRepository,
            )
            from app.services.dropbox_service import DropboxNotConfigured, DropboxService
            import asyncio as _asyncio

            integration_repo = IntegrationRepository(db)
            integration = await integration_repo.get_by_provider("dropbox")
            if integration and integration.access_token:
                dbx = DropboxService(
                    access_token=integration.access_token,
                    refresh_token=integration.refresh_token,
                )
                logo_url = await _asyncio.to_thread(
                    dbx.get_temporary_link, empresa_dict["logo_dropbox_path"]
                )
        except Exception:  # noqa: BLE001
            # Sin logo si Dropbox falla — el render hace fallback a texto
            pass

    # Datos del proveedor
    proveedor_dict: dict | None = None
    if oc.proveedor_id:
        prov_row = (
            await db.execute(
                _text(
                    """
                    SELECT razon_social, rut, direccion, email
                    FROM core.proveedores
                    WHERE proveedor_id = :pid
                    """
                ),
                {"pid": oc.proveedor_id},
            )
        ).mappings().first()
        if prov_row:
            proveedor_dict = dict(prov_row)

    # OC dict
    oc_dict = {
        "numero_oc": oc.numero_oc,
        "estado": oc.estado,
        "fecha_emision": oc.fecha_emision.isoformat(),
        "validez_dias": oc.validez_dias,
        "moneda": oc.moneda,
        "neto": str(oc.neto),
        "iva": str(oc.iva),
        "total": str(oc.total),
        "forma_pago": oc.forma_pago or "",
        "plazo_pago": oc.plazo_pago or "",
        "observaciones": oc.observaciones or "",
    }

    # Items
    items_list = [
        {
            "item": d.item,
            "descripcion": d.descripcion,
            "cantidad": str(d.cantidad),
            "precio_unitario": str(d.precio_unitario),
            "total_linea": str(d.total_linea) if d.total_linea else "0",
        }
        for d in (oc.items or [])
    ]

    from app.services.report_renderer_service import render_orden_compra_html

    html = render_orden_compra_html(
        oc=oc_dict,
        items=items_list,
        empresa=empresa_dict,
        proveedor=proveedor_dict,
        logo_url=logo_url,
    )
    return Response(content=html, media_type="text/html")


# =====================================================================
# GET /ordenes-compra/{oc_id}/pdf — descarga PDF branded + attachments
# =====================================================================


@router.get("/{oc_id:int}/pdf")
async def download_oc_pdf(
    oc_id: int,
    user: CurrentUser,
    db: DBSession,
    include_attachments: bool = True,
):
    """Genera un PDF branded de la OC con (opcional) adjuntos incrustados.

    El cover trae header de la empresa emisora (logo + razón social + RUT),
    título "ORDEN DE COMPRA", ficha del proveedor, info grid de fechas y
    forma de pago, tabla de items con totales, observaciones (si las hay)
    y placeholder de firma.

    Si `include_attachments=True` (default) y existe la tabla
    `core.oc_attachments`, los adjuntos se mergean al final del PDF.
    Falla silenciosa: errores fetching del logo o de adjuntos no rompen
    la generación.

    R152KKKK — logging estructurado para diagnosticar "Failed to fetch"
    reportado por el operador. Cada step loggea para que en Fly logs
    podamos ver dónde se cuelga.
    """
    import time as _time

    from fastapi.responses import StreamingResponse
    import structlog

    from app.services.oc_pdf_service import generate_oc_pdf_bundle

    _pdf_log = structlog.get_logger(__name__)
    t0 = _time.monotonic()

    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OC no encontrada",
        )
    await assert_empresa_access(user, db, oc.empresa_codigo)
    _pdf_log.info(
        "oc_pdf.start",
        oc_id=oc_id,
        empresa=oc.empresa_codigo,
        include_attachments=include_attachments,
        user_email=getattr(user, "email", None),
    )

    try:
        pdf_bytes = await generate_oc_pdf_bundle(
            oc_id=oc_id,
            db=db,
            include_attachments=include_attachments,
            # Round 14 — footer notarial registra user que descargo.
            generated_by_email=getattr(user, "email", None),
        )
    except ValueError as exc:
        _pdf_log.warning("oc_pdf.value_error", oc_id=oc_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001
        _pdf_log.error(
            "oc_pdf.generation_failed",
            oc_id=oc_id,
            error=str(exc),
            error_type=type(exc).__name__,
            duration_s=round(_time.monotonic() - t0, 2),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generando PDF de la OC: {exc}",
        ) from exc

    _pdf_log.info(
        "oc_pdf.success",
        oc_id=oc_id,
        pdf_bytes=len(pdf_bytes),
        duration_s=round(_time.monotonic() - t0, 2),
    )

    filename = f"oc-{oc.numero_oc}.pdf"

    # Round 17 — audit log de descarga PDF (forense). Soft-fail.
    # R152KKKK — Bug fix: `request` no estaba en scope. Lo omito (audit_log
    # acepta request=None, solo pierde el IP/user-agent en el registro).
    try:
        await audit_log(
            db, None, user,
            action="download_pdf",
            entity_type="orden_compra",
            entity_id=str(oc_id),
            entity_label=str(oc.numero_oc),
            summary=(
                f"Descarga PDF de OC {oc.numero_oc} "
                f"({len(pdf_bytes)} bytes, attachments={include_attachments})"
            ),
            before=None,
            after={
                "bytes": len(pdf_bytes),
                "include_attachments": include_attachments,
                "empresa_codigo": oc.empresa_codigo,
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


@router.post(
    "/{oc_id:int}/duplicate",
    response_model=OrdenCompraRead,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    body: DuplicateOcRequest,
) -> OrdenCompraRead:
    """Duplica una OC existente. Copia proveedor, items, montos, moneda, forma_pago.

    El user pasa el numero_oc nuevo (obligatorio, no auto-generamos para no
    pisar correlativos manuales). Opcionalmente puede sobrescribir fecha_emision
    y observaciones; el resto se hereda del original.

    La OC duplicada arranca en estado 'emitida' sin pdf_url (se generara cuando
    el flujo de export lo dispare).
    """
    repo = OrdenCompraRepository(db)
    original = await repo.get(oc_id)
    if not original:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    # Scope check sobre la empresa del original (el duplicado vive en la misma).
    await assert_empresa_access(user, db, original.empresa_codigo)
    # Numero unico por empresa: si el nuevo ya existe, 409 sin tocar nada.
    if await repo.exists_numero_oc(original.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {original.empresa_codigo}",
        )
    # Construir el OrdenCompraCreate copiando los campos del original. El IVA
    # se recalcula automaticamente en repo.create() segun moneda + neto, asi
    # que no hay riesgo de inconsistencia.
    duplicate_payload = OrdenCompraCreate(
        numero_oc=body.numero_oc,
        empresa_codigo=original.empresa_codigo,
        proveedor_id=original.proveedor_id,
        fecha_emision=body.fecha_emision or date.today(),
        validez_dias=original.validez_dias,
        moneda=original.moneda,  # type: ignore[arg-type]
        neto=original.neto,
        forma_pago=original.forma_pago,
        plazo_pago=original.plazo_pago,
        observaciones=body.observaciones if body.observaciones is not None else original.observaciones,
        items=[
            OCDetalleCreate(
                item=d.item,
                descripcion=d.descripcion,
                precio_unitario=d.precio_unitario,
                cantidad=d.cantidad,
            )
            for d in (original.items or [])
        ],
    )
    try:
        new_oc = await repo.create(duplicate_payload)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {original.empresa_codigo}",
        ) from exc
    new_oc_id = new_oc.oc_id
    new_oc = await repo.get(new_oc_id)
    if not new_oc:  # pragma: no cover — invariant
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_duplicate",
            new_oc_id=new_oc_id,
            source_oc_id=oc_id,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{new_oc_id} duplicada pero no se pudo recargar. "
                "Refrescá la lista para verla."
            ),
        )
    after = _to_read(user, new_oc).model_dump(mode="json")
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(new_oc.oc_id),
        entity_label=new_oc.numero_oc,
        summary=(
            f"OC {new_oc.numero_oc} duplicada desde {original.numero_oc} "
            f"({original.empresa_codigo})"
        ),
        before=None,
        after=after,
    )
    await publish_event(
        db,
        "oc.created",
        {
            "oc_id": new_oc.oc_id,
            "numero_oc": new_oc.numero_oc,
            "empresa_codigo": new_oc.empresa_codigo,
            "proveedor_id": new_oc.proveedor_id,
            "total": float(new_oc.total) if new_oc.total else None,
            "moneda": new_oc.moneda,
            "estado": new_oc.estado,
            "created_by": str(user.sub),
            "duplicated_from_oc_id": original.oc_id,
        },
    )
    return _to_read(user, new_oc)


@router.patch("/{oc_id}", response_model=OrdenCompraRead)
async def update_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    body: OrdenCompraUpdate,
) -> OrdenCompraRead:
    """Edita campos no-críticos. Estado se cambia vía `/{oc_id}/estado`.

    V5++ ola CJ — scope check sobre `oc.empresa_codigo` (era un gap
    crítico: user con oc:update global podía editar OC de empresa ajena).
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    await assert_empresa_access(user, db, oc.empresa_codigo)
    if oc.estado not in _OC_EDITABLE_ESTADOS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo OCs en estado 'emitida' o 'parcial' son editables",
        )
    before = _to_read(user, oc).model_dump(mode="json")
    updated = await repo.update_fields(oc, body)
    await db.commit()
    # re-fetch para refrescar items via selectin
    refreshed = await repo.get(oc_id)
    if not refreshed:  # pragma: no cover — invariant
        import structlog
        structlog.get_logger(__name__).error(
            "oc_refetch_failed_after_edit",
            oc_id=oc_id,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"OC #{oc_id} editada pero no se pudo recargar. "
                "Refrescá la pagina para ver los cambios."
            ),
        )
    after = _to_read(user, refreshed).model_dump(mode="json")
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=refreshed.numero_oc,
        summary=f"OC {refreshed.numero_oc} editada",
        before=before,
        after=after,
    )
    return _to_read(user, refreshed)


# =====================================================================
# DELETE /ordenes-compra/{oc_id} — borrar OC (solo emitida o anulada)
# =====================================================================
#
# Permitimos eliminacion fisica solo si la OC todavia no tiene impacto
# financiero, es decir si esta en `emitida` (recien creada, sin pagos)
# o `anulada` (cancelada antes de pagar). Las `parcial` y `pagada`
# tienen movimientos contables asociados y no se borran — para esos
# casos usar el flujo de `anular` (PATCH /estado anulada) que mantiene
# el rastro auditable.
@router.delete(
    "/{oc_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("oc:update"))],
)
async def delete_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
) -> Response:
    """Borra una OC. Solo permitido si estado in ('emitida', 'anulada').

    V5++ ola CJ — scope check sobre empresa.
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, oc.empresa_codigo)
    if oc.estado not in {"emitida", "anulada"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo OCs en estado 'emitida' o 'anulada' pueden borrarse "
                f"(esta esta en '{oc.estado}'). Para detener pagos usar "
                f"PATCH /{oc_id}/estado con estado='anulada'."
            ),
        )
    numero_oc = oc.numero_oc
    estado_prev = oc.estado
    empresa_prev = oc.empresa_codigo
    before = _to_read(user, oc).model_dump(mode="json")
    await db.delete(oc)
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=numero_oc,
        summary=f"OC {numero_oc} eliminada (estado previo: {estado_prev}, empresa: {empresa_prev})",
        before=before,
        after=None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{oc_id}/estado", response_model=OrdenCompraRead)
async def update_estado(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    oc_id: int,
    body: EstadoUpdateRequest,
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")

    # V5++ ola CJ — scope check sobre empresa.
    await assert_empresa_access(user, db, oc.empresa_codigo)
    allowed = _authz.allowed_actions_for_oc(user, oc.estado)
    _ESTADO_ACTION = {"pagada": "mark_paid", "anulada": "cancel", "parcial": "mark_paid"}
    required = _ESTADO_ACTION.get(body.estado)
    if not required or required not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"No tienes permiso para cambiar estado a '{body.estado}'",
        )

    estado_before = oc.estado
    updated = await repo.update_estado(oc, body.estado)
    await db.commit()
    # `anulada` mapea a 'reject', el resto a 'approve' / 'update' según semántica.
    audit_action = (
        "reject" if body.estado == "anulada"
        else "approve" if body.estado == "pagada"
        else "update"
    )
    await audit_log(
        db,
        request,
        user,
        action=audit_action,
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=updated.numero_oc,
        summary=f"OC {updated.numero_oc}: {estado_before} -> {body.estado}",
        before={"estado": estado_before},
        after={"estado": body.estado},
    )
    # Webhook: mapea estado interno (español) → event type registrado (inglés).
    # `pagada`/`parcial` → oc.paid (con partial_payment flag). `anulada` →
    # oc.cancelled. Best-effort async — fallo del dispatcher no rompe la mutación.
    _OC_EVENT_MAP = {
        "pagada": "oc.paid",
        "parcial": "oc.paid",
        "anulada": "oc.cancelled",
    }
    _evt = _OC_EVENT_MAP.get(body.estado)
    if _evt:
        await publish_event(
            db,
            _evt,
            {
                "oc_id": oc_id,
                "numero_oc": updated.numero_oc,
                "empresa_codigo": updated.empresa_codigo,
                "estado_before": estado_before,
                "estado_after": body.estado,
                "partial_payment": body.estado == "parcial",
                "total": float(updated.total) if updated.total else None,
                "moneda": updated.moneda,
                "proveedor_id": updated.proveedor_id,
                "changed_by": str(user.sub),
            },
        )
    return _to_read(user, updated)


@router.post("/bulk-update-estado", response_model=BulkUpdateResult)
async def bulk_update_estado(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    body: BulkUpdateEstadoRequest,
) -> BulkUpdateResult:
    """Cambio masivo de estado en hasta 200 OCs.

    Reglas:
    - Reusa la misma autorización por-OC que `PATCH /{oc_id}/estado` — si el
      usuario no tiene permiso para el cambio en algún ID, ese ID falla y los
      demás siguen.
    - Cada cambio es una mutación independiente con su propio `audit_log`,
      auditado bajo `action='bulk_update'` con `entity_label` que enumera
      cuántos quedaron.
    - El commit es uno solo al final — atómico por endpoint pero idempotente
      por id (re-correr no re-aplica si el estado ya quedó).
    """
    repo = OrdenCompraRepository(db)
    failed: list[BulkItemError] = []
    succeeded = 0
    _ESTADO_ACTION = {"pagada": "mark_paid", "anulada": "cancel", "parcial": "mark_paid"}
    required_action = _ESTADO_ACTION.get(body.estado)

    for oc_id in body.ids:
        oc = await repo.get(oc_id)
        if not oc:
            failed.append(BulkItemError(id=oc_id, detail="not found"))
            continue
        if oc.estado == body.estado:
            failed.append(BulkItemError(id=oc_id, detail="ya en ese estado"))
            continue
        allowed = _authz.allowed_actions_for_oc(user, oc.estado)
        if not required_action or required_action not in allowed:
            failed.append(
                BulkItemError(id=oc_id, detail=f"sin permiso para {body.estado}")
            )
            continue
        await repo.update_estado(oc, body.estado)
        succeeded += 1

    if succeeded:
        await db.commit()
        await audit_log(
            db,
            request,
            user,
            action="update",
            entity_type="orden_compra",
            entity_id=f"bulk:{succeeded}",
            entity_label=f"{succeeded} OCs → {body.estado}",
            summary=(
                f"Bulk update estado={body.estado}: {succeeded} OCs ok, "
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


# =====================================================================
# V5++ ola AA — POST /ordenes-compra/import-csv (bulk import desde Excel)
# =====================================================================


class OcImportCsvResponse(BaseModel):
    total_rows: int
    total_ocs_intended: int
    ocs_created_count: int
    errors_count: int
    ocs_created: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


@router.post(
    "/import-csv",
    response_model=OcImportCsvResponse,
    dependencies=[Depends(require_scope("oc:create"))],
)
async def import_ocs_csv(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
) -> OcImportCsvResponse:
    """Bulk-import de Órdenes de Compra desde CSV (Excel chileno).

    Formato esperado:
        - Separador: `;`  (Excel chileno) o `,`
        - Encoding: UTF-8 (BOM opcional)
        - Una fila por ITEM de la OC; mismo `numero_oc` agrupa filas
          en una OC con sus items. La key real para agrupar combina
          `empresa_codigo|numero_oc`.

    Columnas obligatorias (case-insensitive, aliases en español OK):
        numero_oc, empresa_codigo, fecha_emision,
        item, descripcion, precio_unitario, cantidad

    Columnas opcionales:
        proveedor_id, validez_dias, moneda, forma_pago, plazo_pago,
        observaciones

    El `neto` de la OC se calcula como Σ(precio_unitario * cantidad) de
    los items. El IVA y total se calculan con la regla CLP estándar.

    Todas las OCs se crean en estado `emitida`. Idempotencia: si una OC
    con `(empresa_codigo, numero_oc)` ya existe, se reporta error y se
    continúa con las demás (best-effort).

    `dry_run=true` valida y devuelve el reporte sin insertar nada.
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

    from app.services.oc_csv_import_service import (
        OcCsvImportError,
        parse_csv_to_ocs,
    )

    parsed_ocs, report = parse_csv_to_ocs(raw)

    if dry_run or not parsed_ocs:
        return OcImportCsvResponse(**report.to_dict())

    repo = OrdenCompraRepository(db)
    for oc_data in parsed_ocs:
        try:
            if await repo.exists_numero_oc(
                oc_data.empresa_codigo, oc_data.numero_oc
            ):
                report.errors.append(
                    OcCsvImportError(
                        numero_oc=oc_data.numero_oc,
                        row=0,
                        field="numero_oc",
                        message=(
                            f"OC {oc_data.numero_oc} ya existe "
                            f"para empresa {oc_data.empresa_codigo}"
                        ),
                    )
                )
                continue

            oc = await repo.create(oc_data)
            await db.flush()
            report.ocs_created.append({
                "oc_id": oc.oc_id,
                "numero_oc": oc.numero_oc,
                "empresa_codigo": oc.empresa_codigo,
                "neto": str(oc.neto),
                "total": str(oc.total),
                "moneda": oc.moneda,
                "items": len(oc_data.items),
            })

            # Webhook por OC creada (mismo patrón que create_oc individual)
            try:
                await publish_event(
                    db,
                    "oc.created",
                    {
                        "oc_id": oc.oc_id,
                        "numero_oc": oc.numero_oc,
                        "empresa_codigo": oc.empresa_codigo,
                        "proveedor_id": oc.proveedor_id,
                        "total": float(oc.total) if oc.total else None,
                        "moneda": oc.moneda,
                        "estado": oc.estado,
                        "created_by": str(user.sub),
                        "via_csv_import": True,
                    },
                )
            except Exception:
                pass  # soft-fail
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            report.errors.append(
                OcCsvImportError(
                    numero_oc=oc_data.numero_oc,
                    row=0,
                    field=None,
                    message=f"error: {exc}",
                )
            )

    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error commiteando OCs: {exc}",
        ) from exc

    return OcImportCsvResponse(**report.to_dict())


# ─────────────────────────────────────────────────────────────────────
# R152IIII — Endpoint manual: enviar OC al GG + CC
# ─────────────────────────────────────────────────────────────────────


@router.post("/{oc_id}/send-to-signers")
async def send_oc_to_signers_endpoint(
    user: CurrentUser, db: DBSession, oc_id: int, force: bool = False
) -> dict:
    """Envía (o reenvía con ?force=true) el PDF de la OC al GG firmante.

    Auto-disparado al crear OC desde email. Endpoint manual útil para:
      - Re-enviar si Resend falló la primera vez
      - Enviar OCs creadas antes de aplicar la migración R152IIII
      - Forzar re-envío después de cambiar email del GG
    """
    if force:
        await db.execute(
            text(
                "UPDATE core.ordenes_compra "
                "SET oc_sent_at = NULL, oc_send_error = NULL "
                "WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )
        await db.commit()

    from app.services.send_oc_to_signers_service import send_oc_to_signers
    return await send_oc_to_signers(db, oc_id)
