"""V5 Fase 2 — Aprobaciones de vouchers.

Crea las dos tablas que faltan para el flujo completo de aprobación
con firma:

  core.approval_rules
    Define qué roles deben firmar para aprobar un voucher según:
    - empresa
    - tipo de voucher (NULL = aplica a todos)
    - rango de monto (min_amount, max_amount)
    - tratamiento (GASTO vs ACTIVACION) — relevante para umbral reforzado
    Default sugerido en seed:
      - 0 a 5M CLP: 1 firma (GG)
      - 5M+ CLP gasto: 2 firmas (GG + COO) reforzado
      - 20M+ CLP activación: 2 firmas (GG + DIRECTOR) reforzado

  core.user_company_roles
    Asigna roles operativos por empresa. Un mismo user puede ser GG
    de CSL y OPERADOR de RHO. Roles posibles: GG, COO, CONTADOR,
    OPERADOR, DIRECTOR, TESORERIA.

NO se crea seed automático — el COO configura las reglas y los roles
desde la UI después del deploy. Hasta tener la primera regla, los
vouchers se pueden enviar a PENDING pero el endpoint /approve va a
fallar con 'Sin reglas configuradas' (decisión segura: bloquear hasta
que el COO defina la matriz).
"""
from __future__ import annotations

from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =================================================================
    # core.approval_rules
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.approval_rules (
            rule_id            BIGSERIAL PRIMARY KEY,
            empresa_codigo     TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            -- NULL = aplica a todos los tipos de voucher
            voucher_tipo       TEXT CHECK (voucher_tipo IN (
                'INGRESO', 'EGRESO', 'TRASPASO', 'COMPRA', 'VENTA',
                'APERTURA', 'CIERRE', 'REVERSO'
            )),
            -- Rango de monto en CLP (total_debit del voucher)
            min_amount         NUMERIC(18, 2) NOT NULL DEFAULT 0,
            -- NULL = sin tope superior
            max_amount         NUMERIC(18, 2),
            -- NULL = aplica a ambos balance treatments
            balance_treatment  TEXT CHECK (balance_treatment IN ('GASTO', 'ACTIVACION')),
            -- Roles requeridos para aprobar, en orden. Ej: ARRAY['GG'] o ARRAY['GG','COO'].
            required_roles     TEXT[] NOT NULL CHECK (cardinality(required_roles) >= 1),
            -- Marca semántica: ¿es un flujo reforzado (sobre umbral)?
            reinforced         BOOLEAN NOT NULL DEFAULT FALSE,
            -- Prioridad de matching: regla con menor número se evalúa primero.
            -- Permite definir reglas específicas (tipo+treatment) y un fallback general.
            priority           INT NOT NULL DEFAULT 100,
            active             BOOLEAN NOT NULL DEFAULT TRUE,
            descripcion        TEXT,
            created_by         UUID,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Invariante: si max_amount NOT NULL, debe ser > min_amount
            CHECK (max_amount IS NULL OR max_amount > min_amount),
            -- Invariante: roles validos
            CHECK (required_roles <@ ARRAY[
                'GG', 'COO', 'CONTADOR', 'OPERADOR', 'DIRECTOR', 'TESORERIA'
            ]::TEXT[])
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_approval_rules_empresa "
        "ON core.approval_rules(empresa_codigo) WHERE active = TRUE;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_approval_rules_priority "
        "ON core.approval_rules(empresa_codigo, priority) WHERE active = TRUE;"
    )
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.approval_rules
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # core.user_company_roles
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.user_company_roles (
            user_id          UUID NOT NULL,
            empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            role             TEXT NOT NULL CHECK (role IN (
                'GG', 'COO', 'CONTADOR', 'OPERADOR', 'DIRECTOR', 'TESORERIA'
            )),
            active           BOOLEAN NOT NULL DEFAULT TRUE,
            assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            assigned_by      UUID,
            notas            TEXT,
            PRIMARY KEY (user_id, empresa_codigo, role)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_company_roles_user "
        "ON core.user_company_roles(user_id) WHERE active = TRUE;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_company_roles_empresa_role "
        "ON core.user_company_roles(empresa_codigo, role) WHERE active = TRUE;"
    )

    # =================================================================
    # Seed de reglas default — solo si no hay reglas en la empresa.
    # Los umbrales sugeridos por el prompt son 5M gasto / 20M activación.
    # El COO puede ajustarlos después desde /admin/approval-rules.
    # =================================================================
    op.execute(
        """
        DO $$
        DECLARE
            emp_codigo TEXT;
        BEGIN
            FOR emp_codigo IN
                SELECT codigo FROM core.empresas WHERE activo = TRUE
            LOOP
                -- Regla 1: vouchers chicos (< 5M CLP) → solo GG
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced, priority,
                    descripcion
                )
                VALUES (
                    emp_codigo, NULL, 0, 5000000, NULL,
                    ARRAY['GG']::TEXT[], FALSE, 100,
                    'Default: vouchers menores a 5M CLP requieren firma del Gerente General'
                )
                ON CONFLICT DO NOTHING;

                -- Regla 2: vouchers de gasto medianos-grandes (5M+) → GG + COO reforzado
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced, priority,
                    descripcion
                )
                VALUES (
                    emp_codigo, NULL, 5000000, NULL, 'GASTO',
                    ARRAY['GG', 'COO']::TEXT[], TRUE, 50,
                    'Reforzado: gastos sobre 5M CLP requieren GG + COO'
                )
                ON CONFLICT DO NOTHING;

                -- Regla 3: vouchers de activación grandes (20M+) → GG + DIRECTOR reforzado
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced, priority,
                    descripcion
                )
                VALUES (
                    emp_codigo, NULL, 20000000, NULL, 'ACTIVACION',
                    ARRAY['GG', 'DIRECTOR']::TEXT[], TRUE, 40,
                    'Reforzado: activaciones sobre 20M CLP requieren GG + Director'
                )
                ON CONFLICT DO NOTHING;
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.approval_rules;")
    op.execute("DROP TABLE IF EXISTS core.user_company_roles CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.approval_rules CASCADE;")
