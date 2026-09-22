"""Que TODAS las salidas de una OC muestren los mismos números.

Segunda ronda del arreglo "las OC no suman" (revisión adversarial del
commit 91694a1): el PDF ya quedaba bien, pero la misma OC se muestra en
más lugares — la vista imprimible (Ctrl+P), la conciliación de la
extracción con IA, el alta por correo y el banco de preview local.
"""
from __future__ import annotations

import importlib.util
import re
from decimal import Decimal
from pathlib import Path

import pytest

from app.domain.value_objects.itemizado import subtotal_itemizado, total_linea

BACKEND = Path(__file__).resolve().parents[2]

# ──────────────────────────────────────────────────────────────────────
# La línea se calcula con lo que la BD va a guardar
# ──────────────────────────────────────────────────────────────────────


def test_la_linea_usa_la_precision_de_la_columna():
    """cantidad NUMERIC(18,4) y precio NUMERIC(18,2): si se multiplica con
    más precisión, el PDF imprime una multiplicación que no da."""
    # La BD guarda 0,3333 (no 0,33333): 0,3333 x 300.000 = 99.990.
    assert total_linea("0.33333", "300000", "CLP") == Decimal("99990")
    # El precio se guarda con 2 decimales: 333,33 x 3 = 999,99 -> 1.000.
    assert total_linea(3, "333.333", "CLP") == Decimal("1000")


# ──────────────────────────────────────────────────────────────────────
# Alta por correo: la moneda de la OC, no "CLP" clavado
# ──────────────────────────────────────────────────────────────────────


def test_el_alta_por_correo_no_trunca_las_oc_en_uf():
    fuente = (BACKEND / "app/services/auto_create_oc_from_inbox.py").read_text(
        encoding="utf-8"
    )
    assert 'total_linea(cantidad, precio, "CLP")' not in fuente
    assert "total_linea(cantidad, precio, moneda)" in fuente
    # Y la regla de verdad: en UF los centésimos son plata.
    assert total_linea(1, "12.45", "UF") == Decimal("12.45")
    assert total_linea(1, "12.45", "CLP") == Decimal("12")


# ──────────────────────────────────────────────────────────────────────
# Conciliación de la extracción con IA
# ──────────────────────────────────────────────────────────────────────


def test_la_conciliacion_compara_contra_lo_que_se_va_a_guardar():
    """Antes comparaba el documento contra la suma CRUDA y avisaba
    'no cuadran' sobre cotizaciones que sí cuadran con la OC a crear."""
    from app.api.v1.ordenes_compra_extract import _build_oc_suggestion

    fields = {
        "proveedor_nombre": "Comercializadora los Canelos",
        "moneda": "CLP",
        "neto": "1208",
        "items": [
            {"descripcion": f"linea {i}", "cantidad": "3", "precio_unitario": "100,50"}
            for i in range(4)
        ],
    }
    s = _build_oc_suggestion(fields, "PANIMAVIDA")
    # 4 líneas de 3 x 100,50 = 301,50 -> $302 cada una -> $1.208.
    assert s.conciliacion.neto_items == "1208"
    assert s.conciliacion.difieren is False


# ──────────────────────────────────────────────────────────────────────
# Vista imprimible (Ctrl+P)
# ──────────────────────────────────────────────────────────────────────


def _html_oc(**over):
    from app.services.report_renderer_service import render_orden_compra_html

    oc = {
        "numero_oc": "OC0059-PAN001",
        "empresa_codigo": "PANIMAVIDA",
        "fecha_emision": "2026-09-22",
        "moneda": "CLP",
        "tipo_documento": "FACTURA",
        "neto": Decimal("336387"),
        "iva": Decimal("63914"),
        "total": Decimal("400301"),
        "total_a_pagar": Decimal("400301"),
        "retencion_porcentaje": Decimal("0"),
        "retencion_monto": Decimal("0"),
        "estado": "emitida",
    }
    oc.update(over.pop("oc", {}))
    items = over.pop("items", [
        {"item": 5, "descripcion": "Codo PPR 32", "cantidad": Decimal("19.0000"),
         "precio_unitario": Decimal("420.17"), "total_linea": Decimal("7983")},
        {"item": 17, "descripcion": "Abrazadera", "cantidad": Decimal("20.0000"),
         "precio_unitario": Decimal("84.03"), "total_linea": Decimal("1681")},
    ])
    return render_orden_compra_html(oc=oc, items=items, empresa={}, proveedor=None, **over)


def test_la_vista_imprimible_muestra_los_decimales_del_precio():
    html = _html_oc()
    assert "$420,17" in html  # 19 x 420,17 = 7.983 cierra
    assert "$7.983" in html
    assert "$84,03" in html


def test_la_vista_imprimible_no_imprime_la_cantidad_en_notacion_cientifica():
    html = _html_oc()
    assert "2E+1" not in html
    assert ">20<" in html.replace(" ", "").replace("\n", "")


def test_la_vista_imprimible_de_una_boleta_de_honorarios_muestra_la_retencion():
    """La OC 74 salía 'Neto / IVA / TOTAL' y nunca mencionaba los $24.292
    que retiene el mandante: una boleta impresa como si fuera factura."""
    html = _html_oc(oc={
        "tipo_documento": "HONORARIOS",
        "neto": Decimal("159292"),
        "iva": Decimal("0"),
        "total": Decimal("159292"),
        "retencion_porcentaje": Decimal("15.25"),
        "retencion_monto": Decimal("24292"),
        "total_a_pagar": Decimal("135000"),
    })
    assert "Honorarios brutos" in html
    assert "Retención 15,25%" in html
    assert "-$24.292" in html
    assert "Líquido a pagar" in html and "$135.000" in html


def test_la_vista_imprimible_respeta_la_moneda():
    html = _html_oc(oc={"moneda": "UF", "neto": Decimal("4.5"),
                        "iva": Decimal("0"), "total": Decimal("4.5"),
                        "total_a_pagar": Decimal("4.5")},
                    items=[{"item": 1, "descripcion": "Arriendo",
                            "cantidad": Decimal("1"), "precio_unitario": Decimal("4.5"),
                            "total_linea": Decimal("4.5")}])
    assert "UF 4,50" in html
    assert "$4" not in html


# ──────────────────────────────────────────────────────────────────────
# El banco de preview local tiene que seguir renderizando
# ──────────────────────────────────────────────────────────────────────


def test_el_preview_local_pasa_todos_los_helpers_que_usan_los_templates():
    """El template llama formatear_precio_unitario desde 2026-09-22: si el
    preview no lo pasa, muere con UndefinedError y nadie puede mirar el PDF."""
    plantillas = (BACKEND / "app/templates/oc/documents").glob("orden_compra*.html")
    usados = set()
    for t in plantillas:
        usados |= set(re.findall(r"\b(formatear_\w+)\(", t.read_text(encoding="utf-8")))
    assert "formatear_precio_unitario" in usados  # guard del propio test

    spec = importlib.util.spec_from_file_location(
        "preview_oc", BACKEND / "scripts/preview_oc.py"
    )
    modulo = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(modulo)
    except Exception as exc:  # pragma: no cover — dependencias del script
        pytest.skip(f"preview_oc no importable en este entorno: {exc}")
    ctx = modulo.construir_contexto("rho", 2, "OC-TEST", "factura", "CLP")
    faltan = usados - set(ctx)
    assert not faltan, f"el preview no pasa: {faltan}"


def test_el_pdf_avisa_cuando_la_cabecera_no_cuadra_con_su_itemizado():
    fuente = (BACKEND / "app/services/oc_pdf_v2_service.py").read_text(encoding="utf-8")
    assert "oc_pdf.itemizado_descuadrado" in fuente


def test_el_schema_declarado_no_genera_total_linea():
    """Una columna GENERATED impondría el producto crudo y haría fallar
    todo INSERT que mande el importe (la suite de integración crea la BD
    desde este archivo)."""
    schema = (BACKEND / "db/schema.sql").read_text(encoding="utf-8")
    linea = next(x for x in schema.splitlines() if "total_linea" in x)
    assert "GENERATED" not in linea, linea


def test_las_migraciones_de_septiembre_estan_registradas():
    fuente = (BACKEND / "scripts/apply_pending_migrations.py").read_text(encoding="utf-8")
    for archivo in (
        "oc_anexos_2026_09.sql",
        "oc_pago_sin_firmas_2026_09.sql",
        "oc_total_linea_2026_09.sql",
        "oc_itemizado_cuadratura_2026_09.sql",
    ):
        assert archivo in fuente, archivo
        assert (BACKEND / "scripts/sql" / archivo).exists()
    # Los meta-comandos de psql rompen el aplicador (ojo: el comentario que
    # explica eso también los nombra, así que se mira línea por línea).
    for sql in (BACKEND / "scripts/sql").glob("oc_*_2026_09.sql"):
        for linea in sql.read_text(encoding="utf-8").splitlines():
            assert not linea.strip().startswith("\\set"), f"{sql.name}: {linea}"


def test_subtotal_con_moneda_por_defecto_sigue_siendo_pesos():
    assert subtotal_itemizado([{"cantidad": 1, "precio_unitario": "10.4"}]) == Decimal("10")


def test_la_conciliacion_de_un_documento_sin_lineas_no_avisa_en_falso():
    """Sin ítems se inventa una línea con el neto: la conciliación tiene
    que comparar contra ESA línea, no contra una suma vacía."""
    from app.api.v1.ordenes_compra_extract import _build_oc_suggestion

    s = _build_oc_suggestion(
        {"proveedor_nombre": "Proveedor", "moneda": "CLP", "neto": "336.387",
         "observaciones": "Servicios de septiembre"},
        "PANIMAVIDA",
    )
    assert len(s.items) == 1
    assert s.conciliacion.neto_items == "336387"
    assert s.conciliacion.difieren is False
