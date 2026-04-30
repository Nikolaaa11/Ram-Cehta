"""V4 fase 6 — Entregables Regulatorios FIP CEHTA ESG.

Tabla `app.entregables_regulatorios` con seed data inicial cubriendo
todos los compromisos regulatorios + internos del Reglamento Interno
del Fondo (CMF, CORFO, UAF, Auditorías, Asambleas, Comités).

Seed: instancias 2025 + 2026 generadas determinísticamente desde los
templates del PROMPT_MAESTRO. Idempotente — re-correr la migración
no duplica filas (ON CONFLICT DO NOTHING en (id_template, periodo)).

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-30
"""
from __future__ import annotations

from alembic import op

revision = "0022"
down_revision: str | None = "0021"
branch_labels = None
depends_on = None


def _last_day_of_month(year: int, month: int) -> str:
    """Último día del mes en formato ISO. Helper para construir el seed."""
    import calendar

    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-{last:02d}"


def _q(s: str | None) -> str:
    """Quote-escape simple para SQL strings en INSERT."""
    if s is None:
        return ""
    return s.replace("'", "''")


# ---------------------------------------------------------------------------
# Seed templates — definidos como tuplas para claridad
# ---------------------------------------------------------------------------
# (id_template, nombre, categoria, descripcion, ref_normativa, frecuencia,
#  prioridad, responsable, alerta_15, alerta_10, alerta_5, fechas_2025, fechas_2026)
# Las fechas son listas de (periodo, fecha_iso) — ya pre-calculadas según las reglas
# del Reglamento Interno (Art. 71°, 72°, etc.).

_SEED: list[tuple] = [
    # CMF — Reportes trimestrales (5 días hábiles tras cierre, aproximamos al 7 del mes siguiente)
    (
        "cmf_trimestral",
        "Reporte Trimestral CMF — Entidades Informantes",
        "CMF",
        "Información trimestral al Registro Especial CMF: denominación del Fondo, listado de partícipes, valor activos y pasivos en CLP.",
        "Art. 72° Reglamento Interno / Ley 20.712 Art. 56 inc. 2°",
        "trimestral", "critica", "Administradora", True, True, True,
        [("Q1-2025", "2025-05-07"), ("Q2-2025", "2025-08-07"),
         ("Q3-2025", "2025-11-07"), ("Q4-2025", "2026-02-09")],
        [("Q1-2026", "2026-05-07"), ("Q2-2026", "2026-08-07"),
         ("Q3-2026", "2026-11-09"), ("Q4-2026", "2027-02-08")],
    ),
    (
        "cmf_inscripcion_vigente",
        "Mantención Inscripción Registro Especial CMF",
        "CMF",
        "Verificar vigencia de inscripción N° 619 de AFIS S.A. en Registro Especial de Entidades Informantes CMF.",
        "Art. 3° / Art. 72° Reglamento Interno",
        "anual", "alta", "Administradora", True, True, True,
        [("2025", "2025-12-31")],
        [("2026", "2026-12-31")],
    ),
    # CORFO
    (
        "corfo_rendicion_semestral",
        "Rendición Semestral CORFO — Detalle Inversiones",
        "CORFO",
        "Detalle de todas las inversiones del Fondo, transferencias Fondo-Empresa beneficiaria, información Empresas Beneficiarias.",
        "Art. 71° Reglamento Interno / Programa FT",
        "semestral", "critica", "Administradora", True, True, True,
        [("S1-2025", "2025-07-31"), ("S2-2025", "2026-01-31")],
        [("S1-2026", "2026-07-31"), ("S2-2026", "2027-01-31")],
    ),
    (
        "corfo_balance_medio_ano",
        "Balance Provisorio Medio Año (No Auditado) — CORFO",
        "CORFO",
        "Balance provisorio de medio año no auditado de la Administradora y el Fondo.",
        "Art. 71° (ii) Reglamento Interno",
        "semestral", "alta", "Administradora", True, True, True,
        [("S1-2025", "2025-08-31"), ("S2-2025", "2026-02-28")],
        [("S1-2026", "2026-08-31"), ("S2-2026", "2027-02-28")],
    ),
    (
        "corfo_eeff_anuales",
        "EEFF Anuales Auditados — CORFO",
        "CORFO",
        "Balances anuales auditados y estados financieros de la Administradora y el Fondo. 180 días tras cierre.",
        "Art. 71° (ii) Reglamento Interno",
        "anual", "critica", "Administradora", True, True, True,
        [("2024", "2025-06-30"), ("2025", "2026-06-30")],
        [("2026", "2027-06-30")],
    ),
    (
        "corfo_evaluacion_bienal",
        "Evaluación Bienal CORFO — Monitoreo Programa FT",
        "CORFO",
        "Información para evaluación bienal del cumplimiento de objetivos del Programa FT.",
        "Art. 71° in fine Reglamento Interno",
        "bienal", "alta", "Administradora", True, False, True,
        [("2024-2025", "2025-12-31")],
        [],
    ),
    (
        "corfo_pago_comision_mensual",
        "Pago Comisión Administración CORFO (cargo Línea)",
        "CORFO",
        "Pago mensual comisión fija 2.5% anual + IVA. 5 primeros días hábiles del mes siguiente.",
        "Art. 25° Reglamento Interno FIP CEHTA ESG",
        "mensual", "critica", "Administradora", False, False, True,
        [(f"{m:02d}-2025", f"2025-{m:02d}-07") for m in range(1, 13)],
        [(f"{m:02d}-2026", f"2026-{m:02d}-07") for m in range(1, 13)],
    ),
    # UAF
    (
        "uaf_roe_trimestral",
        "Reporte de Operaciones en Efectivo (ROE) — UAF",
        "UAF",
        "Reporte trimestral de operaciones en efectivo a la Unidad de Análisis Financiero.",
        "Ley 19.913 UAF / Normativa Administradoras de Fondos",
        "trimestral", "critica", "Administradora", True, True, True,
        [("Q1-2025", "2025-04-30"), ("Q2-2025", "2025-07-31"),
         ("Q3-2025", "2025-10-31"), ("Q4-2025", "2026-01-31")],
        [("Q1-2026", "2026-04-30"), ("Q2-2026", "2026-07-31"),
         ("Q3-2026", "2026-11-02"), ("Q4-2026", "2027-02-01")],
    ),
    # INTERNO — Valorización IFRS
    (
        "ifrs_valorizacion_mensual",
        "Valorización IFRS Mensual — Cartera Inversiones",
        "INTERNO",
        "Valorización mensual de las inversiones del Fondo según criterios IFRS y normativa CMF.",
        "Art. 13° Reglamento Interno / Art. 70° letra (c)",
        "mensual", "alta", "Administradora", False, True, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    # AUDITORIA
    (
        "auditoria_eeff_anual",
        "Estados Financieros Anuales Auditados",
        "AUDITORIA",
        "EEFF anuales del Fondo al 31 de diciembre, auditados por firma externa CMF. 15 días antes de Asamblea Ordinaria.",
        "Art. 62°/65° Reglamento Interno FIP CEHTA ESG",
        "anual", "critica", "Auditores", True, True, True,
        [("2024", "2025-04-15")],
        [("2025", "2026-04-15")],
    ),
    (
        "auditoria_designacion_anual",
        "Designación Auditores Externos — Asamblea Ordinaria",
        "AUDITORIA",
        "Designación anual de auditores externos inscritos en Registro CMF, terna del Comité de Vigilancia.",
        "Art. 31°(c) / Art. 65° Reglamento Interno",
        "anual", "alta", "Comité Vigilancia", True, False, True,
        [("2025", "2025-04-30")],
        [("2026", "2026-04-30")],
    ),
    # ASAMBLEA
    (
        "asamblea_ordinaria_anual",
        "Asamblea Ordinaria de Aportantes",
        "ASAMBLEA",
        "Aprobación EEFF, elección Comité Vigilancia, designación auditores, cuenta gestión. Cuatrimestre tras cierre.",
        "Art. 30°/31° Reglamento Interno FIP CEHTA ESG",
        "anual", "critica", "Administradora", True, True, True,
        [("2025", "2025-04-30")],
        [("2026", "2026-04-30")],
    ),
    # COMITÉS
    (
        "comite_vigilancia_sesion_mensual",
        "Sesión Comité de Vigilancia (mínimo mensual)",
        "INTERNO",
        "Sesión mensual obligatoria. 3 miembros titulares, quórum por unanimidad.",
        "Art. 46° Reglamento Interno FIP CEHTA ESG",
        "mensual", "alta", "Comité Vigilancia", False, False, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    (
        "comite_inversiones_sesion_trimestral",
        "Sesión Comité de Inversiones (mínimo trimestral, primeros 3 años)",
        "INTERNO",
        "Sesionar cada 3 meses durante los primeros 3 años. 5 miembros, quórum mayoría.",
        "Art. 54° Reglamento Interno FIP CEHTA ESG",
        "trimestral", "alta", "Comité Inversiones", False, True, True,
        [("Q1-2025", "2025-03-31"), ("Q2-2025", "2025-06-30"),
         ("Q3-2025", "2025-09-30"), ("Q4-2025", "2025-12-31")],
        [("Q1-2026", "2026-03-31"), ("Q2-2026", "2026-06-30"),
         ("Q3-2026", "2026-09-30"), ("Q4-2026", "2026-12-31")],
    ),
    # OPERACIONAL — Portafolio
    (
        "informe_cartera_mensual",
        "Informe Cartera de Inversiones (Portafolio)",
        "OPERACIONAL",
        "Detalle mensual del portafolio del Fondo. CSL, RHO, DTE, REVTECH, EVOQUE, TRONGKAI.",
        "Art. 70° Reglamento Interno FIP CEHTA ESG",
        "mensual", "media", "Administradora", False, False, True,
        [(f"{m:02d}-2025", _last_day_of_month(2025, m)) for m in range(1, 13)],
        [(f"{m:02d}-2026", _last_day_of_month(2026, m)) for m in range(1, 13)],
    ),
    (
        "informe_anual_aportantes",
        "Informe Anual a Aportantes",
        "OPERACIONAL",
        "EEFF, Memoria Anual, detalle gastos con recursos del Fondo.",
        "Art. 71° Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Administradora", True, True, True,
        [("2024", "2025-04-30")],
        [("2025", "2026-04-30")],
    ),
    (
        "memoria_anual_fondo",
        "Memoria Anual del Fondo CEHTA ESG",
        "OPERACIONAL",
        "Memoria anual disponible 15 días antes de la Asamblea Ordinaria.",
        "Art. 70° Reglamento Interno FIP CEHTA ESG",
        "anual", "alta", "Administradora", True, False, True,
        [("2024", "2025-04-15")],
        [("2025", "2026-04-15")],
    ),
]


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.entregables_regulatorios (
            entregable_id SERIAL PRIMARY KEY,
            id_template TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            categoria TEXT NOT NULL,
            subcategoria TEXT,
            referencia_normativa TEXT,
            fecha_limite DATE NOT NULL,
            frecuencia TEXT NOT NULL,
            prioridad TEXT NOT NULL,
            responsable TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'pendiente',
            fecha_entrega_real DATE,
            motivo_no_entrega TEXT,
            notas TEXT,
            adjunto_url TEXT,
            periodo TEXT NOT NULL,
            alerta_15 BOOLEAN NOT NULL DEFAULT TRUE,
            alerta_10 BOOLEAN NOT NULL DEFAULT TRUE,
            alerta_5 BOOLEAN NOT NULL DEFAULT TRUE,
            generado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE,
            es_publico BOOLEAN NOT NULL DEFAULT FALSE,
            extra JSONB,
            created_by UUID,
            updated_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_entregable_template_periodo UNIQUE (id_template, periodo),
            CONSTRAINT chk_entregable_categoria CHECK (
                categoria IN ('CMF','CORFO','UAF','SII','INTERNO','AUDITORIA','ASAMBLEA','OPERACIONAL')
            ),
            CONSTRAINT chk_entregable_estado CHECK (
                estado IN ('pendiente','en_proceso','entregado','no_entregado')
            ),
            CONSTRAINT chk_entregable_prioridad CHECK (
                prioridad IN ('critica','alta','media','baja')
            )
        )
        """
    )

    # Indices para queries comunes
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entregables_fecha_limite_estado
            ON app.entregables_regulatorios (fecha_limite, estado)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entregables_categoria_fecha
            ON app.entregables_regulatorios (categoria, fecha_limite DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entregables_estado_fecha
            ON app.entregables_regulatorios (estado, fecha_limite)
            WHERE estado IN ('pendiente','en_proceso')
        """
    )

    # Seed data — instancias 2025 + 2026
    for tpl in _SEED:
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
    op.execute("DROP TABLE IF EXISTS app.entregables_regulatorios CASCADE")
