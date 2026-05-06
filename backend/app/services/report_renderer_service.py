"""Reportes PDF/HTML server-side — renderiza HTML notarial standalone.

Diseño minimalista (sin reportlab/weasyprint):
  - Genera HTML 100% standalone con CSS @media print embebido
  - El user abre el HTML, Ctrl+P → "Guardar como PDF" del browser
  - Sin dependencias pesadas. Sin OCR de imágenes. Sin licencia comercial.

Ventajas:
  - Genera al instante (sin headless Chrome)
  - El browser se encarga de fonts + paginación
  - Mismo motor que el voucher detail print de la UI
  - Archivable como HTML self-contained (resiste sin internet)

Output:
  - Reportes Voucher individual: ya existe en /vouchers/{id} con print CSS
  - Reportes contables (libro diario, mayor, p&l proyecto/área): NEW

Cada renderer es una función pura que recibe el data y devuelve el HTML.
Los endpoints API la sirven con `Content-Type: text/html`.
"""
from __future__ import annotations

import html as html_lib
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any


def _esc(s: Any) -> str:
    """Escape HTML para evitar XSS en datos de usuario."""
    return html_lib.escape(str(s)) if s is not None else ""


def _fmt_clp(v: Decimal | float | int | None) -> str:
    """Formatea CLP con punto miles + signo $."""
    if v is None:
        return "—"
    try:
        n = int(round(float(v)))
    except (ValueError, TypeError):
        return "—"
    return f"${n:,}".replace(",", ".")


def _fmt_date(d: date | str | None) -> str:
    if d is None:
        return "—"
    if isinstance(d, str):
        return d
    return d.isoformat()


# ============================================================================
# Base CSS — embeded en cada reporte para self-contained
# ============================================================================


_BASE_CSS = """
@page { margin: 1.5cm 1cm; size: A4; }

* { box-sizing: border-box; }

body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 10pt;
  line-height: 1.45;
  color: #1f2937;
  background: white;
  margin: 0;
  padding: 2rem;
  max-width: 1280px;
}

h1, h2, h3 {
  font-family: Georgia, serif;
  color: #111827;
  margin-top: 0;
  page-break-after: avoid;
}

h1 { font-size: 18pt; margin-bottom: 0.3em; }
h2 { font-size: 14pt; }
h3 { font-size: 12pt; }

.eyebrow {
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 600;
  color: #1d6f42;
  margin-bottom: 0.4em;
}

.subtle { color: #6b7280; font-size: 9pt; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 9pt;
}

th {
  background: #f3f4f6;
  text-transform: uppercase;
  font-size: 8pt;
  letter-spacing: 0.08em;
  font-weight: 600;
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1.5px solid #1f2937;
}

td {
  padding: 5px 8px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}

tr:nth-child(even) { background: #fafafa; }

td.num, th.num { text-align: right; font-family: "Courier New", monospace; font-variant-numeric: tabular-nums; }
td.mono { font-family: "Courier New", monospace; font-size: 8.5pt; }

tfoot { font-weight: 600; }
tfoot td { border-top: 2px solid #1f2937; padding: 8px; background: #fafafa; }

.footer {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid #d1d5db;
  font-size: 8pt;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2em;
  page-break-inside: avoid;
}

.footer .label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  margin-bottom: 0.3em;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 99px;
  font-size: 7.5pt;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.badge-green { color: #1d6f42; }
.badge-amber { color: #b45309; }
.badge-red   { color: #b91c1c; }
.badge-gray  { color: #6b7280; }

@media print {
  body { padding: 0; }
  .no-print { display: none !important; }
}

@media screen {
  body { background: #f3f4f6; }
  .page { background: white; padding: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 4px; }
}
"""


def _render_header(title: str, eyebrow: str, subtitle: str = "") -> str:
    """Header común de todos los reportes."""
    return f"""
    <header>
      <p class="eyebrow">{_esc(eyebrow)}</p>
      <h1>{_esc(title)}</h1>
      {f'<p class="subtle">{_esc(subtitle)}</p>' if subtitle else ''}
    </header>
    """


def _render_footer(report_id: str, generated_at: datetime | None = None) -> str:
    """Footer notarial común."""
    when = (generated_at or datetime.now(UTC)).strftime("%Y-%m-%d %H:%M:%S UTC")
    return f"""
    <footer class="footer">
      <div>
        <p class="label">Documento generado</p>
        <p>Cehta Capital · Plataforma interna</p>
        <p class="subtle">cehta-capital.vercel.app</p>
      </div>
      <div style="text-align: right">
        <p class="label">Verificación</p>
        <p>Generado: <code>{_esc(when)}</code></p>
        <p class="subtle">ID reporte: <code>{_esc(report_id)}</code></p>
      </div>
    </footer>
    """


def _wrap_page(body: str, title: str = "Reporte") -> str:
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>{_esc(title)}</title>
  <style>{_BASE_CSS}</style>
</head>
<body>
  <div class="page">{body}</div>
  <script>
    // Auto-trigger print al cargar (opcional — el user puede cancelar
    // y solo guardar como HTML). Disparamos solo si query ?print=1.
    if (new URLSearchParams(location.search).get('print') === '1') {{
      window.addEventListener('load', () => setTimeout(() => window.print(), 500));
    }}
  </script>
</body>
</html>
"""


# ============================================================================
# Renderers específicos por reporte
# ============================================================================


def render_libro_diario_html(
    *,
    empresa_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
    rows: list[dict],
) -> str:
    """Libro Diario — listado cronológico de asientos contables.

    Cada `row` tiene:
      voucher_codigo, fecha_contable, glosa, line_number,
      cuenta_codigo, cuenta_nombre, debit, credit, descripcion
    """
    if not rows:
        body = (
            _render_header(
                "Libro Diario",
                f"Empresa {empresa_codigo}",
                f"Período {fecha_desde} → {fecha_hasta}",
            )
            + '<p style="text-align:center;padding:4em;color:#6b7280">'
            + "Sin asientos en este período.</p>"
            + _render_footer(f"libro-diario-{empresa_codigo}-{fecha_desde}")
        )
        return _wrap_page(body, f"Libro Diario {empresa_codigo}")

    # Group por voucher
    grouped: list[dict] = []
    for r in rows:
        if grouped and grouped[-1]["voucher_codigo"] == r["voucher_codigo"]:
            grouped[-1]["lines"].append(r)
        else:
            grouped.append({
                "voucher_codigo": r["voucher_codigo"],
                "fecha_contable": r["fecha_contable"],
                "glosa": r.get("glosa", ""),
                "lines": [r],
            })

    total_debit = sum(Decimal(str(r.get("debit", 0))) for r in rows)
    total_credit = sum(Decimal(str(r.get("credit", 0))) for r in rows)

    rows_html = ""
    for g in grouped:
        for i, line in enumerate(g["lines"]):
            tr_cls = ' style="border-top:2px solid #d1d5db"' if i == 0 else ""
            rows_html += f"""<tr{tr_cls}>
  <td class="mono">{_esc(g['voucher_codigo']) if i == 0 else ''}</td>
  <td>{_esc(_fmt_date(g['fecha_contable'])) if i == 0 else ''}</td>
  <td class="mono">{_esc(line.get('cuenta_codigo', ''))}</td>
  <td>{_esc(line.get('cuenta_nombre', ''))}</td>
  <td>{_esc(g['glosa']) if i == 0 else _esc(line.get('descripcion', ''))}</td>
  <td class="num">{_fmt_clp(line.get('debit', 0)) if Decimal(str(line.get('debit', 0))) > 0 else '—'}</td>
  <td class="num">{_fmt_clp(line.get('credit', 0)) if Decimal(str(line.get('credit', 0))) > 0 else '—'}</td>
</tr>"""

    body = (
        _render_header(
            "Libro Diario",
            f"Empresa {empresa_codigo}",
            f"Período {fecha_desde} → {fecha_hasta} · "
            f"{len(grouped)} asientos · {len(rows)} líneas",
        )
        + f"""
        <table>
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Fecha</th>
              <th>Cuenta</th>
              <th>Nombre cuenta</th>
              <th>Glosa</th>
              <th class="num">Debe</th>
              <th class="num">Haber</th>
            </tr>
          </thead>
          <tbody>{rows_html}</tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="text-align:right">Totales del período</td>
              <td class="num">{_fmt_clp(total_debit)}</td>
              <td class="num">{_fmt_clp(total_credit)}</td>
            </tr>
            <tr>
              <td colspan="7" style="text-align:right;font-style:italic;font-weight:normal">
                {'Σ debe = Σ haber ✓ (cuadrado)' if total_debit == total_credit else 'Σ debe ≠ Σ haber ⚠ (descuadrado)'}
              </td>
            </tr>
          </tfoot>
        </table>
        """
        + _render_footer(
            f"libro-diario-{empresa_codigo}-{fecha_desde}-{fecha_hasta}"
        )
    )

    return _wrap_page(body, f"Libro Diario {empresa_codigo}")


def render_balance_prueba_html(
    *,
    empresa_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
    rows: list[dict],
) -> str:
    """Balance de Prueba — saldos por cuenta agrupados por nivel.

    Cada `row`: cuenta_codigo, cuenta_nombre, suma_debe, suma_haber, saldo
    """
    if not rows:
        body = (
            _render_header(
                "Balance de Prueba",
                f"Empresa {empresa_codigo}",
                f"Período {fecha_desde} → {fecha_hasta}",
            )
            + '<p style="text-align:center;padding:4em;color:#6b7280">Sin movimientos.</p>'
            + _render_footer(f"balance-{empresa_codigo}-{fecha_desde}")
        )
        return _wrap_page(body, f"Balance Prueba {empresa_codigo}")

    rows_html = "".join(
        f"""<tr>
          <td class="mono">{_esc(r.get('cuenta_codigo', ''))}</td>
          <td>{_esc(r.get('cuenta_nombre', ''))}</td>
          <td class="num">{_fmt_clp(r.get('suma_debe', 0))}</td>
          <td class="num">{_fmt_clp(r.get('suma_haber', 0))}</td>
          <td class="num">{_fmt_clp(r.get('saldo', 0))}</td>
        </tr>"""
        for r in rows
    )

    total_debe = sum(Decimal(str(r.get("suma_debe", 0))) for r in rows)
    total_haber = sum(Decimal(str(r.get("suma_haber", 0))) for r in rows)
    saldos_pos = sum(
        Decimal(str(r.get("saldo", 0))) for r in rows if Decimal(str(r.get("saldo", 0))) > 0
    )
    saldos_neg = sum(
        Decimal(str(r.get("saldo", 0))) for r in rows if Decimal(str(r.get("saldo", 0))) < 0
    )

    body = (
        _render_header(
            "Balance de Prueba",
            f"Empresa {empresa_codigo}",
            f"Período {fecha_desde} → {fecha_hasta} · "
            f"{len(rows)} cuentas con movimiento",
        )
        + f"""<table>
          <thead><tr>
            <th>Código</th><th>Nombre cuenta</th>
            <th class="num">Debe</th><th class="num">Haber</th>
            <th class="num">Saldo</th>
          </tr></thead>
          <tbody>{rows_html}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="text-align:right">Totales</td>
              <td class="num">{_fmt_clp(total_debe)}</td>
              <td class="num">{_fmt_clp(total_haber)}</td>
              <td class="num">{_fmt_clp(saldos_pos + saldos_neg)}</td>
            </tr>
          </tfoot>
        </table>"""
        + _render_footer(f"balance-prueba-{empresa_codigo}-{fecha_desde}-{fecha_hasta}")
    )
    return _wrap_page(body, f"Balance Prueba {empresa_codigo}")


def render_cashflow_mensual_html(
    *,
    empresa_codigo: str,
    anio: int,
    rows_by_month: list[dict],
) -> str:
    """Reporte Cashflow Mensual — entradas vs salidas mes a mes del año.

    Cada fila de `rows_by_month` tiene:
        mes (1-12), abonos, egresos, neto, saldo_acumulado
    """
    if not rows_by_month:
        body = (
            _render_header(
                f"Cashflow Mensual {anio}",
                f"Empresa {empresa_codigo}",
                "Sin movimientos en el período.",
            )
            + _render_footer(f"cashflow-{empresa_codigo}-{anio}")
        )
        return _wrap_page(body, f"Cashflow {anio} {empresa_codigo}")

    meses_str = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ]
    rows_html = ""
    total_abono = total_egreso = Decimal("0")
    for r in rows_by_month:
        mes_idx = int(r.get("mes", 0))
        mes_label = meses_str[mes_idx - 1] if 1 <= mes_idx <= 12 else "—"
        abonos = Decimal(str(r.get("abonos", 0)))
        egresos = Decimal(str(r.get("egresos", 0)))
        neto = abonos - egresos
        saldo = Decimal(str(r.get("saldo_acumulado", 0)))
        total_abono += abonos
        total_egreso += egresos
        neto_class = "badge-green" if neto >= 0 else "badge-red"
        rows_html += f"""<tr>
          <td>{_esc(mes_label)}</td>
          <td class="num">{_fmt_clp(abonos)}</td>
          <td class="num">{_fmt_clp(egresos)}</td>
          <td class="num">
            <span class="badge {neto_class}">{_fmt_clp(neto)}</span>
          </td>
          <td class="num">{_fmt_clp(saldo)}</td>
        </tr>"""

    neto_total = total_abono - total_egreso
    body = (
        _render_header(
            f"Cashflow Mensual {anio}",
            f"Empresa {empresa_codigo}",
            f"Entradas vs salidas mes a mes — desde core.movimientos",
        )
        + f"""<table>
          <thead><tr>
            <th>Mes</th>
            <th class="num">Entradas (abonos)</th>
            <th class="num">Salidas (egresos)</th>
            <th class="num">Neto</th>
            <th class="num">Saldo acumulado</th>
          </tr></thead>
          <tbody>{rows_html}</tbody>
          <tfoot>
            <tr>
              <td>Totales {anio}</td>
              <td class="num">{_fmt_clp(total_abono)}</td>
              <td class="num">{_fmt_clp(total_egreso)}</td>
              <td class="num">{_fmt_clp(neto_total)}</td>
              <td class="num">—</td>
            </tr>
          </tfoot>
        </table>
        <p class="subtle" style="margin-top: 1em;">
          Neto positivo = ingresos &gt; egresos en el mes. Saldo acumulado
          es la suma neta corrida desde enero.
        </p>"""
        + _render_footer(f"cashflow-{empresa_codigo}-{anio}")
    )
    return _wrap_page(body, f"Cashflow {anio} {empresa_codigo}")


def render_cierre_mensual_html(
    *,
    empresa_codigo: str,
    anio: int,
    mes: int,
    voucher_count: int,
    f29_status: dict | None,
    cartolas_imported: int,
    movimientos_inserted: int,
    vouchers_pending: int,
    vouchers_approved: int,
) -> str:
    """Reporte de cierre mensual — checklist + KPIs del mes.

    Útil para el cierre operativo: ¿está todo listo para mandar a Nubox?
    """
    mes_str = f"{mes:02d}/{anio}"
    f29_section = ""
    if f29_status:
        estado = f29_status.get("estado", "—")
        badge_class = (
            "badge-green"
            if estado == "pagado"
            else "badge-amber"
            if estado == "pendiente"
            else "badge-red"
        )
        f29_section = f"""
        <h3>F29 del período</h3>
        <table>
          <tr><td>Estado</td><td><span class="badge {badge_class}">{_esc(estado)}</span></td></tr>
          <tr><td>Vencimiento</td><td>{_esc(f29_status.get('fecha_vencimiento', '—'))}</td></tr>
          <tr><td>Monto a pagar</td><td>{_fmt_clp(f29_status.get('monto_a_pagar'))}</td></tr>
          <tr><td>Fecha pago</td><td>{_esc(f29_status.get('fecha_pago', '—'))}</td></tr>
        </table>"""
    else:
        f29_section = """
        <h3>F29 del período</h3>
        <p class="subtle">No registrado en sistema. Cargá el F29 desde Dropbox o manual.</p>"""

    checklist = f"""
    <h3>Checklist de cierre</h3>
    <table>
      <tr><td>Vouchers creados en el mes</td><td class="num">{voucher_count}</td></tr>
      <tr><td>Pendientes de firma</td><td class="num">{vouchers_pending}</td>
        <td><span class="badge {'badge-amber' if vouchers_pending > 0 else 'badge-green'}">
          {'⚠ Firmar antes de cerrar' if vouchers_pending > 0 else '✓ Todos firmados'}
        </span></td>
      </tr>
      <tr><td>Aprobados (listos export Nubox)</td><td class="num">{vouchers_approved}</td></tr>
      <tr><td>Cartolas importadas</td><td class="num">{cartolas_imported}</td></tr>
      <tr><td>Movimientos bancarios cargados</td><td class="num">{movimientos_inserted}</td></tr>
    </table>"""

    body = (
        _render_header(
            f"Cierre Mensual {mes_str}",
            f"Empresa {empresa_codigo}",
            f"Reporte de checklist y KPIs operativos del período {mes_str}",
        )
        + checklist
        + f29_section
        + """
        <h3>Próximos pasos</h3>
        <ol>
          <li>Verificar que todos los vouchers PENDING estén firmados.</li>
          <li>Generar batch de Nubox export (CSV) y cargar en sistema contable.</li>
          <li>Conciliar movimientos bancarios con voucher lines en /admin/conciliacion.</li>
          <li>Si hay descuadres, crear vouchers de ajuste antes del cierre formal.</li>
          <li>Pagar F29 si aún no está pagado (vence ~día 12 del mes siguiente).</li>
        </ol>"""
        + _render_footer(f"cierre-{empresa_codigo}-{anio}-{mes:02d}")
    )
    return _wrap_page(body, f"Cierre {mes_str} {empresa_codigo}")
