"""MEGAPROMPT F3 — Flujo de firmas de Órdenes de Compra.

Ciclo de vida:  emitida/borrador → en_firma → firmada → enviada_proveedor
                → facturada → (voucher desde cuotas)

Endpoints (montados bajo /ordenes-compra):
- GET    /{oc_id}/firmas                     estado de firmas + equipo + sugeridos
- POST   /{oc_id}/firmantes                  asignar/invitar firmantes (legacy)
- PUT    /{oc_id}/firmantes                  replace-all del picker (no notifica)
- DELETE /{oc_id}/firmantes/{firma_id}       sacar un firmante que no firmó
- POST   /{oc_id}/firmantes/aplicar-plantilla  habituales / los de la OC anterior
- POST   /{oc_id}/enviar-a-firma             recién acá salen las invitaciones
- POST   /{oc_id}/firmar                     firma en 1 click (hash + IP + PDF)
- POST   /{oc_id}/rechazar-firma             rechazo con motivo → OC a emitida
- POST   /{oc_id}/marcar-facturada           factura recibida → lista p/ voucher

OC-FIRMANTES-EXTERNOS — separar "armar el set de firmantes" de "mandar a
firmar" es el corazón del pedido: el operador clickea integrantes del equipo
decenas de veces mientras prepara la OC y ningún click puede disparar un mail
ni mover el estado. Por eso PUT/aplicar-plantilla son mudos por defecto y todo
el envío vive en enviar-a-firma (o en PUT con notificar=true, explícito).

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
import contextlib
import hashlib
import re
import unicodedata
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
    AplicarPlantillaRequest,
    EnviarAFirmaRequest,
    FirmanteIn,
    FirmantesAssignRequest,
    FirmanteSet,
    FirmantesReplaceRequest,
    FirmaRead,
    FirmarRequest,
    FirmarResponse,
    MarcarFacturadaRequest,
    MiembroRead,
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

# core.oc_firmas.firmante_email es NOT NULL + UNIQUE(oc_id, email), pero un
# firmante externo (el del proveedor) puede no tener correo: firma el papel.
# Le sintetizamos un email bajo este subdominio nuestro — determinístico a
# partir del nombre para que un PUT repetido lo reconozca como el mismo — y
# lo excluimos de TODO envío. Nunca sale un mail hacia acá.
_SIN_EMAIL_DOMAIN = "sin-correo.cehtacapital.com"


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


def _slug_nombre(nombre: str) -> str:
    """`Javiera Vargas Ríos` → `javiera-vargas-rios` (para el email sintético)."""
    base = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore")
    slug = re.sub(r"[^a-z0-9]+", "-", base.decode("ascii").lower()).strip("-")
    return (slug or "externo")[:48]


def _placeholder_email(nombre: str) -> str:
    return f"{_slug_nombre(nombre)}@{_SIN_EMAIL_DOMAIN}"


def _es_placeholder(email: str | None) -> bool:
    return bool(email) and str(email).strip().lower().endswith(
        f"@{_SIN_EMAIL_DOMAIN}"
    )


def _clave_firmante(email: str | None, nombre: str | None) -> str:
    """Identidad de un firmante para diffear el set entrante contra la BD.

    Con correo manda el correo (es lo único estable: el nombre se tipea
    distinto cada vez). Sin correo — externos — comparamos por nombre.
    """
    e = (email or "").strip().lower()
    if e and not _es_placeholder(e):
        return e
    return f"nombre:{(nombre or '').strip().lower()}"


def _asignar_ordenes(items: list[dict[str, Any]]) -> None:
    """Numera 1..N in-place: los externos primero, después el equipo emisor.

    El PDF imprime las firmas en este orden (proveedor arriba, igual que las
    OC de referencia), así que el `orden` es dato de presentación, no de flujo.
    """
    pos = 0
    for es_externo in (True, False):
        for it in items:
            if bool(it.get("es_externo")) is es_externo:
                pos += 1
                it["orden"] = pos


def _normalizar_entrantes(firmantes: list[FirmanteSet]) -> list[dict[str, Any]]:
    """Valida el set entrante del PUT y lo deja listo para el diff.

    Dos reglas duras acá: sin correo solo se admite un externo (nadie más
    puede firmar en la plataforma), y no puede venir la misma persona dos
    veces (la BD tiene UNIQUE(oc_id, email) — mejor un 422 legible que un
    IntegrityError de Postgres).
    """
    items: list[dict[str, Any]] = []
    por_clave: dict[str, str] = {}
    por_email: dict[str, str] = {}
    for f in firmantes:
        nombre = f.nombre.strip()
        email = str(f.email).strip().lower() if f.email else ""
        if not email or _es_placeholder(email):
            if not f.es_externo:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"El firmante {nombre} necesita email para poder "
                        f"firmar en la plataforma."
                    ),
                )
            email = _placeholder_email(nombre)
        clave = _clave_firmante(email, nombre)
        if clave in por_clave:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"{nombre} está repetido en la lista de firmantes "
                    f"(ya figura como {por_clave[clave]})."
                ),
            )
        # El email también tiene que ser único: dos externos cuyos nombres
        # colapsan al mismo slug (José Pérez / Jose Perez) chocarían contra
        # UNIQUE(oc_id, firmante_email) y uno se perdería en silencio.
        if email in por_email:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"{nombre} y {por_email[email]} quedan como el mismo "
                    f"firmante ({email}). Diferenciá el nombre o cargá el "
                    f"correo real."
                ),
            )
        por_clave[clave] = nombre
        por_email[email] = nombre
        items.append(
            {
                "clave": clave,
                "email": email,
                "nombre": nombre,
                "cargo": (f.cargo or "").strip() or None,
                "es_externo": bool(f.es_externo),
                "empresa_firmante": (f.empresa_firmante or "").strip() or None,
            }
        )
    _asignar_ordenes(items)
    return items


async def _uids_por_email(
    db: AsyncSession, emails: list[str]
) -> dict[str, str]:
    """email → user_id de auth.users, en UNA query (nunca N+1)."""
    reales = [e for e in {e.strip().lower() for e in emails if e} if not _es_placeholder(e)]
    if not reales:
        return {}
    rows = (
        await db.execute(
            text(
                "SELECT id::text AS uid, lower(email) AS email "
                "FROM auth.users WHERE lower(email) = ANY(:emails)"
            ),
            {"emails": reales},
        )
    ).mappings().all()
    return {r["email"]: r["uid"] for r in rows}


async def _firmas_de(db: AsyncSession, oc_id: int, my_email: str) -> list[FirmaRead]:
    rows = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, firmante_nombre,
                          firmante_cargo, orden, status, signed_at,
                          notified_at, reminder_sent_at, comments,
                          COALESCE(es_externo, FALSE) AS es_externo,
                          empresa_firmante, firma_visual
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
            sin_email=_es_placeholder(r["firmante_email"]),
        )
        for r in rows
    ]


async def _equipo_de(db: AsyncSession, empresa_codigo: str) -> list[MiembroRead]:
    """Catálogo de personas firmantes de la empresa (chips clickeables).

    Solo activos: los dados de baja no deben poder sumarse a una OC nueva,
    pero sí siguen visibles en las firmas viejas que ya generaron.
    """
    try:
        rows = (
            await db.execute(
                text(
                    """SELECT m.miembro_id, m.empresa_codigo, m.nombre, m.cargo,
                              m.email, m.rut, m.orden, m.es_default, m.activo,
                              EXISTS (
                                  SELECT 1 FROM auth.users u
                                  WHERE lower(u.email) = lower(m.email)
                              ) AS tiene_cuenta
                       FROM core.empresa_equipo m
                       WHERE m.empresa_codigo = :emp AND m.activo
                       ORDER BY m.orden, m.miembro_id"""
                ),
                {"emp": empresa_codigo},
            )
        ).mappings().all()
    except Exception as exc:  # noqa: BLE001
        # Entorno sin la migración de core.empresa_equipo todavía: la pantalla
        # de firmas tiene que seguir abriendo, solo sin los chips del equipo.
        log.warning("oc_firmas.equipo_no_disponible", error=str(exc))
        with contextlib.suppress(Exception):
            await db.rollback()
        return []
    return [MiembroRead(**dict(r)) for r in rows]


async def _respuesta(
    db: AsyncSession,
    oc: dict[str, Any],
    my_email: str,
    *,
    estado: str | None = None,
) -> OcFirmasResponse:
    """Respuesta canónica del módulo: firmas + equipo + sugeridos en 1 sola."""
    firmas = await _firmas_de(db, oc["oc_id"], my_email)
    return OcFirmasResponse(
        oc_id=oc["oc_id"],
        numero_oc=oc["numero_oc"],
        estado=estado or oc["estado"],
        firmas=firmas,
        sugeridos=_sugeridos_de(oc),
        equipo=await _equipo_de(db, oc["empresa_codigo"]),
        puedo_firmar=any(f.es_mi_firma and f.status == "PENDIENTE" for f in firmas),
        pendientes=sum(1 for f in firmas if f.status == "PENDIENTE"),
    )


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


async def _enviar_invitaciones(
    db: AsyncSession,
    oc: dict[str, Any],
    emails: list[str],
    user: AuthenticatedUser,
    mensaje: str | None = None,
) -> None:
    """ÚNICO camino de envío de invitaciones a firmar del módulo.

    Resend directo con el PDF adjunto y, si falla, cola en core.email_outbox
    con idempotency_key (el retry regenera el PDF vía triggered_by_entity).
    Se llama SIEMPRE post-commit y nunca raisea: que un correo no salga no
    puede tumbar una operación que ya quedó firme en la BD.
    """
    # Los externos sin correo firman el papel — jamás se les manda nada.
    destinatarios = [
        e.strip() for e in emails if e and not _es_placeholder(e)
    ]
    if not destinatarios:
        return
    oc_id = oc["oc_id"]
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
        for destino in destinatarios:
            html = _invite_html(
                numero_oc=oc["numero_oc"],
                empresa=oc["empresa_razon_social"],
                proveedor=oc.get("proveedor_nombre"),
                total=oc["total"],
                moneda=oc["moneda"],
                link=f"{APP_URL}/ordenes-compra/{oc_id}",
                mensaje=mensaje,
            )
            subject = (
                f"Firma pendiente — OC {oc['numero_oc']} "
                f"({oc['empresa_razon_social']})"
            )
            sent = False
            if email_svc.enabled:
                try:
                    result = await email_svc.send_async(
                        to=[destino],
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
                        to=destino,
                        error=str(send_exc),
                    )
            if not sent:
                from app.services.email_outbox_service import enqueue_email

                await enqueue_email(
                    db,
                    to=[destino],
                    subject=subject,
                    html=html,
                    idempotency_key=f"oc-firma-invite:{oc_id}:{destino}",
                    triggered_by_user_id=user.sub,
                    triggered_by_entity=f"ocfirma:{oc_id}",
                )
    except Exception as exc:  # noqa: BLE001 — el flujo no muere por email
        log.error("oc_firmas.invites_fallaron", oc_id=oc_id, error=str(exc))


async def _notificar_in_app(
    db: AsyncSession,
    oc: dict[str, Any],
    uid_por_email: dict[str, str],
    emails: list[str],
    user: AuthenticatedUser,
) -> None:
    """Campanita in-app para los invitados que sí son usuarios de la plataforma."""
    notif_repo = NotificationRepository(db)
    link = f"/ordenes-compra/{oc['oc_id']}"
    for email in emails:
        uid = uid_por_email.get((email or "").strip().lower())
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
                entity_id=str(oc["oc_id"]),
            )


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
    return await _respuesta(db, oc, my_email)


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
    uid_by_email = await _uids_por_email(db, emails)

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
    await _notificar_in_app(
        db, oc, uid_by_email, [f.email for f in nuevos], user
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
    await _enviar_invitaciones(
        db, oc, [f.email for f in nuevos], user, body.mensaje
    )

    my_email = await _user_email(db, user)
    return await _respuesta(db, oc, my_email, estado="en_firma")


@router.put("/{oc_id:int}/firmantes", response_model=OcFirmasResponse)
async def reemplazar_firmantes(
    oc_id: int,
    body: FirmantesReplaceRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> OcFirmasResponse:
    """Replace-all: la OC queda EXACTAMENTE con este set de firmantes.

    Es el endpoint del picker — el operador clickea integrantes del equipo,
    suma al representante del proveedor y guarda. Por eso `notificar=false`
    (default) no manda un solo correo ni mueve el estado de la OC.

    Lo único intocable son las firmas ya FIRMADAS: si el set entrante no las
    incluye devolvemos 409 nombrando a quién firmó. Es un fondo de inversión
    real — una firma electrónica registrada no se borra para "reordenar".
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_ASIGNABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pueden editar los firmantes con la OC en estado "
                f"'{oc['estado']}' (permitido: emitida, borrador, en_firma)."
            ),
        )

    entrantes = _normalizar_entrantes(body.firmantes)
    claves_entrantes = {it["clave"] for it in entrantes}

    existentes = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, firmante_nombre, status,
                          COALESCE(es_externo, FALSE) AS es_externo, orden
                   FROM core.oc_firmas
                   WHERE oc_id = :id
                   ORDER BY orden, firma_id
                   FOR UPDATE"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    clave_de_fila = {
        r["firma_id"]: _clave_firmante(r["firmante_email"], r["firmante_nombre"])
        for r in existentes
    }

    # Trazabilidad legal: una firma FIRMADA no se puede sacar del set.
    firmadas_fuera = [
        r
        for r in existentes
        if r["status"] == "FIRMADA"
        and clave_de_fila[r["firma_id"]] not in claves_entrantes
    ]
    if firmadas_fuera:
        quienes = ", ".join(
            str(r["firmante_nombre"] or r["firmante_email"]) for r in firmadas_fuera
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se puede quitar a {quienes}: ya firmó la OC "
                f"{oc['numero_oc']}. Una firma electrónica registrada no se "
                f"borra — si hay que rehacer los firmantes, anulá la OC y "
                f"emití una nueva."
            ),
        )

    a_borrar = [
        r["firma_id"]
        for r in existentes
        if clave_de_fila[r["firma_id"]] not in claves_entrantes
    ]
    existente_por_clave = {clave_de_fila[r["firma_id"]]: r for r in existentes}
    a_conservar = [
        (existente_por_clave[it["clave"]], it)
        for it in entrantes
        if it["clave"] in existente_por_clave
    ]
    a_insertar = [it for it in entrantes if it["clave"] not in existente_por_clave]

    # 1 sola query por operación (nada de un round-trip por firmante).
    if a_borrar:
        await db.execute(
            text(
                "DELETE FROM core.oc_firmas "
                "WHERE oc_id = :oc AND firma_id = ANY(:ids) "
                "AND status <> 'FIRMADA'"
            ),
            {"oc": oc_id, "ids": a_borrar},
        )

    if a_conservar:
        # Los que siguen: se actualiza orden y datos de presentación. Las
        # FIRMADAS solo se reordenan (el PDF las imprime en ese orden); su
        # nombre/cargo quedan congelados como al momento de firmar.
        # Una RECHAZADA que el usuario vuelve a incluir se reabre a PENDIENTE
        # —el motivo del rechazo queda en audit.action_log— porque si no la
        # persona no podría volver a firmar nunca tras la corrección.
        await db.execute(
            text(
                """UPDATE core.oc_firmas f
                   SET orden = u.orden,
                       firmante_nombre = CASE WHEN f.status = 'FIRMADA'
                           THEN f.firmante_nombre ELSE u.nombre END,
                       firmante_cargo = CASE WHEN f.status = 'FIRMADA'
                           THEN f.firmante_cargo ELSE u.cargo END,
                       es_externo = CASE WHEN f.status = 'FIRMADA'
                           THEN f.es_externo ELSE u.es_externo END,
                       empresa_firmante = CASE WHEN f.status = 'FIRMADA'
                           THEN f.empresa_firmante ELSE u.empresa_firmante END,
                       status = CASE WHEN f.status = 'RECHAZADA'
                           THEN 'PENDIENTE' ELSE f.status END,
                       signed_at = CASE WHEN f.status = 'RECHAZADA'
                           THEN NULL ELSE f.signed_at END,
                       comments = CASE WHEN f.status = 'RECHAZADA'
                           THEN NULL ELSE f.comments END,
                       notified_at = CASE WHEN f.status = 'RECHAZADA'
                           THEN NULL ELSE f.notified_at END
                   FROM UNNEST(
                       CAST(:ids AS BIGINT[]),
                       CAST(:ordenes AS INT[]),
                       CAST(:nombres AS TEXT[]),
                       CAST(:cargos AS TEXT[]),
                       CAST(:externos AS BOOLEAN[]),
                       CAST(:empresas AS TEXT[])
                   ) AS u(firma_id, orden, nombre, cargo, es_externo,
                          empresa_firmante)
                   WHERE f.firma_id = u.firma_id"""
            ),
            {
                "ids": [r["firma_id"] for r, _ in a_conservar],
                "ordenes": [it["orden"] for _, it in a_conservar],
                "nombres": [it["nombre"] for _, it in a_conservar],
                "cargos": [it["cargo"] for _, it in a_conservar],
                "externos": [it["es_externo"] for _, it in a_conservar],
                "empresas": [it["empresa_firmante"] for _, it in a_conservar],
            },
        )

    uid_por_email = await _uids_por_email(db, [it["email"] for it in a_insertar])
    if a_insertar:
        # notified_at solo se estampa si esta llamada realmente invita: si
        # queda NULL, `enviar-a-firma` sabe a quién le falta el correo.
        notified_sql = "NOW()" if body.notificar else "NULL"
        await db.execute(
            text(
                f"""INSERT INTO core.oc_firmas (
                        oc_id, firmante_user_id, firmante_email,
                        firmante_nombre, firmante_cargo, orden,
                        es_externo, empresa_firmante, notified_at, invited_by
                    )
                    SELECT :oc, CAST(NULLIF(u.uid, '') AS UUID), u.email,
                           u.nombre, u.cargo, u.orden, u.es_externo,
                           u.empresa_firmante, {notified_sql},
                           CAST(:by AS UUID)
                    FROM UNNEST(
                        CAST(:emails AS TEXT[]),
                        CAST(:nombres AS TEXT[]),
                        CAST(:cargos AS TEXT[]),
                        CAST(:ordenes AS INT[]),
                        CAST(:externos AS BOOLEAN[]),
                        CAST(:empresas AS TEXT[]),
                        CAST(:uids AS TEXT[])
                    ) AS u(email, nombre, cargo, orden, es_externo,
                           empresa_firmante, uid)
                    ON CONFLICT (oc_id, firmante_email) DO NOTHING"""
            ),
            {
                "oc": oc_id,
                "by": user.sub,
                "emails": [it["email"] for it in a_insertar],
                "nombres": [it["nombre"] for it in a_insertar],
                "cargos": [it["cargo"] for it in a_insertar],
                "ordenes": [it["orden"] for it in a_insertar],
                "externos": [it["es_externo"] for it in a_insertar],
                "empresas": [it["empresa_firmante"] for it in a_insertar],
                "uids": [uid_por_email.get(it["email"]) for it in a_insertar],
            },
        )

    # Solo con notificar=true esto deja de ser "preparar" y pasa a "mandar".
    invitados = (
        [it["email"] for it in a_insertar if not _es_placeholder(it["email"])]
        if body.notificar
        else []
    )
    estado_final = oc["estado"]
    if body.notificar and entrantes:
        estado_final = "en_firma"
        if oc["estado"] != "en_firma":
            await db.execute(
                text(
                    "UPDATE core.ordenes_compra SET estado = 'en_firma' "
                    "WHERE oc_id = :id"
                ),
                {"id": oc_id},
            )

    if invitados:
        await _notificar_in_app(db, oc, uid_por_email, invitados, user)

    await audit_log(
        db,
        None,
        user,
        action="oc.firmantes_actualizados",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']}: firmantes actualizados "
            f"({len(a_insertar)} agregado{'s' if len(a_insertar) != 1 else ''}, "
            f"{len(a_borrar)} quitado{'s' if len(a_borrar) != 1 else ''}, "
            f"{len(entrantes)} en total"
            f"{' · invitaciones enviadas' if invitados else ''})"
        ),
        after={
            "firmantes": [it["email"] for it in entrantes],
            "notificar": bool(body.notificar),
        },
    )
    await db.commit()

    # Emails DESPUÉS del commit y con soft-fail (mismo criterio que POST).
    await _enviar_invitaciones(db, oc, invitados, user, body.mensaje)

    my_email = await _user_email(db, user)
    return await _respuesta(db, oc, my_email, estado=estado_final)


@router.delete(
    "/{oc_id:int}/firmantes/{firma_id:int}", response_model=OcFirmasResponse
)
async def quitar_firmante(
    oc_id: int,
    firma_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> OcFirmasResponse:
    """Saca un firmante de la OC. Nunca uno que ya firmó (409)."""
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_ASIGNABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pueden editar los firmantes con la OC en estado "
                f"'{oc['estado']}' (permitido: emitida, borrador, en_firma)."
            ),
        )
    row = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, firmante_nombre, status
                   FROM core.oc_firmas
                   WHERE oc_id = :oc AND firma_id = :fid
                   FOR UPDATE"""
            ),
            {"oc": oc_id, "fid": firma_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ese firmante no está en la OC {oc['numero_oc']}.",
        )
    quien = str(row["firmante_nombre"] or row["firmante_email"])
    if row["status"] == "FIRMADA":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{quien} ya firmó la OC {oc['numero_oc']} — su firma no se "
                f"puede eliminar."
            ),
        )
    await db.execute(
        text("DELETE FROM core.oc_firmas WHERE firma_id = :fid AND status <> 'FIRMADA'"),
        {"fid": firma_id},
    )
    await audit_log(
        db,
        None,
        user,
        action="oc.firmante_quitado",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=f"OC {oc['numero_oc']}: {quien} sacado de los firmantes",
        before={"firmante": row["firmante_email"], "status": row["status"]},
    )
    await db.commit()
    my_email = await _user_email(db, user)
    return await _respuesta(db, oc, my_email)


@router.post(
    "/{oc_id:int}/firmantes/aplicar-plantilla", response_model=OcFirmasResponse
)
async def aplicar_plantilla_firmantes(
    oc_id: int,
    body: AplicarPlantillaRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
) -> OcFirmasResponse:
    """Carga de una los firmantes habituales o los de la OC anterior.

    ADITIVO a propósito: respeta lo que ya hay (firmas hechas, el externo del
    proveedor que se cargó a mano) y solo suma los que faltan. Es el "no
    tener que ponerlos a cada rato" del pedido. No notifica ni cambia estado.
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_ASIGNABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se pueden editar los firmantes con la OC en estado "
                f"'{oc['estado']}' (permitido: emitida, borrador, en_firma)."
            ),
        )

    candidatos: list[dict[str, Any]] = []
    sin_email = 0
    if body.origen == "default":
        filas = (
            await db.execute(
                text(
                    """SELECT nombre, cargo, email
                       FROM core.empresa_equipo
                       WHERE empresa_codigo = :emp AND activo AND es_default
                       ORDER BY orden, miembro_id"""
                ),
                {"emp": oc["empresa_codigo"]},
            )
        ).mappings().all()
        if not filas:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"{oc['empresa_razon_social']} todavía no tiene firmantes "
                    f"habituales cargados. Cargalos en Configuración → OC → "
                    f"Equipo de firmantes (/admin/oc-branding) marcando "
                    f"\"firmante habitual\"."
                ),
            )
        for r in filas:
            # Sin correo no puede firmar en la plataforma y no es externo:
            # se salta (el contrato solo admite firma manuscrita si es_externo).
            if not (r["email"] or "").strip():
                sin_email += 1
                continue
            candidatos.append(
                {
                    "email": str(r["email"]).strip().lower(),
                    "nombre": (r["nombre"] or "").strip(),
                    "cargo": (r["cargo"] or "").strip() or None,
                    "es_externo": False,
                    "empresa_firmante": None,
                }
            )
    else:
        prev = (
            await db.execute(
                text(
                    """SELECT oc.oc_id, oc.numero_oc
                       FROM core.ordenes_compra oc
                       WHERE oc.empresa_codigo = :emp AND oc.oc_id <> :id
                         AND EXISTS (SELECT 1 FROM core.oc_firmas f
                                     WHERE f.oc_id = oc.oc_id)
                       ORDER BY oc.fecha_emision DESC, oc.oc_id DESC
                       LIMIT 1"""
                ),
                {"emp": oc["empresa_codigo"], "id": oc_id},
            )
        ).mappings().first()
        if prev is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    f"No hay una OC anterior con firmantes en "
                    f"{oc['empresa_razon_social']}."
                ),
            )
        filas = (
            await db.execute(
                text(
                    """SELECT firmante_nombre, firmante_cargo, firmante_email,
                              COALESCE(es_externo, FALSE) AS es_externo,
                              empresa_firmante
                       FROM core.oc_firmas
                       WHERE oc_id = :prev
                       ORDER BY orden, firma_id"""
                ),
                {"prev": prev["oc_id"]},
            )
        ).mappings().all()
        for r in filas:
            # Se copia SOLO la identidad del firmante. Nada del acto de firmar
            # (status/signed_at/hash/IP) viaja a la OC nueva: arrancan PENDIENTE.
            nombre = (r["firmante_nombre"] or "").strip()
            email = str(r["firmante_email"] or "").strip().lower()
            if _es_placeholder(email):
                if not r["es_externo"] or not nombre:
                    continue
                email = _placeholder_email(nombre)
            candidatos.append(
                {
                    "email": email,
                    "nombre": nombre or email,
                    "cargo": (r["firmante_cargo"] or "").strip() or None,
                    "es_externo": bool(r["es_externo"]),
                    "empresa_firmante": r["empresa_firmante"],
                }
            )

    existentes = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, firmante_nombre,
                          COALESCE(es_externo, FALSE) AS es_externo, orden
                   FROM core.oc_firmas
                   WHERE oc_id = :id
                   ORDER BY orden, firma_id
                   FOR UPDATE"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    claves = {
        _clave_firmante(r["firmante_email"], r["firmante_nombre"])
        for r in existentes
    }
    nuevos: list[dict[str, Any]] = []
    for c in candidatos:
        clave = _clave_firmante(c["email"], c["nombre"])
        if clave in claves:
            continue
        claves.add(clave)
        nuevos.append(c)

    if nuevos:
        # Renumerar todo junto: los externos siguen yendo primero en el PDF
        # aunque se hayan agregado después.
        combinados: list[dict[str, Any]] = [
            {"firma_id": r["firma_id"], "es_externo": r["es_externo"]}
            for r in existentes
        ] + [{"firma_id": None, "es_externo": c["es_externo"]} for c in nuevos]
        _asignar_ordenes(combinados)
        ya_estaban = combinados[: len(existentes)]
        for idx, c in enumerate(nuevos):
            c["orden"] = combinados[len(existentes) + idx]["orden"]

        if ya_estaban:
            await db.execute(
                text(
                    """UPDATE core.oc_firmas f
                       SET orden = u.orden
                       FROM UNNEST(
                           CAST(:ids AS BIGINT[]), CAST(:ordenes AS INT[])
                       ) AS u(firma_id, orden)
                       WHERE f.firma_id = u.firma_id"""
                ),
                {
                    "ids": [c["firma_id"] for c in ya_estaban],
                    "ordenes": [c["orden"] for c in ya_estaban],
                },
            )

        uid_por_email = await _uids_por_email(db, [c["email"] for c in nuevos])
        await db.execute(
            text(
                """INSERT INTO core.oc_firmas (
                       oc_id, firmante_user_id, firmante_email,
                       firmante_nombre, firmante_cargo, orden,
                       es_externo, empresa_firmante, invited_by
                   )
                   SELECT :oc, CAST(NULLIF(u.uid, '') AS UUID), u.email,
                          u.nombre, u.cargo, u.orden, u.es_externo,
                          u.empresa_firmante, CAST(:by AS UUID)
                   FROM UNNEST(
                       CAST(:emails AS TEXT[]),
                       CAST(:nombres AS TEXT[]),
                       CAST(:cargos AS TEXT[]),
                       CAST(:ordenes AS INT[]),
                       CAST(:externos AS BOOLEAN[]),
                       CAST(:empresas AS TEXT[]),
                       CAST(:uids AS TEXT[])
                   ) AS u(email, nombre, cargo, orden, es_externo,
                          empresa_firmante, uid)
                   ON CONFLICT (oc_id, firmante_email) DO NOTHING"""
            ),
            {
                "oc": oc_id,
                "by": user.sub,
                "emails": [c["email"] for c in nuevos],
                "nombres": [c["nombre"] for c in nuevos],
                "cargos": [c["cargo"] for c in nuevos],
                "ordenes": [c["orden"] for c in nuevos],
                "externos": [c["es_externo"] for c in nuevos],
                "empresas": [c["empresa_firmante"] for c in nuevos],
                "uids": [uid_por_email.get(c["email"]) for c in nuevos],
            },
        )

    origen_txt = (
        "firmantes habituales de la empresa"
        if body.origen == "default"
        else "la OC anterior"
    )
    await audit_log(
        db,
        None,
        user,
        action="oc.firmantes_plantilla",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']}: {len(nuevos)} firmante"
            f"{'s' if len(nuevos) != 1 else ''} agregado"
            f"{'s' if len(nuevos) != 1 else ''} desde {origen_txt}"
            f"{f' ({sin_email} sin email, omitidos)' if sin_email else ''}"
        ),
        after={
            "origen": body.origen,
            "agregados": [c["email"] for c in nuevos],
        },
    )
    await db.commit()
    my_email = await _user_email(db, user)
    return await _respuesta(db, oc, my_email)


@router.post("/{oc_id:int}/enviar-a-firma", response_model=OcFirmasResponse)
async def enviar_a_firma(
    oc_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    body: EnviarAFirmaRequest | None = None,
) -> OcFirmasResponse:
    """Recién acá salen los correos: invita a los PENDIENTE sin notificar.

    Se separa del armado del set justamente para que preparar la OC no
    despierte a nadie. Re-llamarlo no re-spamea: quien ya tiene notified_at
    queda afuera (el recordatorio de 48h lo maneja el monitor horario).
    """
    oc = await _get_oc_full(db, oc_id, user, for_update=True)
    if oc["estado"] not in _ESTADOS_ASIGNABLES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No se puede enviar a firma una OC en estado "
                f"'{oc['estado']}' (permitido: emitida, borrador, en_firma)."
            ),
        )
    filas = (
        await db.execute(
            text(
                """SELECT firma_id, firmante_email, status, notified_at
                   FROM core.oc_firmas
                   WHERE oc_id = :id
                   ORDER BY orden, firma_id
                   FOR UPDATE"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    if not filas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC {oc['numero_oc']} no tiene firmantes cargados. "
                f"Agregá al menos uno antes de enviarla a firma."
            ),
        )

    a_invitar = [
        r
        for r in filas
        if r["status"] == "PENDIENTE"
        and r["notified_at"] is None
        and not _es_placeholder(r["firmante_email"])
    ]
    emails = [str(r["firmante_email"]).strip().lower() for r in a_invitar]
    if a_invitar:
        await db.execute(
            text(
                "UPDATE core.oc_firmas SET notified_at = NOW() "
                "WHERE firma_id = ANY(:ids)"
            ),
            {"ids": [r["firma_id"] for r in a_invitar]},
        )
    if oc["estado"] != "en_firma":
        await db.execute(
            text(
                "UPDATE core.ordenes_compra SET estado = 'en_firma' "
                "WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )

    uid_por_email = await _uids_por_email(db, emails)
    await _notificar_in_app(db, oc, uid_por_email, emails, user)

    await audit_log(
        db,
        None,
        user,
        action="oc.enviada_a_firma",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']} enviada a firma "
            f"({len(a_invitar)} invitación{'es' if len(a_invitar) != 1 else ''} "
            f"de {len(filas)} firmante{'s' if len(filas) != 1 else ''})"
        ),
        after={"invitados": emails},
    )
    await db.commit()

    await _enviar_invitaciones(
        db, oc, emails, user, body.mensaje if body else None
    )

    my_email = await _user_email(db, user)
    return await _respuesta(db, oc, my_email, estado="en_firma")


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

    # Firma visual: el texto que se dibuja en cursiva sobre la línea del PDF.
    # Se congela acá y NO se re-deriva después del catálogo de equipo: una OC
    # firmada es probatoria, si mañana corrigen el nombre del miembro la firma
    # estampada tiene que seguir diciendo lo que la persona aceptó firmar.
    # COALESCE contra el nombre registrado para que nunca quede la línea vacía.
    firma_visual = (body.firma_visual or "").strip() or None

    await db.execute(
        text(
            """UPDATE core.oc_firmas
               SET status = 'FIRMADA', signed_at = :now,
                   signature_hash = :hash, ip_address = :ip,
                   user_agent = :ua, comments = :comments,
                   firma_visual = COALESCE(:firma_visual, firmante_nombre),
                   firmante_user_id = CAST(:uid AS UUID)
               WHERE firma_id = :fid"""
        ),
        {
            "now": now,
            "hash": sig_hash,
            "ip": ip,
            "ua": ua,
            "comments": body.comments,
            "firma_visual": firma_visual,
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
