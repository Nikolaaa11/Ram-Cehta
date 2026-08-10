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
from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, Undefined, select_autoescape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rutas + entorno Jinja
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "oc"
_DOCUMENTS_DIR = _TEMPLATES_DIR / "documents"
_LOGOS_DIR = _TEMPLATES_DIR / "logos"
_FONTS_DIR = _TEMPLATES_DIR / "fonts"

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
    # Una variable que el contexto NO trajo llega acá como jinja2.Undefined.
    # Sin este guard, `Decimal(str(Undefined))` levanta, el except la
    # convierte en `str(Undefined)` == "" y la celda del importe sale VACÍA:
    # el PDF dice "LÍQUIDO A PAGAR" seguido de nada, y se emite igual.
    # En un documento de plata, un importe faltante tiene que reventar el
    # render, no imprimirse en blanco — un PDF que no sale se nota; una
    # franja vacía en la hoja 1 de una OC firmada, no siempre.
    if isinstance(monto, Undefined):
        raise ValueError(
            "_fmt_clp recibió una variable que el contexto del template no "
            "definió. Falta pasarla desde oc_pdf_v2_service."
        )
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


@lru_cache(maxsize=1)
def _firma_font_data_uri() -> str:
    """Data URI de la tipografía manuscrita de las firmas (Great Vibes, OFL).

    El contenedor de Fly no trae ninguna fuente cursiva instalada, así que
    va embebida en el repo y se inyecta al CSS como base64. Cacheado: son
    ~450 KB que se leen del disco una sola vez por proceso, no en cada PDF.

    Si el archivo faltara, devuelve "" y el template omite el @font-face:
    la firma cae a la cursiva genérica en vez de romper la generación.
    """
    try:
        raw = (_FONTS_DIR / "GreatVibes-Regular.ttf").read_bytes()
    except OSError:
        log.warning("oc_pdf_v2.firma_font_ausente")
        return ""
    return "data:font/truetype;base64," + base64.b64encode(raw).decode("ascii")


def _logo_raw_bytes(empresa_codigo: str, logo_bytes: bytes | None) -> bytes | None:
    """Bytes finales del logo: los de Dropbox o, si no hay, el archivo local.

    Se separó del data URI porque el encabezado del PDF necesita además las
    dimensiones en píxeles del archivo para calcular hasta dónde puede
    agrandarlo sin pixelarlo (ver `_logo_max_css`).
    """
    if logo_bytes:
        return logo_bytes
    fname = _LOGO_LOCAL.get(empresa_codigo.upper())
    if not fname:
        return None
    path = _LOGOS_DIR / fname
    if not path.exists():
        return None
    try:
        return path.read_bytes()
    except Exception as exc:
        log.warning("oc_pdf_v2.local_logo_read_failed", extra={"err": str(exc)})
        return None


def _logo_data_uri(raw: bytes | None) -> str:
    """Data URI del logo a partir de sus bytes. "" si no hay logo."""
    if not raw:
        return ""
    # Detección naive: PNG/JPG por magic bytes
    if raw[:4] == b"\x89PNG":
        mime = "image/png"
    elif raw[:3] == b"\xff\xd8\xff":
        mime = "image/jpeg"
    else:
        mime = "image/png"
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def _imagen_px(raw: bytes) -> tuple[int, int] | None:
    """(ancho, alto) en píxeles de un PNG o JPEG, leyendo sólo la cabecera.

    Sin Pillow a propósito: no es dependencia del backend y para esto alcanza
    con parsear la cabecera. PNG trae el tamaño fijo en el chunk IHDR; en JPEG
    hay que recorrer los marcadores hasta el SOFn. Devuelve None ante cualquier
    formato raro (SVG, WebP, archivo truncado) y el caller cae al tope de
    diseño, que es el comportamiento previo.
    """
    try:
        if raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[12:16] == b"IHDR":
            return (
                int.from_bytes(raw[16:20], "big"),
                int.from_bytes(raw[20:24], "big"),
            )
        if raw[:3] == b"\xff\xd8\xff":
            i, n = 2, len(raw)
            while i + 9 < n:
                if raw[i] != 0xFF:
                    i += 1
                    continue
                marker = raw[i + 1]
                # Marcadores sin payload (RSTn, SOI, TEM): no traen longitud.
                if marker in (0x01, 0xD8) or 0xD0 <= marker <= 0xD9:
                    i += 2
                    continue
                # SOS (0xDA) arranca los datos comprimidos: de ahí en adelante
                # los bytes NO son marcadores (hay byte-stuffing FF 00 y fill
                # bytes), así que seguir recorriendo lee longitudes basura y
                # puede aterrizar en un falso SOFn devolviendo un tamaño
                # inventado. En un JPEG bien formado el SOF siempre viene antes
                # del SOS, así que si llegamos acá el tamaño no está: cortamos.
                if marker == 0xDA:
                    return None
                seg_len = int.from_bytes(raw[i + 2:i + 4], "big")
                # SOF0..SOF15 llevan el tamaño real; DHT(C4)/JPG(C8)/DAC(CC) no.
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    alto = int.from_bytes(raw[i + 5:i + 7], "big")
                    ancho = int.from_bytes(raw[i + 7:i + 9], "big")
                    return (ancho, alto) if ancho and alto else None
                if seg_len < 2:
                    return None
                i += 2 + seg_len
    except Exception:
        return None
    return None


# Topes de DISEÑO del logo en el encabezado de la OC (ver el comentario largo
# en orden_compra_panimavida.html): 88mm de ancho = los ~100mm de la columna
# menos el canal de aire, 26mm de alto ≈ el alto natural del bloque de color.
_LOGO_MAX_W_MM = 88.0
_LOGO_MAX_H_MM = 26.0

# Topes HISTÓRICOS (los que rigieron hasta este cambio). Actúan como PISO: el
# recorte por resolución de abajo nunca puede dejar un logo más chico de lo que
# ya venía imprimiéndose. Sin este piso, un logo de pocos píxeles —por ejemplo
# uno subido a mano desde /admin/empresas, que es de dónde sale `logo_bytes` en
# producción vía empresas.logo_dropbox_path— pasaría a imprimirse hasta un 45%
# más chico que hoy, en silencio y para una sola empresa. Achicar el logo es
# exactamente lo contrario de lo que se pidió; preferimos conservar el tamaño
# actual aunque ese archivo puntual siga viéndose con la misma nitidez de
# siempre, y reservar la mejora para los logos que sí tienen píxeles de sobra.
_LOGO_PREV_W_MM = 62.0
_LOGO_PREV_H_MM = 22.0

# Piso de resolución efectiva para AGRANDAR. Estirar un logo más allá de esto
# lo deja borroso en papel y "se ve mal" igual que si estuviera chico. 175 DPI
# es el punto en que afis.jpg (110x153px, el único archivo de baja resolución
# de las 10 empresas) conserva los ~22mm de alto que ya venía imprimiendo, en
# vez de subir a 26mm y perder nitidez. Todos los demás logos pasan holgados y
# quedan con el tope de diseño.
_LOGO_MIN_DPI = 175.0


def _logo_max_css(raw: bytes | None) -> str:
    """Declaraciones `max-width`/`max-height` del logo del encabezado.

    Se arma en Python y NO interpolando campos en el <style> del template: el
    Environment tiene autoescape para .html y el contenido de <style> es
    raw-text, así que las entidades no se decodificarían. Acá el string sale
    de dos floats formateados por nosotros, no de datos de usuario, y el
    template lo inyecta con `|safe`.

    El tope queda acotado entre dos referencias, y ese doble borde es lo que
    hace que el cambio sólo pueda mejorar:
      · PISO  = el tope histórico (62x22mm). Nunca imprimimos más chico que
        antes, aunque al archivo le falten píxeles.
      · TECHO = el tope de diseño (88x26mm), y sólo se llega si el archivo
        tiene resolución para sostenerlo a `_LOGO_MIN_DPI`.
    Como se fijan sólo los máximos, el motor escala proporcionalmente y el
    logo nunca se deforma, sea cual sea su ratio.
    """
    ancho_mm, alto_mm = _LOGO_MAX_W_MM, _LOGO_MAX_H_MM
    px = _imagen_px(raw) if raw else None
    if px:
        px_w, px_h = px
        if px_w > 0 and px_h > 0:
            ancho_mm = min(ancho_mm, max(_LOGO_PREV_W_MM, px_w * 25.4 / _LOGO_MIN_DPI))
            alto_mm = min(alto_mm, max(_LOGO_PREV_H_MM, px_h * 25.4 / _LOGO_MIN_DPI))
    return f"max-width: {ancho_mm:.1f}mm; max-height: {alto_mm:.1f}mm;"


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

    # OC base — best-effort en las columnas de retención (HONORARIOS) y
    # `total_a_pagar`. El deploy NO corre migraciones (release_command
    # desactivado), así que entre el deploy y el SQL aplicado a mano hay una
    # ventana en la que estas columnas no existen: sin el fallback el PDF de
    # TODAS las empresas se caería durante esa ventana. Mismo patrón que
    # empresas/items/firmas/cuotas más abajo.
    try:
        oc_row = (
            await db.execute(
                text(
                    """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                              fecha_emision, validez_dias, moneda, neto, iva, total,
                              forma_pago, plazo_pago, plazo_entrega,
                              observaciones, estado,
                              atte_nombre, atte_cargo, tipo_documento, iva_porcentaje,
                              retencion_porcentaje, retencion_monto, total_a_pagar
                       FROM core.ordenes_compra
                       WHERE oc_id = :id"""
                ),
                {"id": oc_id},
            )
        ).mappings().first()
    except Exception:
        with contextlib.suppress(Exception):
            await db.rollback()
        oc_row = (
            await db.execute(
                text(
                    """SELECT oc_id, numero_oc, empresa_codigo, proveedor_id,
                              fecha_emision, validez_dias, moneda, neto, iva, total,
                              forma_pago, plazo_pago, plazo_entrega,
                              observaciones, estado,
                              atte_nombre, atte_cargo, tipo_documento, iva_porcentaje
                       FROM core.ordenes_compra
                       WHERE oc_id = :id"""
                ),
                {"id": oc_id},
            )
        ).mappings().first()
        # El SELECT reducido NO trae las columnas de retención, pero SÍ trae
        # `tipo_documento`: si la OC es de honorarios o exenta, el template
        # entraría igual en su rama tributaria con retención 0 y el BRUTO
        # rotulado como "líquido a pagar". Eso no es un PDF degradado, es un
        # documento contractual firmado que sobredeclara lo que hay que girar
        # (en una OC de 3.645.000 al 15,25%, 555.863 de más) y que además
        # afirma "retención 0%" en la nota legal.
        # El resto de los fallbacks de este módulo degradan datos OPCIONALES
        # (logo, firmas, ítems); éste degradaría cifras de plata. Preferimos
        # que no salga el PDF a que salga mintiendo.
        if oc_row is not None and oc_row.get("tipo_documento") in (
            "HONORARIOS",
            "FACTURA_EXENTA",
        ):
            raise RuntimeError(
                f"OC #{oc_id} es {oc_row['tipo_documento']} y no se pudieron "
                "leer las columnas de retención: no se emite el PDF antes que "
                "emitirlo con montos incorrectos. Revisar que la migración "
                "megaprompt_oc_honorarios_exenta.sql esté aplicada."
            )
    if oc_row is None:
        return None

    # Empresa (best-effort en columnas nuevas)
    empresa_row = None
    try:
        empresa_row = (
            await db.execute(
                text(
                    """SELECT codigo, razon_social, rut, giro, direccion, ciudad,
                              telefono, logo_dropbox_path, pagina_web,
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
    # MEGAPROMPT OC-PDF-VERDE — pie de la página de firmas. En entornos sin
    # la migración R115 la columna no existe y el fallback de arriba no la
    # trae: el default deja el pie con la razón social, como antes.
    empresa.setdefault("pagina_web", None)
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

    # Bytes finales del logo (Dropbox → archivo local → nada). Se resuelven una
    # sola vez porque el contexto los necesita dos veces: para el data URI y
    # para medir sus píxeles y decidir cuánto se puede agrandar en el
    # encabezado sin que quede pixelado.
    _logo_raw = _logo_raw_bytes(emp_codigo, logo_bytes)

    # Verify URL (mismo patrón que oc-pagos-platform)
    try:
        from app.core.config import settings
        base = (getattr(settings, "frontend_url", "") or "").rstrip("/")
        verify_url = f"{base}/ordenes-compra/{oc_id}" if base else f"/ordenes-compra/{oc_id}"
    except Exception:
        verify_url = f"/ordenes-compra/{oc_id}"

    # Modelo OC para el template (formato que espera orden_compra.html)
    moneda_str = (oc_row.get("moneda") or "CLP").upper()

    # HONORARIOS / FACTURA_EXENTA — cifras de retención para el bloque de
    # totales del template.
    #
    # `is not None` en TODAS, nunca `or`: `retencion_porcentaje` y
    # `retencion_monto` valen 0 LEGÍTIMAMENTE en facturas, boletas y exentas,
    # y Python trata 0 como falso. Con `or` una boleta de honorarios pactada
    # sin retención imprimiría la tasa por defecto y una exenta volvería a
    # mostrar 19% de IVA. Ese bug ya se cometió en esta misma tabla.
    _total = (
        Decimal(str(oc_row["total"]))
        if oc_row.get("total") is not None
        else Decimal("0")
    )
    _ret_monto = (
        Decimal(str(oc_row["retencion_monto"]))
        if oc_row.get("retencion_monto") is not None
        else Decimal("0")
    )
    _total_a_pagar = oc_row.get("total_a_pagar")
    if _total_a_pagar is None:
        # OC anterior al backfill, o entorno todavía sin la columna. El líquido
        # se obtiene POR RESTA y no redondeando aparte, que es lo que hace
        # cerrar exacto la identidad total_a_pagar + retencion_monto == total
        # (§3.3 del contrato). Sin retención da `total`, que es el caso de
        # facturas, boletas y exentas.
        _total_a_pagar = _total - _ret_monto
    else:
        _total_a_pagar = Decimal(str(_total_a_pagar))
    oc_ctx = type("OcCtx", (), {
        "numero": oc_row["numero_oc"],
        "fecha_emision": oc_row["fecha_emision"],
        "moneda": type("M", (), {"value": moneda_str})(),
        "forma_pago": oc_row.get("forma_pago"),
        "plazo_pago": oc_row.get("plazo_pago"),
        # Plazo de ENTREGA — el diseño de referencia lo lista aparte del
        # plazo de pago. Antes estaba fijo en None y la fila del template
        # era código muerto.
        "plazo_entrega": oc_row.get("plazo_entrega"),
        "lugar_entrega": None,
        "garantia": None,
        "observaciones": oc_row.get("observaciones"),
        "gestiones_proveedor": None,
        "emails_documentacion": None,
        "emails_insumos": None,
        # None-check y no `or` también acá: un neto o un IVA de 0 son montos
        # válidos y `or 0` los deja igual por casualidad, pero es el mismo
        # patrón que sí rompe abajo. Se unifica para no dejar la trampa armada.
        "total_neto": oc_row["neto"] if oc_row.get("neto") is not None else 0,
        "iva": oc_row["iva"] if oc_row.get("iva") is not None else 0,
        # `or` rompería con 0% (Python trata 0 como falsy) — una OC en 0%
        # (boleta, exenta) volvería a mostrar "19%" en el PDF. None-check.
        "iva_porcentaje": (
            oc_row.get("iva_porcentaje")
            if oc_row.get("iva_porcentaje") is not None
            else Decimal("19.00")
        ),
        # Token del catálogo SII: FACTURA | FACTURA_EXENTA | BOLETA | HONORARIOS.
        # La etiqueta en castellano es PRESENTACIÓN y la arma el template.
        "tipo_documento": oc_row.get("tipo_documento") or "FACTURA",
        "total": _total,
        # Retención de honorarios. Sin la columna (entorno pre-migración) o con
        # NULL, la tasa cae a 0 y NO a 15,25: una OC que no es de honorarios
        # imprimiría una retención inventada, que en un documento contractual
        # es peor que no imprimir nada.
        "retencion_porcentaje": (
            oc_row.get("retencion_porcentaje")
            if oc_row.get("retencion_porcentaje") is not None
            else Decimal("0")
        ),
        "retencion_monto": _ret_monto,
        # Lo que efectivamente se transfiere: `total` en factura/boleta/exenta,
        # `total − retención` (LÍQUIDO) en honorarios.
        "total_a_pagar": _total_a_pagar,
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
        "pagina_web": empresa.get("pagina_web"),
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
    #
    # OC-FIRMANTES-EXTERNOS — el firmante del proveedor/cliente dejó de ir
    # hardcodeado en el template: ahora sale de esta misma tabla marcado con
    # es_externo, porque las OCs reales alternan su cargo ("Representante
    # Legal" / "Representante Comercial") y a veces firma además un tercero
    # (mandante). Los separamos en dos listas para que el template pinte
    # primero los externos y después el equipo emisor.
    firmantes_externos: list[dict[str, Any]] = []
    firmas_rows: Any = []
    try:
        firmas_rows = (
            await db.execute(
                text(
                    """SELECT firmante_nombre, firmante_email, firmante_cargo,
                              status, signed_at, signature_hash,
                              COALESCE(es_externo, FALSE) AS es_externo,
                              empresa_firmante, firma_visual
                       FROM core.oc_firmas
                       WHERE oc_id = :id AND status <> 'RECHAZADA'
                       ORDER BY orden, firma_id"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
    except Exception:
        # Entorno sin la migración de es_externo/empresa_firmante todavía: el
        # PDF tiene que seguir saliendo, con todas las firmas como internas.
        with contextlib.suppress(Exception):
            await db.rollback()
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
        firmantes_internos: list[dict[str, Any]] = []
        for fr in firmas_rows:
            item: dict[str, Any] = {
                "nombre": fr["firmante_nombre"] or fr["firmante_email"],
                "cargo": fr["firmante_cargo"] or "",
                # NULL ⇒ el template cae a la razón social por defecto
                # (proveedor para los externos, empresa emisora para el equipo).
                "empresa_firmante": fr.get("empresa_firmante"),
            }
            if fr["status"] == "FIRMADA" and fr["signed_at"]:
                item["firmado_el"] = fr["signed_at"].strftime(
                    "%d/%m/%Y %H:%M UTC"
                )
                item["hash_corto"] = (fr["signature_hash"] or "")[:12]
                # Texto manuscrito que el template dibuja en cursiva SOBRE la
                # línea. Cae al nombre del firmante para las firmas viejas,
                # anteriores a que existiera firma_visual.
                item["firma_visual"] = (
                    fr.get("firma_visual")
                    or fr["firmante_nombre"]
                    or ""
                )
            if fr.get("es_externo"):
                firmantes_externos.append(item)
            else:
                firmantes_internos.append(item)
        # Reemplazo total: si la OC tiene firmantes cargados, mandan ellos y
        # no los genéricos del branding (mismo criterio que antes de F3).
        firmantes = firmantes_internos

    # MEGAPROMPT OC-PDF-VERDE — hitos de pago para la sección "Forma de pago".
    # Las OC reales se pactan por PORCENTAJE ("30% anticipo al inicio de
    # fabricación, 70% contra entrega"), y eso es lo que el proveedor firma.
    # UNA sola query (nada de un SELECT por cuota) y envuelta como las firmas:
    # si la BD todavía no tiene la columna `porcentaje` el PDF tiene que salir
    # igual — sin la sección — en lugar de tumbar la generación entera.
    # Las cuotas ANULADAS no se imprimen: son hitos que el operador descartó.
    hitos_pago: list[dict[str, Any]] = []
    cuotas_rows: Any = []
    try:
        cuotas_rows = (
            await db.execute(
                text(
                    """SELECT numero_cuota, porcentaje, descripcion,
                              fecha_vencimiento, monto
                       FROM core.oc_cuotas
                       WHERE oc_id = :id AND estado <> 'ANULADA'
                       ORDER BY numero_cuota"""
                ),
                {"id": oc_id},
            )
        ).mappings().all()
    except Exception:
        with contextlib.suppress(Exception):
            await db.rollback()
        cuotas_rows = []

    # El denominador es `total_a_pagar`, no `total`: el monto de un hito es
    # PLATA QUE SALE (§3.1 del contrato) y en honorarios se reparte sobre el
    # líquido. Con `total` (bruto) los porcentajes derivados de una OC de
    # honorarios saldrían ~15% más chicos y dos hitos de 50% imprimirían
    # "42,4%" cada uno. En factura/boleta/exenta ambos valores coinciden, así
    # que el cambio es inerte fuera de honorarios.
    _total_oc = _total_a_pagar
    for cr in cuotas_rows:
        pct = cr.get("porcentaje")
        # Cuotas viejas creadas antes de la columna `porcentaje`: derivamos el
        # % desde el monto para que la columna nunca salga vacía en el PDF.
        if pct is None and _total_oc > 0 and cr["monto"] is not None:
            with contextlib.suppress(Exception):
                pct = (
                    Decimal(str(cr["monto"])) / _total_oc * 100
                ).quantize(Decimal("0.001"))
        hitos_pago.append({
            "porcentaje": pct,
            "descripcion": cr.get("descripcion"),
            "fecha": cr.get("fecha_vencimiento"),
            "monto": cr.get("monto"),
        })

    # Modelo Proveedor para template
    # "Atte. Señor/a" — MEGAPROMPT ENCARGADOS: prioriza el snapshot de la OC
    # (atte_nombre/atte_cargo, elegido al crearla desde el catálogo
    # proveedor_contactos) sobre el `contacto` suelto histórico del
    # proveedor. Así, si el proveedor cambia de encargado después, las OC ya
    # emitidas no cambian de destinatario retroactivamente.
    _atte_nombre = oc_row.get("atte_nombre") or proveedor.get("contacto_nombre")
    _atte_cargo = oc_row.get("atte_cargo") if oc_row.get("atte_nombre") else None
    prov_ctx = type("Prov", (), {
        "razon_social": proveedor.get("razon_social") or "Proveedor sin nombre",
        "rut": proveedor.get("rut") or "—",
        "giro": proveedor.get("giro"),
        "direccion": proveedor.get("direccion"),
        "ciudad": proveedor.get("ciudad"),
        "contacto_nombre": _atte_nombre,
        "contacto_cargo": _atte_cargo,
        "contacto_email": proveedor.get("contacto_email"),
        "contacto_telefono": proveedor.get("contacto_telefono"),
    })()

    css_content = (_DOCUMENTS_DIR / "document.css").read_text(encoding="utf-8")

    # Pie de página armado y SANEADO acá, no interpolado en el template: el
    # @bottom-center vive dentro de <style>, que es raw-text, y el Environment
    # tiene autoescape para .html — "DTE Consulting & Development SpA" salía
    # impreso como "&amp;". Se quitan comillas, backslashes y saltos porque
    # cualquiera de los tres rompe el string CSS y tumba la regla @page entera
    # (el PDF quedaría sin pie en TODAS las páginas).
    # `emp_ctx` es una clase creada al vuelo con type(), no un dict: se accede
    # por atributo. (Un .get() acá tumbaba la generación con AttributeError.)
    _pie_partes = [
        p for p in (
            getattr(emp_ctx, "direccion", None),
            getattr(emp_ctx, "ciudad", None),
        ) if p
    ]
    _pie = ", ".join(_pie_partes)
    # La OC de referencia cierra con el dominio de la empresa, no con la razón
    # social ("... Colbún | Panimávida.Energy"). Si no hay web, cae a la razón.
    _razon = (
        getattr(emp_ctx, "pagina_web", None)
        or getattr(emp_ctx, "razon_social", None)
        or ""
    )
    _razon = _razon.replace("https://", "").replace("http://", "").rstrip("/")
    footer_texto = f"{_pie}   |   {_razon}" if _pie else _razon
    for _malo in ('"', "\\", "\n", "\r"):
        footer_texto = footer_texto.replace(_malo, " ")
    footer_texto = " ".join(footer_texto.split())

    return {
        "titulo": f"Orden de Compra {oc_ctx.numero}",
        "tipo_doc": "ORDEN DE COMPRA",
        "folio": oc_ctx.numero,
        "fecha_emision_larga": _fecha_larga(oc_ctx.fecha_emision),
        "estado": oc_ctx.estado.value,
        "color_primario": color_primario,
        "footer_texto": footer_texto,
        "empresa": emp_ctx,
        "logo_data_uri": _logo_data_uri(_logo_raw),
        # Topes del logo en el encabezado, recortados según los píxeles reales
        # del archivo para no escalarlo hasta pixelarlo. El template lo inyecta
        # con |safe dentro del <style> (ver `_logo_max_css`).
        "logo_max_css": _logo_max_css(_logo_raw),
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
        # `firmantes` = equipo emisor; `firmantes_externos` = proveedor/cliente.
        # Si `firmantes_externos` va vacío el template imprime la celda
        # histórica del proveedor (OCs viejas sin firmantes cargados).
        "firmantes": firmantes,
        "firmantes_externos": firmantes_externos,
        "firma_font_uri": _firma_font_data_uri(),
        # MEGAPROMPT OC-PDF-VERDE — [{porcentaje, descripcion, fecha, monto}].
        # Vacía ⇒ el template omite la sección "Forma de pago" entera.
        "hitos_pago": hitos_pago,
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
