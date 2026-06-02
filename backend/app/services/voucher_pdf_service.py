"""Servicio de generación de PDFs de Vouchers (cover branded + attachments merged).

Genera un PDF "bundle" por voucher:
  1. Cover PDF (1-3 páginas) con branding de la empresa y todo el detalle:
     header, info grid, glosa, tabla de líneas, totales, approvals, footer.
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
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
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
                       fecha_vencimiento, source, created_at, threshold_aplicado
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
                       tipo_imputacion
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
        log.warning("voucher_pdf.approvals_unavailable", extra={"err": str(exc)})
        await db.rollback()

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


async def _try_fetch_logo(db: AsyncSession, empresa: dict[str, Any]) -> bytes | None:
    """Intenta obtener el logo. Soporta dos fuentes:
       1. URL http(s)://... — descarga directa (R152AAAA: logos servidos
          desde frontend/public/logos/ via Vercel).
       2. Path Dropbox /Cehta Capital/... — vía API Dropbox.

    Falla silenciosamente devolviendo None — el PDF se genera sin logo.
    """
    path = empresa.get("logo_dropbox_path")
    if not path:
        path = _LOGO_FALLBACK_PATH_TPL.format(empresa=empresa.get("codigo") or "")

    # R152AAAA — soporte URL HTTP(s) (frontend static logos)
    if path.startswith("http://") or path.startswith("https://"):
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                r = await client.get(path)
                if r.status_code == 200:
                    return r.content
                log.info(
                    "voucher_pdf.logo_http_non_200",
                    extra={"url": path, "status": r.status_code},
                )
                return None
        except Exception as exc:
            log.info(
                "voucher_pdf.logo_http_failed",
                extra={"url": path, "err": str(exc)},
            )
            return None

    # Path Dropbox tradicional
    dbx = await _get_dropbox_or_none(db)
    if dbx is None:
        return None
    try:
        return await asyncio.to_thread(dbx.download_file, path)
    except Exception as exc:
        log.info(
            "voucher_pdf.logo_fetch_failed",
            extra={"path": path, "err": str(exc)},
        )
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


def _is_nubox_voucher(voucher: dict[str, Any]) -> bool:
    return (voucher.get("source") or "").lower() == "nubox_form"


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
    nubox = _is_nubox_voucher(voucher)
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

    # Lines table
    story.append(Paragraph(
        "DETALLE FINANCIERO / CONTABLE" if nubox else "IMPUTACIÓN CONTABLE",
        section,
    ))
    moneda = voucher.get("moneda") or "CLP"
    lines_tbl = _build_lines_table(lines, moneda, nubox=nubox)
    story.append(lines_tbl)
    story.append(Spacer(1, 3 * mm))

    # Totals box
    story.append(_build_totals_table(voucher, lines, moneda, nubox=nubox))

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


def _build_lines_table(
    lines: list[dict], moneda: str, *, nubox: bool
) -> Table:
    """Tabla de líneas con header en cehta-green, alternancia de filas, total."""
    styles = getSampleStyleSheet()
    cell = ParagraphStyle(
        "Cell", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=colors.black,
    )
    cell_mono = ParagraphStyle(
        "CellMono", parent=cell, fontName="Courier", fontSize=8,
    )
    if nubox:
        header = ["#", "Cuenta", "Descripción", "Neto", "IVA", "Total"]
    else:
        header = ["#", "Cuenta", "Descripción", "Debe", "Haber"]

    rows: list[list[Any]] = [header]
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    total_neto = Decimal("0")
    total_iva = Decimal("0")

    for ln in lines:
        debit = Decimal(str(ln.get("debit") or 0))
        credit = Decimal(str(ln.get("credit") or 0))
        neto = Decimal(str(ln.get("neto_amount") or 0))
        iva = Decimal(str(ln.get("iva_amount") or 0))
        total_debit += debit
        total_credit += credit
        total_neto += neto
        total_iva += iva

        desc_parts = []
        if ln.get("cuenta_nombre"):
            desc_parts.append(_esc(ln["cuenta_nombre"]))
        if ln.get("descripcion"):
            desc_parts.append(f"<font color='#6b7280'>{_esc(ln['descripcion'])}</font>")
        desc_html = "<br/>".join(desc_parts) or "—"

        if nubox:
            total_line = debit + credit  # bruto approx
            rows.append([
                Paragraph(str(ln.get("line_number", "")), cell),
                Paragraph(_esc(ln.get("cuenta_codigo") or ""), cell_mono),
                Paragraph(desc_html, cell),
                Paragraph(_fmt_money(neto, moneda) if neto else "—", cell),
                Paragraph(_fmt_money(iva, moneda) if iva else "—", cell),
                Paragraph(_fmt_money(total_line, moneda) if total_line else "—", cell),
            ])
        else:
            rows.append([
                Paragraph(str(ln.get("line_number", "")), cell),
                Paragraph(_esc(ln.get("cuenta_codigo") or ""), cell_mono),
                Paragraph(desc_html, cell),
                Paragraph(_fmt_money(debit, moneda) if debit else "—", cell),
                Paragraph(_fmt_money(credit, moneda) if credit else "—", cell),
            ])

    # Total row
    if nubox:
        rows.append([
            "",
            "",
            Paragraph("<b>TOTAL</b>", cell),
            Paragraph(f"<b>{_fmt_money(total_neto, moneda)}</b>", cell),
            Paragraph(f"<b>{_fmt_money(total_iva, moneda)}</b>", cell),
            Paragraph(
                f"<b>{_fmt_money(total_neto + total_iva, moneda)}</b>", cell
            ),
        ])
    else:
        rows.append([
            "",
            "",
            Paragraph("<b>TOTAL</b>", cell),
            Paragraph(f"<b>{_fmt_money(total_debit, moneda)}</b>", cell),
            Paragraph(f"<b>{_fmt_money(total_credit, moneda)}</b>", cell),
        ])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    if nubox:
        col_widths = [
            content_w * 0.05, content_w * 0.13, content_w * 0.42,
            content_w * 0.13, content_w * 0.13, content_w * 0.14,
        ]
    else:
        col_widths = [
            content_w * 0.05, content_w * 0.15, content_w * 0.50,
            content_w * 0.15, content_w * 0.15,
        ]

    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    style: list[Any] = [
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (0, 0), "CENTER"),
        ("ALIGN", (-3, 0), (-1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        # Body
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("ALIGN", (-3, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
        ("GRID", (0, 0), (-1, -2), 0.25, CEHTA_BORDER),
        # Total row
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.black),
        ("FONTNAME", (-3, -1), (-1, -1), "Helvetica-Bold"),
        ("TOPPADDING", (0, -1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 4),
    ]
    # Alternating rows
    for i in range(1, len(rows) - 1):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), CEHTA_ROW_ALT))
    tbl.setStyle(TableStyle(style))
    return tbl


def _build_totals_table(
    voucher: dict, lines: list[dict], moneda: str, *, nubox: bool
) -> Table:
    """Caja de totales con sumas y diferencia (14pt en montos)."""
    styles = getSampleStyleSheet()
    total_label = ParagraphStyle(
        "TotLabel", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=CEHTA_GREY, alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )
    total_value = ParagraphStyle(
        "TotValue", parent=styles["Normal"], fontSize=14, leading=18,
        textColor=colors.black, alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )
    total_diff_value_ok = ParagraphStyle(
        "TotDiffOk", parent=total_value, textColor=CEHTA_GREEN_DARK,
    )
    total_diff_value_bad = ParagraphStyle(
        "TotDiffBad", parent=total_value, textColor=HexColor("#991b1b"),
    )

    if nubox:
        total_contable = sum(
            (Decimal(str(ln.get("neto_amount") or 0)) for ln in lines),
            start=Decimal("0"),
        )
        total_financiera = sum(
            (Decimal(str(ln.get("debit") or 0)) + Decimal(str(ln.get("credit") or 0))
             for ln in lines),
            start=Decimal("0"),
        )
        diff = total_contable - total_financiera
        labels = ["Σ CONTABLE", "Σ FINANCIERA", "DIFERENCIA"]
        amounts = [total_contable, total_financiera, diff]
    else:
        total_debit = Decimal(str(voucher.get("total_debit") or 0))
        total_credit = Decimal(str(voucher.get("total_credit") or 0))
        # Recompute from lines for safety
        sum_d = sum(
            (Decimal(str(ln.get("debit") or 0)) for ln in lines),
            start=Decimal("0"),
        )
        sum_c = sum(
            (Decimal(str(ln.get("credit") or 0)) for ln in lines),
            start=Decimal("0"),
        )
        if total_debit == 0 and sum_d > 0:
            total_debit = sum_d
        if total_credit == 0 and sum_c > 0:
            total_credit = sum_c
        diff = total_debit - total_credit
        labels = ["Σ DEBE", "Σ HABER", "DIFERENCIA"]
        amounts = [total_debit, total_credit, diff]

    diff_style = total_diff_value_ok if diff == 0 else total_diff_value_bad
    val_paragraphs = [
        Paragraph(_fmt_money(amounts[0], moneda), total_value),
        Paragraph(_fmt_money(amounts[1], moneda), total_value),
        Paragraph(_fmt_money(amounts[2], moneda), diff_style),
    ]
    label_paragraphs = [Paragraph(lbl, total_label) for lbl in labels]

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_w = content_w / 3
    tbl = Table(
        [label_paragraphs, val_paragraphs],
        colWidths=[col_w, col_w, col_w],
    )
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, CEHTA_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ]))
    return KeepTogether([Spacer(1, 2 * mm), tbl])


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
