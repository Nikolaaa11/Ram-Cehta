"""Anexos de una OC — subir, listar, descargar y quitar (2026-09-21).

Nicolás: "que se pueda adjuntar anexo a las oc".

`core.oc_attachments` ya existía: la llena el inbox cuando una OC nace de un
correo, y el PDF de la OC (`oc_pdf_v2_service._fetch_attachments`) ya mergea
todas sus filas al final. Lo que faltaba era subir un anexo A MANO. Estos
endpoints escriben ahí con `source = 'manual_upload'`, así que un anexo PDF o
imagen sale en "Descargar PDF", en la invitación a firmar y en el PDF que se
le manda al proveedor. Excel y Word quedan guardados (plataforma + Dropbox);
en el PDF aparecen como una hoja que los nombra.

Reglas (revisión adversarial pre-deploy, 2026-09-21):
  · Scope multi-tenant SIEMPRE antes de tocar Dropbox o la BD.
  · Un anexo es PARTE DEL DOCUMENTO QUE SE FIRMA. Por eso se agregan y se
    quitan sólo mientras nadie firmó: estado borrador/emitida/en_firma y cero
    firmas FIRMADA — mismo criterio probatorio que `_assert_oc_sin_firmas`.
    Una factura o comprobante que llega después es respaldo del PAGO: va en
    el voucher, no en la OC.
  · El tipo se decide por la extensión y se VERIFICA por contenido (firma de
    bytes, PDF legible sin contraseña, imagen con resolución razonable,
    Office sin macros). El Content-Type del navegador no se cree.
  · Tope por archivo (10 MB) y por OC (20 MB en total): el PDF final va
    adjunto a correos (Resend acepta ~40 MB después de base64) y se arma en
    memoria en una máquina de 512 MB.
  · La subida a Dropbox ocurre FUERA de la transacción; la fila se inserta
    después, con la OC bloqueada (FOR UPDATE) y re-chequeando las reglas —
    así una firma que entra mientras se sube el archivo no queda "firmando"
    un anexo que no vio. Si la fila no se puede guardar, el archivo recién
    subido se borra de Dropbox.
  · Quitar un anexo borra la fila, NO el archivo en Dropbox: queda como
    respaldo y la auditoría guarda su ruta.

Carpeta Dropbox (la del árbol canónico, ver scripts/ensure_dropbox_folders.py):
    /Cehta Capital/01-Empresas/{COD}/06-Adjuntos-OCs/{año}/{numero_oc}/{ts}_{archivo}
"""
from __future__ import annotations

import asyncio
import io
import re
import time
import unicodedata
import zipfile
from datetime import datetime
from typing import Annotated, Any

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
_MB = 1024 * 1024
_MAX_BYTES_ARCHIVO = 10 * _MB
_MAX_BYTES_TOTAL = 20 * _MB
_MAX_ANEXOS_POR_OC = 15
# Una foto de celular anda en 12-50 MP; más que esto es un escaneo absurdo o
# una "bomba" de descompresión (pocos KB que piden GB de RAM al renderizar).
_MAX_PIXELES = 60_000_000

# Mientras nadie firmó. `firmada` en adelante (y `anulada`) quedan fuera.
_ESTADOS_MODIFICABLES = {"borrador", "emitida", "en_firma"}

# extensión → (mime canónico, familia). La familia decide cómo se verifica.
_TIPOS: dict[str, tuple[str, str]] = {
    ".pdf": ("application/pdf", "pdf"),
    ".jpg": ("image/jpeg", "imagen"),
    ".jpeg": ("image/jpeg", "imagen"),
    ".png": ("image/png", "imagen"),
    ".webp": ("image/webp", "imagen"),
    ".xlsx": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ooxml",
    ),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ooxml",
    ),
    ".xls": ("application/vnd.ms-excel", "ole"),
    ".doc": ("application/msword", "ole"),
}
# Para archivos sin extensión reconocible: el mime que manda el navegador
# sirve sólo como PISTA de qué verificar (igual se verifica el contenido).
_EXT_POR_MIME = {mime: ext for ext, (mime, _) in _TIPOS.items()}
_FORMATOS_IMAGEN = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_TIPOS_TEXTO = "PDF, imagen (JPG, PNG o WebP), Excel (.xlsx/.xls) o Word (.docx/.doc)"

_COLUMNAS = """a.attachment_id, a.oc_id, a.file_name, a.mime_type, a.size_bytes,
               a.source, a.descripcion, a.subido_por_email, a.created_at"""


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
    #: True si se incrusta en el PDF de la OC (PDF e imágenes). Excel/Word
    #: aparecen en el PDF sólo como una hoja que los nombra.
    en_el_pdf: bool = True


class OcAnexosResponse(BaseModel):
    anexos: list[OcAnexoRead]
    #: False cuando la OC ya tiene firmas o salió del borrador/emisión/firma.
    se_pueden_modificar: bool
    #: Por qué no (texto para mostrar tal cual). None si se pueden modificar.
    motivo_bloqueo: str | None = None
    usado_bytes: int
    limite_total_bytes: int = _MAX_BYTES_TOTAL
    limite_archivo_bytes: int = _MAX_BYTES_ARCHIVO
    max_anexos: int = _MAX_ANEXOS_POR_OC


class OcAnexoLink(BaseModel):
    attachment_id: int
    file_name: str
    url: str
    expires_in_seconds: int = 4 * 60 * 60


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────


def _nombre_seguro(nombre: str, maximo: int = 120) -> str:
    """Nombre apto para Dropbox: sin acentos raros, sin '/', sin '..'."""
    base = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" ._") or "archivo"
    base = base.replace("..", "_")
    if len(base) > maximo:
        raiz, punto, ext = base.rpartition(".")
        base = (raiz[: maximo - len(ext) - 1] + "." + ext) if punto else base[:maximo]
    return base


def _mb(n: int) -> str:
    return f"{n / _MB:.1f}".replace(".", ",") + " MB"


def _en_el_pdf(mime: str | None) -> bool:
    m = (mime or "").lower()
    return m == "application/pdf" or m.startswith("image/")


def _anexo(fila: Any) -> OcAnexoRead:
    d = dict(fila)
    return OcAnexoRead(**d, en_el_pdf=_en_el_pdf(d.get("mime_type")))


def _tipo_de(nombre: str, mime_cliente: str | None) -> tuple[str, str]:
    """(mime canónico, familia) según la extensión; el mime del navegador sólo
    desempata archivos sin extensión. 400 si el formato no se acepta."""
    ext = ("." + nombre.rsplit(".", 1)[1].lower()) if "." in nombre else ""
    if ext in _TIPOS:
        return _TIPOS[ext]
    pista = _EXT_POR_MIME.get((mime_cliente or "").split(";")[0].strip().lower())
    if not ext and pista:
        return _TIPOS[pista]
    extra = (
        " Si es una foto del iPhone (.heic), compártela como JPG."
        if ext in {".heic", ".heif"}
        else ""
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Formato no aceptado ({ext or 'sin extensión'}). Sube {_TIPOS_TEXTO}."
            + extra
        ),
    )


def _verificar_contenido(familia: str, mime: str, contenido: bytes, nombre: str) -> str:
    """Verifica que el contenido sea lo que dice la extensión. Devuelve el
    mime definitivo (para imágenes, el del formato real). 400 si no calza."""

    def rechazo(msg: str) -> HTTPException:
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{nombre}: {msg}")

    if familia == "pdf":
        if b"%PDF-" not in contenido[:1024]:
            raise rechazo("no es un PDF válido.")
        try:
            from pypdf import PdfReader

            lector = PdfReader(io.BytesIO(contenido))
            if lector.is_encrypted and not lector.decrypt(""):
                raise rechazo(
                    "el PDF está protegido con contraseña y no se puede incluir "
                    "en el PDF de la OC. Guárdalo sin contraseña y vuelve a subirlo."
                )
            if len(lector.pages) == 0:
                raise rechazo("el PDF no tiene páginas.")
        except HTTPException:
            raise
        except Exception as exc:
            log.info("oc_anexo.pdf_ilegible", archivo=nombre, error=str(exc))
            raise rechazo("el PDF está dañado y no se puede leer.") from exc
        return mime

    if familia == "imagen":
        try:
            from PIL import Image

            with Image.open(io.BytesIO(contenido)) as img:
                formato = img.format
                ancho, alto = img.size
            with Image.open(io.BytesIO(contenido)) as img:
                img.verify()
        except Exception as exc:
            log.info("oc_anexo.imagen_ilegible", archivo=nombre, error=str(exc))
            raise rechazo("la imagen está dañada o no es una imagen.") from exc
        if formato not in _FORMATOS_IMAGEN:
            raise rechazo(f"formato de imagen no aceptado ({formato}). Usa JPG, PNG o WebP.")
        if ancho * alto > _MAX_PIXELES:
            raise rechazo(
                f"la imagen es demasiado grande ({ancho}x{alto} px). "
                "Redúcela a una resolución normal y vuelve a subirla."
            )
        return _FORMATOS_IMAGEN[formato]

    if familia == "ooxml":
        if contenido[:4] != b"PK\x03\x04":
            raise rechazo("no es un archivo de Office válido.")
        try:
            with zipfile.ZipFile(io.BytesIO(contenido)) as z:
                nombres = set(z.namelist())
        except Exception as exc:
            raise rechazo("el archivo de Office está dañado.") from exc
        if any(n.endswith("vbaProject.bin") for n in nombres):
            raise rechazo("el archivo tiene macros; no se aceptan. Guárdalo sin macros.")
        es_excel = mime.endswith("spreadsheetml.sheet")
        esperado = "xl/workbook.xml" if es_excel else "word/document.xml"
        if esperado not in nombres:
            raise rechazo("el contenido no corresponde a la extensión del archivo.")
        return mime

    if familia == "ole":
        if contenido[:8] != _OLE_MAGIC:
            raise rechazo("no es un archivo de Office válido.")
        return mime

    raise rechazo("formato no aceptado.")  # no debería ocurrir


_SQL_OC = """SELECT oc_id, numero_oc, empresa_codigo, estado, fecha_emision
               FROM core.ordenes_compra WHERE oc_id = :id"""
_SQL_OC_BLOQUEANDO = _SQL_OC + " FOR UPDATE"


async def _oc_con_scope(
    db: DBSession, user: AuthenticatedUser, oc_id: int, *, bloquear: bool = False
) -> dict:
    fila = (
        await db.execute(
            text(_SQL_OC_BLOQUEANDO if bloquear else _SQL_OC),
            {"id": oc_id},
        )
    ).mappings().first()
    if fila is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada"
        )
    await assert_empresa_access(user, db, fila["empresa_codigo"])
    return dict(fila)


_ETIQUETA_ESTADO = {
    "firmada": "firmada",
    "enviada_proveedor": "enviada al proveedor",
    "facturada": "facturada",
    "pagada": "pagada",
    "parcial": "con pago parcial",
    "anulada": "anulada",
}


async def _bloqueo(db: DBSession, oc: dict) -> str | None:
    """Por qué NO se pueden agregar/quitar anexos a esta OC (None = se puede)."""
    estado = oc["estado"]
    if estado == "anulada":
        return "La OC está anulada: sus anexos ya no se modifican."
    if estado not in _ESTADOS_MODIFICABLES:
        return (
            f"La OC está {_ETIQUETA_ESTADO.get(estado, estado)}: los anexos son "
            "parte del documento que se firmó y ya no se pueden agregar ni quitar. "
            "Si es un respaldo del pago (factura, comprobante), súbelo al voucher del pago."
        )
    firmadas = (
        await db.scalar(
            text(
                "SELECT count(*) FROM core.oc_firmas "
                "WHERE oc_id = :id AND status = 'FIRMADA'"
            ),
            {"id": oc["oc_id"]},
        )
    ) or 0
    if firmadas:
        return (
            f"La OC ya tiene {firmadas} firma{'s' if firmadas != 1 else ''} "
            "puesta" + ("s" if firmadas != 1 else "") + ": los anexos son parte de "
            "lo que se firma, así que ya no se pueden agregar ni quitar. Si hay que "
            "cambiarlos, duplica la OC (botón Duplicar) y anula esta."
        )
    return None


async def _uso(db: DBSession, oc_id: int) -> tuple[int, int]:
    """(cantidad de anexos, bytes usados) de la OC."""
    fila = (
        await db.execute(
            text(
                "SELECT count(*) AS n, COALESCE(sum(size_bytes), 0) AS b "
                "FROM core.oc_attachments WHERE oc_id = :id"
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    return int(fila["n"] or 0), int(fila["b"] or 0)


def _chequear_cupo(cantidad: int, usado: int, nuevo: int, nombre: str) -> None:
    if cantidad >= _MAX_ANEXOS_POR_OC:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"La OC ya tiene {cantidad} anexos (máximo {_MAX_ANEXOS_POR_OC}). "
                "Junta varios en un solo PDF o quita alguno."
            ),
        )
    if usado + nuevo > _MAX_BYTES_TOTAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{nombre} no cabe: la OC ya usa {_mb(usado)} de {_mb(_MAX_BYTES_TOTAL)} "
                "en anexos (el PDF de la OC viaja por correo y no puede ser más "
                "grande). Comprime el archivo o quita otro anexo."
            ),
        )


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


async def _borrar_de_dropbox(dbx: DropboxService, ruta: str) -> None:
    """Best-effort: limpia un archivo recién subido cuya fila no se guardó."""
    try:
        await asyncio.to_thread(dbx.delete, ruta)
    except Exception as exc:
        log.warning("oc_anexo.dropbox_huerfano", ruta=ruta, error=str(exc))


# ──────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────


@router.get(
    "/{oc_id:int}/anexos",
    response_model=OcAnexosResponse,
    dependencies=[Depends(require_scope("oc:read"))],
)
async def listar_anexos(
    user: CurrentUser, db: DBSession, oc_id: int
) -> OcAnexosResponse:
    """Anexos en el orden en que salen en el PDF (más antiguo primero) + si se
    pueden modificar y por qué no."""
    oc = await _oc_con_scope(db, user, oc_id)
    filas = (
        await db.execute(
            text(
                f"""SELECT {_COLUMNAS}
                      FROM core.oc_attachments a
                     WHERE a.oc_id = :id
                     ORDER BY a.created_at, a.attachment_id"""  # noqa: S608 (sólo constantes)
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    bloqueo = await _bloqueo(db, oc)
    anexos = [_anexo(f) for f in filas]
    return OcAnexosResponse(
        anexos=anexos,
        se_pueden_modificar=bloqueo is None,
        motivo_bloqueo=bloqueo,
        usado_bytes=sum(a.size_bytes or 0 for a in anexos),
    )


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
    # 1. OC + scope + reglas ANTES de leer el archivo o tocar Dropbox.
    oc = await _oc_con_scope(db, user, oc_id)
    bloqueo = await _bloqueo(db, oc)
    if bloqueo:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=bloqueo)

    # 2. Archivo: nombre, tamaño, tipo verificado por contenido.
    nombre = (file.filename or "").strip()
    if not nombre:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El archivo no tiene nombre."
        )
    demasiado_grande = HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=(
            f"{nombre} pesa más de {_mb(_MAX_BYTES_ARCHIVO)}. Comprímelo o "
            "divídelo (el PDF de la OC viaja por correo)."
        ),
    )
    if file.size is not None and file.size > _MAX_BYTES_ARCHIVO:
        raise demasiado_grande
    contenido = await file.read()
    if not contenido:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"{nombre} está vacío."
        )
    if len(contenido) > _MAX_BYTES_ARCHIVO:
        raise demasiado_grande
    mime, familia = _tipo_de(nombre, file.content_type)
    mime = await asyncio.to_thread(_verificar_contenido, familia, mime, contenido, nombre)

    cantidad, usado = await _uso(db, oc_id)
    _chequear_cupo(cantidad, usado, len(contenido), nombre)

    # Cerrar la transacción de lectura: la subida a Dropbox puede tardar y no
    # debe tener tomada una conexión del pool (3+1 por máquina) mientras tanto.
    await db.commit()

    # 3. Dropbox. El prefijo de milisegundos hace único el nombre: dos
    #    "cotizacion.pdf" en la misma OC no se pisan (overwrite=False).
    fecha = oc["fecha_emision"]
    anio = fecha.year if fecha else datetime.now().year
    carpeta = (
        f"{_ROOT}/{oc['empresa_codigo']}/06-Adjuntos-OCs/{anio}/"
        f"{_nombre_seguro(oc['numero_oc'], 80)}"
    )
    ruta = f"{carpeta}/{int(time.time() * 1000)}_{_nombre_seguro(nombre)}"
    dbx = await _dropbox(db)
    await db.commit()
    try:
        await asyncio.to_thread(dbx.ensure_folder_path, carpeta)
        await asyncio.to_thread(dbx.upload_file, ruta, contenido, overwrite=False)
    except Exception as exc:
        log.warning("oc_anexo.dropbox_fallo", oc_id=oc_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo guardar el archivo en Dropbox. Intenta de nuevo en un rato.",
        ) from exc

    # 4. Fila, con la OC BLOQUEADA y las reglas re-chequeadas: si alguien
    #    firmó (o subió otro anexo) mientras se subía el archivo, lo que vale
    #    es el estado de ahora. `firmar` bloquea la misma fila (FOR UPDATE OF
    #    oc), así que firma e inserción quedan serializadas.
    #    `created_at` = now() de ESTA transacción, posterior a la subida.
    desc = (descripcion or "").strip() or None
    try:
        oc = await _oc_con_scope(db, user, oc_id, bloquear=True)
        bloqueo = await _bloqueo(db, oc)
        if bloqueo:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=bloqueo)
        cantidad, usado = await _uso(db, oc_id)
        _chequear_cupo(cantidad, usado, len(contenido), nombre)
        email = await db.scalar(
            text("SELECT email FROM auth.users WHERE id = CAST(:uid AS UUID)"),
            {"uid": user.sub},
        )
        fila = (
            await db.execute(
                text(
                    f"""INSERT INTO core.oc_attachments AS a
                            (oc_id, file_name, dropbox_path, mime_type, size_bytes,
                             source, descripcion, subido_por, subido_por_email)
                        VALUES (:oc, :n, :p, :m, :s, 'manual_upload', :d,
                                CAST(:uid AS UUID), :email)
                        RETURNING {_COLUMNAS}"""
                ),
                {
                    "oc": oc_id,
                    "n": nombre,
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
    except BaseException:
        await db.rollback()
        await _borrar_de_dropbox(dbx, ruta)
        raise

    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="orden_compra",
        entity_id=str(oc_id),
        entity_label=oc["numero_oc"],
        summary=(
            f"OC {oc['numero_oc']}: anexo agregado «{nombre}»"
            + (f" ({desc})" if desc else "")
        ),
        after={
            "anexo_id": fila["attachment_id"],
            "archivo": nombre,
            "descripcion": desc,
            "dropbox_path": ruta,
            "bytes": len(contenido),
            "tipo": mime,
        },
    )
    return _anexo(fila)


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
        log.warning("oc_anexo.link_fallo", attachment_id=attachment_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dropbox no entregó el archivo. Intenta de nuevo en un rato.",
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
    # OC bloqueada: quitar y firmar no se cruzan.
    oc = await _oc_con_scope(db, user, oc_id, bloquear=True)
    bloqueo = await _bloqueo(db, oc)
    if bloqueo:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=bloqueo)
    fila = (
        await db.execute(
            text(
                """SELECT file_name, dropbox_path, descripcion
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
    await db.execute(
        text("DELETE FROM core.oc_attachments WHERE attachment_id = :a AND oc_id = :oc"),
        {"a": attachment_id, "oc": oc_id},
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
