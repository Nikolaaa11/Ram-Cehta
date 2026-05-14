"""Servicio de generación de PDF de Informes LP (V4 fase 9.x).

Genera un PDF "press kit" para mandar a inversores institucionales con
branding profesional FIP CEHTA ESG:

  - Header band con razón social del fondo + RUT (logo opcional).
  - Cover con título, período y destinatario.
  - Caja "Tus datos" del LP (nombre, % participación, capital comprometido).
  - Caja "Métricas del fondo" (NAV, IRR neto, MOIC, distribuciones LTD).
  - Resumen ejecutivo + secciones narrativas (performance, holdings,
    ESG, outlook, próximos hitos, CTA).
  - Tablas con estética cehta-green (mismo lenguaje visual que voucher PDF).
  - Footer "Confidencial · página X de N" en cada página.

Robustez:
  - Si faltan campos del schema (`informe.secciones[...]` no tiene tal key),
    se renderiza placeholder elegante "Datos en preparación" en vez de crashear.
  - Pillow + reportlab + pypdf ya están como dependencies.
  - reportlab es sync → siempre llamar `generate_informe_lp_pdf` con `await`
    (internamente usa `asyncio.to_thread`).
"""
from __future__ import annotations

import asyncio
import io
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.repositories.informe_lp_repository import (
    InformeLpRepository,
    LpRepository,
)
from app.models.informe_lp import InformeLp
from app.models.lp import Lp

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Branding constants (mirror de voucher_pdf_service para coherencia visual)
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

# Datos del fondo. En el futuro vendrá de core.fondos cuando esté linkeado
# al InformeLp (V5 — Sprint 3+). Por ahora hardcoded — es el fondo principal.
FONDO_RAZON_SOCIAL = "FIP CEHTA ESG"
FONDO_RUT = "77.751.766-K"
FONDO_TAGLINE = "Cehta Capital · Inversión ESG en Energía Renovable"


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


async def generate_informe_lp_pdf(
    informe_id: int,
    db: AsyncSession,
) -> bytes:
    """Renderiza el PDF del Informe LP. Devuelve bytes listos para streamear.

    Levanta `ValueError("Informe ... no encontrado")` si el id no existe.
    Cualquier otro error de renderizado propaga al caller (que debería
    convertirlo en 500).
    """
    data = await _fetch_informe_bundle(db, informe_id)
    if data is None:
        raise ValueError(f"Informe {informe_id} no encontrado")

    pdf_bytes = await asyncio.to_thread(_build_informe_pdf, data)
    return pdf_bytes


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


async def _fetch_informe_bundle(
    db: AsyncSession, informe_id: int
) -> dict[str, Any] | None:
    """Carga informe + lp asociado en pocas queries."""
    repo = InformeLpRepository(db)
    informe: InformeLp | None = await repo.get(informe_id)
    if informe is None:
        return None

    lp: Lp | None = None
    if informe.lp_id is not None:
        lp = await LpRepository(db).get(informe.lp_id)

    return {
        "informe": informe,
        "lp": lp,
    }


# ---------------------------------------------------------------------------
# Helpers comunes
# ---------------------------------------------------------------------------


def _esc(value: Any) -> str:
    """Escape para Paragraph reportlab — escapa &, <, >."""
    if value is None:
        return ""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _fmt_money_clp(value: Any) -> str:
    if value is None:
        return "Datos en preparación"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    n = int(d.quantize(Decimal("1")))
    return f"${n:,}".replace(",", ".")


def _fmt_pct(value: Any, decimals: int = 2) -> str:
    if value is None:
        return "—"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    return f"{d:,.{decimals}f}%".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_multiple(value: Any) -> str:
    if value is None:
        return "—"
    try:
        d = Decimal(str(value))
    except Exception:
        return str(value)
    return f"{d:,.2f}x"


def _fmt_date(value: Any) -> str:
    if value is None:
        return "—"
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _safe_get(
    secciones: dict[str, Any] | None,
    *keys: str,
    default: Any = None,
) -> Any:
    """Lookup defensivo en `informe.secciones` con path de keys.

    `_safe_get(secciones, "performance", "payload", "kpis_snapshot")`
    devuelve `default` si en cualquier nivel el path no existe.
    """
    cur: Any = secciones or {}
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


# ---------------------------------------------------------------------------
# Doc template con header + footer (con número de página total)
# ---------------------------------------------------------------------------


class _InformeLpDoc(BaseDocTemplate):
    """Doc con onPage callback que dibuja header band y footer.

    Usa onLaterPages igual que onFirstPage para mantener layout consistente.
    El "página X de N" requiere two-pass: en la primera pasada acumulamos
    `_page_count`, en la segunda lo usamos.
    """

    def __init__(
        self,
        buf: io.BytesIO,
        *,
        titulo: str,
        periodo: str | None,
    ) -> None:
        super().__init__(
            buf,
            pagesize=A4,
            leftMargin=MARGIN_L,
            rightMargin=MARGIN_R,
            topMargin=MARGIN_T + HEADER_BAND_H,
            bottomMargin=MARGIN_B + 12 * mm,
            title=titulo,
            author="Cehta Capital · FIP CEHTA ESG",
        )
        self._periodo = periodo
        self._page_count_estimate = 0
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="content",
            showBoundary=0,
        )
        tpl = PageTemplate(
            id="informe_lp",
            frames=[frame],
            onPage=self._draw_chrome,
        )
        self.addPageTemplates([tpl])

    def _draw_chrome(
        self, canv: rl_canvas.Canvas, doc: BaseDocTemplate
    ) -> None:
        _draw_header(canv)
        _draw_footer(canv, doc.page, total_pages=self._page_count_estimate)


def _draw_header(canv: rl_canvas.Canvas) -> None:
    """Header band: 'FIP CEHTA ESG' + RUT + border cehta-green."""
    top_y = PAGE_H - MARGIN_T
    band_bottom = top_y - HEADER_BAND_H

    canv.saveState()
    canv.setFillColor(colors.white)
    canv.rect(
        MARGIN_L, band_bottom,
        PAGE_W - MARGIN_L - MARGIN_R, HEADER_BAND_H,
        stroke=0, fill=1,
    )

    # Left: "CEHTA" big mark (logo placeholder textual)
    canv.setFillColor(CEHTA_GREEN)
    canv.setFont("Helvetica-Bold", 20)
    canv.drawString(
        MARGIN_L,
        band_bottom + HEADER_BAND_H / 2 - 2 * mm,
        "CEHTA",
    )

    # Right: razón social + RUT
    right_x = PAGE_W - MARGIN_R
    y = top_y - 6 * mm
    canv.setFillColor(colors.black)
    canv.setFont("Helvetica-Bold", 13)
    canv.drawRightString(right_x, y, FONDO_RAZON_SOCIAL)
    y -= 5 * mm
    canv.setFont("Helvetica", 9)
    canv.drawRightString(right_x, y, f"RUT {FONDO_RUT}")
    y -= 4 * mm
    canv.setFillColor(CEHTA_GREY)
    canv.setFont("Helvetica", 8)
    canv.drawRightString(right_x, y, FONDO_TAGLINE)

    # Bottom border cehta-green 2pt
    canv.setStrokeColor(CEHTA_GREEN)
    canv.setLineWidth(2)
    canv.line(MARGIN_L, band_bottom, PAGE_W - MARGIN_R, band_bottom)
    canv.restoreState()


def _draw_footer(
    canv: rl_canvas.Canvas, page_num: int, *, total_pages: int = 0
) -> None:
    """Footer: Confidencial · página X de N · fecha · fondo."""
    canv.saveState()
    y = MARGIN_B - 2 * mm
    canv.setStrokeColor(CEHTA_BORDER)
    canv.setLineWidth(0.5)
    canv.line(MARGIN_L, y + 6 * mm, PAGE_W - MARGIN_R, y + 6 * mm)

    canv.setFont("Helvetica", 7)
    canv.setFillColor(CEHTA_GREY)
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    canv.drawString(MARGIN_L, y + 2 * mm, f"Confidencial · Generado {now}")

    page_str = (
        f"Página {page_num} de {total_pages}"
        if total_pages > 0
        else f"Página {page_num}"
    )
    canv.drawRightString(PAGE_W - MARGIN_R, y + 2 * mm, page_str)

    canv.setFillColor(CEHTA_GREEN_DARK)
    canv.setFont("Helvetica-Bold", 7)
    canv.drawCentredString(
        PAGE_W / 2, y - 1 * mm,
        f"{FONDO_RAZON_SOCIAL} · Cehta Capital",
    )
    canv.restoreState()


# ---------------------------------------------------------------------------
# PDF construction
# ---------------------------------------------------------------------------


def _build_informe_pdf(data: dict[str, Any]) -> bytes:
    """Renderiza el PDF. Two-pass para tener `página X de N` correctos."""
    informe: InformeLp = data["informe"]
    lp: Lp | None = data["lp"]

    # PASS 1 — build to count pages
    buf1 = io.BytesIO()
    doc1 = _InformeLpDoc(
        buf1, titulo=informe.titulo, periodo=informe.periodo,
    )
    story = _build_story(informe, lp)
    try:
        doc1.build(list(story))
        page_count = doc1.page
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "informe_lp_pdf.first_pass_failed",
            extra={"informe_id": informe.informe_id, "err": str(exc)},
        )
        page_count = 0

    # PASS 2 — render con total_pages conocido
    buf2 = io.BytesIO()
    doc2 = _InformeLpDoc(
        buf2, titulo=informe.titulo, periodo=informe.periodo,
    )
    doc2._page_count_estimate = page_count
    doc2.build(_build_story(informe, lp))
    return buf2.getvalue()


def _build_story(informe: InformeLp, lp: Lp | None) -> list[Any]:
    """Construye el `story` de Platypus flowables. Sin side effects."""
    styles = getSampleStyleSheet()

    h_title = ParagraphStyle(
        "ITitle", parent=styles["Heading1"],
        alignment=TA_CENTER, fontSize=22, leading=26,
        textColor=colors.black, spaceAfter=4,
        fontName="Helvetica-Bold",
    )
    h_sub = ParagraphStyle(
        "ISub", parent=styles["Normal"],
        alignment=TA_CENTER, fontSize=11, leading=14,
        fontName="Helvetica", textColor=CEHTA_GREY, spaceAfter=10,
    )
    h_destinatario = ParagraphStyle(
        "IDest", parent=styles["Normal"],
        alignment=TA_CENTER, fontSize=12, leading=15,
        fontName="Helvetica-Bold", textColor=CEHTA_GREEN_DARK, spaceAfter=20,
    )
    section_title = ParagraphStyle(
        "ISection", parent=styles["Heading2"],
        fontSize=13, textColor=CEHTA_GREEN_DARK,
        spaceBefore=10, spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    body = ParagraphStyle(
        "IBody", parent=styles["Normal"],
        fontSize=10, leading=14, textColor=colors.black,
        alignment=TA_JUSTIFY, spaceAfter=4,
    )
    box_label = ParagraphStyle(
        "IBoxLabel", parent=styles["Normal"],
        fontSize=8, textColor=CEHTA_GREY,
        fontName="Helvetica-Bold", spaceAfter=2,
    )
    box_value = ParagraphStyle(
        "IBoxValue", parent=styles["Normal"],
        fontSize=11, textColor=colors.black,
        fontName="Helvetica", spaceAfter=0,
    )
    box_title = ParagraphStyle(
        "IBoxTitle", parent=styles["Normal"],
        fontSize=10, textColor=CEHTA_GREEN_DARK,
        fontName="Helvetica-Bold", alignment=TA_LEFT, spaceAfter=4,
    )

    story: list[Any] = []

    # ===== Cover =====
    story.append(Paragraph("INFORME PARA LP", h_title))
    if informe.periodo:
        story.append(
            Paragraph(f"Período: {_esc(informe.periodo)}", h_sub)
        )
    if informe.titulo:
        story.append(Paragraph(_esc(informe.titulo), h_sub))

    destinatario_nombre = _lp_full_name(lp) or "Inversionista"
    story.append(
        Paragraph(f"Destinatario: {_esc(destinatario_nombre)}", h_destinatario)
    )

    # ===== Caja "Tus datos" =====
    story.append(_lp_data_box(lp, box_title, box_label, box_value))
    story.append(Spacer(1, 4 * mm))

    # ===== Caja "Métricas del fondo" =====
    secciones = informe.secciones or {}
    metricas_box = _metricas_fondo_box(
        secciones, box_title, box_label, box_value
    )
    story.append(metricas_box)
    story.append(Spacer(1, 6 * mm))

    # ===== Resumen ejecutivo =====
    story.append(Paragraph("RESUMEN EJECUTIVO", section_title))
    resumen_text = _build_resumen_text(informe)
    story.append(Paragraph(resumen_text, body))

    # ===== Holdings (tabla) =====
    holdings_block = _holdings_block(secciones, section_title, body)
    if holdings_block is not None:
        story.append(Spacer(1, 4 * mm))
        story.extend(holdings_block)

    # ===== ESG Impact =====
    esg_block = _esg_block(secciones, section_title, body)
    if esg_block is not None:
        story.append(Spacer(1, 4 * mm))
        story.extend(esg_block)

    # ===== Próximos hitos =====
    hitos_block = _hitos_block(secciones, section_title, body)
    if hitos_block is not None:
        story.append(Spacer(1, 4 * mm))
        story.extend(hitos_block)

    # ===== CTA (call-to-action) =====
    cta_block = _cta_block(secciones, section_title, body)
    if cta_block is not None:
        story.append(Spacer(1, 4 * mm))
        story.extend(cta_block)

    return story


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------


def _lp_full_name(lp: Lp | None) -> str | None:
    if lp is None:
        return None
    parts = [lp.nombre]
    if lp.apellido:
        parts.append(lp.apellido)
    return " ".join(p for p in parts if p).strip() or None


def _lp_data_box(
    lp: Lp | None,
    title_style: ParagraphStyle,
    label_style: ParagraphStyle,
    value_style: ParagraphStyle,
) -> Table:
    """Caja con datos del LP — nombre, email, empresa, aportes."""
    nombre = _lp_full_name(lp) or "Datos en preparación"
    email = (lp.email if lp else None) or "—"
    empresa = (lp.empresa if lp else None) or "—"
    aporte_total = (
        _fmt_money_clp(lp.aporte_total) if lp and lp.aporte_total else "Datos en preparación"
    )
    aporte_actual = (
        _fmt_money_clp(lp.aporte_actual) if lp and lp.aporte_actual else "—"
    )

    # % participación estimado simple: aporte_actual / aporte_total
    pct_str = "—"
    if lp and lp.aporte_total and lp.aporte_actual:
        try:
            pct = (Decimal(str(lp.aporte_actual)) / Decimal(str(lp.aporte_total))) * 100
            pct_str = _fmt_pct(pct)
        except Exception:
            pct_str = "—"

    title = Paragraph("TUS DATOS", title_style)
    rows: list[list[Any]] = [
        [title, ""],
        [
            Paragraph("NOMBRE", label_style),
            Paragraph("EMAIL", label_style),
        ],
        [
            Paragraph(_esc(nombre), value_style),
            Paragraph(_esc(email), value_style),
        ],
        [
            Paragraph("EMPRESA / ROL", label_style),
            Paragraph("% PARTICIPACIÓN ESTIMADA", label_style),
        ],
        [
            Paragraph(_esc(empresa), value_style),
            Paragraph(_esc(pct_str), value_style),
        ],
        [
            Paragraph("CAPITAL COMPROMETIDO", label_style),
            Paragraph("CAPITAL APORTADO", label_style),
        ],
        [
            Paragraph(_esc(aporte_total), value_style),
            Paragraph(_esc(aporte_actual), value_style),
        ],
    ]
    col_w = (PAGE_W - MARGIN_L - MARGIN_R) / 2
    tbl = Table(rows, colWidths=[col_w, col_w])
    tbl.setStyle(TableStyle([
        # Title row spans both cols
        ("SPAN", (0, 0), (1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_GREEN),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, CEHTA_GREEN),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return tbl


def _metricas_fondo_box(
    secciones: dict[str, Any] | None,
    title_style: ParagraphStyle,
    label_style: ParagraphStyle,
    value_style: ParagraphStyle,
) -> Table:
    """Caja con métricas del fondo (NAV, IRR, MOIC, distribuciones).

    Si los datos no están en `secciones["performance"]["payload"]`, usamos
    placeholders elegantes "Datos en preparación".
    """
    kpis = _safe_get(secciones, "performance", "payload", "kpis_snapshot") or {}

    # Best-effort mapeo desde el shape conocido (portfolio_kpis)
    nav_total = kpis.get("nav_total") or kpis.get("aum_total")
    irr_neto = kpis.get("irr_neto") or kpis.get("irr")
    moic = kpis.get("moic")
    distribuciones = kpis.get("distribuciones_ltd") or kpis.get("distribuciones")
    proyectos_total = kpis.get("proyectos_total")
    pct_avance_global = kpis.get("pct_avance_global")

    cell_value_strong = ParagraphStyle(
        "MFValueStrong", parent=value_style,
        fontSize=14, leading=18, fontName="Helvetica-Bold",
        textColor=CEHTA_GREEN_DARK,
    )

    title = Paragraph("MÉTRICAS DEL FONDO", title_style)
    rows: list[list[Any]] = [
        [title, "", ""],
        [
            Paragraph("NAV TOTAL", label_style),
            Paragraph("IRR NETO", label_style),
            Paragraph("MOIC", label_style),
        ],
        [
            Paragraph(_esc(_fmt_money_clp(nav_total) if nav_total else "Datos en preparación"), cell_value_strong),
            Paragraph(_esc(_fmt_pct(irr_neto) if irr_neto is not None else "Datos en preparación"), cell_value_strong),
            Paragraph(_esc(_fmt_multiple(moic) if moic is not None else "Datos en preparación"), cell_value_strong),
        ],
        [
            Paragraph("DISTRIBUCIONES LTD", label_style),
            Paragraph("PROYECTOS ACTIVOS", label_style),
            Paragraph("AVANCE GLOBAL", label_style),
        ],
        [
            Paragraph(_esc(_fmt_money_clp(distribuciones) if distribuciones else "Datos en preparación"), value_style),
            Paragraph(_esc(str(proyectos_total) if proyectos_total is not None else "—"), value_style),
            Paragraph(_esc(_fmt_pct(pct_avance_global) if pct_avance_global is not None else "—"), value_style),
        ],
    ]
    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_w = content_w / 3
    tbl = Table(rows, colWidths=[col_w, col_w, col_w])
    tbl.setStyle(TableStyle([
        # Title row spans 3 cols
        ("SPAN", (0, 0), (2, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, CEHTA_GREEN_DARK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("LINEABOVE", (0, 1), (-1, 1), 0.25, CEHTA_BORDER),
        ("LINEABOVE", (0, 3), (-1, 3), 0.25, CEHTA_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    # Override title-row alignment
    tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
    ]))
    return tbl


def _build_resumen_text(informe: InformeLp) -> str:
    """Combina hero_titulo + hero_narrativa → párrafo de resumen ejecutivo."""
    parts: list[str] = []
    if informe.hero_titulo:
        parts.append(f"<b>{_esc(informe.hero_titulo)}</b>")
    if informe.hero_narrativa:
        parts.append(_esc(informe.hero_narrativa))
    if not parts:
        return (
            "Este informe está siendo preparado para vos. Volveremos pronto "
            "con los detalles del trimestre."
        )
    return "<br/><br/>".join(parts)


def _holdings_block(
    secciones: dict[str, Any] | None,
    section_style: ParagraphStyle,
    body_style: ParagraphStyle,
) -> list[Any] | None:
    """Bloque HOLDINGS — tabla con empresas del portafolio destacadas."""
    empresas_payload = _safe_get(secciones, "empresas", "payload") or {}
    destacadas: list[str] = empresas_payload.get("destacadas") or []
    datos: dict[str, dict[str, Any]] = empresas_payload.get("datos") or {}
    narrativas: dict[str, Any] = empresas_payload.get("narrativas") or {}

    if not destacadas:
        return None

    out: list[Any] = [Paragraph("HOLDINGS", section_style)]

    styles = getSampleStyleSheet()
    cell = ParagraphStyle(
        "HCell", parent=styles["Normal"], fontSize=8, leading=11,
        textColor=colors.black,
    )
    cell_strong = ParagraphStyle(
        "HCellStrong", parent=cell, fontName="Helvetica-Bold",
    )

    header = ["Empresa", "Estado", "Avance", "Comentario"]
    rows: list[list[Any]] = [header]
    for cod in destacadas:
        info = datos.get(cod) or {}
        narrativa = narrativas.get(cod) or {}
        nombre = info.get("razon_social") or cod
        estado = info.get("estado_proyecto") or info.get("status") or "—"
        avance_raw = info.get("pct_avance") or info.get("avance")
        avance = _fmt_pct(avance_raw) if avance_raw is not None else "—"
        comentario = (
            narrativa.get("highlight")
            or narrativa.get("comentario")
            or info.get("descripcion")
            or "Datos en preparación"
        )
        rows.append([
            Paragraph(_esc(nombre), cell_strong),
            Paragraph(_esc(estado), cell),
            Paragraph(_esc(avance), cell),
            Paragraph(_esc(_truncate(str(comentario), 200)), cell),
        ])

    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_widths = [
        content_w * 0.25, content_w * 0.18, content_w * 0.12, content_w * 0.45,
    ]
    tbl = Table(rows, colWidths=col_widths, repeatRows=1)
    style: list[Any] = [
        ("BACKGROUND", (0, 0), (-1, 0), CEHTA_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.25, CEHTA_BORDER),
    ]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), CEHTA_ROW_ALT))
    tbl.setStyle(TableStyle(style))
    out.append(tbl)
    return out


def _esg_block(
    secciones: dict[str, Any] | None,
    section_style: ParagraphStyle,
    body_style: ParagraphStyle,
) -> list[Any] | None:
    """Bloque ESG IMPACT — métricas de impacto + narrativa."""
    payload = _safe_get(secciones, "esg_impact", "payload")
    if not payload:
        return None

    co2 = payload.get("co2_evitado_tons")
    mw = payload.get("mw_renovables")
    hogares = payload.get("hogares_equivalentes")
    empleos = payload.get("empleos_creados")
    narrativa = payload.get("narrativa")

    # Si todo es None y no hay narrativa, omitir
    if all(x is None for x in [co2, mw, hogares, empleos]) and not narrativa:
        return None

    out: list[Any] = [Paragraph("IMPACTO ESG", section_style)]

    styles = getSampleStyleSheet()
    metric_label = ParagraphStyle(
        "EMLabel", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=CEHTA_GREY, alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )
    metric_value = ParagraphStyle(
        "EMValue", parent=styles["Normal"], fontSize=13, leading=16,
        textColor=CEHTA_GREEN_DARK, alignment=TA_CENTER,
        fontName="Helvetica-Bold",
    )

    def _v(x: Any) -> str:
        return str(x) if x is not None else "Datos en preparación"

    metrics: list[list[Any]] = [
        [
            Paragraph("CO₂ EVITADO (t)", metric_label),
            Paragraph("MW RENOVABLES", metric_label),
            Paragraph("HOGARES EQUIV.", metric_label),
            Paragraph("EMPLEOS CREADOS", metric_label),
        ],
        [
            Paragraph(_esc(_v(co2)), metric_value),
            Paragraph(_esc(_v(mw)), metric_value),
            Paragraph(_esc(_v(hogares)), metric_value),
            Paragraph(_esc(_v(empleos)), metric_value),
        ],
    ]
    content_w = PAGE_W - MARGIN_L - MARGIN_R
    col_w = content_w / 4
    tbl = Table(metrics, colWidths=[col_w] * 4)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEHTA_LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, CEHTA_BORDER),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, CEHTA_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
    ]))
    out.append(tbl)
    if narrativa:
        out.append(Spacer(1, 3 * mm))
        out.append(Paragraph(_esc(narrativa), body_style))
    return out


def _hitos_block(
    secciones: dict[str, Any] | None,
    section_style: ParagraphStyle,
    body_style: ParagraphStyle,
) -> list[Any] | None:
    """Bloque PRÓXIMOS HITOS — bullets."""
    outlook = _safe_get(secciones, "outlook", "payload") or {}
    hitos = outlook.get("hitos_proximos") or outlook.get("hitos") or []

    if not hitos:
        # Mostrar el bloque igual con placeholder si hay horizonte definido
        if not outlook.get("horizonte_meses"):
            return None
        out: list[Any] = [Paragraph("PRÓXIMOS HITOS", section_style)]
        out.append(
            Paragraph(
                f"<i>Datos en preparación — horizonte planificado: "
                f"{_esc(outlook.get('horizonte_meses'))} meses.</i>",
                body_style,
            )
        )
        return out

    out: list[Any] = [Paragraph("PRÓXIMOS HITOS", section_style)]
    bullet_style = ParagraphStyle(
        "HitosBullet", parent=body_style,
        leftIndent=12, bulletIndent=2, spaceAfter=3, fontSize=10,
    )
    for h in hitos:
        if isinstance(h, dict):
            label = h.get("titulo") or h.get("nombre") or h.get("descripcion") or ""
            when = h.get("fecha") or h.get("when")
            text_line = _esc(label)
            if when:
                text_line += f" <font color='#6b7280'>· {_esc(_fmt_date(when))}</font>"
        else:
            text_line = _esc(h)
        out.append(Paragraph(f"• {text_line}", bullet_style))
    return out


def _cta_block(
    secciones: dict[str, Any] | None,
    section_style: ParagraphStyle,
    body_style: ParagraphStyle,
) -> list[Any] | None:
    """Bloque CTA — call to action sutil al final."""
    cta = _safe_get(secciones, "cta", "payload")
    if not cta:
        return None

    principal = cta.get("cta_principal")
    sec1 = cta.get("cta_secundario_1")
    sec2 = cta.get("cta_secundario_2")

    items: list[str] = [x for x in [principal, sec1, sec2] if x]
    if not items:
        return None

    out: list[Any] = [Paragraph("PRÓXIMOS PASOS", section_style)]
    cta_style = ParagraphStyle(
        "CTAItem", parent=body_style,
        leftIndent=12, spaceAfter=3, fontSize=10,
        textColor=CEHTA_GREEN_DARK,
        fontName="Helvetica-Bold",
    )
    for it in items:
        out.append(Paragraph(f"→ {_esc(it)}", cta_style))
    return out


__all__ = ["generate_informe_lp_pdf"]
