"""R152www · Endpoints para editar branding/firmantes de OC por empresa.

Lo expone bajo /admin/empresas/{codigo}/oc-branding.
Permite a un admin ajustar:
  - logo_dropbox_path (path en Dropbox)
  - oc_color_primario (HEX)
  - gerente_general_{nombre,cargo,email}
  - oc_firma_colectiva (toggle RHO)
  - firmantes_extra (lista JSON)

R152AAAA — agregado POST /admin/empresas/{codigo}/logo/upload que sube un
archivo de imagen a Dropbox usando las credenciales del servicio backend
(refresh_token cifrado en core.integrations) y actualiza
logo_dropbox_path. Esto evita que el operador tenga que copiar el archivo
a Dropbox manualmente.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)

router = APIRouter()


class Firmante(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nombre: str = Field(min_length=2, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=200)
    rut: str | None = Field(default=None, max_length=20)


class OcBrandingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    codigo: str
    razon_social: str
    logo_dropbox_path: str | None
    oc_color_primario: str | None
    gerente_general_nombre: str | None
    gerente_general_cargo: str | None
    gerente_general_email: str | None
    oc_firma_colectiva: bool
    firmantes_extra: list[Firmante]
    cantidad_firmantes: int
    # R152IIII — Emails para envío auto
    emails_oc_cc: list[str] = Field(default_factory=list)
    auto_send_oc_emails: bool = True


class OcBrandingUpdate(BaseModel):
    logo_dropbox_path: str | None = None
    oc_color_primario: str | None = Field(default=None, pattern=r"^#?[0-9A-Fa-f]{6}$")
    gerente_general_nombre: str | None = Field(default=None, max_length=200)
    gerente_general_cargo: str | None = Field(default=None, max_length=120)
    gerente_general_email: str | None = Field(default=None, max_length=200)
    oc_firma_colectiva: bool | None = None
    firmantes_extra: list[Firmante] | None = None
    # R152IIII — emails CC + auto-send toggle
    emails_oc_cc: list[str] | None = None
    auto_send_oc_emails: bool | None = None


async def _require_admin(user: AuthenticatedUser) -> None:
    if not getattr(user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden editar branding de OC",
        )


async def _require_admin_with_empresa_scope(
    user: AuthenticatedUser, db: Any, codigo: str
) -> None:
    """R152YYYYY — Doble gate: is_admin + scope sobre la empresa.

    Sin este check, un admin de FIP_CEHTA podía cambiar los firmantes
    (GG, emails CC) de RHO o cualquier otra empresa portfolio — escalada
    de privilegios cross-empresa. Un GG comprometido cambiaba su propio
    email a uno controlado y aprobaba sus propias OCs.

    is_admin solo certifica "puede operar branding". El scope certifica
    "puede operar la empresa específica".
    """
    from app.services.empresa_scope_service import assert_empresa_access
    await _require_admin(user)
    await assert_empresa_access(user, db, codigo)


@router.get(
    "/admin/empresas/{codigo}/oc-branding", response_model=OcBrandingRead
)
async def get_oc_branding(
    user: CurrentUser, db: DBSession, codigo: str
) -> OcBrandingRead:
    """Devuelve la config de branding/firmantes para una empresa.

    R152YYYYY — Doble gate: admin + scope sobre la empresa.
    """
    await _require_admin_with_empresa_scope(user, db, codigo)
    row = (
        await db.execute(
            text(
                """
                SELECT codigo, razon_social,
                       logo_dropbox_path, oc_color_primario,
                       gerente_general_nombre, gerente_general_cargo,
                       gerente_general_email,
                       oc_firma_colectiva,
                       COALESCE(firmantes_extra, '[]'::jsonb) AS firmantes_extra,
                       COALESCE(emails_oc_cc, ARRAY[]::TEXT[]) AS emails_oc_cc,
                       COALESCE(auto_send_oc_emails, TRUE) AS auto_send_oc_emails
                FROM core.empresas
                WHERE codigo = :c AND activo = TRUE
                """
            ),
            {"c": codigo},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa {codigo} no encontrada",
        )
    data = dict(row)
    firmantes_raw = data.get("firmantes_extra") or []
    if isinstance(firmantes_raw, str):
        try:
            firmantes_raw = json.loads(firmantes_raw)
        except Exception:
            firmantes_raw = []
    data["firmantes_extra"] = firmantes_raw
    data["cantidad_firmantes"] = (
        len(firmantes_raw) if data["oc_firma_colectiva"] else 1
    )
    return OcBrandingRead.model_validate(data)


@router.patch(
    "/admin/empresas/{codigo}/oc-branding", response_model=OcBrandingRead
)
async def patch_oc_branding(
    user: CurrentUser,
    db: DBSession,
    codigo: str,
    body: OcBrandingUpdate,
) -> OcBrandingRead:
    """Actualiza branding/firmantes. Solo campos provistos cambian.

    R152YYYYY — Doble gate: admin + scope sobre la empresa.
    """
    await _require_admin_with_empresa_scope(user, db, codigo)

    fields: dict[str, Any] = body.model_dump(exclude_none=True)
    if not fields:
        return await get_oc_branding(user, db, codigo)

    # Construir SET dinámico
    set_clauses = []
    params: dict[str, Any] = {"c": codigo}

    for k, v in fields.items():
        if k == "firmantes_extra":
            # Serializar a JSON; en Postgres se cast a JSONB
            set_clauses.append("firmantes_extra = CAST(:firmantes_extra AS JSONB)")
            params["firmantes_extra"] = json.dumps(
                [f.model_dump(exclude_none=True) for f in v]
            )
        elif k == "oc_color_primario":
            # Normalizar a #XXXXXX
            color = v if v.startswith("#") else f"#{v}"
            set_clauses.append("oc_color_primario = :oc_color_primario")
            params["oc_color_primario"] = color
        elif k == "emails_oc_cc":
            # R152IIII — TEXT[] cast. Filtrar vacíos + dedupe.
            cleaned = list(
                dict.fromkeys(  # preserva orden + dedupe
                    (e or "").strip()
                    for e in (v or [])
                    if (e or "").strip()
                )
            )
            set_clauses.append("emails_oc_cc = CAST(:emails_oc_cc AS TEXT[])")
            params["emails_oc_cc"] = cleaned
        else:
            set_clauses.append(f"{k} = :{k}")
            params[k] = v

    set_clauses.append("updated_at = NOW()")
    sql = (
        "UPDATE core.empresas SET "
        + ", ".join(set_clauses)
        + " WHERE codigo = :c AND activo = TRUE"
    )
    result = await db.execute(text(sql), params)
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa {codigo} no encontrada",
        )
    await db.commit()
    return await get_oc_branding(user, db, codigo)


# ─────────────────────────────────────────────────────────────────────
# R152AAAA — Upload de logo via API (sube a Dropbox + actualiza path)
# ─────────────────────────────────────────────────────────────────────


_LOGO_PATH_TPL = "/Cehta Capital/01-Empresas/{codigo}/00-Branding/logo{ext}"


class LogoUploadResult(BaseModel):
    codigo: str
    logo_dropbox_path: str
    size_bytes: int


@router.post(
    "/admin/empresas/{codigo}/logo/upload",
    response_model=LogoUploadResult,
)
async def upload_logo(
    user: CurrentUser,
    db: DBSession,
    codigo: str,
    file: Annotated[UploadFile, File(...)],
) -> LogoUploadResult:
    """Sube un archivo de imagen a Dropbox bajo la convención estándar:

        /Cehta Capital/01-Empresas/{CODIGO}/00-Branding/logo.{ext}

    Acepta .png, .jpg, .jpeg, .gif, .webp. Si ya existe un logo en esa
    ruta, lo sobreescribe (es lo que querés cuando re-subís).

    Actualiza core.empresas.logo_dropbox_path con la nueva ruta.
    Idempotente — si llamás dos veces con el mismo file, queda igual.

    R152YYYYY — Doble gate: admin + scope sobre la empresa.
    """
    await _require_admin_with_empresa_scope(user, db, codigo)

    if not file.filename:
        raise HTTPException(400, "Falta nombre de archivo")
    name_lower = file.filename.lower()
    ext = None
    for candidate in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        if name_lower.endswith(candidate):
            ext = candidate
            break
    if not ext:
        raise HTTPException(400, "Solo se aceptan png/jpg/jpeg/gif/webp")

    # Verificar empresa
    row = await db.execute(
        text(
            "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
        ),
        {"c": codigo},
    )
    if not row.first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa {codigo} no encontrada o inactiva",
        )

    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no está conectado. Conectalo en /admin/dropbox-connect.",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Archivo vacío")
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, f"Logo muy grande ({len(contents)} bytes). Máximo 5MB.")

    target_path = _LOGO_PATH_TPL.format(codigo=codigo, ext=ext)

    try:
        svc = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
        # Crear carpeta padre + subir
        parent = "/".join(target_path.split("/")[:-1])
        await asyncio.to_thread(svc.ensure_folder_path, parent)
        await asyncio.to_thread(
            svc.upload_file, target_path, contents, overwrite=True
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        # R152JJJJJJ — detalle Dropbox solo al log, genérico al cliente.
        logging.getLogger(__name__).warning(
            "oc_branding.upload_failed", extra={"err": str(exc)[:200]}
        )
        raise HTTPException(
            502,
            "Error subiendo el archivo a Dropbox. Verificá en "
            "/admin/integraciones que Dropbox esté conectado y reintentá.",
        ) from exc

    # Actualizar logo_dropbox_path en DB
    await db.execute(
        text(
            """UPDATE core.empresas
               SET logo_dropbox_path = :p, updated_at = NOW()
               WHERE codigo = :c"""
        ),
        {"p": target_path, "c": codigo},
    )
    await db.commit()

    return LogoUploadResult(
        codigo=codigo,
        logo_dropbox_path=target_path,
        size_bytes=len(contents),
    )
