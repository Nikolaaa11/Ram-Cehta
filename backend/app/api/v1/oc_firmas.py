"""MEGAPROMPT F3 — Flujo de firmas de Órdenes de Compra.

Ciclo de vida:  emitida/borrador → en_firma → firmada → enviada_proveedor
                → facturada → (voucher desde cuotas)

Endpoints (montados bajo /ordenes-compra):
- GET  /{oc_id}/firmas            estado de firmas + sugeridos + puedo_firmar
- POST /{oc_id}/firmantes         asignar/invitar firmantes (correo + in-app)
- POST /{oc_id}/firmar            firma en 1 click (hash + IP + estampa PDF)
- POST /{oc_id}/rechazar-firma    rechazo con motivo → OC vuelve a emitida
- POST /{oc_id}/marcar-facturada  factura recibida → lista para voucher

Diseño (mismos patrones del módulo OC):
- SQL crudo con text() — el modelo SQLAlchemy de OC está deliberadamente
  desactualizado (ver gotcha R152IIII en send_oc_to_signers_service).
- Estados nuevos son TEXT sin CHECK en la BD viva (verificado): los estados
  legacy (emitida/pagada/anulada/parcial) siguen operando por PATCH /estado.
- Emails: envío directo Resend con PDF adjunto; si falla, cola en
  core.email_outbox (retry con backoff; triggered_by_entity 'oc:{id}'
  regenera el PDF en el retry).
- La firma registra usuario/fecha/hash SHA-256/IP/user-agent — mismo patrón
  probatorio que core.voucher_approvals.
"""
from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DBSession, require_scope
from app.core.logging import get_logger
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.notification_repository import (
    NotificationRepository,
)
from app.schemas.oc_firma import (
    FirmanteIn,
    FirmantesAssignRequest,
    FirmaRead,
    FirmarRequest,
    FirmarResponse,
    MarcarFacturadaRequest,
    OcFirmasResponse,
    RechazarFirmaRequest,
)
from app.services.audit_service import audit_log
from app.services.email_service import EmailService
from app.services.empresa_scope_service import assert_empresa_access

log = get_logger(__name__)

router = APIRouter()

APP_URL = "https://cehta-capital.vercel.app"

# Estados desde los que se puede mandar a firma / re-invitar firmantes.
_ESTADOS_ASIGNABLES = {"emitida", "borrador", "en_firma"}
# Estados desde los que se puede marcar facturada.
_ESTADOS_FACTURABLES = {"firmada", "enviada_proveedor"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_oc_full(
    db: AsyncSession, oc_id: int, user: AuthenticatedUser, *, for_update: bool = False
) -> dict[str, Any]:
    """OC + empresa + proveedor. 404 si no existe; 403 si fuera de scope."""
    lock = "FOR UPDATE OF oc" if for_update else ""
    row = (
        await db.execute(
            text(
                f"""SELECT oc.oc_id, oc.numero_oc, oc.empresa_codigo, oc.estado,
                           oc.total, oc.moneda, oc.created_by, oc.observaciones,
                           e.razon_social AS empresa_razon_social,
                           e.gerente_general_email AS gg_email,
                           e.gerente_general_nombre AS gg_nombre,
                           e.gerente_general_cargo AS gg_cargo,
                           COALESCE(e.firmantes_extra, '[]'::jsonb) AS firmantes_extra,
                           COALESCE(e.emails_oc_cc, ARRAY[]::TEXT[]) AS emails_cc,
                           p.razon_social AS proveedor_nombre,
                           p.email AS proveedor_email
                    FROM core.ordenes_compra oc
                    JOIN core.empresas e ON e.codigo = oc.empresa_codigo
                    LEFT JOIN core.proveedores p ON p.proveedor_id = oc.proveedor_id
                    WHERE oc.oc_id = :id
                    {lock}"""
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OC {oc_id} no encontrada",
        )
    await assert_empresa_access(user, db, row["empresa_codigo"])
    return dict(row)


async def _user_email(db: AsyncSession, user: AuthenticatedUser) -> str:
    """Email del usuario autenticado (desde auth.users, fuente de verdad)."""
    email = await db.scalar(
        text("SELECT email FROM auth.users WHERE id = CAST(:uid AS UUID)"),
        {"uid": user.sub},
    )
    if not email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se pudo resolver el email del usuario autenticado",
        )
    return str(email).strip().lower()


async def _firmas_de(db: AsyncSession, oc_id: int, my_email: str) -> list[FirmaRead]:
    rows = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, firmante_nombre,
                          firmante_cargo, orden, status, signed_at,
                          notified_at, reminder_sent_at, comments
                   FROM core.oc_firmas
                   WHERE oc_id = :id
                   ORDER BY orden, firma_id"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    return [
        FirmaRead(
            **dict(r),
            es_mi_firma=(r["firmante_email"].strip().lower() == my_email),
        )
        for r in rows
    ]


def _sugeridos_de(oc: dict[str, Any]) -> list[FirmanteIn]:
    """GG + firmantes_extra del branding de la empresa (pueden venir sin email)."""
    out: list[FirmanteIn] = []
    seen: set[str] = set()
    if oc.get("gg_email"):
        out.append(
            FirmanteIn(
                email=oc["gg_email"],
                nombre=oc.get("gg_nombre"),
                cargo=oc.get("gg_cargo") or "Gerente General",
            )
        )
        seen.add(str(oc["gg_email"]).lower())
    extra = oc.get("firmantes_extra") or []
    if isinstance(extra, list):
        for f in extra:
            if not isinstance(f, dict):
                continue
            email = str(f.get("email") or "").strip().lower()
            if not email or email in seen:
                continue  # sin email no sirve para invitar
            seen.add(email)
            out.append(
                FirmanteIn(
                    email=email,
                    nombre=f.get("nombre"),
                    cargo=f.get("cargo"),
                )
            )
    return out


def _invite_html(
    *, numero_oc: str, empresa: str, proveedor: str | None,
    total: Any, moneda: str, link: str, mensaje: str | None,
) -> str:
    extra = (
        f"<p style='background:#F5F5F7;border-radius:8px;padding:12px'>{mensaje}</p>"
        if mensaje
        else ""
    )
    prov = f" a favor de <b>{proveedor}</b>" if proveedor else ""
    return f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">
      <h2 style="color:#0F6E4B">Orden de Compra {numero_oc} espera tu firma</h2>
      <p>La OC <b>{numero_oc}</b> de <b>{empresa}</b>{prov} por
         <b>{moneda} {total}</b> requiere tu firma para continuar.</p>
      {extra}
      <p style="margin:24px 0">
        <a href="{link}" style="background:#138A5E;color:#fff;padding:12px 22px;
           border-radius:10px;text-decoration:none;font-weight:600">
           Revisar y firmar en 1 click</a>
      </p>
      <p style="color:#6e6e73;font-size:12px">Se adjunta el PDF de la OC.
         Si el botón no funciona, entrá a {link}</p>
    </div>"""


async def _enviar_oc_a_proveedor(
    db: AsyncSession, oc: dict[str, Any], firmas: int
) -> tuple[bool, str | None]:
    """Envía la OC firmada (PDF) al proveedor con CC al creador + encargados.

    Returns (enviada, detalle). Soft-fail: si Resend falla, encola en el
    outbox (el retry regenera el PDF vía triggered_by_entity='oc:{id}').
    """
    prov_email = (oc.get("proveedor_email") or "").strip()
    if not prov_email or "@" not in prov_email:
        return False, "Proveedor sin email — enviá la OC manualmente."

    # CC: creador (si existe) + encargados de la empresa.
    cc: list[str] = []
    if oc.get("created_by"):
        creator_email = await db.scalar(
            text("SELECT email FROM auth.users WHERE id = :uid"),
            {"uid": oc["created_by"]},
        )
        if creator_email:
            cc.append(str(creator_email))
    for e in oc.get("emails_cc") or []:
        if e and e.lower() not in {c.lower() for c in cc}:
            cc.append(e)

    subject = (
        f"Orden de Compra {oc['numero_oc']} — {oc['empresa_razon_social']}"
    )
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">
      <h2 style="color:#0F6E4B">Orden de Compra {oc['numero_oc']}</h2>
      <p>Estimados {oc.get('proveedor_nombre') or 'proveedor'}:</p>
      <p>Adjuntamos la Orden de Compra <b>{oc['numero_oc']}</b> de
         <b>{oc['empresa_razon_social']}</b>, completamente firmada
         ({firmas} firma{'s' if firmas != 1 else ''} electrónica{'s' if firmas != 1 else ''}).</p>
      <p>Por favor confirmar recepción respondiendo este correo.</p>
      <p style="color:#6e6e73;font-size:12px">Enviado automáticamente por la
         plataforma de gestión de {oc['empresa_razon_social']}.</p>
    </div>"""

    from app.services.send_oc_to_signers_service import generate_oc_pdf_for_email

    try:
        pdf_bytes = await generate_oc_pdf_for_email(db, oc["oc_id"])
        email_svc = EmailService()
        if email_svc.enabled:
            result = await email_svc.send_async(
                to=[prov_email],
                cc=cc or None,
                subject=subject,
                html=html,
                attachments=[
                    {
                        "filename": f"OC-{oc['numero_oc']}.pdf",
                        "content": base64.b64encode(pdf_bytes).decode("ascii"),
                    }
                ],
            )
            if result and result.get("id"):
                log.info(
                    "oc_firmas.proveedor_enviado",
                    oc_id=oc["oc_id"],
                    to=prov_email,
                    message_id=result["id"],
                )
                return True, f"Enviada a {prov_email}"
        raise RuntimeError("Resend deshabilitado o sin message_id")
    except Exception as exc:  # noqa: BLE001 — soft-fail con outbox
        log.warning(
            "oc_firmas.proveedor_envio_fallo",
            oc_id=oc["oc_id"],
            error=str(exc),
        )
        try:
            from app.services.email_outbox_service import enqueue_email

            await enqueue_email(
                db,
                to=[prov_email],
                cc=cc or None,
                subject=subject,
                html=html,
                idempotency_key=f"oc-prov-send-{oc['oc_id']}",
                triggered_by_entity=f"oc:{oc['oc_id']}",
            )
            return False, (
                "Envío al proveedor falló — quedó en cola de reintento "
                "automático (5-40 min)."
            )
        except Exception as queue_exc:  # noqa: BLE001
            return False, f"No se pudo enviar ni encolar: {queue_exc}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{oc_id:int}/firmas", response_model=OcFirmasResponse)
async def get_firmas(
    oc_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:read"))],
    db: DBSession,
) -> OcFirmasResponse:
    oc = await _get_oc_full(db, oc_id, user)
    my_email = await _user_email(db, user)
    firmas = await _firmas_de(db, oc_id, my_email)
    pendientes = sum(1 for f in firmas if f.status == "PENDIENTE")
    return OcFirmasResponse(
        oc_id=oc_id,
        numero_oc=oc["numero_oc"],
        estado=oc["estado"],
        firmas=firmas,
        sugeridos=_sugeridos_de(oc),
        puedo_firmar=any(f.es_mi_firma and f.status == "PENDIENTE" for f in firmas),
        pendientes=pendientes,
    )


@router.post(
    "/{oc_id:int}/firmantes",
    response_model=OcFirmasResponse,
    status_code=status.HTTP_201_CREATED,
)
async def asignar_firmantes(
    oc_id: int,
    body: FirmantesAssignRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> OcFirmasResponse:
    """Asigna firmantes a la OC y les avisa por correo + notificación in-app.

    Idempotente por (oc_id, email): re-invitar a alguien ya asignado no
    duplica ni re-notifica. La OC pasa a estado 'en_firma'.
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_ASIGNABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pueden asignar firmantes con la OC en estado "
                f"'{oc['estado']}' (permitido: emitida, borrador, en_firma)."
            ),
        )

    emails = [f.email.strip().lower() for f in body.firmantes]
    # Resolver qué firmantes son usuarios de la plataforma (para notif in-app).
    user_rows = (
        await db.execute(
            text(
                "SELECT id::text AS uid, lower(email) AS email "
                "FROM auth.users WHERE lower(email) = ANY(:emails)"
            ),
            {"emails": emails},
        )
    ).mappings().all()
    uid_by_email = {r["email"]: r["uid"] for r in user_rows}

    # Orden correlativo: continuar desde el máximo existente.
    next_orden = (
        await db.scalar(
            text("SELECT COALESCE(MAX(orden), 0) FROM core.oc_firmas WHERE oc_id = :id"),
            {"id": oc_id},
        )
        or 0
    )

    nuevos: list[FirmanteIn] = []
    for f in body.firmantes:
        email = f.email.strip().lower()
        next_orden += 1
        inserted = (
            await db.execute(
                text(
                    """INSERT INTO core.oc_firmas (
                           oc_id, firmante_user_id, firmante_email,
                           firmante_nombre, firmante_cargo, orden,
                           notified_at, invited_by
                       ) VALUES (
                           :oc, CAST(:uid AS UUID), :email, :nombre, :cargo,
                           :orden, NOW(), CAST(:by AS UUID)
                       )
                       ON CONFLICT (oc_id, firmante_email) DO NOTHING
                       RETURNING firma_id"""
                ),
                {
                    "oc": oc_id,
                    "uid": uid_by_email.get(email),
                    "email": email,
                    "nombre": f.nombre,
                    "cargo": f.cargo,
                    "orden": next_orden,
                    "by": user.sub,
                },
            )
        ).first()
        if inserted:
            nuevos.append(f)

    # Estado → en_firma (si venía de emitida/borrador).
    if oc["estado"] != "en_firma":
        await db.execute(
            text(
                "UPDATE core.ordenes_compra SET estado = 'en_firma' "
                "WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )

    # Notificaciones in-app para firmantes que son usuarios de la plataforma.
    notif_repo = NotificationRepository(db)
    link = f"/ordenes-compra/{oc_id}"
    for f in nuevos:
        uid = uid_by_email.get(f.email.strip().lower())
        if uid and uid != user.sub:
            await notif_repo.create(
                user_id=uid,
                tipo="oc_pending",
                title=f"OC {oc['numero_oc']} espera tu firma",
                body=(
                    f"{oc['empresa_razon_social']} → "
                    f"{oc.get('proveedor_nombre') or 'proveedor'} · "
                    f"{oc['moneda']} {oc['total']}"
                ),
                severity="warning",
                link=link,
                entity_type="orden_compra",
                entity_id=str(oc_id),
            )

    await audit_log(
        db,
        None,
        user,
        action="oc.firmantes_asignados",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']} enviada a firma "
            f"({len(nuevos)} firmante{'s' if len(nuevos) != 1 else ''} nuevo"
            f"{'s' if len(nuevos) != 1 else ''})"
        ),
        after={"firmantes": [f.email for f in body.firmantes]},
    )
    await db.commit()

    # Emails DESPUÉS del commit (enqueue_email commitea internamente y el
    # envío directo puede tardar — no queremos la transacción abierta).
    if nuevos:
        try:
            from app.services.send_oc_to_signers_service import (
                generate_oc_pdf_for_email,
            )

            pdf_b64: str | None = None
            try:
                pdf_b64 = base64.b64encode(
                    await generate_oc_pdf_for_email(db, oc_id)
                ).decode("ascii")
            except Exception as pdf_exc:  # noqa: BLE001 — invitar sin PDF > no invitar
                log.warning(
                    "oc_firmas.invite_pdf_fallo", oc_id=oc_id, error=str(pdf_exc)
                )
            email_svc = EmailService()
            for f in nuevos:
                html = _invite_html(
                    numero_oc=oc["numero_oc"],
                    empresa=oc["empresa_razon_social"],
                    proveedor=oc.get("proveedor_nombre"),
                    total=oc["total"],
                    moneda=oc["moneda"],
                    link=f"{APP_URL}/ordenes-compra/{oc_id}",
                    mensaje=body.mensaje,
                )
                subject = (
                    f"Firma pendiente — OC {oc['numero_oc']} "
                    f"({oc['empresa_razon_social']})"
                )
                sent = False
                if email_svc.enabled:
                    try:
                        result = await email_svc.send_async(
                            to=[f.email],
                            subject=subject,
                            html=html,
                            attachments=(
                                [
                                    {
                                        "filename": f"OC-{oc['numero_oc']}.pdf",
                                        "content": pdf_b64,
                                    }
                                ]
                                if pdf_b64
                                else None
                            ),
                        )
                        sent = bool(result and result.get("id"))
                    except Exception as send_exc:  # noqa: BLE001
                        log.warning(
                            "oc_firmas.invite_directo_fallo",
                            oc_id=oc_id,
                            to=f.email,
                            error=str(send_exc),
                        )
                if not sent:
                    from app.services.email_outbox_service import enqueue_email

                    await enqueue_email(
                        db,
                        to=[f.email],
                        subject=subject,
                        html=html,
                        idempotency_key=f"oc-firma-invite:{oc_id}:{f.email}",
                        triggered_by_user_id=user.sub,
                        triggered_by_entity=f"ocfirma:{oc_id}",
                    )
        except Exception as exc:  # noqa: BLE001 — el flujo no muere por email
            log.error("oc_firmas.invites_fallaron", oc_id=oc_id, error=str(exc))

    my_email = await _user_email(db, user)
    firmas = await _firmas_de(db, oc_id, my_email)
    return OcFirmasResponse(
        oc_id=oc_id,
        numero_oc=oc["numero_oc"],
        estado="en_firma",
        firmas=firmas,
        sugeridos=_sugeridos_de(oc),
        puedo_firmar=any(f.es_mi_firma and f.status == "PENDIENTE" for f in firmas),
        pendientes=sum(1 for f in firmas if f.status == "PENDIENTE"),
    )


@router.post("/{oc_id:int}/firmar", response_model=FirmarResponse)
async def firmar_oc(
    oc_id: int,
    body: FirmarRequest,
    request: Request,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:approve"))],
    db: DBSession,
) -> FirmarResponse:
    """Firma en 1 click. Registra usuario/fecha/hash/IP y estampa el PDF.

    Cuando se completa la última firma pendiente: estado → 'firmada' y la OC
    se envía automáticamente al proveedor (PDF adjunto, CC creador +
    encargados) → 'enviada_proveedor'.
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in {"en_firma", "emitida"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La OC está en estado '{oc['estado']}' — no admite firmas.",
        )
    my_email = await _user_email(db, user)

    firma = (
        await db.execute(
            text(
                """SELECT firma_id FROM core.oc_firmas
                   WHERE oc_id = :id AND lower(firmante_email) = :email
                     AND status = 'PENDIENTE'
                   FOR UPDATE"""
            ),
            {"id": oc_id, "email": my_email},
        )
    ).first()
    if firma is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tenés una firma pendiente en esta OC.",
        )

    now = datetime.now(timezone.utc)
    ip = request.client.host if request.client else None
    ua = (request.headers.get("user-agent") or "")[:300]
    sig_hash = hashlib.sha256(
        f"{oc['numero_oc']}|{my_email}|{now.isoformat()}|{ip}".encode()
    ).hexdigest()

    await db.execute(
        text(
            """UPDATE core.oc_firmas
               SET status = 'FIRMADA', signed_at = :now,
                   signature_hash = :hash, ip_address = :ip,
                   user_agent = :ua, comments = :comments,
                   firmante_user_id = CAST(:uid AS UUID)
               WHERE firma_id = :fid"""
        ),
        {
            "now": now,
            "hash": sig_hash,
            "ip": ip,
            "ua": ua,
            "comments": body.comments,
            "uid": user.sub,
            "fid": firma[0],
        },
    )

    pendientes = (
        await db.scalar(
            text(
                "SELECT count(*) FROM core.oc_firmas "
                "WHERE oc_id = :id AND status = 'PENDIENTE'"
            ),
            {"id": oc_id},
        )
        or 0
    )
    total_firmadas = (
        await db.scalar(
            text(
                "SELECT count(*) FROM core.oc_firmas "
                "WHERE oc_id = :id AND status = 'FIRMADA'"
            ),
            {"id": oc_id},
        )
        or 0
    )

    await audit_log(
        db,
        request,
        user,
        action="oc.firmada",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']} firmada por {my_email} "
            f"({int(pendientes)} pendiente{'s' if int(pendientes) != 1 else ''})"
        ),
        after={"hash": sig_hash, "pendientes": int(pendientes)},
    )

    completa = int(pendientes) == 0
    enviada = False
    detalle: str | None = None

    if completa:
        await db.execute(
            text(
                "UPDATE core.ordenes_compra SET estado = 'firmada' "
                "WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )
        # Notificar al creador que quedó completamente firmada.
        if oc.get("created_by") and str(oc["created_by"]) != user.sub:
            await NotificationRepository(db).create(
                user_id=str(oc["created_by"]),
                tipo="oc_pending",
                title=f"OC {oc['numero_oc']} completamente firmada",
                body="Se enviará automáticamente al proveedor.",
                severity="info",
                link=f"/ordenes-compra/{oc_id}",
                entity_type="orden_compra",
                entity_id=str(oc_id),
            )
        await db.commit()

        # Auto-envío al proveedor (post-commit; puede tardar por el PDF).
        enviada, detalle = await _enviar_oc_a_proveedor(db, oc, int(total_firmadas))
        if enviada:
            await db.execute(
                text(
                    "UPDATE core.ordenes_compra SET estado = 'enviada_proveedor' "
                    "WHERE oc_id = :id AND estado = 'firmada'"
                ),
                {"id": oc_id},
            )
            await audit_log(
                db,
                request,
                user,
                action="oc.enviada_proveedor",
                entity_type="orden_compra",
                entity_id=str(oc_id),
                entity_label=oc["numero_oc"],
                summary=f"OC {oc['numero_oc']} enviada al proveedor ({detalle})",
            )
            await db.commit()
        elif oc.get("created_by"):
            # Proveedor sin email o envío en retry — avisar al creador.
            await NotificationRepository(db).create(
                user_id=str(oc["created_by"]),
                tipo="oc_pending",
                title=f"OC {oc['numero_oc']}: revisar envío al proveedor",
                body=detalle or "",
                severity="warning",
                link=f"/ordenes-compra/{oc_id}",
                entity_type="orden_compra",
                entity_id=str(oc_id),
            )
            await db.commit()
    else:
        await db.commit()

    estado_final = (
        "enviada_proveedor" if enviada else ("firmada" if completa else "en_firma")
    )
    return FirmarResponse(
        ok=True,
        estado=estado_final,
        completamente_firmada=completa,
        enviada_proveedor=enviada,
        proveedor_email=oc.get("proveedor_email"),
        detalle=detalle,
    )


@router.post("/{oc_id:int}/rechazar-firma", response_model=FirmarResponse)
async def rechazar_firma(
    oc_id: int,
    body: RechazarFirmaRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:approve"))],
    db: DBSession,
) -> FirmarResponse:
    """El firmante rechaza con motivo → la OC vuelve a 'emitida' para corregir."""
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    my_email = await _user_email(db, user)
    updated = (
        await db.execute(
            text(
                """UPDATE core.oc_firmas
                   SET status = 'RECHAZADA', comments = :motivo,
                       signed_at = NOW(), firmante_user_id = CAST(:uid AS UUID)
                   WHERE oc_id = :id AND lower(firmante_email) = :email
                     AND status = 'PENDIENTE'
                   RETURNING firma_id"""
            ),
            {"motivo": body.motivo, "uid": user.sub, "id": oc_id, "email": my_email},
        )
    ).first()
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tenés una firma pendiente en esta OC.",
        )
    await db.execute(
        text("UPDATE core.ordenes_compra SET estado = 'emitida' WHERE oc_id = :id"),
        {"id": oc_id},
    )
    if oc.get("created_by") and str(oc["created_by"]) != user.sub:
        await NotificationRepository(db).create(
            user_id=str(oc["created_by"]),
            tipo="oc_pending",
            title=f"OC {oc['numero_oc']}: firma rechazada",
            body=f"Motivo: {body.motivo}",
            severity="critical",
            link=f"/ordenes-compra/{oc_id}",
            entity_type="orden_compra",
            entity_id=str(oc_id),
        )
    await audit_log(
        db,
        None,
        user,
        action="oc.firma_rechazada",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=f"Firma de OC {oc['numero_oc']} rechazada por {my_email}",
        after={"motivo": body.motivo},
    )
    await db.commit()
    return FirmarResponse(
        ok=True, estado="emitida", completamente_firmada=False, detalle=body.motivo
    )


@router.post("/{oc_id:int}/marcar-facturada", response_model=FirmarResponse)
async def marcar_facturada(
    oc_id: int,
    body: MarcarFacturadaRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> FirmarResponse:
    """Registra que llegó la factura del proveedor → OC 'facturada'.

    Con esto la OC aparece en "Listas para voucher" (la factura puede venir
    linkeada desde el mailbox o adjunta por Dropbox). El folio queda en
    observaciones para trazabilidad del voucher.
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_FACTURABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Solo una OC firmada/enviada puede marcarse facturada "
                f"(estado actual: '{oc['estado']}')."
            ),
        )
    nota = f"Factura recibida{f' folio {body.folio}' if body.folio else ''}"
    await db.execute(
        text(
            """UPDATE core.ordenes_compra
               SET estado = 'facturada',
                   observaciones = COALESCE(observaciones || E'\n', '') || :nota
               WHERE oc_id = :id"""
        ),
        {"id": oc_id, "nota": f"[{datetime.now(timezone.utc).date().isoformat()}] {nota}"},
    )
    await audit_log(
        db,
        None,
        user,
        action="oc.facturada",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=f"OC {oc['numero_oc']} marcada facturada — lista para voucher",
        after={"folio": body.folio},
    )
    await db.commit()
    return FirmarResponse(
        ok=True, estado="facturada", completamente_firmada=True, detalle=nota
    )
