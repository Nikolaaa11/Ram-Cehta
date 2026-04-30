"""V4 fase6 — Extender entregables regulatorios con obligaciones del Reglamento Interno.

Después de revisar el Reglamento Interno protocolizado del FIP CEHTA ESG +
obligaciones SII estándar para fondos de inversión privados, agregamos
templates faltantes:

OBLIGACIONES SII (no estaban):
- F22 Operación Renta anual (30 abril)
- DJ Personas Relacionadas anual (junio)
- PPM Pago Provisional Mensual (día 12 del mes siguiente)
- IVA mensual (día 12 del mes siguiente)
- Boleta de honorarios / facturas — cuando aplique

REGLAMENTO INTERNO (faltaban):
- Citación Asamblea Ordinaria (15 días antes — 15 abril)
- Cuenta de gestión anual (en Asamblea Ordinaria)
- Política de inversión revisada por Comité Inversiones (anual)
- Reporte ESG anual (específico FIP CEHTA "ESG")
- Registro actualizado de partícipes (mensual)
- Registro mensual de aportes/rescates
- Comisión administración: cálculo y facturación mensual

ANTI-LAVADO / UAF (faltaban):
- Capacitación anual oficial cumplimiento UAF
- Declaración oficial cumplimiento anual UAF
- Revisión anual política prevención LA/FT

CIERRE EJERCICIO (faltaban):
- Inventario de activos al cierre (31 dic)
- Reporte de litigios pendientes (cierre)
- Cierre tributario y contable (31 dic)

Idempotente: usa ON CONFLICT (id_template, periodo) DO NOTHING — re-correr
no duplica.

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-30
"""
from __future__ import annotations

from alembic import op

revision = "0023"
down_revision: str | None = "0022"
branch_labels = None
depends_on = None


def _last_day_of_month(year: int, month: int) -> str:
    import calendar

    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-{last:02d}"


def _q(s: str | None) -> str:
    if s is None:
        return ""
    return s.replace("'", "''")


# (id_template, nombre, categoria, descripcion, ref, frec, prio, resp,
#  a15, a10, a5, fechas_2025, fechas_2026)
_SEED_EXTENDIDO: list[tuple] = [
    # ─── SII ──────────────────────────────────────────────────────────────
    (
        "sii_f22_anual",
        "F22 Operación Renta — SII",
        "SII",
        "Declaración anual de impuesto a la renta (F22). Para AFIS S.A. y para cada empresa del portafolio del Fondo. Plazo legal: 30 abril.",
        "Art. 65° Ley sobre Impuesto a la Renta / Resolución SII",
        "anual", "critica", "Administradora", True, True, True,
        [("AT-2025", "2025-04-30")],
        [("AT-2026", "2026-04-30")],
    ),
    (
        "sii_dj_personas_relacionadas",
        "Declaración Jurada Personas Relacionadas — SII",
        "SII",
        "DJ 1907 (1834 cesado): operaciones con partes relacionadas en Chile y exterior. Obligatoria para administradoras de fondos.",
        "Resolución Ex. SII N° 92/2018 / Art. 41 E LIR",
        "anual", "alta", "Administradora", True, True, True,
        [("2024", "2025-06-30")],
        [("2025", "2026-06-30")],
    ),
    (
        "sii_ppm_mensual",
        "PPM Pago Provisional Mensual — F29 SII",
        "SII",
        "PPM por ingresos del mes anterior. Se declara en F29 junto con IVA. Plazo: día 12 del mes siguiente.",
        "Art. 84° LIR",
        "mensual", "critica", "Administradora", False, False, True,
        [(f"{m:02d}-2025", f"2025-{(m % 12) + 1:02d}-12" if m < 12 else "2026-01-12")
         for m in range(1, 13)],
        [(f"{m:02d}-2026", f"2026-{(m % 12) + 1:02d}-12" if m < 12 else "2027-01-12")
         for m in range(1, 13)],
    ),
    (
        "sii_iva_mensual",
        "Declaración IVA Mensual — F29 SII",
        "SII",
        "IVA débito y crédito fiscal del mes anterior. Plazo: día 12 del mes siguiente. Mismo F29 que PPM.",
        "DL 825 Ley IVA",
        "mensual", "critica", "Administradora", False, False, True,
        [(f"{m:02d}-2025", f"2025-{(m % 12) + 1:02d}-12" if m < 12 else "2026-01-12")
         for m in range(1, 13)],
        [(f"{m:02d}-2026", f"2026-{(m % 12) + 1:02d}-12" if m < 12 else "2027-01-12")
         for m in range(1, 13)],
    ),
    # ─── REGLAMENTO INTERNO — Asamblea + Citaciones ───────────────────────
    (
        "citacion_asamblea_ordinaria",
        "Citación Asamblea Ordinaria de Aportantes",
        "ASAMBLEA",
        "Convocatoria a Asamblea Ordinaria. 15 días corridos antes de la fecha. Incluye: tabla, EEFF auditados, Memoria Anual.",
        "Art. 30° Reglamento Interno FIP CEHTA ESG",
        "anual", "critica", "Administradora", True, True, True,
        [("2025", "2025-04-15")],
        [("2026", "2026-04-15")],
    ),
    (
        "cuenta_gestion_anual",
        "Cuenta de Gestión Anual — Asamblea",
        "ASAMBLEA",
        "Cuenta razonada de la gestión del ejercicio anterior, presentada por la Administradora a la Asamblea Ordinaria.",
        "Art. 31° (b) Reglamento Interno FIP CEHTA ESG",
        "anual", "critica", "Administradora", True, True, True,
        [("2024", "2025-04-30")],
        [("2025", "2026-04-30")],
    ),
    # ─── REGLAMENTO INTERNO — Política de Inversión + ESG ────────────────
    (
        "politica_inversion_revision_anual",
        "Revisión Anual Política de Inversión — Comité Inversiones",
        "INTERNO",
        "Revisión y eventual actualización de la política de inversión. Acta del Comité de Inversiones que la apruebe.",
        "Art. 54° / Art. 9° Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Comité Inversiones", True, True, True,
        [("2025", "2025-12-31")],
        [("2026", "2026-12-31")],
    ),
    (
        "reporte_esg_anual",
        "Reporte ESG Anual — Impacto Sostenible",
        "OPERACIONAL",
        "Reporte anual de impacto ambiental, social y de gobernanza (ESG) del Fondo. Específico al FIP CEHTA ESG dado su mandato. Incluye métricas por empresa beneficiaria.",
        "Mandato del Fondo / Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Administradora", True, True, True,
        [("2024", "2025-06-30")],
        [("2025", "2026-06-30")],
    ),
    # ─── PARTICIPES + APORTES ────────────────────────────────────────────
    (
        "registro_participes_mensual",
        "Actualización Registro de Partícipes",
        "INTERNO",
        "Registro actualizado mensualmente: ingresos, rescates, transferencias de cuotas. Disponible en oficina para Comité Vigilancia.",
        "Art. 11° / Art. 70° Reglamento Interno FIP CEHTA ESG",
        "mensual", "alta", "Administradora", False, True, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    (
        "comision_administracion_calculo",
        "Cálculo y Facturación Comisión Administración",
        "INTERNO",
        "Cálculo mensual de comisión 2.5% anual sobre activos netos del Fondo + emisión de factura por la Administradora. Diferente al pago: este es el doc, el pago es el cargo a la Línea CORFO.",
        "Art. 25° Reglamento Interno FIP CEHTA ESG",
        "mensual", "alta", "Administradora", False, True, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    # ─── UAF / ANTI-LAVADO ───────────────────────────────────────────────
    (
        "uaf_capacitacion_anual",
        "Capacitación Anual UAF — Oficial Cumplimiento + Personal",
        "UAF",
        "Capacitación anual obligatoria sobre prevención de lavado de activos y financiamiento del terrorismo (LA/FT). Constancia firmada por personal.",
        "Ley 19.913 / Circular UAF N° 49",
        "anual", "alta", "Administradora", True, True, True,
        [("2025", "2025-12-31")],
        [("2026", "2026-12-31")],
    ),
    (
        "uaf_revision_politica_la_ft",
        "Revisión Política Prevención LA/FT",
        "UAF",
        "Revisión anual del Manual de Prevención de Lavado de Activos y Financiamiento del Terrorismo. Aprobación por Directorio AFIS.",
        "Ley 19.913 / Circular UAF N° 49 / 57",
        "anual", "alta", "Administradora", True, True, True,
        [("2025", "2025-12-31")],
        [("2026", "2026-12-31")],
    ),
    # ─── CIERRE DE EJERCICIO ─────────────────────────────────────────────
    (
        "cierre_ejercicio_anual",
        "Cierre Contable y Tributario Anual",
        "INTERNO",
        "Cierre del ejercicio al 31 de diciembre. Inventario de activos, valorización final, ajustes contables, conciliaciones bancarias.",
        "Art. 62° Reglamento Interno FIP CEHTA ESG",
        "anual", "critica", "Administradora", True, True, True,
        [("2024", "2024-12-31"), ("2025", "2025-12-31")],
        [("2026", "2026-12-31")],
    ),
    (
        "inventario_activos_anual",
        "Inventario de Activos del Fondo",
        "OPERACIONAL",
        "Listado completo de inversiones, derechos sociales, instrumentos financieros del Fondo al 31 de diciembre. Insumo para EEFF auditados.",
        "Art. 62° / Art. 70° Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Administradora", True, True, True,
        [("2024", "2025-01-15"), ("2025", "2026-01-15")],
        [("2026", "2027-01-15")],
    ),
    (
        "reporte_litigios_anual",
        "Reporte Litigios Pendientes",
        "AUDITORIA",
        "Listado de litigios y contingencias pendientes del Fondo y empresas beneficiarias. Insumo para EEFF y nota a Auditores.",
        "Art. 62° Reglamento Interno / NIIF",
        "anual", "alta", "Administradora", True, True, True,
        [("2024", "2025-02-15"), ("2025", "2026-02-15")],
        [("2026", "2027-02-15")],
    ),
    # ─── DESEMBOLSOS A EMPRESAS BENEFICIARIAS ────────────────────────────
    (
        "informe_avance_empresas_beneficiarias_trimestral",
        "Informe Avance Empresas Beneficiarias",
        "OPERACIONAL",
        "Reporte trimestral del avance operativo y financiero de cada empresa beneficiaria del Fondo (CSL, RHO, DTE, REVTECH, EVOQUE, TRONGKAI). Insumo para Comité Vigilancia y CORFO.",
        "Art. 71° Reglamento Interno FIP CEHTA ESG",
        "trimestral", "alta", "Administradora", True, True, True,
        [("Q1-2025", "2025-04-30"), ("Q2-2025", "2025-07-31"),
         ("Q3-2025", "2025-10-31"), ("Q4-2025", "2026-01-31")],
        [("Q1-2026", "2026-04-30"), ("Q2-2026", "2026-07-31"),
         ("Q3-2026", "2026-10-31"), ("Q4-2026", "2027-01-31")],
    ),
    # ─── INFORMACIÓN A APORTANTES ────────────────────────────────────────
    (
        "informacion_comisiones_aportantes_mensual",
        "Información Comisiones a Aportantes",
        "OPERACIONAL",
        "Detalle mensual de comisiones cobradas por la Administradora, disponible para los aportantes en oficinas del Fondo.",
        "Art. 25° Reglamento Interno FIP CEHTA ESG",
        "mensual", "media", "Administradora", False, False, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    # ─── COMITÉ VIGILANCIA — CUENTA AL APORTANTES ────────────────────────
    (
        "comite_vigilancia_informe_anual",
        "Informe Anual Comité de Vigilancia",
        "ASAMBLEA",
        "El Comité de Vigilancia presenta su informe anual de gestión a la Asamblea Ordinaria.",
        "Art. 47° Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Comité Vigilancia", True, True, True,
        [("2024", "2025-04-15")],
        [("2025", "2026-04-15")],
    ),
]


def upgrade() -> None:
    for tpl in _SEED_EXTENDIDO:
        (id_template, nombre, categoria, descripcion, ref, frecuencia, prioridad,
         responsable, a15, a10, a5, fechas_2025, fechas_2026) = tpl
        for periodo, fecha_iso in fechas_2025 + fechas_2026:
            op.execute(
                f"""
                INSERT INTO app.entregables_regulatorios (
                    id_template, nombre, descripcion, categoria,
                    referencia_normativa, fecha_limite, frecuencia,
                    prioridad, responsable, periodo,
                    alerta_15, alerta_10, alerta_5
                ) VALUES (
                    '{_q(id_template)}',
                    '{_q(nombre)}',
                    '{_q(descripcion)}',
                    '{categoria}',
                    '{_q(ref)}',
                    DATE '{fecha_iso}',
                    '{frecuencia}',
                    '{prioridad}',
                    '{responsable}',
                    '{_q(periodo)}',
                    {a15},
                    {a10},
                    {a5}
                ) ON CONFLICT (id_template, periodo) DO NOTHING
                """
            )


def downgrade() -> None:
    # Borrar solo los templates que esta migración agregó.
    templates = [tpl[0] for tpl in _SEED_EXTENDIDO]
    placeholders = ", ".join(f"'{_q(t)}'" for t in templates)
    op.execute(
        f"DELETE FROM app.entregables_regulatorios WHERE id_template IN ({placeholders})"
    )
