"""Servicio de generación de PDFs de Vouchers (cover branded + attachments merged).

Genera un PDF "bundle" por voucher:
  1. Cover PDF (1-3 páginas) con branding de la empresa y todo el detalle:
     header, info grid, glosa, VISTA CONTABLE (el asiento + cuadratura),
     VISTA FINANCIERA (composición del documento tributario), approvals,
     footer.
  2. Si include_attachments=True: descarga cada adjunto desde Dropbox y los
     concatena al final del PDF. PDFs nativos se merge-an con pypdf, imágenes
     (jpg/png/webp) se renderizan a A4 con Pillow + reportlab, otros tipos
     (docx, xlsx, etc.) producen una página placeholder.

Robustez:
  - Errores fetching del logo o de adjuntos NUNCA tumban el PDF — se loggean
    y se usa un fallback (texto en vez de logo, página placeholder en vez de
    adjunto roto).
  - Si Dropbox no está conectado se sigue generando el cover sin attachments.

Diseño:
  - Color de marca cehta-green: #1d6f42
  - Fuentes Helvetica (built-in reportlab, sin asset externo).
  - A4 portrait.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# La cuenta de retención no se hardcodea acá: se lee de donde ya vive, que es
# el motor de asientos. El día que cambie, cambia en un solo lugar y el PDF
# sigue leyendo la retención correcta.
from app.domain.services.asiento_desde_oc import CUENTA_RETENCION_HONORARIOS

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Branding constants
# ---------------------------------------------------------------------------

CEHTA_GREEN = HexColor("#1d6f42")
CEHTA_GREEN_DARK = HexColor("#154d2e")
CEHTA_GREY = HexColor("#6b7280")
CEHTA_LIGHT_GREY = HexColor("#fafafa")
CEHTA_ROW_ALT = HexColor("#f6f8f6")
CEHTA_BORDER = HexColor("#e5e7eb")

PAGE_W, PAGE_H = A4
MARGIN_L = 18 * mm
MARGIN_R = 18 * mm
MARGIN_T = 18 * mm
MARGIN_B = 18 * mm
HEADER_BAND_H = 24 * mm

# Logo path convention (empresa.logo_dropbox_path takes precedence)
_LOGO_FALLBACK_PATH_TPL = "/Cehta Capital/01-Empresas/{empresa}/Logo.png"

# Status display labels and colors
_STATUS_COLORS: dict[str, tuple[str, str]] = {
    # status -> (bg, fg)
    "DRAFT": ("#e5e7eb", "#374151"),
    "PENDING": ("#fef3c7", "#92400e"),
    "APPROVED": ("#dcfce7", "#166534"),
    "EXECUTED": ("#dcfce7", "#166534"),
    "SYNCED": ("#dbeafe", "#1e3a8a"),
    "RECONCILED": ("#dcfce7", "#166534"),
    "REJECTED": ("#fee2e2", "#991b1b"),
    "VOID": ("#fee2e2", "#991b1b"),
    "REVERSO": ("#fee2e2", "#991b1b"),
}

_APPROVAL_REQUIRED_STATUSES = {
    "PENDING", "APPROVED", "EXECUTED", "SYNCED", "RECONCILED", "REJECTED",
}


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


async def generate_voucher_pdf_bundle(
    voucher_id: int,
    db: AsyncSession,
    include_attachments: bool = True,
    generated_by_email: str | None = None,
) -> bytes:
    """Genera el PDF bundle: cover branded + (opcional) attachments mergeados.

    Round 13 — acepta `generated_by_email` opcional para que el footer
    notarial registre QUE user genero el PDF (auditoria forense).
    Si None, el footer solo muestra timestamp.

    Devuelve los bytes del PDF combinado listo para streamear al cliente.

    Errores graceful:
      - Si el logo no se puede bajar -> usa texto fallback.
      - Si un attachment falla -> placeholder page + log warning, sigue con el resto.
      - Si Dropbox no está conectado -> cover sin attachments (sin lanzar).
    """
    data = await _fetch_voucher_bundle_data(db, voucher_id)
    if data is None:
        raise ValueError(f"Voucher {voucher_id} no encontrado")
    # Inyectamos el email en el dict de data para que _build_cover_pdf
    # pueda renderearlo en el footer. None = no muestra "Por: ...".
    data["generated_by_email"] = generated_by_email
    # Round 21 — QR de verificación. URL pública del voucher en la app.
    # Soft-fail: si frontend_url no está, o qrcode no instalado, sin QR.
    try:
        from app.core.config import settings
        base = (settings.frontend_url or "").rstrip("/")
        if base:
            data["verify_url"] = f"{base}/vouchers/{voucher_id}"
    except Exception:  # noqa: BLE001
        pass

    # 1. Build cover PDF in worker thread (reportlab is sync)
    logo_bytes = await _try_fetch_logo(db, data["empresa"])
    cover_bytes = await asyncio.to_thread(_build_cover_pdf, data, logo_bytes)

    if not include_attachments or not data["attachments"]:
        return cover_bytes

    # 2. Download attachments (best effort) + merge
    attachment_payloads = await _fetch_attachment_bytes(db, data["attachments"])
    merged = await asyncio.to_thread(
        _merge_cover_with_attachments, cover_bytes, attachment_payloads
    )
    return merged


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


async def _fetch_voucher_bundle_data(
    db: AsyncSession, voucher_id: int
) -> dict[str, Any] | None:
    """Carga voucher + lines + empresa + approvals + attachments en pocas queries.

    Devuelve None si el voucher no existe.
    """
    v_row = (
        await db.execute(
            text(
                """
                SELECT voucher_id, codigo, empresa_codigo, tipo, status,
                       fecha_documento, fecha_contable, fecha_ejecucion,
                       glosa, total_debit, total_credit, moneda,
                       contraparte_rut, contraparte_nombre, contraparte_tipo,
                       doc_tributario_tipo, doc_tributario_folio,
                       banco, banco_cuenta_alias, forma_pago,
                       fecha_vencimiento, source, created_at, threshold_aplicado,
                       impuesto_especifico
                FROM core.vouchers
                WHERE voucher_id = :id
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().first()
    if v_row is None:
        return None
    voucher = dict(v_row)

    empresa_row = (
        await db.execute(
            text(
                """
                SELECT codigo, razon_social, rut, giro, direccion, ciudad,
                       telefono, logo_dropbox_path
                FROM core.empresas
                WHERE codigo = :c
                """
            ),
            {"c": voucher["empresa_codigo"]},
        )
    ).mappings().first()
    empresa = dict(empresa_row) if empresa_row else {
        "codigo": voucher["empresa_codigo"],
        "razon_social": voucher["empresa_codigo"],
        "rut": None,
        "direccion": None,
        "ciudad": None,
        "logo_dropbox_path": None,
    }

    # Lines + cuenta name
    line_rows = (
        await db.execute(
            text(
                """
                SELECT line_number, cuenta_codigo, proyecto_codigo, area_codigo,
                       debit, credit, descripcion, neto_amount, iva_amount,
                       iva_tratamiento, tipo_imputacion
                FROM core.voucher_lines
                WHERE voucher_id = :id
                ORDER BY line_number
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()
    lines = [dict(r) for r in line_rows]

    cuenta_codes = [ln["cuenta_codigo"] for ln in lines if ln.get("cuenta_codigo")]
    cuenta_name_map: dict[str, str] = {}
    if cuenta_codes:
        cuenta_rows = await db.execute(
            text(
                "SELECT codigo, nombre FROM core.plan_cuentas "
                "WHERE codigo = ANY(CAST(:codes AS text[]))"
            ),
            {"codes": list(set(cuenta_codes))},
        )
        cuenta_name_map = {r[0]: r[1] for r in cuenta_rows}
    for ln in lines:
        ln["cuenta_nombre"] = cuenta_name_map.get(ln.get("cuenta_codigo") or "", "")

    # Approvals (table may not exist in older deploys — soft-fail)
    approvals: list[dict[str, Any]] = []
    # R152SSSSS — Compliance fix: si la query de approvals falla, NO podemos
    # emitir un PDF "sin firmas" porque ese PDF se manda al SII/auditor como
    # evidencia. Fail loud con 503 para que el caller reintente, NO emit lie.
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT order_num, role, decision, approver_user_id,
                           signed_at, signature_hash, comments
                    FROM core.voucher_approvals
                    WHERE voucher_id = :id
                    ORDER BY order_num
                    """
                ),
                {"id": voucher_id},
            )
        ).mappings().all()
        approvals = [dict(r) for r in rows]
    except Exception as exc:
        log.error(
            "voucher_pdf.approvals_query_failed",
            extra={"voucher_id": voucher_id, "err": str(exc)},
        )
        await db.rollback()
        # Re-raise para que el endpoint devuelva 503 — el caller debe
        # reintentar. Mejor un PDF no generado que un PDF mentiroso.
        raise RuntimeError(
            "No se pudo cargar el historial de firmas del voucher. "
            "PDF no emitido para evitar evidencia incompleta."
        ) from exc

    # Attachments
    att_rows = (
        await db.execute(
            text(
                """
                SELECT attachment_id, tipo, file_name, dropbox_path,
                       mime_type, size_bytes
                FROM core.voucher_attachments
                WHERE voucher_id = :id
                ORDER BY uploaded_at
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()
    attachments = [dict(r) for r in att_rows]

    return {
        "voucher": voucher,
        "empresa": empresa,
        "lines": lines,
        "approvals": approvals,
        "attachments": attachments,
    }


# ---------------------------------------------------------------------------
# Dropbox helpers (best-effort, never raise to caller)
# ---------------------------------------------------------------------------


async def _get_dropbox_or_none(db: AsyncSession):
    """Devuelve `DropboxService` o None si no está configurado / conectado."""
    try:
        from app.infrastructure.repositories.integration_repository import (
            IntegrationRepository,
        )
        from app.services.dropbox_service import (
            DropboxNotConfigured,
            DropboxService,
        )

        integration = await IntegrationRepository(db).get_by_provider("dropbox")
        if integration is None:
            return None
        try:
            return DropboxService(
                access_token=integration.access_token,
                refresh_token=integration.refresh_token,
            )
        except DropboxNotConfigured:
            return None
    except Exception as exc:
        log.warning("voucher_pdf.dropbox_init_failed", extra={"err": str(exc)})
        return None


# R152LLLL — Cache en memoria del logo bytes por (path, hash).
# Antes: cada PDF disparaba un HTTP request a Vercel CDN (5-15s con cold
# Fly machine + cold Vercel edge). Si timeout browser (~30s) o latencia
# spike, el frontend recibe "Failed to fetch" generic. Cacheando los
# logos en RAM evitamos el round-trip salvo en miss.
# TTL 1h: si el operador sube un logo nuevo, el cache se renueva en 1h
# (o cuando reinicie el container Fly). Hit ratio esperado: ~99%.
# Memory cost: 10 empresas × ~30KB = 300KB. Negligible.
import time as _time
from typing import NamedTuple


class _LogoCacheEntry(NamedTuple):
    fetched_at: float
    bytes_data: bytes | None  # None marca "intento previo falló, no reintentar"


_LOGO_CACHE: dict[str, _LogoCacheEntry] = {}
_LOGO_CACHE_TTL = 3600.0  # 1h
_LOGO_CACHE_NEGATIVE_TTL = 60.0  # 1min para misses (reintenta sino tarda 1h)


async def _try_fetch_logo(db: AsyncSession, empresa: dict[str, Any]) -> bytes | None:
    """Intenta obtener el logo con cache en memoria. Soporta dos fuentes:
       1. URL http(s)://... — descarga directa con cache 1h (Vercel CDN).
       2. Path Dropbox /Cehta Capital/... — vía API Dropbox.

    Falla silenciosamente devolviendo None — el PDF se genera sin logo.

    R152LLLL — cache en memoria por path para evitar HTTP round-trip
    en cada PDF generation, que era la causa principal del "Failed to
    fetch" reportado por el operador (Fly cold start + Vercel CDN miss
    > 30s browser timeout).
    """
    path = empresa.get("logo_dropbox_path")
    if not path:
        path = _LOGO_FALLBACK_PATH_TPL.format(empresa=empresa.get("codigo") or "")

    # Cache check
    cached = _LOGO_CACHE.get(path)
    now = _time.time()
    if cached:
        age = now - cached.fetched_at
        ttl = _LOGO_CACHE_TTL if cached.bytes_data else _LOGO_CACHE_NEGATIVE_TTL
        if age < ttl:
            return cached.bytes_data

    # R152AAAA — soporte URL HTTP(s) (frontend static logos)
    if path.startswith("http://") or path.startswith("https://"):
        try:
            import httpx
            # Timeout 5s — si Vercel CDN no responde rápido, fallback a None
            # rápidamente para no colgar la generación del PDF.
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                r = await client.get(path)
                if r.status_code == 200:
                    _LOGO_CACHE[path] = _LogoCacheEntry(now, r.content)
                    return r.content
                log.info(
                    "voucher_pdf.logo_http_non_200",
                    extra={"url": path, "status": r.status_code},
                )
                _LOGO_CACHE[path] = _LogoCacheEntry(now, None)
                return None
        except Exception as exc:
            log.info(
                "voucher_pdf.logo_http_failed",
                extra={"url": path, "err": str(exc)},
            )
            _LOGO_CACHE[path] = _LogoCacheEntry(now, None)
            return None

    # Path Dropbox tradicional
    dbx = await _get_dropbox_or_none(db)
    if dbx is None:
        return None
    try:
        result = await asyncio.to_thread(dbx.download_file, path)
        _LOGO_CACHE[path] = _LogoCacheEntry(now, result)
        return result
    except Exception as exc:
        log.info(
            "voucher_pdf.logo_fetch_failed",
            extra={"path": path, "err": str(exc)},
        )
        _LOGO_CACHE[path] = _LogoCacheEntry(now, None)
        return None


async def _fetch_attachment_bytes(
    db: AsyncSession, attachments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Para cada attachment intenta descargarlo. Devuelve lista con `bytes` o None."""
    dbx = await _get_dropbox_or_none(db)
    out: list[dict[str, Any]] = []
    for att in attachments:
        if dbx is None:
            out.append({**att, "bytes": None, "error": "Dropbox no conectado"})
            continue
        try:
            data = await asyncio.to_thread(dbx.download_file, att["dropbox_path"])
            out.append({**att, "bytes": data, "error": None})
        except Exception as exc:
            log.warning(
                "voucher_pdf.attachment_download_failed",
                extra={"path": att.get("dropbox_path"), "err": str(exc)},
            )
            out.append({**att, "bytes": None, "error": str(exc)})
    return out


# ---------------------------------------------------------------------------
# Cover PDF (reportlab)
# ---------------------------------------------------------------------------


def _fmt_money(value: Any, moneda: str = "CLP") -> str:
    if value is None:
        return "—"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    if moneda == "CLP":
        # No decimals for CLP, thousands sep with dot
        n = int(d.quantize(Decimal("1")))
        return f"${n:,}".replace(",", ".")
    return f"{d:,.2f}"


def _fmt_date(value: Any) -> str:
    if value is None:
        return "—"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _fmt_dt(value: Any) -> str:
    if value is None:
        return "—"
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value)


def _short_hash(h: str | None) -> str:
    if not h:
        return "—"
    return h[:16] + ("…" if len(h) > 16 else "")


# ---------------------------------------------------------------------------
# Cálculo puro — las dos vistas del voucher
# ---------------------------------------------------------------------------
#
# Estas funciones no saben nada de reportlab: comen los dicts que arma
# `_fetch_voucher_bundle_data` y devuelven números. Están separadas del armado
# de la tabla a propósito. El bug que motivó este rediseño —Σ(debe+haber)
# comparado contra Σ(netos), que imprimía "DIFERENCIA -$440.168" arriba de un
# asiento que cuadraba perfecto— vivía adentro del constructor de la tabla,
# donde ningún test lo podía ver: una función que devuelve un `Table` no se
# puede afirmar, una que devuelve un Decimal sí.
#
# Antes había DOS layouts elegidos por `source == 'nubox_form'`. Eso estaba mal
# de raíz: el mismo asiento se imprimía distinto según por qué pantalla se
# había cargado (/vouchers/nubox caía en la rama rota, /vouchers/corfo en la
# sana, con idéntico shape de datos). El layout ahora se decide por lo único
# que importa: si el desglose tributario está cargado o no.


def _dec(value: Any) -> Decimal:
    """Decimal de una columna NOT NULL DEFAULT 0 (`debit` / `credit`).

    Acá NULL y 0 significan lo mismo porque la columna no admite NULL: si viene
    None es un dict armado a mano, no un dato faltante.
    """
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _dec_or_none(value: Any) -> Decimal | None:
    """Decimal de una columna NULLABLE (`neto_amount`, `iva_amount`, …).

    El contrapunto de `_dec`: acá None es "no está cargado" y NO es cero.
    Confundir los dos es exactamente cómo se imprime un $0 que miente.
    """
    if value is None:
        return None
    return Decimal(str(value))


ESTADO_CUADRA: Final[str] = "CUADRA"
ESTADO_DESCUADRE: Final[str] = "DESCUADRE"
ESTADO_SIN_LINEAS: Final[str] = "SIN_LINEAS"
ESTADO_SIN_MONTOS: Final[str] = "SIN_MONTOS"


@dataclass(frozen=True)
class CuadraturaContable:
    """Lo único que responde la vista contable: ¿el asiento cuadra?

    `estado` tiene cuatro valores y no dos porque "0 == 0" es cierto y a la vez
    inútil: un voucher sin líneas, o con líneas en cero, tiene diferencia cero
    y NO cuadra — no hay asiento que cuadrar. Un booleano solo obligaría al PDF
    a decirle al gerente "el asiento cuadra" sobre una hoja vacía.
    """

    total_debe: Decimal
    total_haber: Decimal
    diferencia: Decimal  # debe - haber. Cero cuando cuadra.
    estado: str
    cantidad_lineas: int

    @property
    def cuadra(self) -> bool:
        return self.estado == ESTADO_CUADRA

    @property
    def hay_asiento(self) -> bool:
        """False cuando no hay nada que verificar (sin líneas o todo en cero)."""
        return self.estado in (ESTADO_CUADRA, ESTADO_DESCUADRE)


def calcular_cuadratura_contable(lines: list[dict]) -> CuadraturaContable:
    """Σ DEBE y Σ HABER del asiento, calculadas desde las líneas.

    Se calcula desde las líneas y NO desde `vouchers.total_debit/total_credit`:
    el asiento son las líneas: el encabezado es un derivado que puede quedar
    viejo. Si el papel dice que cuadra, tiene que ser porque lo que está
    impreso arriba suma igual, no porque un contador guardado dijo que sí.

    Las dos sumas son independientes a propósito. La BD NO tiene el CHECK de
    `debit XOR credit` (la migración 0035 lo declara, `pg_constraint` en
    producción está vacío), así que una línea con los dos lados cargados es
    posible; sumarlos por separado la deja a la vista en vez de taparla.
    """
    total_debe = sum((_dec(ln.get("debit")) for ln in lines), start=Decimal("0"))
    total_haber = sum((_dec(ln.get("credit")) for ln in lines), start=Decimal("0"))
    diferencia = total_debe - total_haber

    if not lines:
        estado = ESTADO_SIN_LINEAS
    elif total_debe == 0 and total_haber == 0:
        estado = ESTADO_SIN_MONTOS
    elif diferencia == 0:
        estado = ESTADO_CUADRA
    else:
        estado = ESTADO_DESCUADRE

    return CuadraturaContable(
        total_debe=total_debe,
        total_haber=total_haber,
        diferencia=diferencia,
        estado=estado,
        cantidad_lineas=len(lines),
    )


# Regímenes en los que la ley dice que la operación no lleva IVA. Cuando la
# línea los declara, un IVA de $0 es un dato (lo afirma el régimen), no un
# relleno. Con cualquier otro tratamiento —o sin tratamiento— un IVA no
# cargado es desconocido y se imprime como tal.
_TRATAMIENTOS_SIN_IVA: Final[frozenset[str]] = frozenset({"EXENTO", "NO_GRAVADO"})


@dataclass(frozen=True)
class DesgloseTributario:
    """Composición del documento: cuánta plata sale y de qué está hecha.

    Todos los montos son `Decimal | None`, y el None es la mitad del valor de
    esta clase: significa "no está cargado", que es distinto de cero. El
    renderer imprime "—" para None y "$0" para Decimal(0), y esa diferencia es
    la que separa un documento honesto de uno que inventa.
    """

    neto: Decimal | None
    iva: Decimal | None
    impuesto_especifico: Decimal | None
    retencion: Decimal | None
    total_documento: Decimal | None
    total_a_pagar: Decimal | None
    tratamiento_iva: str | None  # AFECTO / EXENTO / NO_GRAVADO / MIXTO / None

    @property
    def hay_desglose(self) -> bool:
        """True si hay algo tributario que valga la pena imprimir.

        Ojo con la sutileza: un 0 guardado SÍ es un dato (la trampa del cero
        falso también se comete al revés, confundiendo un cero legítimo con
        ausencia). Lo que no sirve es encender la sección entera para mostrar
        un único número que dice cero, con neto, IVA y total en guiones —
        eso es justamente "un número impreso que no significa nada".

        Entonces: el neto y el IVA valen por sí solos, porque son la
        composición del documento. La retención y el impuesto específico sólo
        encienden la sección si tienen monto: en cero no le dicen nada al
        lector que el asiento no diga mejor.
        """
        if self.neto is not None or self.iva is not None:
            return True
        return any(
            v is not None and v != 0
            for v in (self.impuesto_especifico, self.retencion)
        )


def calcular_desglose_tributario(
    voucher: dict, lines: list[dict]
) -> DesgloseTributario:
    """Arma la vista financiera desde los datos del propio voucher.

    Fuentes, todas del voucher y ninguna inventada:
      - neto / IVA: `voucher_lines.neto_amount` / `.iva_amount`, sumando sólo
        las líneas que los traen. Que el gasto los traiga y la contrapartida no
        es la forma normal del asiento, no una anomalía.
      - impuesto específico: `vouchers.impuesto_especifico` (combustibles, ILA).
      - retención: el haber imputado a la cuenta de retención de honorarios.
        No hay columna `retencion` en el voucher — el único registro de la
        retención ES esa línea del asiento, así que se lee de ahí.

    Deliberadamente NO se toca la OC (`vouchers.oc_id`): una OC con hitos
    genera un voucher por hito, así que el neto/IVA/retención de la OC son los
    del contrato entero y no los de este documento. Imprimirlos acá sería el
    mismo error que estamos arreglando, con otro disfraz.
    """
    # --- Neto: suma de las líneas que lo traen. Ninguna lo trae => None.
    netos = [
        n
        for n in (_dec_or_none(ln.get("neto_amount")) for ln in lines)
        if n is not None
    ]
    neto = sum(netos, start=Decimal("0")) if netos else None

    # --- IVA. Se decide a nivel DOCUMENTO y no línea por línea, porque en el
    # asiento real el IVA vive en su PROPIA línea (1113-02 IVA CRÉDITO FISCAL)
    # y el neto en la del gasto. Emparejarlos por línea daba "no sé" sobre una
    # factura afecta perfectamente cargada.
    ivas_explicitos = [
        i
        for i in (_dec_or_none(ln.get("iva_amount")) for ln in lines)
        if i is not None
    ]
    lineas_con_neto = [
        ln for ln in lines if _dec_or_none(ln.get("neto_amount")) is not None
    ]
    if ivas_explicitos:
        # Alguien cargó el desglose: el IVA del documento es lo que cargó.
        iva = sum(ivas_explicitos, start=Decimal("0"))
    elif lineas_con_neto and all(
        (ln.get("iva_tratamiento") or "").upper() in _TRATAMIENTOS_SIN_IVA
        for ln in lineas_con_neto
    ):
        # Todo el documento está bajo un régimen que no lleva IVA: el cero lo
        # afirma la ley, no lo inventamos nosotros.
        iva = Decimal("0")
    else:
        # O no hay nada cargado, o hay un neto afecto sin su IVA. En los dos
        # casos la respuesta honesta es "no sé", nunca cero.
        iva = None

    impuesto_especifico = _dec_or_none(voucher.get("impuesto_especifico"))

    # --- Retención: la POSICIÓN NETA de la cuenta de retención, no su haber.
    #
    # Buscarla por cuenta y sumarla por haber hacía que el papel se
    # contradijera solo. Dos casos reales lo disparan:
    #   · el REVERSO de un voucher de honorarios, que lleva 2105-04 al DEBE;
    #   · el voucher que paga la retención al SII en el F29, ídem.
    # En los dos, la suma de haberes daba Decimal("0") —que no es None—, así
    # que se apagaba el cartel honesto "sin desglose" y se imprimía
    # "Retención $0" ocho líneas debajo de una vista contable que mostraba
    # "2105-04 · Debe $152.500". El mismo documento afirmando dos cosas
    # incompatibles.
    #
    # `haber − debe` da el signo correcto en los dos sentidos: positivo cuando
    # se retiene (nace el pasivo), negativo cuando se entera al SII (se
    # extingue). Y si las dos patas se cancelan, el resultado es un 0 que SÍ
    # es un dato real, no una ausencia disfrazada.
    lineas_retencion = [
        ln
        for ln in lines
        if (ln.get("cuenta_codigo") or "") == CUENTA_RETENCION_HONORARIOS
    ]
    retencion = (
        sum(
            (_dec(ln.get("credit")) - _dec(ln.get("debit")) for ln in lineas_retencion),
            start=Decimal("0"),
        )
        if lineas_retencion
        else None
    )

    # --- Total del documento. Sólo se puede afirmar con neto E IVA conocidos.
    # `impuesto_especifico` NULL sí se puede tomar como cero: el modelo lo
    # documenta como "NULL = no aplica" (app/models/voucher.py), o sea que la
    # ausencia ahí es una afirmación del schema, no un dato faltante.
    if neto is not None and iva is not None:
        # `is None` y no `or`: con `or`, un impuesto específico guardado en cero
        # entraría por la rama del fallback. Da el mismo número, pero es la
        # trampa de este repo escrita a mano y el que lea después no tiene por
        # qué demostrarse que es inocua.
        extra = Decimal("0") if impuesto_especifico is None else impuesto_especifico
        total_documento = neto + iva + extra
    else:
        total_documento = None

    total_a_pagar = (
        total_documento - retencion
        if total_documento is not None and retencion is not None
        else None
    )

    tratamientos = {(ln.get("iva_tratamiento") or "").upper() for ln in lines}
    tratamientos.discard("")
    tratamientos.discard("NA")  # "no aplica" no describe un régimen: no se muestra
    if len(tratamientos) == 1:
        tratamiento_iva: str | None = next(iter(tratamientos))
    elif tratamientos:
        tratamiento_iva = "MIXTO"
    else:
        tratamiento_iva = None

    return DesgloseTributario(
        neto=neto,
        iva=iva,
        impuesto_especifico=impuesto_especifico,
        retencion=retencion,
        total_documento=total_documento,
        total_a_pagar=total_a_pagar,
        tratamiento_iva=tratamiento_iva,
    )


def formatear_debe_haber(
    debit: Any, credit: Any, moneda: str = "CLP"
) -> tuple[str, str]:
    """Las dos celdas de monto de una línea, ya formateadas.

    En un libro contable el lado que no lleva monto va VACÍO. No "—", que
    significa "no sé" y acá sí sabemos que es cero; y no "$0" en cada fila,
    que es ruido y hace que el ojo tenga que buscar el número real.

    La excepción es la línea sin monto de ningún lado: ahí los dos ceros se
    imprimen, porque esa línea está mal cargada y esconderla sería tapar el
    problema con un espacio en blanco.
    """
    d = _dec(debit)
    c = _dec(credit)
    if d == 0 and c == 0:
        return _fmt_money(d, moneda), _fmt_money(c, moneda)
    return (
        _fmt_money(d, moneda) if d != 0 else "",
        _fmt_money(c, moneda) if c != 0 else "",
    )


class _CoverDoc(BaseDocTemplate):
    """Doc template con header/footer custom dibujados en onPage."""

    def __init__(self, buf: io.BytesIO, *, empresa: dict, voucher: dict,
                 logo_bytes: bytes | None,
                 generated_by_email: str | None = None,
                 verify_url: str | None = None) -> None:
        super().__init__(
            buf,
            pagesize=A4,
            leftMargin=MARGIN_L,
            rightMargin=MARGIN_R,
            topMargin=MARGIN_T + HEADER_BAND_H,
            bottomMargin=MARGIN_B + 12 * mm,
            title=f"Voucher {voucher.get('codigo', '')}",
            author="Cehta Capital",
        )
        self._empresa = empresa
        self._voucher = voucher
        self._logo_bytes = logo_bytes
        self._generated_by_email = generated_by_email
        # Round 21 — QR de verificación (cacheado por instancia para no
        # regenerar el PNG en cada onPage de cada página).
        self._verify_url = verify_url
        self._qr_png: bytes | None = None
        if verify_url:
            try:
                from app.services.pdf_qr_util import qr_png_bytes
                self._qr_png = qr_png_bytes(verify_url)
            except Exception:  # noqa: BLE001
                self._qr_png = None
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="content",
            showBoundary=0,
        )
        tpl = PageTemplate(
            id="cover",
            frames=[frame],
            onPage=self._draw_chrome,
        )
        self.addPageTemplates([tpl])

    def _draw_chrome(self, canv: rl_canvas.Canvas, doc: BaseDocTemplate) -> None:
        # QA fix 14/05/2026 — watermark diagonal por estado critico
        # (VOID/REVERSO/REJECTED/DRAFT). Previene que un voucher invalido
        # se procese como vigente cuando se imprime y mezcla con otros.
        _draw_status_watermark(canv, self._voucher.get("status"))
        _draw_header(canv, self._empresa, self._logo_bytes)
        _draw_footer(
            canv,
            doc.page,
            self._generated_by_email,
            qr_png=self._qr_png,
            verify_url=self._verify_url,
        )


def _draw_header(canv: rl_canvas.Canvas, empresa: dict, logo_bytes: bytes | None) -> None:
    """Header band: logo (left) + razon social/rut/dirección (right) + green border."""
    top_y = PAGE_H - MARGIN_T
    band_bottom = top_y - HEADER_BAND_H

    # Background (subtle)
    canv.saveState()
    canv.setFillColor(colors.white)
    canv.rect(MARGIN_L, band_bottom, PAGE_W - MARGIN_L - MARGIN_R,
              HEADER_BAND_H, stroke=0, fill=1)

    # Logo on left or empresa.codigo big text fallback
    logo_drawn = False
    if logo_bytes:
        try:
            reader = _to_imagereader(logo_bytes)
            iw, ih = reader.getSize()
            max_h = HEADER_BAND_H - 6 * mm
            max_w = 40 * mm
            scale = min(max_w / iw, max_h / ih)
            draw_w, draw_h = iw * scale, ih * scale
            canv.drawImage(
                reader,
                MARGIN_L,
                band_bottom + (HEADER_BAND_H - draw_h) / 2,
                width=draw_w,
                height=draw_h,
                preserveAspectRatio=True,
                mask="auto",
            )
            logo_drawn = True
        except Exception as exc:
            log.info("voucher_pdf.logo_draw_failed", extra={"err": str(exc)})
            logo_drawn = False
    if not logo_drawn:
        canv.setFillColor(CEHTA_GREEN)
        canv.setFont("Helvetica-Bold", 20)
        canv.drawString(
            MARGIN_L,
            band_bottom + HEADER_BAND_H / 2 - 2 * mm,
            str(empresa.get("codigo") or "—"),
        )

    # Right: razon social bold, rut, dir
    right_x = PAGE_W - MARGIN_R
    y = top_y - 6 * mm
    canv.setFillColor(colors.black)
    canv.setFont("Helvetica-Bold", 13)
    canv.drawRightString(right_x, y, _truncate(empresa.get("razon_social") or "", 55))
    y -= 5 * mm
    canv.setFont("Helvetica", 9)
    if empresa.get("rut"):
        canv.drawRightString(right_x, y, f"RUT {empresa['rut']}")
        y -= 4 * mm
    canv.setFillColor(CEHTA_GREY)
    canv.setFont("Helvetica", 8)
    dir_line = " · ".join(
        x for x in [empresa.get("direccion"), empresa.get("ciudad")] if x
    )
    if dir_line:
        canv.drawRightString(right_x, y, _truncate(dir_line, 70))

    # Bottom border 2pt cehta-green
    canv.setStrokeColor(CEHTA_GREEN)
    canv.setLineWidth(2)
    canv.line(MARGIN_L, band_bottom, PAGE_W - MARGIN_R, band_bottom)
    canv.restoreState()


# QA fix 14/05/2026 — watermark diagonal por estado critico.
# Previene que documentos VOID/REJECTED se procesen como vigentes
# cuando se imprimen y mezclan con otros. Tambien marca DRAFT.
_WATERMARK_BY_STATUS: dict[str, tuple[str, tuple[float, float, float]]] = {
    # status → (texto, (r,g,b))
    "VOID": ("ANULADO", (0.85, 0.20, 0.20)),       # red strong
    "VOIDED": ("ANULADO", (0.85, 0.20, 0.20)),
    "CANCELLED": ("ANULADO", (0.85, 0.20, 0.20)),
    "REJECTED": ("RECHAZADO", (0.85, 0.20, 0.20)),
    "REVERSO": ("REVERSO", (0.85, 0.55, 0.20)),    # orange
    "DRAFT": ("BORRADOR", (0.55, 0.55, 0.55)),     # gray
}


def _draw_status_watermark(canv: rl_canvas.Canvas, status: str | None) -> None:
    """Dibuja un watermark diagonal grande si status amerita marcarlo.

    No-op para status normales (PENDING, APPROVED, EXECUTED, SYNCED).
    """
    if not status:
        return
    meta = _WATERMARK_BY_STATUS.get(status.upper())
    if meta is None:
        return
    text, (r, g, b) = meta

    canv.saveState()
    try:
        canv.translate(PAGE_W / 2, PAGE_H / 2)
        canv.rotate(35)
        canv.setFillColorRGB(r, g, b, alpha=0.12)
        canv.setStrokeColorRGB(r, g, b, alpha=0.0)
        # 72pt font scaled enough to cross la pagina A4 en diagonal
        canv.setFont("Helvetica-Bold", 110)
        canv.drawCentredString(0, -30, text)
    finally:
        canv.restoreState()


def _draw_footer(
    canv: rl_canvas.Canvas,
    page_num: int,
    generated_by_email: str | None = None,
    qr_png: bytes | None = None,
    verify_url: str | None = None,
) -> None:
    """Round 13 — footer notarial enriquecido.

    Antes solo timestamp UTC + page. Ahora tambien `Por: {user_email}`
    si se proveyo. Util para auditoria forense (saber QUE user descargo
    el PDF cuando se distribuye externamente).

    Round 21 — opcionalmente dibuja un QR a la derecha del footer con
    la URL del registro en la plataforma. Si qr_png es None (lib no
    instalada o sin URL), simplemente omite el QR.
    """
    canv.saveState()
    y = MARGIN_B - 2 * mm
    canv.setStrokeColor(CEHTA_BORDER)
    canv.setLineWidth(0.5)
    canv.line(MARGIN_L, y + 6 * mm, PAGE_W - MARGIN_R, y + 6 * mm)

    canv.setFont("Helvetica", 7)
    canv.setFillColor(CEHTA_GREY)
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    gen_text = f"Generado el {now}"
    if generated_by_email:
        # Trunca email muy largo para no romper layout (max 35 chars).
        email_short = (
            generated_by_email[:32] + "…"
            if len(generated_by_email) > 35
            else generated_by_email
        )
        gen_text += f"  ·  Por: {email_short}"
    canv.drawString(MARGIN_L, y + 2 * mm, gen_text)
    canv.drawRightString(PAGE_W - MARGIN_R, y + 2 * mm, f"Página {page_num}")
    canv.setFillColor(CEHTA_GREEN_DARK)
    canv.setFont("Helvetica-Bold", 7)
    canv.drawCentredString(PAGE_W / 2, y - 1 * mm,
                           "Cehta Capital · FIP CEHTA ESG")

    # Round 21 — QR de verificación arriba del footer (esquina sup-der).
    # Solo se dibuja en la primera página para no inundar el bundle.
    if qr_png and page_num == 1:
        try:
            from app.services.pdf_qr_util import draw_qr_on_canvas
            qr_x_mm = (PAGE_W - MARGIN_R) / mm - 22
            qr_y_mm = (y + 10 * mm) / mm
            draw_qr_on_canvas(canv, qr_png, x_mm=qr_x_mm, y_mm=qr_y_mm,
                              size_mm=20)
            canv.setFont("Helvetica", 6)
            canv.setFillColor(CEHTA_GREY)
            canv.drawRightString(
                PAGE_W - MARGIN_R,
                qr_y_mm * mm - 2.5 * mm,
                "Verificar en plataforma",
            )
        except Exception:  # noqa: BLE001
            pass

    canv.restoreState()


def _to_imagereader(data: bytes):
    """Wraps bytes en algo que reportlab acepta para drawImage."""
    from reportlab.lib.utils import ImageReader

    return ImageReader(io.BytesIO(data))


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _build_cover_pdf(data: dict[str, Any], logo_bytes: bytes | None) -> bytes:
    """Renderiza el PDF de cover (sync, llamar via to_thread)."""
    voucher = data["voucher"]
    empresa = data["empresa"]
    lines = data["lines"]
    approvals = data["approvals"]
    # Round 13 — propagamos el user que genero el PDF al footer notarial.
    generated_by_email = data.get("generated_by_email")
    # Round 21 — URL para QR de verificación (opcional).
    verify_url = data.get("verify_url")

    buf = io.BytesIO()
    doc = _CoverDoc(
        buf,
        empresa=empresa,
        voucher=voucher,
        logo_bytes=logo_bytes,
        generated_by_email=generated_by_email,
        verify_url=verify_url,
    )

    styles = getSampleStyleSheet()
    h_title = ParagraphStyle(
        "VTitle", parent=styles["Heading1"],
        alignment=TA_CENTER, fontSize=18, leading=22,
        textColor=colors.black, spaceAfter=2,
    )
    h_sub = ParagraphStyle(
        "VSub", parent=styles["Normal"],
        alignment=TA_CENTER, fontSize=11, leading=14,
        fontName="Courier", textColor=CEHTA_GREY, spaceAfter=12,
    )
    label = ParagraphStyle(
        "Label", parent=styles["Normal"],
        fontSize=7, textColor=CEHTA_GREY,
        fontName="Helvetica-Bold", spaceAfter=2,
    )
    value = ParagraphStyle(
        "Value", parent=styles["Normal"],
        fontSize=10, textColor=colors.black, spaceAfter=0,
    )
    section = ParagraphStyle(
        "Section", parent=styles["Heading3"],
        fontSize=11, textColor=CEHTA_GREEN_DARK, spaceBefore=8, spaceAfter=4,
        fontName="Helvetica-Bold",
        # Un título solo al pie de una página, con su contenido en la
        # siguiente, se lee como una sección vacía. Pasaba con "VISTA
        # FINANCIERA" en los vouchers de tres líneas o más.
        keepWithNext=1,
    )
    glosa_style = ParagraphStyle(
        "Glosa", parent=styles["Normal"],
        fontSize=10, leading=13, textColor=colors.black,
    )

    story: list[Any] = []

    # Title block
    tipo = (voucher.get("tipo") or "").upper()
    story.append(Paragraph(f"VOUCHER {tipo}", h_title))
    story.append(Paragraph(f"Código: {voucher.get('codigo', '')}", h_sub))

    # Status badge row
    status_str = voucher.get("status") or ""
    bg_hex, fg_hex = _STATUS_COLORS.get(status_str, ("#e5e7eb", "#374151"))
    badge_tbl = Table(
        [[Paragraph(
            f"<font color='{fg_hex}'><b>{status_str}</b></font>", value
        )]],
        colWidths=[35 * mm],
        rowHeights=[7 * mm],
    )
    badge_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor(bg_hex)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 0.5, HexColor(bg_hex)),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))

    # Info grid: 2 columns x 4 rows
    info_pairs: list[tuple[str, str, str, str]] = [
        (
            "Fecha documento",
            _fmt_date(voucher.get("fecha_documento")),
            "Fecha contable",
            _fmt_date(voucher.get("fecha_contable")),
        ),
        (
            "Tipo",
            (voucher.get("tipo") or "—"),
            "Forma de pago",
            (voucher.get("forma_pago") or "—"),
        ),
        (
            "Folio doc. trib.",
            f"{voucher.get('doc_tributario_tipo') or '—'} "
            f"{voucher.get('doc_tributario_folio') or ''}".strip(),
            "Moneda",
            voucher.get("moneda") or "CLP",
        ),
        (
            "Contraparte",
            (voucher.get("contraparte_nombre") or "—"),
            "RUT contraparte",
            (voucher.get("contraparte_rut") or "—"),
        ),
    ]
    info_rows: list[list[Any]] = []
    for l1, v1, l2, v2 in info_pairs:
        info_rows.append([
            Paragraph(l1.upper(), label),
            Paragraph(l2.upper(), label),
        ])
        info_rows.append([
            Paragraph(_esc(v1), value),
            Paragraph(_esc(v2), value),
        ])
    col_w = (PAGE_W - MARGIN_L - MARGIN_R) / 2
    info_tbl = Table(info_rows, colWidths=[col_w, col_w])
    info_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 1), (-1, 1), 0.25, CEHTA_BORDER),
        ("LINEBELOW", (0, 3), (-1, 3), 0.25, CEHTA_BORDER),
        ("LINEBELOW", (0, 5), (-1, 5), 0.25, CEHTA_BORDER),
    ]))

    story.append(badge_tbl)
    story.append(Spacer(1, 4 * mm))
    story.append(info_tbl)

    # Glosa
    story.append(Paragraph("GLOSA", section))
    glosa_tbl = Table(
        [[Paragraph(_esc(voucher.get("glosa") or "—"), glosa_style)]],
        colWidths=[PAGE_W - MARGIN_L - MARGIN_R],
    )
    glosa_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(glosa_tbl)
    story.append(Spacer(1, 3 * mm))

    moneda = voucher.get("moneda") or "CLP"

    # --- VISTA CONTABLE: el asiento, y si cuadra o no.
    # Va primero porque es la que responde la pregunta del que firma: ¿está
    # bien hecho el trabajo? Se imprime siempre y con el mismo layout para
    # todos los vouchers, venga de la pantalla que venga.
    story.append(Paragraph("VISTA CONTABLE · EL ASIENTO", section))
    story.append(_build_contable_table(lines, moneda))
    story.append(_build_cuadratura_box(calcular_cuadratura_contable(lines), moneda))

    # --- VISTA FINANCIERA: de qué está hecho el monto del documento.
    # Separada de la contable porque responde otra pregunta (cuánta plata sale
    # y cómo se compone), y porque mezclarlas fue lo que produjo la resta sin
    # sentido que este rediseño saca.
    # El título va ADENTRO del KeepTogether y no antes: `keepWithNext` no puede
    # engancharse a un KeepTogether (reportlab lo excluye vía `_ktAllow`, porque
    # es un `_ContainerSpace`), así que el título quedaba huérfano al pie de la
    # página con su contenido en la siguiente. Se verificó rindiendo el asiento
    # de honorarios de 3 líneas.
    story.append(KeepTogether([
        Paragraph("VISTA FINANCIERA · EL DOCUMENTO", section),
        *_build_financiera_block(
            voucher, calcular_desglose_tributario(voucher, lines), moneda
        ),
    ]))

    # Approvals
    if status_str in _APPROVAL_REQUIRED_STATUSES:
        story.append(Paragraph("APROBACIONES", section))
        story.append(_build_approvals_table(approvals))

    doc.build(story)
    return buf.getvalue()


def _esc(s: Any) -> str:
    """Escape para Paragraph reportlab — escapa &, <, >."""
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _build_contable_table(lines: list[dict], moneda: str) -> Table:
    """VISTA CONTABLE — el asiento, una línea por fila, en DEBE o en HABER.

    Seis columnas: # · Cuenta · Nombre de la cuenta · Glosa · Debe · Haber.
    El nombre de la cuenta y la glosa van en columnas separadas (antes
    compartían una celda con un `<br/>` en el medio) porque responden cosas
    distintas: contra qué cuenta se imputó, y por qué. El nombre ya viene
    resuelto en `_fetch_voucher_bundle_data` con una sola query batch contra
    `core.plan_cuentas`, así que separarlo no cuesta un round-trip más.
    """
    styles = getSampleStyleSheet()
    cell = ParagraphStyle(
        "Cell", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=colors.black,
    )
    cell_mono = ParagraphStyle(
        "CellMono", parent=cell, fontName="Courier", fontSize=8,
    )
    cell_grey = ParagraphStyle("CellGrey", parent=cell, textColor=CEHTA_GREY)
    cell_right = ParagraphStyle("CellRight", parent=cell, alignment=TA_RIGHT)

    header = ["#", "Cuenta", "Nombre de la cuenta", "Glosa", "Debe", "Haber"]
    rows: list[list[Any]] = [header]

    total_debe = Decimal("0")
    total_haber = Decimal("0")

    for ln in lines:
        total_debe += _dec(ln.get("debit"))
        total_haber += _dec(ln.get("credit"))
        celda_debe, celda_haber = formatear_debe_haber(
            ln.get("debit"), ln.get("credit"), moneda
        )
        rows.append([
            Paragraph(str(ln.get("line_number", "")), cell),
            Paragraph(_esc(ln.get("cuenta_codigo") or ""), cell_mono),
            # Nombre vacío = la cuenta no está en el plan. "—" (no sé cómo se
            # llama) es la lectura correcta y además deja el hueco a la vista.
            Paragraph(_esc(ln.get("cuenta_nombre") or "—"), cell),
            Paragraph(_esc(ln.get("descripcion") or "—"), cell_grey),
            Paragraph(celda_debe, cell_right),
            Paragraph(celda_haber, cell_right),
        ])

    hay_total = bool(lines)
    if hay_total:
        rows.append([
            "", "", "",
            Paragraph("<b>TOTAL</b>", cell_right),
            Paragraph(f"<b>{_fmt_money(total_debe, moneda)}</b>", cell_right),
            Paragraph(f"<b>{_fmt_money(total_haber, moneda)}</b>", cell_right),
        ])
    else:
        rows.append([
            Paragraph("<i>Sin líneas contables cargadas</i>", cell_grey),
            "", "", "", "", "",
        ])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_widths = [
        content_w * 0.05, content_w * 0.12, content_w * 0.25,
        content_w * 0.26, content_w * 0.16, content_w * 0.16,
    ]

    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    # Índices de columna EXPLÍCITOS y no negativos: con `(-3, ...)` sobre una
    # tabla de 6 columnas el "alinear a la derecha" caía sobre la Glosa.
    col_debe, col_haber = 4, 5
    ultima_fila = len(rows) - 1
    style: list[Any] = [
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (0, 0), "CENTER"),
        ("ALIGN", (col_debe, 0), (col_haber, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        # Body
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
    ]
    if hay_total:
        style += [
            ("GRID", (0, 0), (-1, -2), 0.25, CEHTA_BORDER),
            ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.black),
            ("TOPPADDING", (0, -1), (-1, -1), 4),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 4),
        ]
    else:
        style += [
            ("GRID", (0, 0), (-1, -1), 0.25, CEHTA_BORDER),
            ("SPAN", (0, 1), (5, 1)),
            ("ALIGN", (0, 1), (0, 1), "LEFT"),
        ]
    # Zebra sobre el cuerpo, sin tocar la fila de totales.
    fin_cuerpo = ultima_fila if hay_total else ultima_fila + 1
    for i in range(1, fin_cuerpo):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), CEHTA_ROW_ALT))
    tbl.setStyle(TableStyle(style))
    return tbl


# Veredicto de cuadratura: (texto, color de fondo, color de texto). El texto se
# arma con `.format()` sobre los datos reales — nunca hay un cartel verde que
# no venga de haber comparado los dos totales impresos justo arriba.
_VEREDICTO_CUADRATURA: Final[dict[str, tuple[str, str, str]]] = {
    ESTADO_CUADRA: (
        "<b>EL ASIENTO CUADRA.</b> El total del debe es igual al total del "
        "haber.",
        "#f0fdf4",
        "#166534",
    ),
    ESTADO_DESCUADRE: (
        "<b>EL ASIENTO NO CUADRA.</b> {detalle} Debe corregirse antes de "
        "aprobar.",
        "#fef2f2",
        "#991b1b",
    ),
    ESTADO_SIN_LINEAS: (
        "<b>SIN ASIENTO CARGADO.</b> Este voucher todavía no tiene ninguna "
        "línea contable, así que no hay cuadratura que verificar.",
        "#fef3c7",
        "#92400e",
    ),
    ESTADO_SIN_MONTOS: (
        "<b>ASIENTO SIN MONTOS.</b> Las líneas están cargadas pero todas en "
        "cero: no hay nada que verificar.",
        "#fef3c7",
        "#92400e",
    ),
}


def _build_cuadratura_box(
    cuadratura: CuadraturaContable, moneda: str
) -> KeepTogether:
    """Cierre de la vista contable: los dos totales y el veredicto, con palabras.

    Reemplaza la caja de tres columnas que imprimía "DIFERENCIA" siempre —
    incluso cuando valía cero, que es el caso normal y bueno. Acá la diferencia
    aparece SÓLO cuando existe; cuando el asiento cuadra el papel lo dice en
    castellano y en verde, que es lo que el que firma necesita leer.
    """
    styles = getSampleStyleSheet()
    tot_label = ParagraphStyle(
        "CuadLabel", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=CEHTA_GREY, alignment=TA_CENTER, fontName="Helvetica-Bold",
    )
    tot_value = ParagraphStyle(
        "CuadValue", parent=styles["Normal"], fontSize=14, leading=18,
        textColor=colors.black, alignment=TA_CENTER, fontName="Helvetica-Bold",
    )

    plantilla, bg_hex, fg_hex = _VEREDICTO_CUADRATURA[cuadratura.estado]
    if cuadratura.estado == ESTADO_DESCUADRE:
        monto = _fmt_money(abs(cuadratura.diferencia), moneda)
        lado = "El debe supera al haber" if cuadratura.diferencia > 0 else (
            "El haber supera al debe"
        )
        texto = plantilla.format(detalle=f"{lado} en {monto}.")
    else:
        texto = plantilla

    veredicto_style = ParagraphStyle(
        "CuadVeredicto", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=HexColor(fg_hex), alignment=TA_CENTER,
    )

    # Sin asiento no hay totales: "$0" ahí sería afirmar que las sumas dieron
    # cero cuando en realidad no hay nada que sumar.
    if cuadratura.hay_asiento:
        txt_debe = _fmt_money(cuadratura.total_debe, moneda)
        txt_haber = _fmt_money(cuadratura.total_haber, moneda)
    else:
        txt_debe = txt_haber = "—"

    rows: list[list[Any]] = [
        [Paragraph("TOTAL DEBE", tot_label), Paragraph("TOTAL HABER", tot_label)],
        [Paragraph(txt_debe, tot_value), Paragraph(txt_haber, tot_value)],
        [Paragraph(texto, veredicto_style), ""],
    ]

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_w = content_w / 2
    tbl = Table(rows, colWidths=[col_w, col_w])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 1), CEHTA_LIGHT_GREY),
        ("BACKGROUND", (0, 2), (-1, 2), HexColor(bg_hex)),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("LINEAFTER", (0, 0), (0, 1), 0.5, CEHTA_BORDER),
        ("LINEABOVE", (0, 2), (-1, 2), 0.5, CEHTA_BORDER),
        ("SPAN", (0, 2), (1, 2)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
        ("TOPPADDING", (0, 2), (-1, 2), 6),
        ("BOTTOMPADDING", (0, 2), (-1, 2), 6),
        ("LEFTPADDING", (0, 2), (-1, 2), 10),
        ("RIGHTPADDING", (0, 2), (-1, 2), 10),
    ]))
    # KeepTogether para que el veredicto no se separe de los totales que lo
    # justifican: media caja al pie de una página sería peor que no tenerla.
    return KeepTogether([Spacer(1, 2 * mm), tbl])


def _caption_documento(voucher: dict) -> str:
    """Encabezado de la vista financiera: qué documento y de quién.

    Se arma sólo con lo que existe. Si no hay ni documento ni contraparte
    devuelve "", y el bloque se imprime sin caption en vez de con guiones.
    """
    partes: list[str] = []
    tipo = voucher.get("doc_tributario_tipo")
    folio = voucher.get("doc_tributario_folio")
    if tipo and folio:
        partes.append(f"Documento: {_esc(tipo)} N° {_esc(folio)}")
    elif tipo:
        partes.append(f"Documento: {_esc(tipo)} (sin folio)")
    elif folio:
        partes.append(f"Documento: folio {_esc(folio)}")

    nombre = voucher.get("contraparte_nombre")
    rut = voucher.get("contraparte_rut")
    if nombre and rut:
        partes.append(f"Contraparte: {_esc(nombre)} ({_esc(rut)})")
    elif nombre:
        partes.append(f"Contraparte: {_esc(nombre)}")
    elif rut:
        partes.append(f"Contraparte: RUT {_esc(rut)}")

    return "  ·  ".join(partes)


def _build_financiera_block(
    voucher: dict, desglose: DesgloseTributario, moneda: str
) -> list[Any]:
    """VISTA FINANCIERA — neto, IVA, retención y total del documento.

    Devuelve los flowables SIN envolver: el caller los mete en un KeepTogether
    junto con el título de la sección, que es la única forma de que el título
    no se despegue del contenido.

    Cuando el desglose NO está cargado —que hoy es el caso de los 4 vouchers de
    producción— esta sección lo DICE. No imprime $0: un cero es una afirmación
    ("el IVA de esta compra fue cero") y sería falsa. El guion con la
    aclaración es la verdad, y un documento que admite lo que no sabe vale más
    que uno que rellena.
    """
    styles = getSampleStyleSheet()
    caption_style = ParagraphStyle(
        "FinCaption", parent=styles["Normal"], fontSize=8, leading=11,
        textColor=CEHTA_GREY,
    )
    label_style = ParagraphStyle(
        "FinLabel", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=colors.black,
    )
    value_style = ParagraphStyle(
        "FinValue", parent=label_style, alignment=TA_RIGHT,
        fontName="Helvetica-Bold",
    )
    aviso_style = ParagraphStyle(
        "FinAviso", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=CEHTA_GREY,
    )

    out: list[Any] = []
    caption = _caption_documento(voucher)
    if caption:
        out.append(Paragraph(caption, caption_style))
        out.append(Spacer(1, 2 * mm))

    content_w = PAGE_W - MARGIN_L - MARGIN_R

    if not desglose.hay_desglose:
        aviso = Table(
            [[Paragraph(
                "<b>Sin desglose tributario cargado.</b> Este voucher no "
                "registra neto ni IVA por línea, así que no es posible "
                "componer el total del documento. No se imprime $0 porque el "
                "dato falta: no es que valga cero.",
                aviso_style,
            )]],
            colWidths=[content_w],
        )
        aviso.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
            ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        out.append(aviso)
        return out

    etiqueta_iva = "IVA"
    if desglose.tratamiento_iva:
        etiqueta_iva += (
            f" <font size='7' color='#6b7280'>({desglose.tratamiento_iva})</font>"
        )

    filas: list[tuple[str, Decimal | None]] = [
        ("Neto", desglose.neto),
        (etiqueta_iva, desglose.iva),
    ]
    if desglose.impuesto_especifico is not None:
        filas.append(("Impuesto específico", desglose.impuesto_especifico))
    if desglose.retencion is not None:
        filas.append((
            "Retención <font size='7' color='#6b7280'>(cuenta "
            f"{CUENTA_RETENCION_HONORARIOS})</font>",
            desglose.retencion,
        ))
    filas.append(("Total del documento", desglose.total_documento))
    # El índice se toma acá y no buscando la etiqueta después: la línea negra
    # tiene que caer sobre ESTA fila aunque mañana alguien reescriba el texto.
    fila_total = len(filas) - 1
    if desglose.total_a_pagar is not None:
        filas.append((
            "Total a pagar <font size='7' color='#6b7280'>(documento menos "
            "retención)</font>",
            desglose.total_a_pagar,
        ))
    rows = [
        [Paragraph(lbl, label_style), Paragraph(_fmt_money(monto, moneda), value_style)]
        for lbl, monto in filas
    ]

    tbl = Table(rows, colWidths=[content_w * 0.68, content_w * 0.32])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, fila_total), (-1, fila_total), 1.0, colors.black),
        ("FONTNAME", (0, fila_total), (-1, fila_total), "Helvetica-Bold"),
    ]))
    out.append(tbl)
    return out


def _build_approvals_table(approvals: list[dict]) -> Table:
    """Tabla de aprobaciones — pendientes con borde dashed, aprobadas con check verde."""
    styles = getSampleStyleSheet()
    cell = ParagraphStyle(
        "ACell", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=colors.black,
    )
    cell_mono = ParagraphStyle("ACellMono", parent=cell, fontName="Courier")

    header = ["Rol", "Aprobador", "Decisión", "Fecha", "Hash"]
    rows: list[list[Any]] = [header]

    if not approvals:
        rows.append([Paragraph("<i>Sin firmas registradas</i>", cell), "", "", "", ""])

    for a in approvals:
        decision = a.get("decision") or "PENDING"
        if decision == "APPROVED":
            dec_html = "<font color='#166534'><b>✓ APROBADO</b></font>"
        elif decision == "REJECTED":
            dec_html = "<font color='#991b1b'><b>✗ RECHAZADO</b></font>"
        else:
            dec_html = "<font color='#92400e'><b>Pendiente</b></font>"
        approver = str(a.get("approver_user_id") or "")[:8] + (
            "…" if a.get("approver_user_id") else ""
        )
        rows.append([
            Paragraph(_esc(a.get("role") or ""), cell),
            Paragraph(approver, cell_mono),
            Paragraph(dec_html, cell),
            Paragraph(_esc(_fmt_dt(a.get("signed_at"))), cell),
            Paragraph(_esc(_short_hash(a.get("signature_hash"))), cell_mono),
        ])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_widths = [
        content_w * 0.18, content_w * 0.18, content_w * 0.20,
        content_w * 0.20, content_w * 0.24,
    ]
    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    style: list[Any] = [
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.25, CEHTA_BORDER),
    ]
    # Highlight rows by decision
    for i, a in enumerate(approvals, start=1):
        dec = a.get("decision")
        if dec == "APPROVED":
            style.append(("BACKGROUND", (0, i), (-1, i), HexColor("#f0fdf4")))
        elif dec == "REJECTED":
            style.append(("BACKGROUND", (0, i), (-1, i), HexColor("#fef2f2")))
    tbl.setStyle(TableStyle(style))
    return tbl


# ---------------------------------------------------------------------------
# Attachment merging
# ---------------------------------------------------------------------------


_IMAGE_MIME_PREFIXES = ("image/jpeg", "image/png", "image/webp", "image/jpg")


def _is_pdf(mime: str | None, name: str) -> bool:
    if mime and "pdf" in mime.lower():
        return True
    return name.lower().endswith(".pdf")


def _is_image(mime: str | None, name: str) -> bool:
    if mime and any(mime.lower().startswith(p) for p in _IMAGE_MIME_PREFIXES):
        return True
    lower = name.lower()
    return lower.endswith((".jpg", ".jpeg", ".png", ".webp"))


def _file_ext(name: str) -> str:
    if "." in name:
        return name.rsplit(".", 1)[-1].lower()
    return ""


def _merge_cover_with_attachments(
    cover_pdf: bytes, attachments: list[dict[str, Any]]
) -> bytes:
    """Mergea el cover con todos los attachments. Devuelve PDF combinado."""
    writer = PdfWriter()
    # 1. Cover pages
    try:
        for page in PdfReader(io.BytesIO(cover_pdf)).pages:
            writer.add_page(page)
    except Exception as exc:
        log.error("voucher_pdf.cover_unreadable", extra={"err": str(exc)})
        # If cover itself fails, return raw bytes
        return cover_pdf

    # 2. Each attachment
    for att in attachments:
        try:
            _append_attachment(writer, att)
        except Exception as exc:
            log.warning(
                "voucher_pdf.attachment_append_failed",
                extra={"file": att.get("file_name"), "err": str(exc)},
            )
            with contextlib.suppress(Exception):
                _append_placeholder_page(
                    writer, att.get("file_name") or "?",
                    f"No se pudo procesar este adjunto: {exc}",
                )

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _append_attachment(writer: PdfWriter, att: dict[str, Any]) -> None:
    name = att.get("file_name") or "archivo"
    data = att.get("bytes")
    if data is None:
        msg = att.get("error") or "Adjunto no disponible (Dropbox)"
        _append_placeholder_page(writer, name, msg)
        return

    if _is_pdf(att.get("mime_type"), name):
        try:
            reader = PdfReader(io.BytesIO(data))
            for page in reader.pages:
                writer.add_page(page)
            return
        except Exception as exc:
            log.warning(
                "voucher_pdf.bad_pdf_attachment",
                extra={"file": name, "err": str(exc)},
            )
            _append_placeholder_page(
                writer, name, f"PDF corrupto, no se pudo incrustar: {exc}"
            )
            return

    if _is_image(att.get("mime_type"), name):
        img_pdf = _image_bytes_to_pdf_page(data, name)
        if img_pdf is not None:
            reader = PdfReader(io.BytesIO(img_pdf))
            for page in reader.pages:
                writer.add_page(page)
            return
        _append_placeholder_page(
            writer, name, "La imagen no se pudo convertir a PDF"
        )
        return

    # Other formats — placeholder
    ext = _file_ext(name) or "?"
    _append_placeholder_page(
        writer,
        name,
        f"Archivo .{ext} no se puede embedir — descargá desde el enlace en el sistema.",
    )


def _image_bytes_to_pdf_page(data: bytes, name: str) -> bytes | None:
    """Renderiza una imagen como página A4 con aspecto preservado, centrada."""
    try:
        from PIL import Image as PILImage
    except Exception as exc:
        log.warning("voucher_pdf.pillow_missing", extra={"err": str(exc)})
        return None
    try:
        with PILImage.open(io.BytesIO(data)) as img:
            # Normalize to RGB for JPEGs/RGBA/PNG with alpha
            if img.mode in ("RGBA", "P", "LA"):
                bg = PILImage.new("RGB", img.size, (255, 255, 255))
                if img.mode == "RGBA":
                    bg.paste(img, mask=img.split()[3])
                else:
                    bg.paste(img.convert("RGBA"),
                             mask=img.convert("RGBA").split()[3])
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
            iw, ih = img.size
    except Exception as exc:
        log.warning(
            "voucher_pdf.image_open_failed",
            extra={"file": name, "err": str(exc)},
        )
        return None

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    avail_w = PAGE_W - 20 * mm
    avail_h = PAGE_H - 24 * mm
    scale = min(avail_w / iw, avail_h / ih)
    draw_w, draw_h = iw * scale, ih * scale
    x = (PAGE_W - draw_w) / 2
    y = (PAGE_H - draw_h) / 2
    try:
        c.drawImage(
            _to_imagereader(data),
            x, y,
            width=draw_w,
            height=draw_h,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception as exc:
        log.warning(
            "voucher_pdf.image_draw_failed",
            extra={"file": name, "err": str(exc)},
        )
        return None

    # Caption
    c.setFont("Helvetica", 7)
    c.setFillColor(CEHTA_GREY)
    c.drawCentredString(PAGE_W / 2, 12 * mm, _truncate(name, 100))
    c.showPage()
    c.save()
    return buf.getvalue()


def _append_placeholder_page(writer: PdfWriter, name: str, message: str) -> None:
    """Página simple con título del adjunto y mensaje explicativo."""
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setStrokeColor(CEHTA_GREEN)
    c.setLineWidth(2)
    c.line(MARGIN_L, PAGE_H - MARGIN_T, PAGE_W - MARGIN_R, PAGE_H - MARGIN_T)

    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(CEHTA_GREEN_DARK)
    c.drawString(MARGIN_L, PAGE_H - MARGIN_T - 8 * mm, "Adjunto")

    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(colors.black)
    c.drawString(MARGIN_L, PAGE_H - MARGIN_T - 18 * mm, _truncate(name, 80))

    c.setFont("Helvetica", 10)
    c.setFillColor(CEHTA_GREY)
    # Word-wrap message
    line_y = PAGE_H - MARGIN_T - 30 * mm
    for chunk in _wrap_text(message, 90):
        c.drawString(MARGIN_L, line_y, chunk)
        line_y -= 5 * mm

    c.setFont("Helvetica-Oblique", 8)
    c.setFillColor(CEHTA_GREY)
    c.drawString(
        MARGIN_L,
        MARGIN_B,
        "Cehta Capital · página de marcador de adjunto",
    )
    c.showPage()
    c.save()
    reader = PdfReader(io.BytesIO(buf.getvalue()))
    for page in reader.pages:
        writer.add_page(page)


def _wrap_text(s: str, width: int) -> list[str]:
    out: list[str] = []
    line = ""
    for word in str(s).split():
        candidate = (line + " " + word).strip()
        if len(candidate) > width and line:
            out.append(line)
            line = word
        else:
            line = candidate
    if line:
        out.append(line)
    return out
