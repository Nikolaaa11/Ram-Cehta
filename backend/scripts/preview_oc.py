"""Vista previa LOCAL del PDF de la Orden de Compra, sin WeasyPrint.

Por qué existe: WeasyPrint no corre en Windows sin GTK/Pango, así que en la
máquina de desarrollo no hay forma de ver el PDF sin deployar a Fly. Esto
renderiza el mismo template Jinja con datos realistas y lo pagina con
Chromium headless (via Playwright, que ya está instalado para los E2E).

⚠️ NO es WeasyPrint. Chromium soporta MÁS CSS que WeasyPrint 63, así que
sirve para juzgar diseño, jerarquía tipográfica y paginación, pero NO
garantiza que algo se vea igual en producción. Reglas para que la vista
previa sea representativa:
  · Nada de flex ni grid (WeasyPrint 63 no los implementa completos).
  · Nada de `gap`, `aspect-ratio`, `clamp()`, custom properties en @page.
  · Tablas y bloques, que es lo que WeasyPrint pagina de forma predecible.

Uso:
    python scripts/preview_oc.py                    # escenario por defecto (RHO)
    python scripts/preview_oc.py --escenario afis   # otra empresa/logo
    python scripts/preview_oc.py --items 25         # OC larga, para ver el corte

Deja el PDF y un PNG por página en scripts/_preview_oc/.
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from app.services.oc_pdf_v2_service import (  # noqa: E402
    _env,
    _fecha_larga,
    _firma_font_data_uri,
    _formatear_moneda,
    _logo_data_uri,
    _logo_max_css,
    _logo_raw_bytes,
    _qr_placeholder_svg,
)

_OUT = Path(__file__).resolve().parent / "_preview_oc"
_DOCUMENTS = _BACKEND / "app" / "templates" / "oc" / "documents"


def _obj(**kw):
    """Objeto anónimo: el template accede por atributo, no por clave."""
    return type("Ctx", (), kw)()


ESCENARIOS = {
    # (codigo_empresa, razon_social, color) — el logo sale del código.
    "rho": ("RHO", "Rho Generación SpA", "#1A793B"),
    "afis": ("AFIS", "AFIS SpA", "#1F2937"),
    "dte": ("DTE", "DTE Consulting & Development SpA", "#0A3A6B"),
    "revtech": ("REVTECH", "Revtech SpA", "#D97706"),
    "trongkai": ("TRONGKAI", "Trongkai SpA", "#2E7D32"),
    "sin-logo": ("PANIMAVIDA", "Panimávida Energy SpA", "#1A793B"),
}


def construir_contexto(escenario: str, n_items: int, folio: str) -> dict:
    codigo, razon, color = ESCENARIOS[escenario]
    raw = _logo_raw_bytes(codigo, None)

    items = []
    base = [
        ("Instalación de fosa séptica, cámaras de inspección y drenes", "Gl", 1, 2_925_000),
        ("Apoyo de retroexcavadora", "Días", 3, 240_000),
        ("Suministro e instalación de tubería HDPE 110mm", "ml", 120, 8_400),
        ("Movimiento de tierras y compactación de plataforma", "m3", 45, 32_000),
        ("Ensayo de compactación Proctor modificado", "Un", 6, 95_000),
    ]
    for i in range(n_items):
        desc, un, cant, pu = base[i % len(base)]
        items.append(
            _obj(
                numero=i + 1,
                articulo=desc[:60],
                descripcion=desc,
                unidad=un,
                cantidad=Decimal(cant),
                precio_unitario=Decimal(pu),
                total=Decimal(cant * pu),
                plazo=None,
            )
        )
    neto = sum(int(i.total) for i in items)
    iva = round(neto * 0.19)

    firmantes = [
        {"nombre": "Javier Álvarez Abarca", "cargo": "Gerente General",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "2ec7f0535fd3",
         "firma_visual": "Javier Alvarez", "empresa_firmante": None},
        {"nombre": "Victoria Álvarez Abarca", "cargo": "Administración y Finanzas",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "af38539f9067",
         "firma_visual": "Victoria Álvarez", "empresa_firmante": None},
        {"nombre": "Javiera Vargas Ríos", "cargo": "Líder Coordinación de Proyectos",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "d8d06aaca595",
         "firma_visual": "Javiera Vargas", "empresa_firmante": None},
        {"nombre": "Francisco Chandía", "cargo": "Project Manager",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "acf521df5a2b",
         "firma_visual": "Francisco Chandía", "empresa_firmante": None},
        {"nombre": "Guido Rietta González", "cargo": "Director General FIP",
         "firmado_el": "29/07/2026 20:35 UTC", "hash_corto": "2b9aa58decfe",
         "firma_visual": "Guido Rietta", "empresa_firmante": None},
    ]
    externos = [{"nombre": "Octavio Parada Cancino", "cargo": "Representante Legal",
                 "empresa_firmante": "OCTAVIO PARADA CANCINO"}]

    oc = _obj(
        numero=folio, fecha_emision=date(2026, 7, 29),
        moneda=_obj(value="CLP"), forma_pago="30% anticipo y 70% contra entrega",
        plazo_pago="30 días", plazo_entrega="No aplica", lugar_entrega=None,
        garantia=None,
        observaciones=("La presente Orden de Compra es por los servicios "
                       "detallados a continuación para el proyecto Panimávida:"),
        gestiones_proveedor=None, emails_documentacion=None, emails_insumos=None,
        total_neto=Decimal(neto), iva=Decimal(iva),
        iva_porcentaje=Decimal("19.00"), tipo_documento="FACTURA",
        total=Decimal(neto + iva), estado=_obj(value="firmada"), items=items,
    )
    emp = _obj(
        nombre_corto=codigo, razon_social=razon, rut="77.931.386-7",
        giro="Ingeniería y construcción", direccion="General del Canto 50 Of 301",
        ciudad="Providencia", telefono="+56 2 2345 6789", email=None,
        pagina_web="rhogeneracion.com", representante_legal="Javier Álvarez Abarca",
    )
    prov = _obj(
        razon_social="OCTAVIO PARADA CANCINO", rut="14.290.239-7",
        giro="Obras civiles menores", direccion="Camino Panimávida s/n",
        ciudad="Colbún", contacto_nombre="Octavio Parada", contacto_cargo="Titular",
        contacto_email=None, contacto_telefono=None,
    )
    hitos = [
        {"porcentaje": Decimal("30"), "descripcion": "Anticipo al inicio de la obra",
         "fecha": date(2026, 8, 15), "monto": Decimal(round((neto + iva) * 0.30))},
        {"porcentaje": Decimal("70"), "descripcion": "Contra entrega conforme",
         "fecha": date(2026, 9, 30), "monto": Decimal(round((neto + iva) * 0.70))},
    ]

    return {
        "titulo": f"Orden de Compra {folio}", "tipo_doc": "ORDEN DE COMPRA",
        "folio": folio, "fecha_emision_larga": _fecha_larga(oc.fecha_emision),
        "estado": oc.estado.value, "color_primario": color,
        "footer_texto": "General del Canto 50 Of 301, Providencia   |   rhogeneracion.com",
        "empresa": emp, "logo_data_uri": _logo_data_uri(raw),
        "logo_max_css": _logo_max_css(raw), "proveedor": prov, "cuenta": None,
        "tipo_cuenta_label": "Cuenta Corriente", "oc": oc,
        "formatear_moneda": _formatear_moneda, "qr_data_uri": _qr_placeholder_svg(),
        "verify_url": "https://cehta-capital.vercel.app/ordenes-compra/28",
        "hash_verificacion": "oc-28-preview", "watermark": None, "css": "",
        "firmantes": firmantes, "firmantes_externos": externos,
        "firma_font_uri": _firma_font_data_uri(), "hitos_pago": hitos,
    }


_NODE_RENDER = r"""
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [htmlPath, pdfPath] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: pdfPath, format: 'Letter', printBackground: true,
    margin: { top: '16mm', right: '17mm', bottom: '15mm', left: '17mm' },
  });
  await browser.close();
})();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--escenario", default="rho", choices=sorted(ESCENARIOS))
    ap.add_argument("--items", type=int, default=2)
    ap.add_argument("--folio", default="OC-FLUJO-COMPLETO-9901")
    ap.add_argument("--template", default="orden_compra_panimavida.html")
    ap.add_argument(
        "--prefix",
        default=None,
        help=("Prefijo de los archivos de salida. Sirve para comparar variantes "
              "del template sin que se pisen los PNG entre sí."),
    )
    args = ap.parse_args()

    prefijo = args.prefix or args.escenario
    _OUT.mkdir(exist_ok=True)
    ctx = construir_contexto(args.escenario, args.items, args.folio)
    html = _env.get_template(args.template).render(**ctx)

    html_path = _OUT / f"{prefijo}.html"
    pdf_path = _OUT / f"{prefijo}.pdf"
    html_path.write_text(html, encoding="utf-8")

    # El script va DENTRO de frontend/: Node resuelve `require('playwright')`
    # relativo a la ubicación del script, no al cwd, y el único node_modules
    # con playwright es el del frontend.
    frontend = _BACKEND.parent / "frontend"
    js = frontend / "_render_oc_preview.js"
    js.write_text(_NODE_RENDER, encoding="utf-8")
    try:
        r = subprocess.run(
            ["node", str(js), str(html_path), str(pdf_path)],
            cwd=str(frontend), capture_output=True, text=True,
        )
    finally:
        js.unlink(missing_ok=True)
    if r.returncode != 0:
        print("render fallo:", r.stderr[:600])
        return 1

    try:
        import fitz
    except ImportError:
        print(f"PDF: {pdf_path} (instalá pymupdf para los PNG)")
        return 0
    doc = fitz.open(pdf_path)
    for i, p in enumerate(doc):
        out = _OUT / f"{prefijo}_p{i + 1}.png"
        p.get_pixmap(dpi=110).save(out)
    print(f"{doc.page_count} pagina(s) -> {_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
