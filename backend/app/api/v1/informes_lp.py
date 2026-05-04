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
    InformesAnalytics,
    LpCreate,
    LpRead,
    LpUpdate,
    TopAdvocate,
    TrackEventRequest,
    TrackEventResponse,
)
from app.services.informes_lp_service import (
    InformesLpAINotConfigured,
    generate_full_informe_narrativa,
)
from app.services.portfolio_data_service import (
    build_live_data,
    pull_empresa_data,
    pull_lp_context,
    pull_portfolio_kpis,
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


def _resolver_empresas_destacadas(
    request: InformeLpGenerateRequest,
    lp: Lp | None,
    empresas: list[Empresa],
) -> list[str]:
    """Resuelve qué empresas mostrar en el informe.

    Prioridad:
    1. Las que el LP tiene en cartera (`empresas_invertidas`)
    2. Las que el GP pidió incluir manualmente (`request.incluir_empresas`)
    3. Default: las primeras 5 empresas del catálogo
    """
    destacadas: list[str] = []
    if lp and lp.empresas_invertidas:
        destacadas.extend(lp.empresas_invertidas)
    if request.incluir_empresas:
        for cod in request.incluir_empresas:
            if cod not in destacadas:
                destacadas.append(cod)
    if not destacadas:
        destacadas = [e.codigo for e in empresas[:5]]
    return destacadas


async def _build_secciones_with_ai(
    db,  # type: ignore[no-untyped-def]
    request: InformeLpGenerateRequest,
    lp: Lp | None,
    empresas: list[Empresa],
) -> tuple[dict[str, Any], str | None, str | None]:
    """Genera secciones del informe usando AI + datos vivos del portafolio.

    Devuelve (secciones, hero_titulo, hero_narrativa).

    Si Anthropic no está configurado, usa fallback templates Jinja2-like
    para que el sistema siga funcional aunque sin la cereza AI.
    """
    empresas_destacadas = _resolver_empresas_destacadas(request, lp, empresas)

    # Pull de datos vivos en paralelo
    portfolio_kpis = await pull_portfolio_kpis(db)
    lp_ctx = await pull_lp_context(db, lp.lp_id) if lp else None
    empresas_data: dict[str, dict[str, Any]] = {}
    for cod in empresas_destacadas:
        empresas_data[cod] = await pull_empresa_data(db, cod)

    # Intentar generación AI
    nombre_lp = (
        (lp.nombre + (f" {lp.apellido}" if lp.apellido else "")).strip()
        if lp
        else "Inversionista"
    )
    hero_titulo: str | None = None
    hero_narrativa: str | None = None
    ai_bundle: dict[str, Any] | None = None

    try:
        ai_bundle = await generate_full_informe_narrativa(
            lp=lp_ctx,
            portfolio_kpis=portfolio_kpis,
            empresas_data=empresas_data,
            periodo=request.periodo,
            parent_token=None,  # se setea aparte cuando viene de share
            tipo=request.tipo,
        )
        hero_data = ai_bundle.get("hero", {})
        hero_titulo = hero_data.get("titulo") or f"Hola, {nombre_lp}."
        hero_narrativa = hero_data.get("subtitulo") or "Tu informe del trimestre."
    except InformesLpAINotConfigured:
        # Fallback sin AI — placeholder estructurado
        hero_titulo = f"Hola, {nombre_lp}."
        hero_narrativa = (
            f"Tu portafolio tiene {portfolio_kpis.get('proyectos_total', 0)} "
            f"proyectos activos con {portfolio_kpis.get('pct_avance_global', 0)}% "
            "de avance global."
        )
    except Exception as e:  # noqa: BLE001
        hero_titulo = f"Hola, {nombre_lp}."
        hero_narrativa = "Tu informe del trimestre."
        ai_bundle = {"_error": str(e)}

    secciones: dict[str, Any] = {
        "hero": {
            "kind": "hero",
            "payload": (ai_bundle or {}).get("hero")
            or {
                "titulo": hero_titulo,
                "subtitulo": hero_narrativa,
                "kpi_destacado": None,
            },
        },
        "performance": {
            "kind": "performance",
            "payload": {
                "kpis_snapshot": portfolio_kpis,
                "periodo": request.periodo,
            },
        },
        "tu_posicion": {
            "kind": "tu_posicion",
            "payload": {
                "aporte_total": float(lp.aporte_total) if lp and lp.aporte_total else None,
                "aporte_actual": float(lp.aporte_actual) if lp and lp.aporte_actual else None,
                "empresas_invertidas": list(lp.empresas_invertidas)
                if lp and lp.empresas_invertidas
                else [],
            },
        },
        "empresas": {
            "kind": "empresas_showcase",
            "payload": {
                "destacadas": empresas_destacadas,
                "datos": empresas_data,
                "narrativas": (ai_bundle or {}).get("empresas", {}),
            },
        },
        "esg_impact": {
            "kind": "esg_impact",
            "payload": {
                # Sprint 2.5: cuando el KB tenga MW reales, los pasamos acá
                "co2_evitado_tons": None,
                "mw_renovables": None,
                "hogares_equivalentes": None,
                "empleos_creados": None,
                "narrativa": "Datos ESG por confirmar con KB de empresas",
            },
        },
        "outlook": {
            "kind": "outlook",
            "payload": {
                "horizonte_meses": 6,
                # hitos_proximos se completa con live_data al renderizar
            },
        },
        "cta": {
            "kind": "cta",
            "payload": (ai_bundle or {}).get("cta")
            or {
                "cta_principal": "Agendá café con Camilo (30 min)",
                "cta_secundario_1": "Aumentar tu posición",
                "cta_secundario_2": "Compartir con un colega",
            },
        },
        "_meta": {
            "destinatario": nombre_lp,
            "tono": request.tono,
            "ai_generated": ai_bundle is not None and "_error" not in ai_bundle,
            "empresas_destacadas": empresas_destacadas,
        },
    }
    return secciones, hero_titulo, hero_narrativa


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

    # Sprint 2: secciones generadas con AI + live data del portafolio
    secciones, hero_titulo, hero_narrativa = await _build_secciones_with_ai(
        db, body, lp, empresas
    )

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


@router.post(
    "/informes-lp/admin/dispatch-notifications",
    dependencies=[Depends(require_scope("informe_lp:update"))],
)
async def dispatch_notifications(
    user: CurrentUser,
    db: DBSession,
    dry_run: bool = False,
) -> dict[str, Any]:
    """V4 fase 9.2: cron que envía notificaciones positivas a los advocates.

    Llamar 1 vez al día (idealmente 9 AM Chile time vía cron en Fly):

      curl -X POST https://cehta-backend.fly.dev/api/v1/informes-lp/admin/dispatch-notifications \\
        -H "Authorization: Bearer $TOKEN"

    Lógica:
    - Escanea eventos `open` y `agendar_click` de informes con parent_token
    - Para cada uno NO notificado todavía, envía email al LP parent:
        * 👀 "{X} abrió tu link"
        * 🎉 "{X} agendó café con Camilo"
    - Idempotente vía UNIQUE(child_token, tipo) en informes_lp_notifications
    - Soft-fail si Resend no está configurado

    `dry_run=true` cuenta lo que mandaría sin enviar.
    """
    from app.services.informes_lp_notifications_service import (
        dispatch_pending_notifications,
    )

    return await dispatch_pending_notifications(db, dry_run=dry_run)


@router.get(
    "/informes-lp/admin/analytics",
    response_model=InformesAnalytics,
    dependencies=[Depends(require_scope("informe_lp:read"))],
)
async def admin_analytics(
    user: CurrentUser,
    db: DBSession,
) -> InformesAnalytics:
    """Dashboard de analytics consolidado para /admin/informes-lp.

    Incluye:
    - Métricas globales (total generados, publicados, aperturas, shares)
    - Tasas de conversion + viral 1→N
    - Top 5 advocates (LPs que más comparten + downstream conversions)
    """
    from sqlalchemy import case, distinct, literal_column

    # Contadores globales
    total_generados = (
        await db.scalar(select(func.count(InformeLp.informe_id)))
    ) or 0
    total_publicados = (
        await db.scalar(
            select(func.count(InformeLp.informe_id)).where(
                InformeLp.estado == "publicado"
            )
        )
    ) or 0
    total_aperturas = (
        await db.scalar(select(func.sum(InformeLp.veces_abierto)))
    ) or 0
    total_compartidos = (
        await db.scalar(select(func.sum(InformeLp.veces_compartido)))
    ) or 0

    # Tiempo promedio en informe (de eventos time_spent)
    from app.models.informe_lp import InformeLpEvento

    tiempo_promedio = await db.scalar(
        select(func.avg(InformeLpEvento.valor_numerico))
        .where(InformeLpEvento.tipo == "time_spent")
        .where(InformeLpEvento.valor_numerico.isnot(None))
    )

    # Tasas
    tasa_apertura = (
        float(total_aperturas) / total_publicados if total_publicados > 0 else 0.0
    )
    tasa_share = (
        float(total_compartidos) / total_publicados if total_publicados > 0 else 0.0
    )

    # CTAs agendar / aperturas
    total_agendar = (
        await db.scalar(
            select(func.count(InformeLpEvento.evento_id)).where(
                InformeLpEvento.tipo == "agendar_click"
            )
        )
    ) or 0
    tasa_conversion = (
        float(total_agendar) / total_aperturas if total_aperturas > 0 else 0.0
    )

    # Tasa viral: aperturas en informes con parent_token / total aperturas
    aperturas_downstream = (
        await db.scalar(
            select(func.count(InformeLpEvento.evento_id))
            .join(InformeLp, InformeLpEvento.informe_id == InformeLp.informe_id)
            .where(InformeLpEvento.tipo == "open")
            .where(InformeLp.parent_token.isnot(None))
        )
    ) or 0
    aperturas_originales = (
        await db.scalar(
            select(func.count(InformeLpEvento.evento_id))
            .join(InformeLp, InformeLpEvento.informe_id == InformeLp.informe_id)
            .where(InformeLpEvento.tipo == "open")
            .where(InformeLp.parent_token.is_(None))
        )
    ) or 0
    tasa_viral = (
        float(aperturas_downstream) / aperturas_originales
        if aperturas_originales > 0
        else 0.0
    )

    # Top 5 advocates: LPs que generaron más downstream views
    # Para cada LP que tiene informes publicados, contar:
    # - cuántos shares hizo (via veces_compartido del padre)
    # - cuántas aperturas downstream generaron sus shares (via parent_token)
    # - cuántas conversiones (agendar_click en children)
    advocates_q = (
        select(
            InformeLp.lp_id,
            func.sum(InformeLp.veces_compartido).label("total_shares"),
            Lp.nombre,
            Lp.apellido,
        )
        .join(Lp, InformeLp.lp_id == Lp.lp_id)
        .where(InformeLp.lp_id.isnot(None))
        .where(InformeLp.veces_compartido > 0)
        .group_by(InformeLp.lp_id, Lp.nombre, Lp.apellido)
        .order_by(func.sum(InformeLp.veces_compartido).desc())
        .limit(5)
    )
    advocate_rows = (await db.execute(advocates_q)).all()

    top_advocates: list[TopAdvocate] = []
    for row in advocate_rows:
        lp_id = row[0]
        shares = int(row[1] or 0)
        nombre_completo = (
            (row[2] or "") + (f" {row[3]}" if row[3] else "")
        ).strip() or f"LP #{lp_id}"

        # Aperturas downstream: opens en informes con parent_token de informes
        # de este LP
        downstream = (
            await db.scalar(
                select(func.count(InformeLpEvento.evento_id))
                .join(
                    InformeLp,
                    InformeLpEvento.informe_id == InformeLp.informe_id,
                )
                .where(InformeLpEvento.tipo == "open")
                .where(
                    InformeLp.parent_token.in_(
                        select(InformeLp.token).where(InformeLp.lp_id == lp_id)
                    )
                )
            )
        ) or 0

        # Conversiones: agendar_click en informes children
        convertidos = (
            await db.scalar(
                select(func.count(InformeLpEvento.evento_id))
                .join(
                    InformeLp,
                    InformeLpEvento.informe_id == InformeLp.informe_id,
                )
                .where(InformeLpEvento.tipo == "agendar_click")
                .where(
                    InformeLp.parent_token.in_(
                        select(InformeLp.token).where(InformeLp.lp_id == lp_id)
                    )
                )
            )
        ) or 0

        top_advocates.append(
            TopAdvocate(
                lp_id=lp_id,
                lp_nombre=nombre_completo,
                compartio_count=shares,
                aperturas_downstream=int(downstream),
                convertidos=int(convertidos),
                aporte_atribuible=None,  # Sprint 6: cálculo de attribution
            )
        )

    return InformesAnalytics(
        total_generados=int(total_generados),
        total_publicados=int(total_publicados),
        total_aperturas=int(total_aperturas),
        total_compartidos=int(total_compartidos),
        tiempo_promedio_segundos=int(tiempo_promedio) if tiempo_promedio else None,
        tasa_apertura=round(tasa_apertura, 4),
        tasa_share=round(tasa_share, 4),
        tasa_conversion=round(tasa_conversion, 4),
        tasa_viral=round(tasa_viral, 4),
        top_advocates=top_advocates,
    )


@router.post(
    "/informes-lp/{informe_id}/regenerate-narrative",
    response_model=InformeLpRead,
    dependencies=[Depends(require_scope("informe_lp:update"))],
)
async def regenerate_narrative(
    user: CurrentUser,
    db: DBSession,
    informe_id: int,
) -> InformeLpRead:
    """Re-genera narrativas AI del informe con datos vivos actuales.

    Útil cuando:
    - El GP editó manualmente y quiere volver al output AI
    - Pasaron días y los KPIs cambiaron significativamente
    - Se actualizó el KB de la empresa con datos nuevos

    Limpia el cache server-side de informes_lp_service para esta combo
    de inputs y vuelve a llamar a Claude.
    """
    repo = InformeLpRepository(db)
    informe = await repo.get(informe_id)
    if informe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Informe no encontrado"
        )

    lp_repo = LpRepository(db)
    lp = await lp_repo.get(informe.lp_id) if informe.lp_id else None

    empresas = list((await db.scalars(select(Empresa).order_by(Empresa.codigo))).all())

    # Reconstruir request from informe (uso lo que tenemos en metadata)
    request = InformeLpGenerateRequest(
        lp_id=informe.lp_id,
        tipo=informe.tipo,  # type: ignore[arg-type]
        titulo=informe.titulo,
        periodo=informe.periodo,
        incluir_empresas=(informe.secciones or {})
        .get("_meta", {})
        .get("empresas_destacadas"),
        tono=(informe.secciones or {}).get("_meta", {}).get("tono", "ejecutivo"),
    )

    # Limpiar cache del service para esta combo
    from app.services.informes_lp_service import clear_cache as clear_ai_cache

    clear_ai_cache()

    secciones, hero_titulo, hero_narrativa = await _build_secciones_with_ai(
        db, request, lp, empresas
    )

    informe.secciones = secciones
    informe.hero_titulo = hero_titulo
    informe.hero_narrativa = hero_narrativa
    await db.flush()
    await db.refresh(informe)
    await db.commit()
    return InformeLpRead.model_validate(informe)


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

    # Sprint 2: live data — KPIs + hitos próximos en tiempo real.
    empresas_destacadas = (
        (informe.secciones or {})
        .get("_meta", {})
        .get("empresas_destacadas")
    ) or []
    try:
        live_data = await build_live_data(
            db,
            lp_id=informe.lp_id,
            empresas_destacadas=empresas_destacadas,
            horizonte_outlook_dias=180,
        )
    except Exception as e:  # noqa: BLE001
        live_data = {
            "_error": str(e),
            "generated_at": datetime.utcnow().isoformat(),
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

    # V4 fase 9.2: enviar email automático al destinatario via Resend.
    # Soft-fail: si Resend no está configurado, registra error pero no
    # rompe el endpoint (el LP igual recibe el child_token para copy-paste).
    nombre_remitente: str = "Tu colega"
    if parent.lp_id is not None:
        parent_lp = await LpRepository(db).get(parent.lp_id)
        if parent_lp is not None:
            nombre_remitente = (
                parent_lp.nombre
                + (f" {parent_lp.apellido}" if parent_lp.apellido else "")
            ).strip() or "Tu colega"

    email_status: dict[str, Any] = {"resend_id": None, "error": None}
    try:
        from app.services.informes_lp_notifications_service import (
            send_share_invitation,
        )

        email_status = await send_share_invitation(
            db,
            child_token=child.token,
            parent_token=parent.token,
            email_destinatario=body.email_destinatario,
            nombre_destinatario=body.nombre_destinatario,
            nombre_remitente=nombre_remitente,
            mensaje_personal=body.mensaje_personal,
            informe_url=child_url,
        )
        await db.commit()
    except Exception as e:  # noqa: BLE001
        # No rompemos el endpoint si el email falla — el child_url
        # sigue siendo válido para que el LP copie y pegue manualmente.
        email_status = {"resend_id": None, "error": str(e)[:200]}

    # Mensaje al frontend depende de si Resend funcionó o no
    if email_status.get("resend_id"):
        msg = (
            f"Informe enviado a {body.nombre_destinatario}. "
            "Te avisamos cuando lo abra."
        )
    else:
        msg = (
            f"Link generado para {body.nombre_destinatario}. "
            "Copialo y compartilo manualmente — el envío automático "
            "está desactivado."
        )

    return InformeLpShareResponse(
        child_token=child.token,
        child_url=child_url,
        parent_token=parent.token,
        message=msg,
    )
