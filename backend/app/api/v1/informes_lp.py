"""Endpoints de Informes LP virales (V4 fase 9 — Sprint 1).

Tres áreas:

1. ADMIN (requieren auth + scope `informe_lp:*`):
   - POST /informes-lp/generate           — crea borrador con narrativa AI
   - GET  /informes-lp                    — lista para dashboard interno
   - GET  /informes-lp/{id}               — detalle interno (con analytics)
   - PATCH /informes-lp/{id}              — editar narrativa antes de publicar
   - DELETE /informes-lp/{id}             — soft-delete (estado='archivado')
   - POST /informes-lp/{id}/publish       — pasa a publicado + envía email

2. PÚBLICO (sin auth — el token es la auth):
   - GET  /informes-lp/by-token/{token}   — vista pública del informe
   - POST /informes-lp/by-token/{token}/track  — log de evento granular
   - POST /informes-lp/by-token/{token}/share  — generar child_token

3. ADMIN — pipeline de LPs:
   - GET/POST/PATCH/DELETE /lps           — CRUD del pipeline

Sprint 1: NO incluye AI generation (mock con datos placeholder).
Sprint 2 reemplazará la lógica de _build_initial_secciones con llamadas
a Anthropic.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.informe_lp_repository import (
    InformeLpEventoRepository,
    InformeLpRepository,
    LpRepository,
)
from app.models.empresa import Empresa
from app.models.informe_lp import InformeLp
from app.models.lp import Lp
from app.schemas.informe_lp import (
    InformeLpGenerateRequest,
    InformeLpListItem,
    InformeLpPublicView,
    InformeLpRead,
    InformeLpShareRequest,
    InformeLpShareResponse,
    InformeLpUpdate,
    LpCreate,
    LpRead,
    LpUpdate,
    TrackEventRequest,
    TrackEventResponse,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _client_ip(request: Request) -> str | None:
    """Extrae la IP cliente respetando X-Forwarded-For (Fly.io / Vercel).

    Fly.io agrega `Fly-Client-IP` como source más confiable.
    """
    fly_ip = request.headers.get("fly-client-ip")
    if fly_ip:
        return fly_ip
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _is_expired(expira_at: datetime | None) -> bool:
    if expira_at is None:
        return False
    return datetime.utcnow().replace(tzinfo=expira_at.tzinfo) > expira_at


def _build_initial_secciones(
    request: InformeLpGenerateRequest,
    lp: Lp | None,
    empresas: list[Empresa],
) -> dict[str, Any]:
    """Build placeholder secciones para Sprint 1.

    Sprint 2 reemplazará esto con generate_informe_narrativa() del
    service AI. Por ahora cargamos un esqueleto vacío con la estructura
    que el frontend va a esperar.
    """
    nombre_lp = "Inversionista"
    if lp:
        nombre_lp = lp.nombre + (f" {lp.apellido}" if lp.apellido else "")

    # Empresas a destacar: las que el LP invirtió + las que el GP pidió incluir
    empresas_destacadas: list[str] = []
    if lp and lp.empresas_invertidas:
        empresas_destacadas.extend(lp.empresas_invertidas)
    if request.incluir_empresas:
        for cod in request.incluir_empresas:
            if cod not in empresas_destacadas:
                empresas_destacadas.append(cod)
    # Default: las primeras 5 empresas con datos
    if not empresas_destacadas:
        empresas_destacadas = [e.codigo for e in empresas[:5]]

    return {
        "performance": {
            "kind": "performance",
            "payload": {
                "kpis": [],  # se completa con live data al renderizar
                "narrativa": "TBD — completar con AI en Sprint 2",
            },
        },
        "tu_posicion": {
            "kind": "tu_posicion",
            "payload": {
                "aporte_total": float(lp.aporte_total) if lp and lp.aporte_total else None,
                "aporte_actual": float(lp.aporte_actual) if lp and lp.aporte_actual else None,
                "empresas_invertidas": list(lp.empresas_invertidas) if lp and lp.empresas_invertidas else [],
            },
        },
        "empresas": {
            "kind": "empresas_showcase",
            "payload": {
                "destacadas": empresas_destacadas,
                "narrativas": {},  # cod → {"headline", "parrafo", "metricas"}
            },
        },
        "esg_impact": {
            "kind": "esg_impact",
            "payload": {
                "co2_evitado_tons": None,
                "mw_renovables": None,
                "hogares_equivalentes": None,
                "empleos_creados": None,
                "narrativa": "TBD",
            },
        },
        "outlook": {
            "kind": "outlook",
            "payload": {
                "horizonte_meses": 6,
                "hitos_proximos": [],  # pull en vivo desde core.hitos
                "narrativa": "TBD",
            },
        },
        "cta": {
            "kind": "cta",
            "payload": {
                "primario": "Agendá café con Camilo (30min)",
                "secundario_1": "Aumentar tu posición",
                "secundario_2": "Compartir con un colega",
            },
        },
        "_meta": {
            "destinatario": nombre_lp,
            "tono": request.tono,
            "ai_generated": False,  # Sprint 2 lo pondrá en true
        },
    }


# ---------------------------------------------------------------------------
# Pipeline de LPs (admin)
# ---------------------------------------------------------------------------


@router.get(
    "/lps",
    response_model=list[LpRead],
    dependencies=[Depends(require_scope("lp:read"))],
)
async def list_lps(
    user: CurrentUser,
    db: DBSession,
    estado: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[LpRead]:
    repo = LpRepository(db)
    lps = await repo.list_all(estado=estado, limit=limit, offset=offset)
    return [LpRead.model_validate(lp) for lp in lps]


@router.post(
    "/lps",
    response_model=LpRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("lp:create"))],
)
async def create_lp(
    user: CurrentUser,
    db: DBSession,
    body: LpCreate,
) -> LpRead:
    repo = LpRepository(db)
    if body.email:
        existing = await repo.get_by_email(body.email)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un LP con email {body.email}",
            )
    lp = await repo.create(body)
    await db.commit()
    return LpRead.model_validate(lp)


@router.get(
    "/lps/{lp_id}",
    response_model=LpRead,
    dependencies=[Depends(require_scope("lp:read"))],
)
async def get_lp(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
) -> LpRead:
    repo = LpRepository(db)
    lp = await repo.get(lp_id)
    if lp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="LP no encontrado"
        )
    return LpRead.model_validate(lp)


@router.patch(
    "/lps/{lp_id}",
    response_model=LpRead,
    dependencies=[Depends(require_scope("lp:update"))],
)
async def update_lp(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
    body: LpUpdate,
) -> LpRead:
    repo = LpRepository(db)
    lp = await repo.get(lp_id)
    if lp is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="LP no encontrado"
        )
    updated = await repo.update(lp, body)
    await db.commit()
    return LpRead.model_validate(updated)


@router.delete(
    "/lps/{lp_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("lp:delete"))],
)
async def delete_lp(
    user: CurrentUser,
    db: DBSession,
    lp_id: int,
) -> Response:
    repo = LpRepository(db)
    lp = await repo.get(lp_id)
    if lp is not None:
        await repo.delete(lp)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Informes LP (admin)
# ---------------------------------------------------------------------------


@router.post(
    "/informes-lp/generate",
    response_model=InformeLpRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("informe_lp:create"))],
)
async def generate_informe(
    user: CurrentUser,
    db: DBSession,
    body: InformeLpGenerateRequest,
) -> InformeLpRead:
    """Sprint 1: crea borrador con secciones placeholder.

    Sprint 2 reemplazará con narrativas AI reales de Anthropic.
    """
    lp_repo = LpRepository(db)
    informe_repo = InformeLpRepository(db)

    lp: Lp | None = None
    if body.lp_id is not None:
        lp = await lp_repo.get(body.lp_id)
        if lp is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"LP {body.lp_id} no encontrado",
            )

    # Cargar empresas para que el _build sepa cuáles destacar
    empresas = list((await db.scalars(select(Empresa).order_by(Empresa.codigo))).all())

    # Título auto-generado si no vino
    titulo = body.titulo
    if not titulo:
        if body.tipo == "memoria_anual":
            titulo = f"Memoria Anual {body.periodo or ''}".strip()
        elif body.tipo == "tear_sheet":
            titulo = "Tear Sheet — FIP CEHTA ESG"
        elif body.tipo == "pitch_inicial":
            titulo = "FIP CEHTA ESG — Te invitamos a invertir"
        elif body.tipo == "update_mensual":
            titulo = f"Update {body.periodo or 'mensual'}"
        else:
            titulo = f"Reporte {body.periodo or 'periódico'}"

    secciones = _build_initial_secciones(body, lp, empresas)

    # Hero placeholder — Sprint 2 lo reemplaza con AI
    nombre_lp = "Inversionista"
    if lp:
        nombre_lp = lp.nombre
    hero_titulo = f"Hola, {nombre_lp}."
    hero_narrativa = "Estamos preparando tu informe personalizado."

    informe = await informe_repo.create(
        lp_id=lp.lp_id if lp else None,
        titulo=titulo,
        tipo=body.tipo,
        periodo=body.periodo,
        hero_titulo=hero_titulo,
        hero_narrativa=hero_narrativa,
        secciones=secciones,
        creado_por=user.email if hasattr(user, "email") else None,
    )
    # Default expiration: 90 días
    informe.expira_at = datetime.utcnow() + timedelta(days=90)
    await db.commit()
    await db.refresh(informe)
    return InformeLpRead.model_validate(informe)


@router.get(
    "/informes-lp",
    response_model=list[InformeLpListItem],
    dependencies=[Depends(require_scope("informe_lp:read"))],
)
async def list_informes(
    user: CurrentUser,
    db: DBSession,
    estado: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[InformeLpListItem]:
    repo = InformeLpRepository(db)
    rows = await repo.list_with_lp_name(estado=estado, limit=limit, offset=offset)
    items: list[InformeLpListItem] = []
    for informe, lp_nombre in rows:
        items.append(
            InformeLpListItem(
                informe_id=informe.informe_id,
                lp_id=informe.lp_id,
                lp_nombre=lp_nombre.strip() if lp_nombre else None,
                token=informe.token,
                titulo=informe.titulo,
                periodo=informe.periodo,
                tipo=informe.tipo,
                estado=informe.estado,
                publicado_at=informe.publicado_at,
                veces_abierto=informe.veces_abierto,
                veces_compartido=informe.veces_compartido,
                created_at=informe.created_at,
            )
        )
    return items


@router.get(
    "/informes-lp/{informe_id}",
    response_model=InformeLpRead,
    dependencies=[Depends(require_scope("informe_lp:read"))],
)
async def get_informe(
    user: CurrentUser,
    db: DBSession,
    informe_id: int,
) -> InformeLpRead:
    repo = InformeLpRepository(db)
    informe = await repo.get(informe_id)
    if informe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Informe no encontrado"
        )
    return InformeLpRead.model_validate(informe)


@router.patch(
    "/informes-lp/{informe_id}",
    response_model=InformeLpRead,
    dependencies=[Depends(require_scope("informe_lp:update"))],
)
async def update_informe(
    user: CurrentUser,
    db: DBSession,
    informe_id: int,
    body: InformeLpUpdate,
) -> InformeLpRead:
    repo = InformeLpRepository(db)
    informe = await repo.get(informe_id)
    if informe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Informe no encontrado"
        )

    # Pasar a publicado requiere scope dedicado (no solo update)
    if body.estado == "publicado" and informe.estado != "publicado":
        # Verificamos scope informe_lp:publish via dependency manualmente
        # (simple check sobre user roles; si require_scope falló no llegaría acá)
        if not _has_scope(user, "informe_lp:publish"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo admin/GP puede publicar informes (requiere scope informe_lp:publish)",
            )

    updated = await repo.update(informe, body)
    await db.commit()
    return InformeLpRead.model_validate(updated)


def _has_scope(user: Any, scope: str) -> bool:
    """Helper defensivo — chequea si el user tiene el scope dado."""
    scopes = getattr(user, "scopes", None) or getattr(user, "allowed_actions", None)
    if not scopes:
        return False
    return scope in scopes


@router.delete(
    "/informes-lp/{informe_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("informe_lp:delete"))],
)
async def delete_informe(
    user: CurrentUser,
    db: DBSession,
    informe_id: int,
) -> Response:
    repo = InformeLpRepository(db)
    informe = await repo.get(informe_id)
    if informe is not None:
        # Soft-delete: archivar en vez de borrar (preservar analytics)
        informe.estado = "archivado"
        await db.flush()
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# PÚBLICO — vista del informe + tracking + share (sin auth)
# ---------------------------------------------------------------------------


@router.get(
    "/informes-lp/by-token/{token}",
    response_model=InformeLpPublicView,
)
async def get_informe_by_token(
    db: DBSession,
    token: str,
    request: Request,
) -> InformeLpPublicView:
    """Endpoint PÚBLICO — el token es la auth. Cualquiera con el link puede ver.

    Soft-fail si:
    - Token no existe → 404 genérico (sin filtrar info)
    - Estado != publicado → 404 también (no exponer borradores)
    - Expirado → devolvemos pero con flag `is_expired=true`
    """
    repo = InformeLpRepository(db)
    informe = await repo.get_by_token(token)
    if informe is None or informe.estado == "archivado":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Informe no encontrado",
        )
    # Solo borradores pueden verse en preview con un query param adicional
    is_preview = request.query_params.get("preview") == "1"
    if informe.estado == "borrador" and not is_preview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Informe no disponible",
        )

    # Pull LP info si existe
    lp_nombre: str | None = None
    lp_apellido: str | None = None
    lp_empresa: str | None = None
    if informe.lp_id is not None:
        lp_repo = LpRepository(db)
        lp = await lp_repo.get(informe.lp_id)
        if lp is not None:
            lp_nombre = lp.nombre
            lp_apellido = lp.apellido
            lp_empresa = lp.empresa

    # Si vino de un share, atribución sutil
    parent_lp_nombre: str | None = None
    if informe.parent_token:
        parent = await repo.get_by_token(informe.parent_token)
        if parent and parent.lp_id is not None:
            parent_lp = await LpRepository(db).get(parent.lp_id)
            if parent_lp is not None:
                parent_lp_nombre = parent_lp.nombre

    # Live data: en Sprint 2 va a pullear KPIs + ESG en tiempo real.
    # Por ahora dejamos placeholder vacío.
    live_data: dict[str, Any] = {
        "_meta": {"sprint": 1, "live_data_disponible": False},
    }

    return InformeLpPublicView(
        informe_id=informe.informe_id,
        titulo=informe.titulo,
        periodo=informe.periodo,
        tipo=informe.tipo,
        hero_titulo=informe.hero_titulo,
        hero_narrativa=informe.hero_narrativa,
        secciones=informe.secciones,
        publicado_at=informe.publicado_at,
        expira_at=informe.expira_at,
        is_expired=_is_expired(informe.expira_at),
        lp_nombre=lp_nombre,
        lp_apellido=lp_apellido,
        lp_empresa=lp_empresa,
        parent_lp_nombre=parent_lp_nombre,
        live_data=live_data,
    )


@router.post(
    "/informes-lp/by-token/{token}/track",
    response_model=TrackEventResponse,
)
async def track_event(
    db: DBSession,
    token: str,
    body: TrackEventRequest,
    request: Request,
) -> TrackEventResponse:
    """Endpoint PÚBLICO — tracking de eventos sin auth.

    El token es la auth. IP se hashea antes de persistir. Rate limiting
    se hace en middleware (TODO Sprint 3).

    Side effects:
    - tipo='open' → incrementa veces_abierto en el informe
    - tipo='share_click' → incrementa veces_compartido
    """
    repo = InformeLpRepository(db)
    informe = await repo.get_by_token(token)
    if informe is None:
        # 404 genérico para no leakear info de tokens válidos
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token inválido",
        )

    # Persistir evento
    event_repo = InformeLpEventoRepository(db)
    await event_repo.create(
        informe_id=informe.informe_id,
        token=token,
        event=body,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        referer_override=request.headers.get("referer"),
    )

    # Side effects: contadores agregados (denormalized para fast dashboard)
    if body.tipo == "open":
        await repo.increment_open(informe)
    elif body.tipo == "share_click":
        await repo.increment_share(informe)

    await db.commit()
    return TrackEventResponse(ok=True)


@router.post(
    "/informes-lp/by-token/{token}/share",
    response_model=InformeLpShareResponse,
)
async def share_informe(
    db: DBSession,
    token: str,
    body: InformeLpShareRequest,
    request: Request,
) -> InformeLpShareResponse:
    """Endpoint PÚBLICO — el LP comparte con un colega.

    Crea un nuevo informe con `parent_token = current` y mismo contenido.
    El frontend usa el child_token para mostrar el link al LP que comparte.

    Sprint 2 va a sumar el envío de email automático con Resend al
    destinatario.
    """
    repo = InformeLpRepository(db)
    parent = await repo.get_by_token(token)
    if parent is None or parent.estado != "publicado":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Informe no encontrado",
        )

    # Cap defensivo anti-spam: max 20 shares por informe
    if (parent.veces_compartido or 0) >= 20:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Límite de comparticiones alcanzado para este informe",
        )

    # Crear lead anónimo (no es LP todavía)
    # NOTA: en Sprint 2 vamos a chequear si ya existe un Lp con ese email
    # y reusar, o crear uno con estado='pipeline'.
    lp_repo = LpRepository(db)
    existing_lp = await lp_repo.get_by_email(body.email_destinatario)
    new_lp_id: int | None = None
    if existing_lp:
        new_lp_id = existing_lp.lp_id
    else:
        # Crear lead pipeline con datos mínimos
        nombre_split = body.nombre_destinatario.strip().split(" ", 1)
        new_lp = await lp_repo.create(
            LpCreate(
                nombre=nombre_split[0],
                apellido=nombre_split[1] if len(nombre_split) > 1 else None,
                email=body.email_destinatario,
                estado="pipeline",
                primer_contacto=datetime.utcnow().date(),
                notas=f"Vino via share de informe parent_token={token[:8]}…",
            )
        )
        new_lp_id = new_lp.lp_id

    # Crear child_informe con mismo contenido + parent_token
    child = await repo.create(
        lp_id=new_lp_id,
        titulo=parent.titulo,
        tipo=parent.tipo,
        periodo=parent.periodo,
        hero_titulo=parent.hero_titulo,
        hero_narrativa=parent.hero_narrativa,
        secciones=parent.secciones,
        creado_por=f"share_from:{token[:8]}",
        parent_token=parent.token,
    )
    # Auto-publicar (el parent ya está publicado)
    child.estado = "publicado"
    child.publicado_at = datetime.utcnow()
    child.expira_at = parent.expira_at
    # Guardar mensaje personal en metadata
    if body.mensaje_personal:
        child.secciones = {
            **(child.secciones or {}),
            "_share_meta": {
                "mensaje_personal": body.mensaje_personal,
                "shared_at": datetime.utcnow().isoformat(),
            },
        }

    # Incrementar veces_compartido del parent + log evento
    await repo.increment_share(parent)
    event_repo = InformeLpEventoRepository(db)
    await event_repo.create(
        informe_id=parent.informe_id,
        token=parent.token,
        event=TrackEventRequest(
            tipo="share_click",
            valor_texto=body.email_destinatario,
        ),
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    await db.commit()

    # Construir URL pública. Origin se puede setear via header o config.
    frontend_origin = (
        request.headers.get("x-frontend-origin")
        or "https://cehta-capital.vercel.app"
    )
    child_url = f"{frontend_origin}/informe/{child.token}"

    return InformeLpShareResponse(
        child_token=child.token,
        child_url=child_url,
        parent_token=parent.token,
        message=(
            f"Informe enviado a {body.nombre_destinatario}. "
            "Te avisamos cuando lo abra."
        ),
    )
