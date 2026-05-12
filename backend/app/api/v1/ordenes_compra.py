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
    UploadFile,
    status,
)
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.orden_compra_repository import OrdenCompraRepository
from app.models.orden_compra import OrdenCompra
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

    repo = OrdenCompraRepository(db)
    if await repo.exists_numero_oc(body.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        )
    oc = await repo.create(body)
    await db.commit()
    oc = await repo.get(oc.oc_id)  # re-fetch para cargar items via selectin
    if not oc:
        raise HTTPException(status_code=500, detail="Error al recuperar OC creada")
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


@router.get("/{oc_id}", response_model=OrdenCompraRead)
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


@router.post(
    "/{oc_id}/duplicate",
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
    new_oc = await repo.create(duplicate_payload)
    await db.commit()
    new_oc = await repo.get(new_oc.oc_id)
    if not new_oc:  # pragma: no cover — invariant
        raise HTTPException(status_code=500, detail="Error al recuperar OC duplicada")
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
    """Edita campos no-críticos. Estado se cambia vía `/{oc_id}/estado`."""
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
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
        raise HTTPException(status_code=500, detail="Error al recuperar OC editada")
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
