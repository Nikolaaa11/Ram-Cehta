"""V5++ ola AC — Reglas de aprobación según workflow Cehta operativo.

Reemplaza las reglas default (que tenían threshold por monto) por una sola
regla universal por empresa:

    TODOS los vouchers requieren 2 firmas en orden:
      1. GG (líder de empresa)
      2. DIRECTOR (Guido — CFO final, todas las empresas)

El CONTADOR de cada empresa crea+submit pero NO firma (separación de
funciones — auditable). Si el COO de Cehta quiere reintroducir thresholds
después, los crea desde /admin/reglas-aprobacion.

Idempotente: borra solo reglas con `descripcion` que empieza con 'Default:'
o 'Reforzado:' (las seedeadas por 0036). Reglas custom del COO no se tocan.
"""
from __future__ import annotations

from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Borrar reglas default seedeadas por la migración 0036
    op.execute(
        """
        DELETE FROM core.approval_rules
        WHERE descripcion LIKE 'Default:%'
           OR descripcion LIKE 'Reforzado:%';
        """
    )

    # 2. Crear regla universal por empresa: [GG, DIRECTOR]
    op.execute(
        """
        DO $$
        DECLARE
            emp_codigo TEXT;
        BEGIN
            FOR emp_codigo IN
                SELECT codigo FROM core.empresas WHERE activo = TRUE
            LOOP
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced, priority,
                    descripcion
                )
                VALUES (
                    emp_codigo,
                    NULL,           -- aplica a todos los tipos
                    0,
                    NULL,           -- sin tope superior
                    NULL,           -- aplica a GASTO + ACTIVACION
                    ARRAY['GG', 'DIRECTOR']::TEXT[],
                    FALSE,
                    100,
                    'V5++ ola AC: workflow Cehta — 2 firmas siempre (Líder empresa → CFO Cehta)'
                )
                ON CONFLICT DO NOTHING;
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # Borra solo las reglas que esta migración creó
    op.execute(
        """
        DELETE FROM core.approval_rules
        WHERE descripcion = 'V5++ ola AC: workflow Cehta — 2 firmas siempre (Líder empresa → CFO Cehta)';
        """
    )
    # Restaurar las reglas default de 0036
    op.execute(
        """
        DO $$
        DECLARE
            emp_codigo TEXT;
        BEGIN
            FOR emp_codigo IN
                SELECT codigo FROM core.empresas WHERE activo = TRUE
            LOOP
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced, priority,
                    descripcion
                )
                VALUES
                    (emp_codigo, NULL, 0, 5000000, NULL, ARRAY['GG']::TEXT[],
                     FALSE, 100, 'Default: vouchers menores a 5M CLP requieren firma del Gerente General'),
                    (emp_codigo, NULL, 5000000, NULL, 'GASTO', ARRAY['GG', 'COO']::TEXT[],
                     TRUE, 50, 'Reforzado: gastos sobre 5M CLP requieren GG + COO'),
                    (emp_codigo, NULL, 20000000, NULL, 'ACTIVACION', ARRAY['GG', 'DIRECTOR']::TEXT[],
                     TRUE, 40, 'Reforzado: activaciones sobre 20M CLP requieren GG + Director')
                ON CONFLICT DO NOTHING;
            END LOOP;
        END $$;
        """
    )
