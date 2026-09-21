"""Anexos de una OC — subir, listar, descargar y quitar (2026-09-21).

Nicolás: "que se pueda adjuntar anexo a las oc".

`core.oc_attachments` ya existía: la llena el inbox cuando una OC nace de un
correo, y el PDF de la OC (`oc_pdf_v2_service._fetch_attachments`) ya mergea
todas sus filas al final. Lo que faltaba era subir un anexo A MANO. Estos
endpoints escriben ahí con `source = 'manual_upload'`, así que un anexo
subido acá sale automáticamente en "Descargar PDF" y en el PDF que se le
manda al proveedor.

Reglas:
  · Scope multi-tenant SIEMPRE antes de tocar Dropbox o la BD
    (`assert_empresa_access`), igual que los adjuntos de voucher.
  · Una OC anulada no recibe anexos.
  · Lo firmado no se borra: si alguien firmó DESPUÉS de que se subió el
    anexo, ese anexo es parte de lo que firmó y no se puede quitar (409).
    Lo que se sube después de las firmas sí se puede quitar.
  · Quitar un anexo borra la fila, NO el archivo en Dropbox: queda como
    respaldo y la auditoría guarda su ruta.

Carpeta Dropbox (la del árbol canónico, ver scripts/ensure_dropbox_folders.py):
    /Cehta Capital/01-Empresas/{COD}/06-Adjuntos-OCs/{año}/{numero_oc}/{ts}_{archivo}
"""
from __future__ import annotations

import asyncio
import re
import time
import unicodedata
from datetime import datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.logging import get_logger
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.services.audit_service import audit_log
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.empresa_scope_service import assert_empresa_access

log = get_logger(__name__)

router = APIRouter()

_ROOT = "/Cehta Capital/01-Empresas"

# 25 MB, no los 50 del voucher: cada anexo se descarga de Dropbox y se mergea
# en el PDF de la OC en cada descarga y en cada envío al proveedor.
_MAX_BYTES = 25 * 1024 * 1024
# Techo por OC por la misma razón: el PDF final los lleva todos.
_MAX_ANEXOS_POR_OC = 20

_MIME_PERMITIDOS = (
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/msword",
)

_COLUMNAS = """attachment_id, oc_id, file_name, mime_type, size_bytes,
               source, descripcion, subido_por_email, created_at"""


class OcAnexoRead(BaseModel):
    attachment_id: int
    oc_id: int
    file_name: str
    mime_type: str | None = None
    size_bytes: int | None = None
    #: 'manual_upload' | 'inbox_email' | 'dropbox_sync' | None
    source: str | None = None
    descripcion: str | None = None
    subido_por_email: str | None = None
    created_at: datetime
    #: False cuando alguien firmó la OC después de subirlo: es parte de lo
    #: firmado y ya no se puede quitar.
    se_puede_quitar: bool = True


class OcAnexoLink(BaseModel):
    attachment_id: int
    file_name: str
    url: str
    expires_in_seconds: int = 4 * 60 * 60


def _nombre_seguro(nombre: str, maximo: int = 120) -> str:
    """Nombre apto para Dropbox: sin acentos raros, sin '/', sin '..'."""
    base = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" ._") or "archivo"
    base = base.replace("..", "_")
    if len(base) > maximo:
        raiz, punto, ext = base.rpartition(".")
        base = (raiz[: maximo - len(ext) - 1] + "." + ext) if punto else base[:maximo]
    return base


async def _oc_con_scope(db: DBSession, user: AuthenticatedUser, oc_id: int) -> dict:
    fila = (
        await db.execute(
            text(
                """SELECT oc_id, numero_oc, empresa_codigo, estado, fecha_emision
                     FROM core.ordenes_compra WHERE oc_id = :id"""
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, fila["empresa_codigo"])
    return dict(fila)


async def _dropbox(db: DBSession) -> DropboxService:
    integracion = await IntegrationRepository(db).get_by_provider("dropbox")
    if integracion is None or not integracion.access_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Dropbox no está conectado: los anexos se guardan ahí. "
                "Conéctalo en /admin/integraciones."
            ),
        )
    try:
        return DropboxService(
            access_token=integracion.access_token,
            refresh_token=integracion.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


# Firmado DESPUÉS de subido el anexo ⇒ el anexo es parte de lo firmado.
_SQL_FIRMADO_DESPUES = """
    EXISTS (SELECT 1 FROM core.oc_firmas f
             WHERE f.oc_id = a.oc_id AND f.status = 'FIRMADA'
               AND f.signed_at >= a.created_at)
"""


@router.get(
    "/{oc_id:int}/anexos",
    response_model=list[OcAnexoRead],
    dependencies=[Depends(require_scope("oc:read"))],
)
async def listar_anexos(
    user: CurrentUser, db: DBSession, oc_id: int
) -> list[OcAnexoRead]:
    """Anexos de la OC en el orden en que salen en el PDF (más antiguo primero)."""
    await _oc_con_scope(db, user, oc_id)
    filas = (
        await db.execute(
            text(
                f"""SELECT {_COLUMNAS},
                           NOT {_SQL_FIRMADO_DESPUES} AS se_puede_quitar
                      FROM core.oc_attachments a
                     WHERE a.oc_id = :id
                     ORDER BY a.created_at, a.attachment_id"""
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    return [OcAnexoRead(**dict(f)) for f in filas]


@router.post(
    "/{oc_id:int}/anexos",
    response_model=OcAnexoRead,
    status_code=status.HTTP_201_CREATED,
)
async def subir_anexo(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    file: UploadFile = File(..., description="Cotización, especificación, contrato…"),
    descripcion: Annotated[str | None, Form(max_length=300)] = None,
) -> OcAnexoRead:
    # 1. OC + scope ANTES de leer el archivo o tocar Dropbox.
    oc = await _oc_con_scope(db, user, oc_id)
    if oc["estado"] == "anulada":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La OC está anulada: no se le pueden agregar anexos.",
        )
    ya = await db.scalar(
        text("SELECT count(*) FROM core.oc_attachments WHERE oc_id = :id"),
        {"id": oc_id},
    )
    if (ya or 0) >= _MAX_ANEXOS_POR_OC:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC ya tiene {ya} anexos (máximo {_MAX_ANEXOS_POR_OC}). "
                "Junta varios en un solo PDF o quita alguno."
            ),
        )

    # 2. Archivo.
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo no tiene nombre."
        )
    contenido = await file.read()
    if not contenido:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo está vacío."
        )
    if len(contenido) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"El archivo pesa más de {_MAX_BYTES // (1024 * 1024)} MB. "
                "Comprímelo o divídelo."
            ),
        )
    mime = (file.content_type or "application/octet-stream").lower()
    if not mime.startswith(_MIME_PERMITIDOS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tipo de archivo no permitido ({mime}). Sube PDF, imagen "
                "(JPG/PNG/WebP), Excel o Word."
            ),
        )

    # 3. Dropbox. El prefijo de milisegundos hace único el nombre: dos
    #    "cotizacion.pdf" en la misma OC no se pisan (overwrite=False).
    fecha = oc["fecha_emision"]
    anio = fecha.year if fecha else datetime.now().year
    carpeta = (
        f"{_ROOT}/{oc['empresa_codigo']}/06-Adjuntos-OCs/{anio}/"
        f"{_nombre_seguro(oc['numero_oc'], 80)}"
    )
    ruta = f"{carpeta}/{int(time.time() * 1000)}_{_nombre_seguro(file.filename)}"
    dbx = await _dropbox(db)
    try:
        await asyncio.to_thread(dbx.ensure_folder_path, carpeta)
        await asyncio.to_thread(dbx.upload_file, ruta, contenido, overwrite=False)
    except Exception as exc:
        log.warning("oc_anexo.dropbox_fallo", oc_id=oc_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo guardar el archivo en Dropbox: {exc}",
        ) from exc

    email = await db.scalar(
        text("SELECT email FROM auth.users WHERE id = CAST(:uid AS UUID)"),
        {"uid": user.sub},
    )
    desc = (descripcion or "").strip() or None

    # 4. Fila. `created_at` la pone la BD (now()); el orden del PDF sale de ahí.
    fila = (
        await db.execute(
            text(
                f"""INSERT INTO core.oc_attachments
                        (oc_id, file_name, dropbox_path, mime_type, size_bytes,
                         source, descripcion, subido_por, subido_por_email)
                    VALUES (:oc, :n, :p, :m, :s, 'manual_upload', :d,
                            CAST(:uid AS UUID), :email)
                    RETURNING {_COLUMNAS}"""
            ),
            {
                "oc": oc_id,
                "n": file.filename,
                "p": ruta,
                "m": mime,
                "s": len(contenido),
                "d": desc,
                "uid": user.sub,
                "email": email,
            },
        )
    ).mappings().one()
    await db.commit()

    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']}: anexo agregado «{file.filename}»"
            + (f" ({desc})" if desc else "")
        ),
        after={
            "anexo_id": fila["attachment_id"],
            "archivo": file.filename,
            "descripcion": desc,
            "dropbox_path": ruta,
            "bytes": len(contenido),
        },
    )
    return OcAnexoRead(**dict(fila), se_puede_quitar=True)


@router.get(
    "/{oc_id:int}/anexos/{attachment_id:int}/url",
    response_model=OcAnexoLink,
    dependencies=[Depends(require_scope("oc:read"))],
)
async def url_anexo(
    user: CurrentUser, db: DBSession, oc_id: int, attachment_id: int
) -> OcAnexoLink:
    """Link temporal de Dropbox (4 h) para abrir el anexo."""
    await _oc_con_scope(db, user, oc_id)
    fila = (
        await db.execute(
            text(
                """SELECT attachment_id, file_name, dropbox_path
                     FROM core.oc_attachments
                    WHERE attachment_id = :a AND oc_id = :oc"""
            ),
            {"a": attachment_id, "oc": oc_id},
        )
    ).mappings().first()
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Anexo no encontrado"
        )
    dbx = await _dropbox(db)
    try:
        url = await asyncio.to_thread(dbx.get_temporary_link, fila["dropbox_path"])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Dropbox no entregó el archivo: {exc}",
        ) from exc
    return OcAnexoLink(
        attachment_id=fila["attachment_id"], file_name=fila["file_name"], url=url
    )


@router.delete(
    "/{oc_id:int}/anexos/{attachment_id:int}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def quitar_anexo(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:update"))],
    db: DBSession,
    request: Request,
    oc_id: int,
    attachment_id: int,
) -> Response:
    oc = await _oc_con_scope(db, user, oc_id)
    fila = (
        await db.execute(
            text(
                f"""SELECT a.file_name, a.dropbox_path, a.descripcion,
                           {_SQL_FIRMADO_DESPUES} AS firmado_despues
                      FROM core.oc_attachments a
                     WHERE a.attachment_id = :a AND a.oc_id = :oc
                     FOR UPDATE OF a"""
            ),
            {"a": attachment_id, "oc": oc_id},
        )
    ).mappings().first()
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Anexo no encontrado"
        )
    if fila["firmado_despues"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este anexo ya estaba cuando firmaron la OC: es parte de lo "
                "firmado y no se puede quitar."
            ),
        )
    await db.execute(
        text("DELETE FROM core.oc_attachments WHERE attachment_id = :a"),
        {"a": attachment_id},
    )
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=f"OC {oc['numero_oc']}: anexo quitado «{fila['file_name']}»",
        before={
            "anexo_id": attachment_id,
            "archivo": fila["file_name"],
            "descripcion": fila["descripcion"],
            # El archivo sigue en Dropbox: quitar el anexo no lo borra.
            "dropbox_path": fila["dropbox_path"],
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
