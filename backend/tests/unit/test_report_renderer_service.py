"""Tests para report_renderer_service — renderers puros sin DB."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services.report_renderer_service import (
    _esc,
    _fmt_clp,
    _fmt_date,
    render_balance_prueba_html,
    render_cierre_mensual_html,
    render_libro_diario_html,
)


class TestFormatHelpers:
    def test_esc_html_special_chars(self) -> None:
        assert _esc("<script>") == "&lt;script&gt;"
        assert _esc("foo & bar") == "foo &amp; bar"
        assert _esc('quote"end') == "quote&quot;end"

    def test_esc_handles_none(self) -> None:
        assert _esc(None) == ""

    def test_fmt_clp(self) -> None:
        assert _fmt_clp(1234567) == "$1.234.567"
        assert _fmt_clp(Decimal("850000")) == "$850.000"
        assert _fmt_clp(0) == "$0"
        assert _fmt_clp(None) == "—"

    def test_fmt_date(self) -> None:
        assert _fmt_date(date(2026, 5, 6)) == "2026-05-06"
        assert _fmt_date("custom-string") == "custom-string"
        assert _fmt_date(None) == "—"


class TestRenderLibroDiario:
    def test_empty_rows_returns_html(self) -> None:
        html = render_libro_diario_html(
            empresa_codigo="TRONGKAI",
            fecha_desde=date(2026, 1, 1),
            fecha_hasta=date(2026, 12, 31),
            rows=[],
        )
        assert "<!DOCTYPE html>" in html
        assert "TRONGKAI" in html
        assert "Libro Diario" in html
        assert "Sin asientos" in html

    def test_with_rows_renders_table(self) -> None:
        rows = [
            {
                "voucher_codigo": "EGRESO-TRONGKAI-2026-0001",
                "fecha_contable": date(2026, 4, 15),
                "glosa": "Pago proveedor",
                "line_number": 1,
                "cuenta_codigo": "5-01-01-01",
                "cuenta_nombre": "Servicios profesionales",
                "debit": Decimal("850000"),
                "credit": Decimal("0"),
                "descripcion": "",
            },
            {
                "voucher_codigo": "EGRESO-TRONGKAI-2026-0001",
                "fecha_contable": date(2026, 4, 15),
                "glosa": "Pago proveedor",
                "line_number": 2,
                "cuenta_codigo": "1-01-01-01",
                "cuenta_nombre": "Banco Santander",
                "debit": Decimal("0"),
                "credit": Decimal("850000"),
                "descripcion": "",
            },
        ]
        html = render_libro_diario_html(
            empresa_codigo="TRONGKAI",
            fecha_desde=date(2026, 4, 1),
            fecha_hasta=date(2026, 4, 30),
            rows=rows,
        )
        assert "EGRESO-TRONGKAI-2026-0001" in html
        assert "Servicios profesionales" in html
        assert "Banco Santander" in html
        assert "$850.000" in html
        # Cuadre OK
        assert "✓" in html or "cuadrado" in html.lower()

    def test_xss_protection_in_glosa(self) -> None:
        rows = [{
            "voucher_codigo": "EGRESO-X-2026-0001",
            "fecha_contable": date(2026, 4, 15),
            "glosa": "<script>alert('xss')</script>",
            "line_number": 1,
            "cuenta_codigo": "5-01-01-01",
            "cuenta_nombre": "Test",
            "debit": Decimal("100"),
            "credit": Decimal("0"),
            "descripcion": "",
        }]
        html = render_libro_diario_html(
            empresa_codigo="X",
            fecha_desde=date(2026, 4, 1),
            fecha_hasta=date(2026, 4, 30),
            rows=rows,
        )
        # El script no debe estar literal
        assert "<script>alert" not in html
        # Pero sí escapado
        assert "&lt;script&gt;" in html


class TestRenderBalancePrueba:
    def test_with_rows(self) -> None:
        rows = [
            {
                "cuenta_codigo": "1-01-01-01",
                "cuenta_nombre": "Banco Santander",
                "suma_debe": Decimal("5000000"),
                "suma_haber": Decimal("3000000"),
                "saldo": Decimal("2000000"),
            },
            {
                "cuenta_codigo": "5-01-01-01",
                "cuenta_nombre": "Servicios profesionales",
                "suma_debe": Decimal("3000000"),
                "suma_haber": Decimal("0"),
                "saldo": Decimal("3000000"),
            },
        ]
        html = render_balance_prueba_html(
            empresa_codigo="TRONGKAI",
            fecha_desde=date(2026, 4, 1),
            fecha_hasta=date(2026, 4, 30),
            rows=rows,
        )
        assert "Balance de Prueba" in html
        assert "Banco Santander" in html
        assert "$5.000.000" in html
        assert "$2.000.000" in html

    def test_empty_returns_no_movements_message(self) -> None:
        html = render_balance_prueba_html(
            empresa_codigo="TRONGKAI",
            fecha_desde=date(2026, 4, 1),
            fecha_hasta=date(2026, 4, 30),
            rows=[],
        )
        assert "Sin movimientos" in html


class TestRenderCierreMensual:
    def test_full_render(self) -> None:
        html = render_cierre_mensual_html(
            empresa_codigo="TRONGKAI",
            anio=2026,
            mes=4,
            voucher_count=15,
            f29_status={
                "estado": "pendiente",
                "fecha_vencimiento": "2026-05-12",
                "monto_a_pagar": 1500000,
                "fecha_pago": None,
            },
            cartolas_imported=2,
            movimientos_inserted=42,
            vouchers_pending=3,
            vouchers_approved=10,
        )
        assert "Cierre Mensual" in html
        assert "04/2026" in html
        assert "TRONGKAI" in html
        assert "pendiente" in html
        assert "$1.500.000" in html
        # Hay alerta amber para vouchers pending > 0
        assert "Firmar antes de cerrar" in html

    def test_no_pending_vouchers_shows_green(self) -> None:
        html = render_cierre_mensual_html(
            empresa_codigo="X",
            anio=2026,
            mes=4,
            voucher_count=10,
            f29_status=None,
            cartolas_imported=0,
            movimientos_inserted=0,
            vouchers_pending=0,
            vouchers_approved=10,
        )
        assert "Todos firmados" in html

    def test_no_f29_status(self) -> None:
        html = render_cierre_mensual_html(
            empresa_codigo="X",
            anio=2026,
            mes=4,
            voucher_count=0,
            f29_status=None,
            cartolas_imported=0,
            movimientos_inserted=0,
            vouchers_pending=0,
            vouchers_approved=0,
        )
        assert "No registrado en sistema" in html
