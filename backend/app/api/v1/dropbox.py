"""Dropbox integration endpoints — admin only.

OAuth flow (single-tenant single-admin):
1. GET  /dropbox/connect      → devuelve authorize_url para redirigir al usuario
2. GET  /dropbox/callback     → Dropbox redirige acá con code+state
3. GET  /dropbox/status       → ¿estamos conectados? (datos de la cuenta)
4. GET  /dropbox/files?path=  → lista archivos+carpetas
5. GET  /dropbox/data-madre   → atajo: encuentra "Inteligencia de Negocios" + Data Madre.xlsx
6. POST /dropbox/disconnect   → borra los tokens (no revoca remotamente — TODO V4)

Notas de seguridad:
- TODOS los endpoints (excepto `callback`, que recibe redirect público de
  Dropbox) requieren JWT con scope `integration:write` o `integration:read`.
- `/callback` no se autentica con JWT porque Dropbox redirige al browser
  del admin sin Authorization header. La protección viene del CSRF state
  que `DropboxOAuth2Flow` valida internamente.
- El CSRF state vive en `core.oauth_states` (Postgres), NO en memoria: la
  app corre con 2 máquinas en Fly y `/callback` cae casi siempre en una
  distinta a la que atendió `/connect`. Con el dict en memoria anterior el
  callback moría con 400 y era imposible reconectar (ver migración 0069).
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.services.dropbox_service import (
    DropboxNotConfigured,
    DropboxService,
    build_oauth_flow,
)

router = APIRouter()

# Clave con la que el SDK de Dropbox guarda el CSRF token en el dict `session`
# (ver `build_oauth_flow`: csrf_token_session_key).
_CSRF_KEY = "dropbox-auth-csrf-token"

# Ventana para completar el flow. Autorizar en Dropbox toma segundos; 15 min
# es holgado y acota el replay si alguien intercepta la URL de callback.
_STATE_TTL = "15 minutes"


@router.get("/connect")
async def connect(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("integration:write"))
    ],
    db: DBSession,
) -> dict[str, str]:
    """Inicia OAuth flow. Devuelve la authorize_url para redirigir al usuario.

    El CSRF token que genera `flow.start()` se persiste en `core.oauth_states`
    porque el `/callback` lo va a leer desde OTRA máquina de Fly.
    """
    session: dict[str, Any] = {}
    try:
        flow = build_oauth_flow(session)
        authorize_url = flow.start()
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    await db.execute(
        text(
            """INSERT INTO core.oauth_states (provider, csrf_token, created_at)
               VALUES ('dropbox', :csrf, now())
               ON CONFLICT (provider) DO UPDATE
                 SET csrf_token = EXCLUDED.csrf_token, created_at = now()"""
        ),
        {"csrf": session.get(_CSRF_KEY)},
    )
    await db.commit()
    return {"authorize_url": authorize_url}


@router.get("/callback")
async def callback(
    db: DBSession,
    code: str = Query(...),
    state: str = Query(...),
) -> RedirectResponse:
    """Dropbox redirige acá tras autorización del usuario.

    Este endpoint es PÚBLICO porque Dropbox redirige al browser del admin sin
    Authorization header. La integridad la garantiza el CSRF token que
    `DropboxOAuth2Flow.finish` valida contra el state persistido en
    `core.oauth_states` por `/connect`.
    """
    # DELETE ... RETURNING: el state es de un solo uso (anti-replay) y vence.
    row = (
        await db.execute(
            text(
                f"""DELETE FROM core.oauth_states
                    WHERE provider = 'dropbox'
                      AND created_at > now() - interval '{_STATE_TTL}'
                    RETURNING csrf_token"""  # noqa: S608 — TTL es constante del módulo
            )
        )
    ).first()
    await db.commit()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El enlace para conectar Dropbox venció o ya se usó. "
                "Volvé a entrar a /admin/dropbox-connect y autorizá de nuevo."
            ),
        )

    try:
        flow = build_oauth_flow({_CSRF_KEY: row[0]})
        oauth_result = flow.finish({"code": code, "state": state})
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"OAuth callback failed: {exc}",
        ) from exc

    # Sanity check + recuperar account info
    try:
        svc = DropboxService(
            access_token=oauth_result.access_token,
            refresh_token=oauth_result.refresh_token,
        )
        account = svc.get_account()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Dropbox API error tras callback: {exc}",
        ) from exc

    repo = IntegrationRepository(db)
    raw_scope = getattr(oauth_result, "scope", None)
    scopes = raw_scope.split() if raw_scope else None
    await repo.upsert(
        provider="dropbox",
        access_token=oauth_result.access_token,
        refresh_token=oauth_result.refresh_token,
        account_info=account,
        scopes=scopes,
    )
    await db.commit()

    target = f"{settings.frontend_url.rstrip('/')}/admin?dropbox_connected=1"
    return RedirectResponse(url=target)


@router.get("/status")
async def get_status(
    user: CurrentUser,
    db: DBSession,
) -> dict[str, Any]:
    """¿Tenemos credenciales válidas guardadas? (no llama a Dropbox)."""
    repo = IntegrationRepository(db)
    integration = await repo.get_by_provider("dropbox")
    if integration is None:
        return {"connected": False}
    return {
        "connected": True,
        "account": integration.account_info,
        "connected_at": integration.connected_at.isoformat(),
        "updated_at": integration.updated_at.isoformat(),
    }


@router.get("/files")
async def list_files(
    user: CurrentUser,
    db: DBSession,
    path: str = Query("", description="Path en Dropbox. '' = root."),
) -> dict[str, Any]:
    """Lista archivos+carpetas en `path`. Requiere conexión activa."""
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dropbox no conectado. Usar /dropbox/connect primero.",
        )

    try:
        svc = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
        items = svc.list_folder(path)
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Error consultando Dropbox: {exc}",
        ) from exc

    return {"path": path, "items": items}


@router.get("/data-madre")
async def find_data_madre(
    user: CurrentUser,
    db: DBSession,
) -> dict[str, Any]:
    """Encuentra `Inteligencia de Negocios/` y reporta `Data Madre.xlsx`.

    Estrategia:
    1. Buscar `Cehta Capital` en root (apps con carpeta dedicada lo tienen
       como root virtual y no aparece; full Dropbox sí).
    2. Buscar `Inteligencia de Negocios` dentro (o en root si no hay
       carpeta `Cehta Capital`).
    3. Listar contenido y detectar `Data Madre.xlsx` (case-insensitive).
    """
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Dropbox no conectado"
        )

    try:
        svc = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
        cehta_path = svc.find_folder("Cehta Capital", "")
        search_root = cehta_path or ""

        ig_path = svc.find_folder("Inteligencia de Negocios", search_root)
        if not ig_path:
            return {
                "found_inteligencia_negocios": False,
                "searched_in": search_root or "/",
                "hint": (
                    "Crear carpeta 'Cehta Capital/Inteligencia de Negocios/' "
                    "en Dropbox o ajustar permisos de la app."
                ),
            }

        items = svc.list_folder(ig_path)
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Error consultando Dropbox: {exc}",
        ) from exc

    data_madre = next(
        (
            i
            for i in items
            if i["type"] == "file" and "data madre" in i["name"].casefold()
        ),
        None,
    )

    return {
        "found_inteligencia_negocios": True,
        "inteligencia_negocios_path": ig_path,
        "found_data_madre": data_madre is not None,
        "data_madre": data_madre,
        "all_items": items,
    }


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def disconnect(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("integration:write"))
    ],
    db: DBSession,
) -> Response:
    """Borra los tokens de Dropbox de la base.

    TODO V4: revocar el access_token vía Dropbox API
    (`auth/token/revoke`) además de borrar local.
    """
    deleted = await IntegrationRepository(db).delete_by_provider("dropbox")
    if deleted:
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
