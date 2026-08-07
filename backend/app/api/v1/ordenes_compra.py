"""CRUD Órdenes de Compra — Session 2.5."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
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
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.iva import calcular_iva, porcentaje_a_tasa
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.orden_compra_repository import OrdenCompraRepository
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.models.orden_compra import OrdenCompra
from app.services.oc_filename_util import oc_pdf_content_disposition
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
        plazo_entrega=oc.plazo_entrega,
        observaciones=oc.observaciones,
        proveedor_contacto_id=oc.proveedor_contacto_id,
        atte_nombre=oc.atte_nombre,
        atte_cargo=oc.atte_cargo,
        tipo_documento=oc.tipo_documento,
        iva_porcentaje=oc.iva_porcentaje,
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        items=[OCDetalleRead.model_validate(d) for d in (oc.items or [])],
        created_at=oc.created_at,
        updated_at=oc.updated_at,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


async def _persistir_unidades(
    db: DBSession, oc_id: int, items: list[OCDetalleCreate]
) -> None:
    """Graba `unidad` en core.ordenes_compra_detalle para los ítems recién creados.

    ¿Por qué acá y no en OrdenCompraRepository.create()? Porque el modelo ORM
    `OrdenCompraDetalle` no mapea la columna `unidad` (se agregó por migración
    SQL directa), así que el INSERT del repo no la puede escribir y la unidad
    se perdía. Un solo UPDATE con UNNEST — nada de un query por ítem — que
    matchea por (oc_id, item), que es UNIQUE en la tabla.

    No abre transacción propia: corre dentro de la del endpoint, antes del
    commit, para que la OC y sus unidades sean atómicas.
    """
    # Normalizamos acá (no en el schema) para que "  " no quede guardado como
    # unidad vacía y el PDF imprima "—" en vez de un espacio.
    pares = [
        (it.item, (it.unidad or "").strip())
        for it in items
        if (it.unidad or "").strip()
    ]
    if not pares:
        return
    await db.execute(
        text(
            """
            UPDATE core.ordenes_compra_detalle AS d
               SET unidad = u.unidad
              FROM UNNEST(CAST(:items AS INT[]), CAST(:unidades AS TEXT[]))
                   AS u(item, unidad)
             WHERE d.oc_id = :oc_id
               AND d.item = u.item
            """
        ),
        {
            "oc_id": oc_id,
            "items": [item for item, _ in pares],
            "unidades": [unidad for _, unidad in pares],
        },
    )


async def _leer_unidades(db: DBSession, oc_id: int) -> dict[int, str]:
    """Devuelve {detalle_id: unidad} de una OC en UNA query (sin N+1)."""
    rows = (
        await db.execute(
            text(
                "SELECT detalle_id, unidad FROM core.ordenes_compra_detalle "
                "WHERE oc_id = :oc_id AND unidad IS NOT NULL"
            ),
            {"oc_id": oc_id},
        )
    ).all()
    return {int(r[0]): str(r[1]) for r in rows}


async def _to_read_con_unidades(
    db: DBSession, user: AuthenticatedUser, oc: OrdenCompra
) -> OrdenCompraRead:
    """`_to_read` + hidratación de `unidad` por ítem.

    El ORM no trae `unidad` (columna no mapeada), así que sin esto la API
    devolvería siempre `unidad: null` aunque en la BD esté cargada — mentirle
    al frontend sobre un dato que el PDF sí imprime.
    """
    out = _to_read(user, oc)
    if not out.items:
        return out
    unidades = await _leer_unidades(db, oc.oc_id)
    if unidades:
        for item in out.items:
            item.unidad = unidades.get(item.detalle_id)
    return out


async def _resolve_atte_snapshot(
    db: DBSession, proveedor_id: int, proveedor_contacto_id: int
) -> tuple[str, str | None]:
    """Nombre/cargo del encargado elegido, para snapshotear en atte_nombre/
    atte_cargo. 404 explícito si el contacto no existe o es de otro
    proveedor — evitar que una OC quede "dirigida a" alguien de otra empresa
    por un id mal armado en el body.
    """
    row = (
        await db.execute(
            text(
                """SELECT nombre, cargo FROM core.proveedor_contactos
                   WHERE contacto_id = :cid AND proveedor_id = :pid AND activo"""
            ),
            {"cid": proveedor_contacto_id, "pid": proveedor_id},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"El contacto {proveedor_contacto_id} no existe en el "
                f"catálogo del proveedor {proveedor_id}."
            ),
        )
    return str(row[0]), (str(row[1]) if row[1] else None)


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

    # R152EEEEEE — Guard explícito: una OC SIN proveedor identificable
    # quedaba con proveedor_id=NULL → orphan FK, rompía reportes,
    # auditoría legal sin contraparte. Exigir id O rut+nombre.
    if body.proveedor_id is None and not body.proveedor_rut:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Falta el proveedor. Proporcioná proveedor_id (existente) "
                "o proveedor_rut + proveedor_nombre para crearlo."
            ),
        )

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

    # Si vino un contacto del catálogo, el catálogo manda: resolvemos
    # nombre/cargo ahí y pisamos lo que haya venido suelto en atte_nombre/
    # atte_cargo (evita mandar un texto libre inconsistente con el id).
    if body.proveedor_contacto_id is not None and body.proveedor_id is not None:
        atte_nombre, atte_cargo = await _resolve_atte_snapshot(
            db, body.proveedor_id, body.proveedor_contacto_id
        )
        body = body.model_copy(
            update={"atte_nombre": atte_nombre, "atte_cargo": atte_cargo}
        )

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
        # La unidad de cada ítem va en el mismo commit que la OC (ver
        # `_persistir_unidades`: el repo no puede escribirla).
        await _persistir_unidades(db, oc.oc_id, body.items)
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
    creada = await _to_read_con_unidades(db, user, oc)
    after = creada.model_dump(mode="json")
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
    return creada


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
    return await _to_read_con_unidades(db, user, oc)


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
    # R152UUUUUU — capturar los atributos ANTES del try/rollback de abajo:
    # si el SELECT de oc_template falla y se hace rollback, el objeto ORM
    # queda expirado y `oc.numero_oc` lanza MissingGreenlet (500) justo al
    # armar el filename, después de haber generado el PDF completo.
    oc_numero = oc.numero_oc
    oc_empresa = oc.empresa_codigo
    _pdf_log.info(
        "oc_pdf.start",
        oc_id=oc_id,
        empresa=oc_empresa,
        include_attachments=include_attachments,
        user_email=getattr(user, "email", None),
    )

    # R152QQQQ — dispatch v1 reportlab vs v2 HTML+CSS+WeasyPrint.
    # Feature flag via settings.oc_pdf_renderer ("v1" default | "v2").
    try:
        from app.core.config import settings as _settings
        renderer = (getattr(_settings, "oc_pdf_renderer", "v1") or "v1").lower()
    except Exception:
        renderer = "v1"

    # R152MMMMMM — si la empresa tiene template custom (ej. RHO →
    # 'panimavida'), forzamos v2 aunque el flag global siga en v1.
    # Best-effort: si la columna no existe aún, sigue el flag global.
    try:
        emp_template = await db.scalar(
            text("SELECT oc_template FROM core.empresas WHERE codigo = :c"),
            {"c": oc.empresa_codigo},
        )
        if (emp_template or "").lower() == "panimavida":
            renderer = "v2"
            _pdf_log.info(
                "oc_pdf.template_override", oc_id=oc_id, template=emp_template
            )
    except Exception:
        import contextlib as _ctx
        with _ctx.suppress(Exception):
            await db.rollback()

    try:
        if renderer == "v2":
            from app.services.oc_pdf_v2_service import generate_oc_pdf_v2_bundle
            _pdf_log.info("oc_pdf.using_v2", oc_id=oc_id)
            pdf_bytes = await generate_oc_pdf_v2_bundle(
                oc_id=oc_id,
                db=db,
                include_attachments=include_attachments,
                generated_by_email=getattr(user, "email", None),
            )
        else:
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

    # OC-FILENAME — el nombre lo arma oc_filename_util (misma regla que el
    # frontend). Antes era f"oc-{oc_numero}.pdf": minúscula y con el prefijo
    # duplicado, porque los numero_oc reales ya empiezan con "OC".
    # Content-Disposition va con fallback ASCII + filename* RFC 5987: Starlette
    # codifica los headers en latin-1 y un número con un carácter fuera de
    # latin-1 tiraba un 500 al descargar.
    content_disposition = oc_pdf_content_disposition(oc_numero)

    # Round 17 — audit log de descarga PDF (forense). Soft-fail.
    # R152KKKK — Bug fix: `request` no estaba en scope. Lo omito (audit_log
    # acepta request=None, solo pierde el IP/user-agent en el registro).
    try:
        await audit_log(
            db, None, user,
            action="download_pdf",
            entity_type="orden_compra",
            entity_id=str(oc_id),
            entity_label=str(oc_numero),
            summary=(
                f"Descarga PDF de OC {oc_numero} "
                f"({len(pdf_bytes)} bytes, attachments={include_attachments})"
            ),
            before=None,
            after={
                "bytes": len(pdf_bytes),
                "include_attachments": include_attachments,
                "empresa_codigo": oc_empresa,
            },
        )
    except Exception:
        pass

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": content_disposition,
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
    # La unidad de cada ítem del original en UNA query: el ORM no la mapea,
    # y sin esto el duplicado perdería las unidades (aparecerían como "—"
    # en el PDF de la copia).
    unidades_originales = await _leer_unidades(db, original.oc_id)
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
        plazo_entrega=original.plazo_entrega,
        observaciones=body.observaciones if body.observaciones is not None else original.observaciones,
        proveedor_contacto_id=original.proveedor_contacto_id,
        atte_nombre=original.atte_nombre,
        atte_cargo=original.atte_cargo,
        tipo_documento=original.tipo_documento,
        iva_porcentaje=original.iva_porcentaje,
        items=[
            OCDetalleCreate(
                item=d.item,
                descripcion=d.descripcion,
                unidad=unidades_originales.get(d.detalle_id),
                precio_unitario=d.precio_unitario,
                cantidad=d.cantidad,
            )
            for d in (original.items or [])
        ],
    )
    try:
        new_oc = await repo.create(duplicate_payload)
        await _persistir_unidades(db, new_oc.oc_id, duplicate_payload.items)
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
    duplicada = await _to_read_con_unidades(db, user, new_oc)
    after = duplicada.model_dump(mode="json")
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
    return duplicada


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

    # Si viene un contacto del catálogo, el catálogo manda (mismo criterio
    # que en la creación): resuelve y pisa atte_nombre/atte_cargo sueltos.
    if body.proveedor_contacto_id is not None:
        if oc.proveedor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta OC no tiene proveedor asociado, no se le puede asignar un contacto.",
            )
        atte_nombre, atte_cargo = await _resolve_atte_snapshot(
            db, oc.proveedor_id, body.proveedor_contacto_id
        )
        body = body.model_copy(
            update={"atte_nombre": atte_nombre, "atte_cargo": atte_cargo}
        )

    # iva/total son derivados de neto — nunca vienen directo en el body. Si
    # cambia iva_porcentaje ("cambiarle el IVA a las OC" cuando resulta ser
    # boleta y no factura), recalculamos acá con el mismo neto ya guardado.
    derived: dict = {}
    if body.iva_porcentaje is not None:
        nuevo_iva = (
            calcular_iva(oc.neto, porcentaje_a_tasa(body.iva_porcentaje))
            if oc.moneda == "CLP"
            else Decimal("0")
        )
        derived = {"iva": nuevo_iva, "total": oc.neto + nuevo_iva}

    updated = await repo.update_fields(oc, body, derived=derived)
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
    # Con unidades: el PATCH no las toca, pero la respuesta alimenta la
    # pantalla de detalle y no pueden "desaparecer" tras editar la cabecera.
    return await _to_read_con_unidades(db, user, refreshed)


# =====================================================================
# DELETE /ordenes-compra/{oc_id} — borrar OC mal cargada
# =====================================================================
#
# El criterio NO es el estado por sí solo sino el impacto real:
#   1. ¿Hay una firma puesta? → documento firmado, evidencia legal, no se
#      borra nunca (se anula).
#   2. ¿Hay plata comprometida o movida (vouchers APPROVED/EXECUTED/
#      SYNCED/RECONCILED)? → no se borra, hay que revertir la plata primero.
# Si no pasa ninguna de las dos, la OC es "papel" y se puede borrar.
#
# Por eso el allowlist de estados incluye los 4 estados PRE-firma:
# `borrador`, `emitida`, `en_firma` y `anulada`. Los estados posteriores
# (`firmada`, `enviada_proveedor`, `facturada`) y los que implican pago
# (`parcial`, `pagada`) quedan fuera: ahí el camino es anular, no borrar.
_OC_ESTADOS_BORRABLES = ("borrador", "emitida", "en_firma", "anulada")
_VOUCHER_ESTADOS_CON_PLATA = ("APPROVED", "EXECUTED", "SYNCED", "RECONCILED")


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
    """Borra fisicamente una OC mal cargada. Estados permitidos: borrador,
    emitida, en_firma, anulada.

    Bloqueos (409, con explicacion de que hacer en su lugar):
      · la OC tiene al menos una firma con status='FIRMADA' → documento
        firmado, evidencia legal, se anula pero no se borra;
      · la OC tiene vouchers APPROVED/EXECUTED/SYNCED/RECONCILED (directos
        via vouchers.oc_id o via sus cuotas) → ya hay plata comprometida.
    Ambas condiciones se chequean en UNA sola query (subselects), no una
    query por condicion.

    Borrado en cascada — verificado contra las FK reales:
      · core.ordenes_compra_detalle  ON DELETE CASCADE (+ cascade ORM)
      · core.oc_cuotas               ON DELETE CASCADE  → forma de pago
      · core.oc_firmas               ON DELETE CASCADE  → firmantes pendientes
      · core.oc_attachments          ON DELETE CASCADE  → adjuntos del email
      · core.vouchers.oc_id          ON DELETE SET NULL → el voucher sobrevive
      · webhooks/eventos de email    ON DELETE SET NULL
    La excepcion es core.inbox_messages.linked_oc_id, cuya FK quedo SIN
    ON DELETE (NO ACTION): si la OC nacio de un email, Postgres abortaba el
    DELETE con un 500 opaco. Lo desligamos explicitamente antes de borrar —
    mismo efecto que un SET NULL, el correo NO se borra.

    V5++ ola CJ — scope check sobre empresa.
    """
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, oc.empresa_codigo)
    if oc.estado not in _OC_ESTADOS_BORRABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"La OC {oc.numero_oc} esta en estado '{oc.estado}' y ya no se "
                "puede borrar: solo se borran las que todavia no avanzaron "
                "(borrador, emitida, en firma o anulada). Si esta mal cargada, "
                "anulala — queda registrada como anulada y no se puede pagar."
            ),
        )

    # UNA query: firmas puestas + quienes firmaron + vouchers con plata.
    # Los vouchers se cuentan una sola vez aunque esten enlazados por los dos
    # caminos (vouchers.oc_id directo y oc_cuotas.voucher_id).
    guard = (
        await db.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(*) FROM core.oc_firmas f
                      WHERE f.oc_id = :id AND f.status = 'FIRMADA')
                        AS firmas,
                    (SELECT string_agg(
                                DISTINCT COALESCE(f.firmante_nombre,
                                                  f.firmante_email),
                                ', ')
                       FROM core.oc_firmas f
                      WHERE f.oc_id = :id AND f.status = 'FIRMADA')
                        AS firmantes,
                    (SELECT COUNT(*) FROM core.vouchers v
                      WHERE v.status = ANY(:estados_plata)
                        AND (v.oc_id = :id
                             OR v.voucher_id IN (
                                 SELECT c.voucher_id FROM core.oc_cuotas c
                                  WHERE c.oc_id = :id
                                    AND c.voucher_id IS NOT NULL)))
                        AS vouchers
                """
            ),
            {"id": oc_id, "estados_plata": list(_VOUCHER_ESTADOS_CON_PLATA)},
        )
    ).mappings().one()

    if (guard["firmas"] or 0) > 0:
        quienes = guard["firmantes"] or "un firmante"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta OC ya la firmo {quienes}. Un documento firmado no se "
                "puede borrar porque es respaldo legal de la operacion. "
                f"Anulala en vez de borrarla: la OC {oc.numero_oc} queda como "
                "anulada, sin efecto, y con el historial intacto."
            ),
        )
    if (guard["vouchers"] or 0) > 0:
        cantidad = guard["vouchers"]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Esta OC tiene {cantidad} voucher(s) aprobado(s) o pagado(s) "
                "asociados: ya se comprometio o se movio la plata, y borrarla "
                "dejaria esos pagos sin respaldo. Primero anula o revierte "
                "esos vouchers; si igual queres dejarla sin efecto, anula la "
                f"OC {oc.numero_oc}."
            ),
        )

    numero_oc = oc.numero_oc
    estado_prev = oc.estado
    empresa_prev = oc.empresa_codigo
    # Snapshot completo (con unidades) ANTES de borrar: es lo unico que queda
    # de la OC en el audit_log si despues hay que reconstruirla.
    before = (await _to_read_con_unidades(db, user, oc)).model_dump(mode="json")
    # Desligar los emails que apuntan a esta OC (la FK no tiene ON DELETE).
    # El correo queda en la bandeja, solo pierde el vinculo.
    await db.execute(
        text(
            "UPDATE core.inbox_messages SET linked_oc_id = NULL "
            "WHERE linked_oc_id = :id"
        ),
        {"id": oc_id},
    )
    try:
        await db.delete(oc)
        await db.commit()
    except IntegrityError as exc:
        # Alguna FK sin ON DELETE que no cubrimos: mejor un mensaje claro
        # que un 500 opaco.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pudo borrar la OC {numero_oc}: todavia hay registros "
                "en el sistema que dependen de ella. Anulala en vez de "
                "borrarla, o avisa a soporte con este numero de OC."
            ),
        ) from exc
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

    # R152YYYYY — Row lock pesimista para evitar race conditions.
    # Sin esto, 2 PATCH simultáneos pasaban ambos el check de estado y
    # ambos hacían update — la 2da transición podía ser ilegal (ej.
    # PENDING→APPROVED→EXECUTED sin firmar). SELECT FOR UPDATE serializa.
    locked = (
        await db.execute(
            text("SELECT oc_id FROM core.ordenes_compra WHERE oc_id = :id FOR UPDATE"),
            {"id": oc_id},
        )
    ).first()
    if locked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")

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

    # R152YYYYY — Validar que el estado destino sea consistente con el
    # estado actual lockeado (ya validado por allowed_actions pero
    # defensivo si _authz cambia en el futuro).
    if oc.estado == body.estado:
        # Idempotente: ya está en ese estado, no hacemos nada.
        return _to_read(user, oc)

    # R152UUUUUU — Anti-anulación con vouchers vivos, igual que el bulk
    # (R152EEEEEE). El comentario del bulk asumía que "_authz ya lo bloquea
    # en el single PATCH", pero _authz solo mira rol+estado: este endpoint
    # permitía anular una OC con vouchers APROBADOS/EJECUTADOS (plata
    # comprometida o salida), dejándolos huérfanos de una OC anulada.
    if body.estado == "anulada":
        vouchers_bloq = (await db.execute(
            text(
                """SELECT COUNT(*) FROM core.oc_cuotas c
                   JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                   WHERE c.oc_id = :id AND v.status IN ('APPROVED','EXECUTED','SYNCED','RECONCILED')"""
            ),
            {"id": oc_id},
        )).scalar() or 0
        if vouchers_bloq > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"La OC tiene {vouchers_bloq} voucher(s) aprobado(s)/"
                    "ejecutado(s) asociados a sus cuotas. Anulá o revertí esos "
                    "vouchers antes de anular la OC."
                ),
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
        # R152JJJJJJ — Row lock por OC (mismo patrón que el PATCH single).
        # Sin esto, un bulk concurrente con otro update sobre la misma OC
        # pasaba ambos el check de estado y aplicaba transiciones ilegales.
        locked = (
            await db.execute(
                text("SELECT oc_id FROM core.ordenes_compra WHERE oc_id = :id FOR UPDATE"),
                {"id": oc_id},
            )
        ).first()
        if locked is None:
            failed.append(BulkItemError(id=oc_id, detail="not found"))
            continue
        oc = await repo.get(oc_id)
        if not oc:
            failed.append(BulkItemError(id=oc_id, detail="not found"))
            continue
        # R152UUUUUU — scoping multi-tenant por OC: el single PATCH valida
        # empresa (ola CJ) pero el bulk no lo hacía — un usuario scopeado a
        # una empresa podía cambiar estados de OCs de cualquier otra
        # enumerando IDs. Falla por-item para no abortar el batch completo.
        try:
            await assert_empresa_access(user, db, oc.empresa_codigo)
        except HTTPException:
            failed.append(
                BulkItemError(id=oc_id, detail="sin acceso a la empresa de esta OC")
            )
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

        # R152EEEEEE — Anti-anulación de OCs con vouchers APROBADOS/EJECUTADOS.
        # Sin este check, `bulk_update_estado` permitía anular una OC cuyas
        # cuotas ya se transformaron en vouchers ejecutados (plata salida),
        # dejando el voucher huérfano de su OC. El single PATCH ya lo bloquea
        # via `_authz`, pero el bulk path se saltaba.
        if body.estado == "anulada":
            vouchers_bloq = (await db.execute(
                text(
                    """SELECT COUNT(*) FROM core.oc_cuotas c
                       JOIN core.vouchers v ON v.voucher_id = c.voucher_id
                       WHERE c.oc_id = :id AND v.status IN ('APPROVED','EXECUTED','SYNCED','RECONCILED')"""
                ),
                {"id": oc_id},
            )).scalar() or 0
            if vouchers_bloq > 0:
                failed.append(BulkItemError(
                    id=oc_id,
                    detail=f"tiene {vouchers_bloq} voucher(s) APROBADO/EJECUTADO — anular vouchers primero",
                ))
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
            # R152UUUUUU — scoping multi-tenant por fila: el CSV trae
            # empresa_codigo libre y antes se insertaba sin validar contra
            # las empresas permitidas del usuario (un operador de RHO podía
            # importar OCs "para" CENERGY). Falla por-OC, sigue el batch.
            try:
                await assert_empresa_access(user, db, oc_data.empresa_codigo)
            except HTTPException:
                report.errors.append(
                    OcCsvImportError(
                        numero_oc=oc_data.numero_oc,
                        row=0,
                        field="empresa_codigo",
                        message=(
                            f"sin acceso a la empresa {oc_data.empresa_codigo}"
                        ),
                    )
                )
                continue
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
    # R152UUUUUU — scoping multi-tenant: este endpoint reenviaba el PDF de
    # CUALQUIER oc_id sin validar la empresa contra el scope del usuario.
    emp = await db.scalar(
        text("SELECT empresa_codigo FROM core.ordenes_compra WHERE oc_id = :id"),
        {"id": oc_id},
    )
    if emp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, str(emp))

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
