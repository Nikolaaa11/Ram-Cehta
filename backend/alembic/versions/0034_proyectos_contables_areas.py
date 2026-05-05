"""V5 — Proyectos contables + Áreas (centros de costo).

Crea las 2 dimensiones analíticas restantes del módulo Vouchers:

  - `core.proyectos_contables`: proyectos formales para imputación
    (CORFO/PRIVADO/INTERNO/FINANCIERO) con código PRJ-EMP-TIPO-NNN.
    DISTINTO de `core.proyectos_empresa` (existente, Gantt operativo).
    FK opcional `gantt_proyecto_id` para cruzar avance operativo ↔
    ejecución presupuestaria cuando ambos hablan del mismo proyecto.

  - `core.areas`: 10 centros de costo de 3 letras (ADM, COM, OPE, ING,
    IDI, LEG, RRH, TIC, EJE, FIN). Comunes al portafolio.

  - `core.area_empresa`: matriz "qué área aplica a qué empresa".
    Default estricto (no row = no aplica), igual que plan_cuenta_empresa.
    Permite que IDI sea solo para EVQ/TRK, o que FIN sea solo AFIS/FIP.

Fuente de datos: hojas `Proyectos` y `Areas` del `Plan_de_cuentas_v2.xlsx`.
Importación: el endpoint `/admin/plan-cuentas/import` extiende su scope
para también llenar estas tablas en la misma transacción.
"""
from __future__ import annotations

from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =================================================================
    # core.proyectos_contables
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.proyectos_contables (
            codigo                     TEXT PRIMARY KEY,
            empresa_codigo             TEXT NOT NULL REFERENCES core.empresas(codigo),
            nombre                     TEXT NOT NULL,
            tipo_financiamiento        TEXT NOT NULL CHECK (tipo_financiamiento IN (
                'CORFO', 'PRIVADO', 'INTERNO', 'FINANCIERO'
            )),
            programa                   TEXT,
            fecha_inicio               DATE,
            fecha_termino              DATE,
            presupuesto_total          NUMERIC(18, 2),
            moneda                     TEXT NOT NULL DEFAULT 'CLP'
                                       CHECK (moneda IN ('CLP', 'UF', 'USD', 'EUR')),
            primer_desembolso_corfo    DATE,
            tipos_gasto_elegibles      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            estado                     TEXT NOT NULL DEFAULT 'ACTIVE'
                                       CHECK (estado IN ('ACTIVE', 'CLOSED', 'SUSPENDED')),
            -- Enlace opcional al proyecto operativo del Gantt
            gantt_proyecto_id          BIGINT REFERENCES core.proyectos_empresa(proyecto_id),
            metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Invariante: tipos_gasto_elegibles solo puede tener valores válidos
            CHECK (tipos_gasto_elegibles <@ ARRAY[
                'RRHH', 'OPERACION', 'INVERSION', 'GASTOS_GENERALES', 'NO_ELEGIBLE'
            ]::TEXT[])
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_proyectos_contables_empresa "
        "ON core.proyectos_contables(empresa_codigo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_proyectos_contables_tipo "
        "ON core.proyectos_contables(tipo_financiamiento);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_proyectos_contables_estado "
        "ON core.proyectos_contables(estado) WHERE estado = 'ACTIVE';"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_proyectos_contables_gantt "
        "ON core.proyectos_contables(gantt_proyecto_id) "
        "WHERE gantt_proyecto_id IS NOT NULL;"
    )
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.proyectos_contables
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # core.areas
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.areas (
            codigo       TEXT PRIMARY KEY,
            nombre       TEXT NOT NULL,
            descripcion  TEXT,
            activa       BOOLEAN NOT NULL DEFAULT TRUE,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Códigos de 3 letras mayúsculas
            CHECK (codigo ~ '^[A-Z]{3}$')
        );
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.areas
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # core.area_empresa (matriz de aplicabilidad)
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.area_empresa (
            area_codigo     TEXT NOT NULL REFERENCES core.areas(codigo) ON DELETE CASCADE,
            empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            aplica          BOOLEAN NOT NULL DEFAULT TRUE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (area_codigo, empresa_codigo)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_area_empresa_empresa "
        "ON core.area_empresa(empresa_codigo) WHERE aplica = TRUE;"
    )

    # =================================================================
    # Seed inicial de las 10 áreas estándar (los nombres y descripciones
    # vienen de la hoja `Areas` del Excel; el script de import
    # los actualizará si difieren). El seed acá garantiza que el sistema
    # arranque con áreas aunque nadie haya corrido el importer todavía.
    # =================================================================
    op.execute(
        """
        INSERT INTO core.areas (codigo, nombre, descripcion) VALUES
            ('ADM', 'Administración y Finanzas', 'Back office, contabilidad, tesorería, RRHH transversal'),
            ('COM', 'Comercial y Desarrollo de Negocio', 'Ventas, marketing, BD, originación'),
            ('OPE', 'Operaciones', 'Operación, mantención, logística'),
            ('ING', 'Ingeniería', 'Diseño, cálculo, gestión técnica de proyectos'),
            ('IDI', 'I+D+i', 'Investigación, desarrollo experimental, prototipos, PTEC'),
            ('LEG', 'Legal y Compliance', 'Asesoría jurídica, regulatorio, contratos, UAF, CMF'),
            ('RRH', 'Personas', 'Reclutamiento, capacitación, bienestar, prevención'),
            ('TIC', 'Tecnología y Sistemas', 'Software, infraestructura, ciberseguridad, datos'),
            ('EJE', 'Ejecutivo', 'Gerencia General, Directorio, planificación estratégica'),
            ('FIN', 'Financiero / Inversiones', 'Gestión de inversiones, FIP, valoración (solo AFIS y FIP)')
        ON CONFLICT (codigo) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.areas;")
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.proyectos_contables;")
    op.execute("DROP TABLE IF EXISTS core.area_empresa;")
    op.execute("DROP TABLE IF EXISTS core.areas CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.proyectos_contables CASCADE;")
