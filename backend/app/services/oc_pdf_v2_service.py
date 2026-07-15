"""R152QQQQ · Generador PDF de OC v2 — HTML + CSS + WeasyPrint.

Reemplazo del `oc_pdf_service.py` reportlab actual. Usa templates HTML+CSS
print-first (mismos que `oc-pagos-platform`, la plataforma hermana del
equipo) renderizados via Jinja2 + WeasyPrint.

Por qué v2:
  - reportlab dibujaba programmatically, sin paridad visual con el diseño
    canónico que ya tenía oc-pagos-platform.
  - HTML+CSS @page print-first es mantenible: el diseñador edita CSS, no
    código Python.
  - WeasyPrint corre Python puro con libpango/libcairo (deps de sistema
    livianas en Docker, +30 MB total). Sin necesidad de Chromium headless.

Feature flag:
  Settings.oc_pdf_renderer = "v1" (reportlab, default) | "v2" (este).
  El endpoint /api/v1/ordenes-compra/{id}/pdf despacha según ese valor.

Robustez:
  - Logo: best-effort fetch desde core.empresas.logo_dropbox_path. Si falla
    o no existe, fallback a logo local en backend/app/templates/oc/logos/
    {codigo}.{png|jpg}. Si tampoco, placeholder con iniciales.
  - Color por empresa: lee core.empresas.oc_color_primario o usa fallback
    institucional por código (mismo mapping que el script local del cliente).
  - Adjuntos: se mergean al cover con el helper compartido de voucher_pdf.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rutas + entorno Jinja
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "oc"
_DOCUMENTS_DIR = _TEMPLATES_DIR / "documents"
_LOGOS_DIR = _TEMPLATES_DIR / "logos"

_env = Environment(
    loader=FileSystemLoader(str(_DOCUMENTS_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


# ---------------------------------------------------------------------------
# Color institucional por empresa (fallback si la empresa no tiene
# oc_color_primario seteado en BD). Mismos colores que usa el cliente en su
# script local de muestras (_render_local.py · COLOR_OVERRIDES).
# ---------------------------------------------------------------------------

_COLOR_FALLBACK: dict[str, str] = {
    "DTE":       "#0A3A6B",
    "EVOQUE":    "#1858D0",
    "TRONGKAI":  "#2E7D32",
    "CSL":       "#059669",
    "RHO":       "#1E40AF",
    "REVTECH":   "#D97706",
    "CENERGY":   "#0F3D6E",
    "AFIS":      "#1F2937",
    "FIP_CEHTA": "#0A1628",
    "CEHTA":     "#0A1628",
}

# Logo local por empresa (fallback si no hay logo_dropbox_path o falla fetch).
_LOGO_LOCAL: dict[str, str] = {
    "DTE":       "dte.png",
    "EVOQUE":    "evoque.png",
    "TRONGKAI":  "trongkai.png",
    "CSL":       "csl.png",
    "RHO":       "rho.png",
    "REVTECH":   "revtech.png",
    "CENERGY":   "cehta.png",   # CENERGY usa logo CEHTA por defecto
    "AFIS":      "afis.jpg",
    "FIP_CEHTA": "fip-cehta.png",
    "CEHTA":     "cehta.png",
}


# ---------------------------------------------------------------------------
# Helpers de formato
# ---------------------------------------------------------------------------

_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _fecha_larga(d: Any) -> str:
    if d is None:
        return "—"
    if isinstance(d, datetime):
        d = d.date()
    if not isinstance(d, date):
        return str(d)
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def _fmt_clp(monto: Any) -> str:
    if monto is None:
        return "$0"
    try:
        n = int(Decimal(str(monto)))
    except Exception:
        return str(monto)
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n):,}".replace(",", ".")


def _fmt_uf(monto: Any) -> str:
    if monto is None:
        return "UF 0"
    try:
        d = Decimal(str(monto)).quantize(Decimal("0.01"))
    except Exception:
        return str(monto)
    ent, dec = f"{d:.2f}".split(".")
    return f"UF {int(ent):,}".replace(",", ".") + f",{dec}"


def _fmt_usd(monto: Any) -> str:
    if monto is None:
        return "US$0"
    try:
        d = Decimal(str(monto)).quantize(Decimal("0.01"))
    except Exception:
        return str(monto)
    return f"US${d:,.2f}"


def _formatear_moneda(monto: Any, moneda: str = "CLP") -> str:
    """Función expuesta al template Jinja como `formatear_moneda(val, mon)`."""
    m = (moneda or "CLP").upper()
    if m == "CLP":
        return _fmt_clp(monto)
    if m == "UF" or m == "CLF":
        return _fmt_uf(monto)
    if m == "USD":
        return _fmt_usd(monto)
    return f"{m} {monto}"


def _logo_data_uri(empresa_codigo: str, logo_bytes: bytes | None) -> str:
    """Devuelve data URI del logo. Si no hay bytes, busca archivo local."""
    if logo_bytes:
        # Detección naive: PNG/JPG por magic bytes
        if logo_bytes[:4] == b"\x89PNG":
            mime = "image/png"
        elif logo_bytes[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        else:
            mime = "image/png"
        b64 = base64.b64encode(logo_bytes).decode("ascii")
        return f"data:{mime};base64,{b64}"

    # Fallback local
    fname = _LOGO_LOCAL.get(empresa_codigo.upper())
    if not fname:
        return ""
    path = _LOGOS_DIR / fname
    if not path.exists():
        return ""
    try:
        data = path.read_bytes()
        mime = "image/png" if fname.lower().endswith(".png") else "image/jpeg"
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"
    except Exception as exc:
        log.warning("oc_pdf_v2.local_logo_read_failed", extra={"err": str(exc)})
        return ""


def _qr_placeholder_svg() -> str:
    """SVG placeholder del QR (idéntico al usado por la otra plataforma).

    Cuando tengamos hash de verificación real, este reemplaza por un QR real
    via app.services.pdf_qr_util.qr_png_bytes.
    """
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
        '<rect width="40" height="40" fill="#FFFFFF"/>'
        '<g fill="#0F172A">'
        '<rect x="2" y="2" width="10" height="10"/>'
        '<rect x="4" y="4" width="6" height="6" fill="#FFFFFF"/>'
        '<rect x="5" y="5" width="4" height="4"/>'
        '<rect x="28" y="2" width="10" height="10"/>'
        '<rect x="30" y="4" width="6" height="6" fill="#FFFFFF"/>'
        '<rect x="31" y="5" width="4" height="4"/>'
        '<rect x="2" y="28" width="10" height="10"/>'
        '<rect x="4" y="30" width="6" height="6" fill="#FFFFFF"/>'
        '<rect x="5" y="31" width="4" height="4"/>'
        "</g></svg>"
    )
    return "data:image/svg+xml;utf8," + svg.replace('"', "'").replace("#", "%23")


# ---------------------------------------------------------------------------
# Data loading — mapea Ram-Cehta schema al contexto que esperan los templates
# ---------------------------------------------------------------------------


async def _load_context(
    db: AsyncSession,
    oc_id: int,
    generated_by_email: str | None,
) -> dict[str, Any] | None:
    """Carga OC + empresa + proveedor + items y arma el contexto Jinja."""

    # OC base
    oc_row = (
        await db.execute(
            text(
                """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                          fecha_emision, validez_dias, moneda, neto, iva, total,
                          forma_pago, plazo_pago, observaciones, estado
                   FROM core.ordenes_compra
                   WHERE oc_id = :id"""
            ),
            {"id": oc_id},
        )
    ).mappings().first()
    if oc_row is None:
        return None

    # Empresa (best-effort en columnas nuevas)
    empresa_row = None
    try:
        empresa_row = (
            await db.execute(
                text(
                    """SELECT codigo, razon_social, rut, giro, direccion, ciudad,
                              telefono, logo_dropbox_path,
                              gerente_general_nombre, gerente_general_cargo,
                              oc_color_primario,
                              oc_template, oc_firmantes
                       FROM core.empresas WHERE codigo = :c"""
                ),
                {"c": oc_row["empresa_codigo"]},
            )
        ).mappings().first()
    except Exception:
        with contextlib.suppress(Exception):
            await db.rollback()
        empresa_row = (
            await db.execute(
                text(
                    """SELECT codigo, razon_social, rut, giro, direccion, ciudad,
                              telefono, logo_dropbox_path
                       FROM core.empresas WHERE codigo = :c"""
                ),
                {"c": oc_row["empresa_codigo"]},
            )
        ).mappings().first()

    empresa = dict(empresa_row) if empresa_row else {}
    empresa.setdefault("codigo", oc_row["empresa_codigo"])
    empresa.setdefault("razon_social", oc_row["empresa_codigo"])
    empresa.setdefault("gerente_general_nombre", None)
    empresa.setdefault("gerente_general_cargo", "Gerente General")
    empresa.setdefault("oc_color_primario", None)
    empresa.setdefault("logo_dropbox_path", None)
    # R152MMMMMM — template por empresa ('default' | 'panimavida') y
    # firmantes JSONB [{nombre, cargo}, ...] para la página de firmas.
    empresa.setdefault("oc_template", None)
    empresa.setdefault("oc_firmantes", None)

    # Proveedor
    proveedor: dict[str, Any] = {}
    if oc_row.get("proveedor_id"):
        prov_row = (
            await db.execute(
                text(
                    """SELECT razon_social, rut, giro, direccion, ciudad,
                              contacto, telefono, email
                       FROM core.proveedores WHERE proveedor_id = :pid"""
                ),
                {"pid": oc_row["proveedor_id"]},
            )
        ).mappings().first()
        if prov_row:
            proveedor = dict(prov_row)
            # mapping a campos del template
            proveedor["contacto_nombre"] = proveedor.pop("contacto", None)
            proveedor["contacto_email"] = proveedor.pop("email", None)
            proveedor["contacto_telefono"] = proveedor.pop("telefono", None)

    # Items — R152MMMMMM: `unidad` (Mes/Aplic./Un./etc.) best-effort, la
    # columna llega con la migración round152MMMMMM. Fallback sin ella.
    try:
        items_rows = (
            await db.execute(
                text(
                    """SELECT item, descripcion, precio_unitario, cantidad,
                              total_linea, unidad
                       FROM core.ordenes_compra_detalle
                       WHERE oc_id = :id ORDER BY item"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
    except Exception:
        with contextlib.suppress(Exception):
            await db.rollback()
        items_rows = (
            await db.execute(
                text(
                    """SELECT item, descripcion, precio_unitario, cantidad,
                              total_linea
                       FROM core.ordenes_compra_detalle
                       WHERE oc_id = :id ORDER BY item"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
    items = []
    for r in items_rows:
        d = dict(r)
        items.append(
            type("OcItem", (), {
                "numero": d.get("item"),
                "articulo": (d.get("descripcion") or "").split("\n", 1)[0][:60] or "—",
                "descripcion": d.get("descripcion") or "",
                "precio_unitario": d.get("precio_unitario") or 0,
                "cantidad": d.get("cantidad") or 0,
                "total": d.get("total_linea") or (
                    (Decimal(str(d.get("precio_unitario") or 0)) *
                     Decimal(str(d.get("cantidad") or 0)))
                ),
                "plazo": None,
                "unidad": d.get("unidad"),
            })()
        )

    # Fetch logo (best-effort via Dropbox shared)
    logo_bytes = None
    try:
        from app.services.voucher_pdf_service import _try_fetch_logo  # type: ignore
        logo_bytes = await _try_fetch_logo(db, empresa)
    except Exception as exc:
        log.info("oc_pdf_v2.logo_fetch_failed", extra={"err": str(exc)})

    # Color: BD → fallback institucional → navy
    emp_codigo = (empresa.get("codigo") or "").upper()
    color_primario = (
        empresa.get("oc_color_primario")
        or _COLOR_FALLBACK.get(emp_codigo)
        or "#0A1628"
    )

    # Verify URL (mismo patrón que oc-pagos-platform)
    try:
        from app.core.config import settings
        base = (getattr(settings, "frontend_url", "") or "").rstrip("/")
        verify_url = f"{base}/ordenes-compra/{oc_id}" if base else f"/ordenes-compra/{oc_id}"
    except Exception:
        verify_url = f"/ordenes-compra/{oc_id}"

    # Modelo OC para el template (formato que espera orden_compra.html)
    moneda_str = (oc_row.get("moneda") or "CLP").upper()
    oc_ctx = type("OcCtx", (), {
        "numero": oc_row["numero_oc"],
        "fecha_emision": oc_row["fecha_emision"],
        "moneda": type("M", (), {"value": moneda_str})(),
        "forma_pago": oc_row.get("forma_pago"),
        "plazo_pago": oc_row.get("plazo_pago"),
        "plazo_entrega": None,
        "lugar_entrega": None,
        "garantia": None,
        "observaciones": oc_row.get("observaciones"),
        "gestiones_proveedor": None,
        "emails_documentacion": None,
        "emails_insumos": None,
        "total_neto": oc_row.get("neto") or 0,
        "iva": oc_row.get("iva") or 0,
        "total": oc_row.get("total") or 0,
        "estado": type("E", (), {"value": oc_row.get("estado") or "borrador"})(),
        "items": items,
    })()

    # Modelo Empresa para template
    emp_ctx = type("Emp", (), {
        "nombre_corto": empresa.get("codigo"),
        "razon_social": empresa.get("razon_social") or "",
        "rut": empresa.get("rut") or "",
        "giro": empresa.get("giro"),
        "direccion": empresa.get("direccion"),
        "ciudad": empresa.get("ciudad"),
        "telefono": empresa.get("telefono"),
        "email": None,
        "representante_legal": empresa.get("gerente_general_nombre"),
    })()

    # R152MMMMMM — firmantes para la página de firmas del template
    # panimavida. JSONB [{nombre, cargo}] en core.empresas.oc_firmantes.
    # Fallback: el GG de la empresa si no hay lista configurada.
    firmantes_raw = empresa.get("oc_firmantes")
    if isinstance(firmantes_raw, str):
        import json as _json
        with contextlib.suppress(Exception):
            firmantes_raw = _json.loads(firmantes_raw)
    firmantes = [
        f for f in (firmantes_raw or [])
        if isinstance(f, dict) and f.get("nombre")
    ]
    if not firmantes and empresa.get("gerente_general_nombre"):
        firmantes = [{
            "nombre": empresa["gerente_general_nombre"],
            "cargo": empresa.get("gerente_general_cargo") or "Gerente General",
        }]

    # MEGAPROMPT F3 — si la OC tiene firmantes REALES asignados
    # (core.oc_firmas), esos reemplazan a los genéricos del branding y las
    # firmas completadas se ESTAMPAN en el PDF: "Firmado electrónicamente"
    # + fecha/hora Chile + hash corto (trazable a core.oc_firmas.signature_hash).
    with contextlib.suppress(Exception):
        firmas_rows = (
            await db.execute(
                text(
                    """SELECT firmante_nombre, firmante_email, firmante_cargo,
                              status, signed_at, signature_hash
                       FROM core.oc_firmas
                       WHERE oc_id = :id AND status <> 'RECHAZADA'
                       ORDER BY orden, firma_id"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
        if firmas_rows:
            firmantes = []
            for fr in firmas_rows:
                item: dict[str, Any] = {
                    "nombre": fr["firmante_nombre"] or fr["firmante_email"],
                    "cargo": fr["firmante_cargo"] or "",
                }
                if fr["status"] == "FIRMADA" and fr["signed_at"]:
                    item["firmado_el"] = fr["signed_at"].strftime(
                        "%d/%m/%Y %H:%M UTC"
                    )
                    item["hash_corto"] = (fr["signature_hash"] or "")[:12]
                firmantes.append(item)

    # Modelo Proveedor para template
    prov_ctx = type("Prov", (), {
        "razon_social": proveedor.get("razon_social") or "Proveedor sin nombre",
        "rut": proveedor.get("rut") or "—",
        "giro": proveedor.get("giro"),
        "direccion": proveedor.get("direccion"),
        "ciudad": proveedor.get("ciudad"),
        "contacto_nombre": proveedor.get("contacto_nombre"),
        "contacto_email": proveedor.get("contacto_email"),
        "contacto_telefono": proveedor.get("contacto_telefono"),
    })()

    css_content = (_DOCUMENTS_DIR / "document.css").read_text(encoding="utf-8")

    return {
        "titulo": f"Orden de Compra {oc_ctx.numero}",
        "tipo_doc": "ORDEN DE COMPRA",
        "folio": oc_ctx.numero,
        "fecha_emision_larga": _fecha_larga(oc_ctx.fecha_emision),
        "estado": oc_ctx.estado.value,
        "color_primario": color_primario,
        "empresa": emp_ctx,
        "logo_data_uri": _logo_data_uri(emp_codigo, logo_bytes),
        "proveedor": prov_ctx,
        "cuenta": None,  # Ram-Cehta aún no tiene cuenta_bancaria_id en OC
        "tipo_cuenta_label": "Cuenta Corriente",
        "oc": oc_ctx,
        "formatear_moneda": _formatear_moneda,
        "qr_data_uri": _qr_placeholder_svg(),
        "verify_url": verify_url,
        "hash_verificacion": f"oc-{oc_id}-{generated_by_email or 'anon'}"[:60],
        "watermark": "MUESTRA" if oc_ctx.estado.value == "borrador" else None,
        "css": css_content,
        # R152MMMMMM — firmantes + template elegido por la empresa.
        "firmantes": firmantes,
        "_oc_template": (empresa.get("oc_template") or "default").lower(),
        # Pasamos también attachments para mergear después.
        "_oc_id": oc_id,
        "_empresa_codigo": emp_codigo,
    }


# ---------------------------------------------------------------------------
# Render HTML → PDF con WeasyPrint
# ---------------------------------------------------------------------------


def _render_html_to_pdf(html: str) -> bytes:
    """WeasyPrint render. Bloqueante — llamar via asyncio.to_thread."""
    # Import diferido: WeasyPrint carga libpango al importar, lento.
    from weasyprint import HTML  # type: ignore

    return HTML(string=html, base_url=str(_DOCUMENTS_DIR)).write_pdf()


async def _fetch_attachments(
    db: AsyncSession, oc_id: int
) -> list[dict[str, Any]]:
    """Lista adjuntos de core.oc_attachments para mergear al cover."""
    try:
        rows = (
            await db.execute(
                text(
                    """SELECT attachment_id, file_name, dropbox_path,
                              mime_type, size_bytes
                       FROM core.oc_attachments
                       WHERE oc_id = :id ORDER BY created_at"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        with contextlib.suppress(Exception):
            await db.rollback()
        return []


# ---------------------------------------------------------------------------
# Public entrypoint — interfaz idéntica a generate_oc_pdf_bundle v1
# ---------------------------------------------------------------------------


async def generate_oc_pdf_v2_bundle(
    oc_id: int,
    db: AsyncSession,
    include_attachments: bool = True,
    generated_by_email: str | None = None,
) -> bytes:
    """Genera el PDF v2 (HTML+CSS+WeasyPrint) + attachments mergeados."""
    ctx = await _load_context(db, oc_id, generated_by_email)
    if ctx is None:
        raise ValueError(f"OC {oc_id} no encontrada")

    # R152WWWWWW — el formato "panimavida" (carta formal PROVEEDOR/MANDANTE
    # + hoja de firmas) es ahora el ESTÁNDAR de TODAS las empresas. Cada una
    # con su propio logo y color (el template ya está parametrizado). El
    # grid institucional viejo (orden_compra.html) queda solo para quien
    # explícitamente setee oc_template='legacy'.
    template_name = (
        "orden_compra.html"
        if ctx.get("_oc_template") == "legacy"
        else "orden_compra_panimavida.html"
    )
    template = _env.get_template(template_name)
    html = template.render(**ctx)

    cover_bytes = await asyncio.to_thread(_render_html_to_pdf, html)

    if not include_attachments:
        return cover_bytes

    attachments_meta = await _fetch_attachments(db, oc_id)
    if not attachments_meta:
        return cover_bytes

    # Reusamos los helpers del voucher_pdf_service para mergear con
    # placeholder pages e image-to-pdf conversion.
    try:
        from app.services.voucher_pdf_service import (  # type: ignore
            _fetch_attachment_bytes,
            _merge_cover_with_attachments,
        )
        payloads = await _fetch_attachment_bytes(db, attachments_meta)
        merged = await asyncio.to_thread(
            _merge_cover_with_attachments, cover_bytes, payloads
        )
        return merged
    except Exception as exc:
        log.warning("oc_pdf_v2.merge_failed_returning_cover", extra={"err": str(exc)})
        return cover_bytes
