"""V5++ ola AM — Vouchers Nubox-style form.

Agrega campos faltantes al form de voucher según el Excel "documento para
claude boucher.xlsx" que mapea 1:1 con el form de Nubox:

  core.vouchers:
    forma_pago         TEXT       — Combo: TRANSFERENCIA / CHEQUE / CONTADO / CRÉDITO 30D / 60D / 90D
    fecha_vencimiento  DATE       — Para facturas con plazo de pago
    documento_dropbox_path TEXT   — Link al PDF subido del documento tributario

  core.voucher_lines:
    tipo_imputacion    TEXT       — 'CONTABLE' | 'FINANCIERA' | 'NA' (default NA)

El frontend del nuevo form /vouchers/nuevo-nubox separa visualmente las
"Información Contable" (gasto) de "Información Financiera" (flujo de
pago), pero ambas van a la misma tabla voucher_lines con este flag.

Idempotente: ADD COLUMN IF NOT EXISTS.
"""
from __future__ import annotations

from alembic import op

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- core.vouchers: 3 columnas nuevas ---
    op.execute(
        """
        ALTER TABLE core.vouchers
        ADD COLUMN IF NOT EXISTS forma_pago TEXT,
        ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
        ADD COLUMN IF NOT EXISTS documento_dropbox_path TEXT;
        """
    )

    # CHECK constraint defensivo en forma_pago (valores conocidos + NULL)
    # No usamos enum para que se pueda extender desde admin.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.check_constraints
                WHERE constraint_name = 'vouchers_forma_pago_check'
            ) THEN
                ALTER TABLE core.vouchers
                ADD CONSTRAINT vouchers_forma_pago_check CHECK (
                    forma_pago IS NULL OR forma_pago IN (
                        'TRANSFERENCIA',
                        'CHEQUE',
                        'CONTADO',
                        'EFECTIVO',
                        'CREDITO_30D',
                        'CREDITO_60D',
                        'CREDITO_90D',
                        'TARJETA_CREDITO',
                        'TARJETA_DEBITO',
                        'OTRO'
                    )
                );
            END IF;
        END $$;
        """
    )

    # Index para reportes por forma de pago
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_forma_pago
        ON core.vouchers(forma_pago) WHERE forma_pago IS NOT NULL;
        """
    )
    # Index para vencimientos próximos (consulta común en dashboard)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_fecha_vencimiento
        ON core.vouchers(fecha_vencimiento) WHERE fecha_vencimiento IS NOT NULL;
        """
    )

    # --- core.voucher_lines: tipo_imputacion ---
    op.execute(
        """
        ALTER TABLE core.voucher_lines
        ADD COLUMN IF NOT EXISTS tipo_imputacion TEXT
        NOT NULL DEFAULT 'NA';
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.check_constraints
                WHERE constraint_name = 'voucher_lines_tipo_imputacion_check'
            ) THEN
                ALTER TABLE core.voucher_lines
                ADD CONSTRAINT voucher_lines_tipo_imputacion_check CHECK (
                    tipo_imputacion IN ('CONTABLE', 'FINANCIERA', 'NA')
                );
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE core.voucher_lines "
        "DROP CONSTRAINT IF EXISTS voucher_lines_tipo_imputacion_check;"
    )
    op.execute(
        "ALTER TABLE core.voucher_lines DROP COLUMN IF EXISTS tipo_imputacion;"
    )
    op.execute(
        "ALTER TABLE core.vouchers "
        "DROP CONSTRAINT IF EXISTS vouchers_forma_pago_check;"
    )
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_forma_pago;")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_fecha_vencimiento;")
    op.execute(
        """
        ALTER TABLE core.vouchers
        DROP COLUMN IF EXISTS forma_pago,
        DROP COLUMN IF EXISTS fecha_vencimiento,
        DROP COLUMN IF EXISTS documento_dropbox_path;
        """
    )
