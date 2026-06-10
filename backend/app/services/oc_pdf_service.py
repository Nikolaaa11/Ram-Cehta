"""Servicio de generación de PDFs de Órdenes de Compra (cover branded + attachments).

Genera un PDF profesional listo para enviar al proveedor:
  1. Cover PDF con branding de la empresa emisora — header con logo, título,
     ficha de proveedor, info grid, tabla de items, totales, observaciones,
     footer con firma.
  2. Si include_attachments=True y existe la tabla `core.oc_attachments`,
     descarga los adjuntos desde Dropbox y los concatena al PDF.

Espejo de `voucher_pdf_service.py` — reusa helpers compartidos para Dropbox,
fetch de logo, attachment merge, placeholder pages e image-to-pdf.

Robustez:
  - Errores fetching del logo o attachments NUNCA tumban el PDF (fallback
    a texto o placeholder).
  - Si la tabla `oc_attachments` no existe, simplemente devuelve el cover.
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
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

# Reuse shared helpers from voucher_pdf_service to keep this module focused on
# OC-specific layout. These are private-but-stable in the same package.
from app.services.voucher_pdf_service import (  # noqa: PLC2701
    CEHTA_BORDER,
    CEHTA_GREEN,
    CEHTA_GREEN_DARK,
    CEHTA_GREY,
    CEHTA_LIGHT_GREY,
    CEHTA_ROW_ALT,
    HEADER_BAND_H,
    MARGIN_B,
    MARGIN_L,
    MARGIN_R,
    MARGIN_T,
    PAGE_H,
    PAGE_W,
    _draw_status_watermark,
    _esc,
    _fetch_attachment_bytes,
    _merge_cover_with_attachments,
    _to_imagereader,
    _truncate,
    _try_fetch_logo,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# OC-specific branding
# ---------------------------------------------------------------------------

AMBER_50 = HexColor("#fffbeb")
AMBER_200 = HexColor("#fde68a")
AMBER_700 = HexColor("#b45309")

_OC_ESTADO_COLORS: dict[str, tuple[str, str]] = {
    "emitida": ("#dbeafe", "#1e3a8a"),
    "aprobada": ("#dcfce7", "#166534"),
    "parcial": ("#fef3c7", "#92400e"),
    "pagada": ("#dcfce7", "#166534"),
    "cerrada": ("#e5e7eb", "#374151"),
    "rechazada": ("#fee2e2", "#991b1b"),
    "anulada": ("#fee2e2", "#991b1b"),
}

_MONEDA_SYMBOLS: dict[str, str] = {
    "CLP": "$",
    "USD": "US$",
    "EUR": "€",
    "UF": "UF ",
    "CLF": "UF ",
}


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


async def generate_oc_pdf_bundle(
    oc_id: int,
    db: AsyncSession,
    include_attachments: bool = True,
    generated_by_email: str | None = None,
) -> bytes:
    """Genera el PDF: cover branded + (opcional) attachments mergeados.

    Round 14 — acepta `generated_by_email` para footer notarial.

    Raises:
        ValueError: si la OC no existe.
    """
    data = await _fetch_oc_bundle_data(db, oc_id)
    if data is None:
        raise ValueError(f"OC {oc_id} no encontrada")
    data["generated_by_email"] = generated_by_email
    # Round 21 — URL QR de verificación.
    try:
        from app.core.config import settings
        base = (settings.frontend_url or "").rstrip("/")
        if base:
            data["verify_url"] = f"{base}/ordenes-compra/{oc_id}"
    except Exception:  # noqa: BLE001
        pass

    logo_bytes = await _try_fetch_logo(db, data["empresa"])
    cover_bytes = await asyncio.to_thread(_build_cover_pdf, data, logo_bytes)

    if not include_attachments or not data["attachments"]:
        return cover_bytes

    attachment_payloads = await _fetch_attachment_bytes(db, data["attachments"])
    merged = await asyncio.to_thread(
        _merge_cover_with_attachments, cover_bytes, attachment_payloads
    )
    return merged


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


async def _fetch_oc_bundle_data(
    db: AsyncSession, oc_id: int
) -> dict[str, Any] | None:
    """Carga OC + items + empresa + proveedor + (best-effort) attachments."""
    oc_row = (
        await db.execute(
            text(
                """
                SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                       fecha_emision, validez_dias, moneda, neto, iva, total,
                       forma_pago, plazo_pago, observaciones, estado,
                       pdf_url, created_at
                FROM core.ordenes_compra
                WHERE oc_id = :id
                """
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    if oc_row is None:
        return None
    oc = dict(oc_row)

    # R152www — intentamos primero la query enriquecida (con campos nuevos).
    # Si la migración no fue aplicada todavía, hace fallback a la query base
    # SIN tumbar el PDF.
    empresa_row = None
    try:
        empresa_row = (
            await db.execute(
                text(
                    """
                    SELECT codigo, razon_social, rut, giro, direccion, ciudad,
                           telefono, logo_dropbox_path,
                           gerente_general_nombre, gerente_general_cargo,
                           gerente_general_email,
                           oc_firma_colectiva,
                           COALESCE(firmantes_extra, '[]'::jsonb) AS firmantes_extra,
                           oc_color_primario
                    FROM core.empresas
                    WHERE codigo = :c
                    """
                ),
                {"c": oc["empresa_codigo"]},
            )
        ).mappings().first()
    except Exception as exc:
        log.info(
            "oc_pdf.empresa_enhanced_select_failed_fallback",
            extra={"err": str(exc), "empresa": oc["empresa_codigo"]},
        )
        # Fallback a query base
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
                {"c": oc["empresa_codigo"]},
            )
        ).mappings().first()

    empresa = dict(empresa_row) if empresa_row else {}
    # Garantizar defaults para campos nuevos (por si la migración no corrió)
    empresa.setdefault("codigo", oc["empresa_codigo"])
    empresa.setdefault("razon_social", oc["empresa_codigo"])
    empresa.setdefault("rut", None)
    empresa.setdefault("direccion", None)
    empresa.setdefault("ciudad", None)
    empresa.setdefault("telefono", None)
    empresa.setdefault("logo_dropbox_path", None)
    empresa.setdefault("gerente_general_nombre", None)
    empresa.setdefault("gerente_general_cargo", "Gerente General")
    empresa.setdefault("gerente_general_email", None)
    empresa.setdefault("oc_firma_colectiva", False)
    empresa.setdefault("firmantes_extra", [])
    empresa.setdefault("oc_color_primario", "#236C4F")

    proveedor: dict[str, Any] | None = None
    if oc.get("proveedor_id"):
        prov_row = (
            await db.execute(
                text(
                    """
                    SELECT proveedor_id, razon_social, rut, giro, direccion,
                           ciudad, contacto, telefono, email
                    FROM core.proveedores
                    WHERE proveedor_id = :pid
                    """
                ),
                {"pid": oc["proveedor_id"]},
            )
        ).mappings().first()
        if prov_row:
            proveedor = dict(prov_row)

    item_rows = (
        await db.execute(
            text(
                """
                SELECT item, descripcion, precio_unitario, cantidad, total_linea
                FROM core.ordenes_compra_detalle
                WHERE oc_id = :id
                ORDER BY item
                """
            ),
            {"id": oc_id},
        )
    ).mappings().all()
    items = [dict(r) for r in item_rows]

    # Attachments — best-effort (tabla puede no existir).
    attachments: list[dict[str, Any]] = []
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT attachment_id, file_name, dropbox_path,
                           mime_type, size_bytes
                    FROM core.oc_attachments
                    WHERE oc_id = :id
                    ORDER BY created_at
                    """
                ),
                {"id": oc_id},
            )
        ).mappings().all()
        attachments = [dict(r) for r in rows]
    except Exception as exc:
        # R152SSSSS — Soft-fail aceptable: los adjuntos físicos se envían
        # como anexos separados al email. El PDF sin la sección "Anexos"
        # no es engañoso (a diferencia de las firmas en voucher_pdf).
        # Pero subimos de info a warning para que sea visible en Sentry.
        log.warning(
            "oc_pdf.attachments_unavailable",
            extra={"oc_id": oc_id, "err": str(exc)},
        )
        with contextlib.suppress(Exception):
            await db.rollback()

    return {
        "oc": oc,
        "empresa": empresa,
        "proveedor": proveedor,
        "items": items,
        "attachments": attachments,
    }


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def _moneda_symbol(moneda: str | None) -> str:
    return _MONEDA_SYMBOLS.get(
        (moneda or "CLP").upper(), (moneda or "CLP") + " "
    )


def _decimals_for(moneda: str | None) -> int:
    return 0 if (moneda or "CLP").upper() == "CLP" else 2


def _fmt_money_oc(value: Any, moneda: str = "CLP") -> str:
    """Format con símbolo de moneda. CLP = sin decimales, USD/EUR = 2 decimales."""
    if value is None:
        return "—"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    decimals = _decimals_for(moneda)
    symbol = _moneda_symbol(moneda)
    if decimals == 0:
        n = int(d.quantize(Decimal("1")))
        return f"{symbol}{n:,}".replace(",", ".")
    return f"{symbol}{d:,.{decimals}f}"


def _fmt_number(value: Any, decimals: int = 2) -> str:
    """Formato cantidad sin símbolo, stripping trailing zeros."""
    if value is None:
        return "—"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    if decimals == 0:
        return f"{int(d.quantize(Decimal('1'))):,}".replace(",", ".")
    fixed = f"{d:,.{decimals}f}"
    if "." in fixed:
        fixed = fixed.rstrip("0").rstrip(".")
    return fixed or "0"


def _fmt_date_dmy(value: Any) -> str:
    if value is None:
        return "—"
    if hasattr(value, "strftime"):
        return value.strftime("%d/%m/%Y")
    return str(value)


# ---------------------------------------------------------------------------
# Doc template (custom header/footer chrome para OC)
# ---------------------------------------------------------------------------


class _OcCoverDoc(BaseDocTemplate):
    def __init__(
        self,
        buf: io.BytesIO,
        *,
        empresa: dict[str, Any],
        oc: dict[str, Any],
        logo_bytes: bytes | None,
        generated_by_email: str | None = None,
        verify_url: str | None = None,
    ) -> None:
        super().__init__(
            buf,
            pagesize=A4,
            leftMargin=MARGIN_L,
            rightMargin=MARGIN_R,
            topMargin=MARGIN_T + HEADER_BAND_H,
            bottomMargin=MARGIN_B + 12 * mm,
            title=f"OC {oc.get('numero_oc', '')}",
            author="Cehta Capital",
        )
        self._empresa = empresa
        self._oc = oc
        self._logo_bytes = logo_bytes
        self._generated_by_email = generated_by_email
        # Round 21 — pre-generamos PNG QR una vez por instancia.
        self._verify_url = verify_url
        self._qr_png: bytes | None = None
        if verify_url:
            try:
                from app.services.pdf_qr_util import qr_png_bytes
                self._qr_png = qr_png_bytes(verify_url)
            except Exception:  # noqa: BLE001
                self._qr_png = None
        frame = Frame(
            self.leftMargin, self.bottomMargin, self.width, self.height,
            id="content", showBoundary=0,
        )
        self.addPageTemplates([PageTemplate(
            id="cover", frames=[frame], onPage=self._draw_chrome,
        )])

    def _draw_chrome(
        self, canv: rl_canvas.Canvas, doc: BaseDocTemplate
    ) -> None:
        # QA Round 8 — watermark diagonal por estado OC critico.
        # Mapeo OC.estado (lowercase) -> status standard del watermark.
        _OC_ESTADO_WATERMARK_MAP = {
            "anulada": "VOID",
            "rechazada": "REJECTED",
            "borrador": "DRAFT",
        }
        oc_estado = (self._oc.get("estado") or "").lower()
        mapped = _OC_ESTADO_WATERMARK_MAP.get(oc_estado)
        if mapped:
            _draw_status_watermark(canv, mapped)
        _draw_oc_header(canv, self._empresa, self._logo_bytes)
        _draw_oc_footer(
            canv, doc.page, self._empresa, self._generated_by_email,
            qr_png=self._qr_png,
        )


def _draw_oc_header(
    canv: rl_canvas.Canvas, empresa: dict[str, Any], logo_bytes: bytes | None
) -> None:
    top_y = PAGE_H - MARGIN_T
    band_bottom = top_y - HEADER_BAND_H
    canv.saveState()
    canv.setFillColor(colors.white)
    canv.rect(
        MARGIN_L, band_bottom, PAGE_W - MARGIN_L - MARGIN_R,
        HEADER_BAND_H, stroke=0, fill=1,
    )

    drawn = False
    if logo_bytes:
        try:
            reader = _to_imagereader(logo_bytes)
            iw, ih = reader.getSize()
            scale = min((40 * mm) / iw, (HEADER_BAND_H - 6 * mm) / ih)
            draw_w, draw_h = iw * scale, ih * scale
            canv.drawImage(
                reader, MARGIN_L,
                band_bottom + (HEADER_BAND_H - draw_h) / 2,
                width=draw_w, height=draw_h,
                preserveAspectRatio=True, mask="auto",
            )
            drawn = True
        except Exception as exc:
            log.info("oc_pdf.logo_draw_failed", extra={"err": str(exc)})
    if not drawn:
        canv.setFillColor(CEHTA_GREEN)
        canv.setFont("Helvetica-Bold", 20)
        canv.drawString(
            MARGIN_L, band_bottom + HEADER_BAND_H / 2 - 2 * mm,
            str(empresa.get("codigo") or "—"),
        )

    right_x = PAGE_W - MARGIN_R
    y = top_y - 6 * mm
    canv.setFillColor(colors.black)
    canv.setFont("Helvetica-Bold", 16)
    canv.drawRightString(
        right_x, y, _truncate(empresa.get("razon_social") or "", 55)
    )
    y -= 5 * mm
    canv.setFont("Helvetica", 10)
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

    canv.setStrokeColor(CEHTA_GREEN)
    canv.setLineWidth(2)
    canv.line(MARGIN_L, band_bottom, PAGE_W - MARGIN_R, band_bottom)
    canv.restoreState()


def _draw_oc_footer(
    canv: rl_canvas.Canvas,
    page_num: int,
    empresa: dict[str, Any],
    generated_by_email: str | None = None,
    qr_png: bytes | None = None,
) -> None:
    """Round 14 — footer notarial OC con email del user.

    Mismo patron que voucher_pdf_service._draw_footer pero scoped a OC
    (centro muestra razon_social de la empresa + Cehta Capital brand).

    Round 21 — QR opcional en esquina sup-derecha del footer (solo page 1).
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
    canv.drawCentredString(
        PAGE_W / 2, y - 1 * mm,
        f"Cehta Capital · {_truncate(empresa.get('razon_social') or '', 60)}",
    )

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


# ---------------------------------------------------------------------------
# Cover content
# ---------------------------------------------------------------------------


def _build_cover_pdf(
    data: dict[str, Any], logo_bytes: bytes | None
) -> bytes:
    oc = data["oc"]
    empresa = data["empresa"]
    proveedor = data["proveedor"]
    items = data["items"]
    moneda = (oc.get("moneda") or "CLP").upper()
    # Round 14 — email del user que genero el PDF (forensic footer).
    generated_by_email = data.get("generated_by_email")
    # Round 21 — URL para QR de verificación (opcional).
    verify_url = data.get("verify_url")

    buf = io.BytesIO()
    doc = _OcCoverDoc(
        buf,
        empresa=empresa,
        oc=oc,
        logo_bytes=logo_bytes,
        generated_by_email=generated_by_email,
        verify_url=verify_url,
    )

    styles = getSampleStyleSheet()
    s_title = ParagraphStyle(
        "OcTitle", parent=styles["Heading1"],
        alignment=TA_CENTER, fontSize=22, leading=26,
        textColor=colors.black, spaceAfter=2, fontName="Helvetica-Bold",
    )
    s_numero = ParagraphStyle(
        "OcNumero", parent=styles["Normal"],
        alignment=TA_CENTER, fontSize=13, leading=16,
        fontName="Courier-Bold", textColor=CEHTA_GREEN_DARK, spaceAfter=4,
    )
    s_label = ParagraphStyle(
        "Label", parent=styles["Normal"],
        fontSize=7, textColor=CEHTA_GREY,
        fontName="Helvetica-Bold", spaceAfter=2,
    )
    s_value = ParagraphStyle(
        "Value", parent=styles["Normal"],
        fontSize=10, textColor=colors.black, spaceAfter=0,
    )
    s_section = ParagraphStyle(
        "Section", parent=styles["Heading3"],
        fontSize=10, textColor=CEHTA_GREEN_DARK, spaceBefore=8, spaceAfter=4,
        fontName="Helvetica-Bold",
    )
    s_small_caps = ParagraphStyle(
        "SmallCaps", parent=styles["Normal"],
        fontSize=8, textColor=AMBER_700, spaceAfter=2,
        fontName="Helvetica-Bold",
    )
    s_prov_name = ParagraphStyle(
        "ProvName", parent=styles["Normal"],
        fontSize=14, leading=18, textColor=colors.black,
        fontName="Helvetica-Bold",
    )
    s_prov_meta = ParagraphStyle(
        "ProvMeta", parent=styles["Normal"],
        fontSize=10, leading=13, textColor=CEHTA_GREY,
    )
    s_obs = ParagraphStyle(
        "Obs", parent=styles["Normal"],
        fontSize=10, leading=13, textColor=colors.black,
    )
    s_footer_note = ParagraphStyle(
        "FooterNote", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=CEHTA_GREY, alignment=TA_LEFT,
    )
    s_sig_center = ParagraphStyle(
        "SigCenter", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=colors.black, alignment=TA_CENTER,
    )

    story: list[Any] = []

    # Title + numero
    story.append(Paragraph("ORDEN DE COMPRA", s_title))
    story.append(Paragraph(f"N° {_esc(oc.get('numero_oc') or '')}", s_numero))

    # Estado chip
    estado_str = (oc.get("estado") or "").lower()
    bg_hex, fg_hex = _OC_ESTADO_COLORS.get(estado_str, ("#e5e7eb", "#374151"))
    badge = Table(
        [[Paragraph(
            f"<font color='{fg_hex}'><b>{_esc(estado_str.upper())}</b></font>",
            s_value,
        )]],
        colWidths=[35 * mm], rowHeights=[7 * mm], hAlign="CENTER",
    )
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor(bg_hex)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 0.5, HexColor(bg_hex)),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(badge)
    story.append(Spacer(1, 5 * mm))

    # Proveedor box
    story.append(_build_proveedor_box(
        proveedor, s_small_caps, s_prov_name, s_prov_meta
    ))
    story.append(Spacer(1, 4 * mm))

    # Info grid
    story.append(_build_info_grid(oc, s_label, s_value))
    story.append(Spacer(1, 5 * mm))

    # Items table
    story.append(Paragraph("DETALLE DE ITEMS", s_section))
    story.append(_build_items_table(items, moneda))
    story.append(Spacer(1, 3 * mm))

    # Totals
    story.append(_build_totals_box(oc, moneda))

    # Observaciones
    obs = (oc.get("observaciones") or "").strip()
    if obs:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph("OBSERVACIONES", s_section))
        obs_tbl = Table(
            [[Paragraph(_esc(obs), s_obs)]],
            colWidths=[PAGE_W - MARGIN_L - MARGIN_R],
        )
        obs_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
            ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(obs_tbl)

    # Validez + signature
    story.append(Spacer(1, 8 * mm))
    validez = oc.get("validez_dias") or 30
    story.append(Paragraph(
        f"Esta orden de compra es válida por <b>{validez} días</b> desde "
        f"la fecha de emisión.",
        s_footer_note,
    ))
    story.append(Spacer(1, 14 * mm))

    # R152www — bloque de firma branded por empresa.
    #   - Empresas normales: 1 firma (GG, nombre + cargo + razón social).
    #   - Empresas con oc_firma_colectiva=TRUE (RHO): N firmas apiladas en
    #     una grilla 2 columnas, una por cada integrante en firmantes_extra.
    sig_story = _build_signature_block(empresa, s_sig_center)
    story.append(KeepTogether(sig_story))

    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# R152www — Signature block (single GG vs collective RHO)
# ---------------------------------------------------------------------------


def _build_signature_block(
    empresa: dict[str, Any], s_sig_center: ParagraphStyle
) -> Table:
    """Construye el bloque de firma del cover.

    - Default (oc_firma_colectiva=False): 1 firma con nombre+cargo del GG.
    - Colectiva (RHO): grilla con TODAS las firmas de firmantes_extra.
    """
    razon_social = _esc(empresa.get("razon_social") or "")
    es_colectiva = bool(empresa.get("oc_firma_colectiva"))

    if not es_colectiva:
        # Firma única — GG
        nombre = _esc(empresa.get("gerente_general_nombre") or "")
        cargo = _esc(empresa.get("gerente_general_cargo") or "Gerente General")
        # Si no hay nombre cargado, mostrar placeholder con leyenda
        nombre_o_placeholder = (
            f"<b>{nombre}</b>" if nombre else "<i>(Cargar GG en /admin/empresas)</i>"
        )
        return Table(
            [
                [Paragraph("________________________________", s_sig_center)],
                [Paragraph(nombre_o_placeholder, s_sig_center)],
                [Paragraph(cargo, s_sig_center)],
                [Paragraph(razon_social, s_sig_center)],
            ],
            colWidths=[PAGE_W - MARGIN_L - MARGIN_R],
            style=TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]),
        )

    # Firma colectiva — RHO. Renderiza grilla de N firmas en 2 columnas.
    firmantes_raw = empresa.get("firmantes_extra") or []
    # firmantes_extra puede venir como list (de psycopg) o str JSON
    if isinstance(firmantes_raw, str):
        import json as _json
        try:
            firmantes_raw = _json.loads(firmantes_raw)
        except Exception:
            firmantes_raw = []

    if not firmantes_raw:
        # Empresa marcada colectiva pero sin firmantes — placeholder genérico
        return Table(
            [
                [Paragraph("________________________________", s_sig_center)],
                [Paragraph(
                    "<i>(Configurar firmantes en /admin/empresas)</i>",
                    s_sig_center,
                )],
                [Paragraph(razon_social, s_sig_center)],
            ],
            colWidths=[PAGE_W - MARGIN_L - MARGIN_R],
            style=TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]),
        )

    # Construir grilla 2-col con N firmantes. Si impar, último ocupa una sola.
    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_w = (content_w - 6 * mm) / 2

    def _firma_cell(f: dict) -> list:
        nombre = _esc(f.get("nombre") or "")
        cargo = _esc(f.get("cargo") or "")
        return [
            Paragraph("__________________________", s_sig_center),
            Paragraph(
                f"<b>{nombre}</b>" if nombre else "<i>(nombre pendiente)</i>",
                s_sig_center,
            ),
            Paragraph(cargo if cargo else "&nbsp;", s_sig_center),
        ]

    # Renderizamos cada firma como sub-Table apilada y luego las
    # agrupamos en filas de 2 cells (col izquierda + col derecha).
    sub_tables = [
        Table([[p] for p in _firma_cell(f)], colWidths=[col_w],
              style=TableStyle([
                  ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                  ("TOPPADDING", (0, 0), (-1, -1), 1),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
              ]))
        for f in firmantes_raw
    ]

    rows = []
    for i in range(0, len(sub_tables), 2):
        row = [sub_tables[i], sub_tables[i + 1] if i + 1 < len(sub_tables) else ""]
        rows.append(row)
    # Footer común con razón social
    razon_p = Paragraph(
        f"<b>{razon_social}</b> · Firma colectiva", s_sig_center
    )

    grid = Table(
        rows + [["", ""], [razon_p, ""]],
        colWidths=[col_w, col_w],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            # razón social spans 2 cols
            ("SPAN", (0, -1), (1, -1)),
            ("ALIGN", (0, -1), (-1, -1), "CENTER"),
        ]),
    )
    return grid


def _build_proveedor_box(
    proveedor: dict[str, Any] | None,
    s_caps: ParagraphStyle,
    s_name: ParagraphStyle,
    s_meta: ParagraphStyle,
) -> Table:
    content_w = PAGE_W - MARGIN_L - MARGIN_R
    title_p = Paragraph("PROVEEDOR", s_caps)
    if proveedor is None:
        cells: list[list[Any]] = [
            [title_p],
            [Paragraph("<i>Sin proveedor asignado</i>", s_meta)],
        ]
    else:
        meta_parts: list[str] = []
        if proveedor.get("rut"):
            meta_parts.append(f"RUT {_esc(proveedor['rut'])}")
        if proveedor.get("email"):
            meta_parts.append(_esc(proveedor["email"]))
        if proveedor.get("telefono"):
            meta_parts.append(_esc(proveedor["telefono"]))
        meta_html = " · ".join(meta_parts) if meta_parts else "—"
        addr_parts: list[str] = []
        if proveedor.get("direccion"):
            addr_parts.append(_esc(proveedor["direccion"]))
        if proveedor.get("ciudad"):
            addr_parts.append(_esc(proveedor["ciudad"]))
        addr_html = ", ".join(addr_parts) if addr_parts else ""
        cells = [
            [title_p],
            [Paragraph(
                _esc(proveedor.get("razon_social") or "—"), s_name
            )],
            [Paragraph(meta_html, s_meta)],
        ]
        if addr_html:
            cells.append([Paragraph(addr_html, s_meta)])

    tbl = Table(cells, colWidths=[content_w])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), AMBER_50),
        ("BOX", (0, 0), (-1, -1), 0.75, AMBER_200),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
    ]))
    return tbl


def _build_info_grid(
    oc: dict[str, Any],
    s_label: ParagraphStyle,
    s_value: ParagraphStyle,
) -> Table:
    pairs: list[tuple[str, str, str, str]] = [
        ("FECHA EMISIÓN", _fmt_date_dmy(oc.get("fecha_emision")),
         "VALIDEZ", f"{oc.get('validez_dias') or 30} días"),
        ("MONEDA", (oc.get("moneda") or "CLP").upper(),
         "FORMA DE PAGO", oc.get("forma_pago") or "—"),
        ("PLAZO DE PAGO", oc.get("plazo_pago") or "—", "", ""),
    ]
    rows: list[list[Any]] = []
    for l1, v1, l2, v2 in pairs:
        rows.append([
            Paragraph(l1, s_label) if l1 else "",
            Paragraph(l2, s_label) if l2 else "",
        ])
        rows.append([
            Paragraph(_esc(v1), s_value) if v1 else "",
            Paragraph(_esc(v2), s_value) if v2 else "",
        ])
    col_w = (PAGE_W - MARGIN_L - MARGIN_R) / 2
    tbl = Table(rows, colWidths=[col_w, col_w])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 1), (-1, 1), 0.25, CEHTA_BORDER),
        ("LINEBELOW", (0, 3), (-1, 3), 0.25, CEHTA_BORDER),
    ]))
    return tbl


def _build_items_table(items: list[dict[str, Any]], moneda: str) -> Table:
    styles = getSampleStyleSheet()
    cell = ParagraphStyle(
        "ICell", parent=styles["Normal"], fontSize=9, leading=11,
        textColor=colors.black,
    )
    cell_r = ParagraphStyle("ICellR", parent=cell, alignment=TA_RIGHT)

    rows: list[list[Any]] = [
        ["#", "Descripción", "Cantidad", "Precio unitario", "Total línea"]
    ]
    for it in items:
        cantidad = it.get("cantidad")
        precio = it.get("precio_unitario")
        total_l = it.get("total_linea")
        if total_l is None and cantidad is not None and precio is not None:
            try:
                total_l = Decimal(str(cantidad)) * Decimal(str(precio))
            except Exception:
                total_l = None
        rows.append([
            Paragraph(str(it.get("item", "")), cell),
            Paragraph(_esc(it.get("descripcion") or ""), cell),
            Paragraph(_fmt_number(cantidad, decimals=2), cell_r),
            Paragraph(_fmt_money_oc(precio, moneda), cell_r),
            Paragraph(_fmt_money_oc(total_l, moneda), cell_r),
        ])
    if not items:
        rows.append(["", Paragraph("<i>Sin items</i>", cell), "", "", ""])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_widths = [
        content_w * 0.06, content_w * 0.44, content_w * 0.13,
        content_w * 0.18, content_w * 0.19,
    ]
    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    style: list[Any] = [
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (0, 0), "CENTER"),
        ("ALIGN", (2, 0), (-1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.25, CEHTA_BORDER),
    ]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), CEHTA_ROW_ALT))
    tbl.setStyle(TableStyle(style))
    return tbl


def _build_totals_box(oc: dict[str, Any], moneda: str) -> Table:
    """Caja totales alineada a la derecha, con TOTAL bold/14pt."""
    styles = getSampleStyleSheet()
    s_lbl = ParagraphStyle(
        "TotLbl", parent=styles["Normal"], fontSize=9, leading=12,
        textColor=CEHTA_GREY, alignment=TA_RIGHT,
    )
    s_val = ParagraphStyle(
        "TotVal", parent=styles["Normal"], fontSize=10, leading=12,
        textColor=colors.black, alignment=TA_RIGHT,
    )
    s_big_lbl = ParagraphStyle(
        "BigLbl", parent=styles["Normal"], fontSize=11, leading=14,
        textColor=CEHTA_GREEN_DARK, alignment=TA_RIGHT,
        fontName="Helvetica-Bold",
    )
    s_big_val = ParagraphStyle(
        "BigVal", parent=styles["Normal"], fontSize=14, leading=16,
        textColor=colors.black, alignment=TA_RIGHT,
        fontName="Helvetica-Bold",
    )

    neto = Decimal(str(oc.get("neto") or 0))
    iva = Decimal(str(oc.get("iva") or 0))
    total = Decimal(str(oc.get("total") or 0))

    rows: list[list[Any]] = [[
        Paragraph("Subtotal (Neto)", s_lbl),
        Paragraph(_fmt_money_oc(neto, moneda), s_val),
    ]]
    if iva > 0:
        rows.append([
            Paragraph("IVA 19%", s_lbl),
            Paragraph(_fmt_money_oc(iva, moneda), s_val),
        ])
    rows.append([
        Paragraph("TOTAL", s_big_lbl),
        Paragraph(_fmt_money_oc(total, moneda), s_big_val),
    ])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    box_w = 80 * mm
    inner = Table(rows, colWidths=[box_w * 0.45, box_w * 0.55])
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, CEHTA_GREEN_DARK),
        ("TOPPADDING", (0, -1), (-1, -1), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
    ]))
    outer = Table(
        [["", inner]],
        colWidths=[content_w - box_w, box_w],
    )
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer
