"""Round 81 — Bloque E: proyectos contables con aportes CORFO/P-tec/Empresa.

Contexto: prompt_v2_voucher_claudia.md Bloque E (Ajustes E3–E9). Reescribe
el modelo de proyectos para soportar:
  - Subsidio asociado (CORFO típicamente).
  - % default de aportes por fuente: CORFO, P-tec (CEHTA Capital), Empresa directa.
  - Cuentas contables destino por fuente.
  - IVA siempre corporativo (validación E8 en endpoints, no en DB).
  - bloquear_edicion_pct para proyectos donde el reparto NO se edita por
    voucher (deja al operador sin opción).

Adicionalmente:
  - voucher_lines gana `fuente_financiamiento` con CHECK enum.
  - Tabla nueva `core.subsidios` para registrar subsidios CORFO/etc por
    separado (varios proyectos pueden compartir un mismo subsidio).

Aclaración importante (operativa): "Cehto" en la transcripción de las
pizarras era el seudónimo/typo de **CEHTA Capital** (entidad holding ya
existente en core.empresas con codigo='CEHTA'). El P-tec se registra
contra esa entidad via la cuenta `cuenta_aporte_ptec_cehta`.

Pendiente futuro (no en esta migration):
  - SUM/E/SE como sub-componentes (Ajuste E10) — Claudia debe definir
    qué son antes de modelar.
"""
from __future__ import annotations

from alembic import op

revision = "0066_proy_aportes"
down_revision = "0065_invoice_imports"
branch_labels = None
depends_on = None


FUENTE_FINANCIAMIENTO_VALUES = [
    "CORFO_SUBSIDIO",   # cargo al pozo del subsidio CORFO
    "PTEC_CEHTA",       # aporte pecuniario empresarial (P-tec) via CEHTA Capital
    "EMPRESA_DIRECTA",  # gasto 100% de la entidad receptora
    "IVA_CORPORATIVO",  # IVA crédito fiscal — siempre corporativo, nunca CORFO
    "NA",               # default backward-compat
]


def _arr(vals: list[str]) -> str:
    return "ARRAY[" + ", ".join(f"'{v}'" for v in vals) + "]"


def upgrade() -> None:
    # 1. Tabla nueva core.subsidios.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.subsidios (
          subsidio_codigo TEXT PRIMARY KEY,
          programa TEXT NOT NULL,
          nombre TEXT NOT NULL,
          monto_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
          entidad_otorgante TEXT NOT NULL DEFAULT 'CORFO',
          estado TEXT NOT NULL DEFAULT 'ACTIVO'
            CHECK (estado IN ('ACTIVO','CERRADO','SUSPENDIDO')),
          fecha_inicio DATE,
          fecha_termino DATE,
          notas TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subsidios_estado "
        "ON core.subsidios(estado)"
    )

    # 2. Extender core.proyectos_contables con columnas de aportes/cuentas.
    op.execute(
        """
        ALTER TABLE core.proyectos_contables
          ADD COLUMN IF NOT EXISTS subsidio_codigo TEXT
            REFERENCES core.subsidios(subsidio_codigo) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS aporte_corfo_pct_default NUMERIC(5, 2)
            NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS aporte_ptec_pct_default NUMERIC(5, 2)
            NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS aporte_empresa_directa_pct_default NUMERIC(5, 2)
            NOT NULL DEFAULT 100,
          ADD COLUMN IF NOT EXISTS cuenta_aporte_corfo TEXT,
          ADD COLUMN IF NOT EXISTS cuenta_aporte_ptec_cehta TEXT,
          ADD COLUMN IF NOT EXISTS cuenta_aporte_empresa_directa TEXT,
          ADD COLUMN IF NOT EXISTS cuenta_iva_corporativo TEXT,
          ADD COLUMN IF NOT EXISTS bloquear_edicion_pct BOOLEAN
            NOT NULL DEFAULT FALSE
        """
    )

    # 3. Constraint que los 3 % sumen 100 (cuando aporte_corfo > 0 sugiere
    # que hay subsidio asociado). Soft check: solo bloqueamos si los 3
    # estan seteados a non-zero pero no suman ~100.
    op.execute(
        """
        ALTER TABLE core.proyectos_contables
          DROP CONSTRAINT IF EXISTS proyectos_contables_aportes_suman_100_check
        """
    )
    op.execute(
        """
        ALTER TABLE core.proyectos_contables
          ADD CONSTRAINT proyectos_contables_aportes_suman_100_check
          CHECK (
            ABS(
              (COALESCE(aporte_corfo_pct_default,0)
               + COALESCE(aporte_ptec_pct_default,0)
               + COALESCE(aporte_empresa_directa_pct_default,0))
              - 100
            ) < 0.01
          )
        """
    )

    # 4. voucher_lines: fuente_financiamiento con CHECK enum.
    op.execute(
        """
        ALTER TABLE core.voucher_lines
          ADD COLUMN IF NOT EXISTS fuente_financiamiento TEXT
            NOT NULL DEFAULT 'NA'
        """
    )
    op.execute(
        "ALTER TABLE core.voucher_lines "
        "DROP CONSTRAINT IF EXISTS voucher_lines_fuente_financiamiento_check"
    )
    op.execute(
        f"""
        ALTER TABLE core.voucher_lines
          ADD CONSTRAINT voucher_lines_fuente_financiamiento_check
          CHECK (fuente_financiamiento = ANY({_arr(FUENTE_FINANCIAMIENTO_VALUES)}))
        """
    )

    # 5. Índice para queries de reportería por proyecto + fuente
    # (E.g. "total CORFO ejecutado en Proyecto X 2026").
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_voucher_lines_proyecto_fuente
          ON core.voucher_lines (proyecto_codigo, fuente_financiamiento)
          WHERE proyecto_codigo IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_voucher_lines_proyecto_fuente")
    op.execute(
        "ALTER TABLE core.voucher_lines "
        "DROP CONSTRAINT IF EXISTS voucher_lines_fuente_financiamiento_check"
    )
    op.execute(
        "ALTER TABLE core.voucher_lines "
        "DROP COLUMN IF EXISTS fuente_financiamiento"
    )
    op.execute(
        """
        ALTER TABLE core.proyectos_contables
          DROP CONSTRAINT IF EXISTS proyectos_contables_aportes_suman_100_check
        """
    )
    op.execute(
        """
        ALTER TABLE core.proyectos_contables
          DROP COLUMN IF EXISTS subsidio_codigo,
          DROP COLUMN IF EXISTS aporte_corfo_pct_default,
          DROP COLUMN IF EXISTS aporte_ptec_pct_default,
          DROP COLUMN IF EXISTS aporte_empresa_directa_pct_default,
          DROP COLUMN IF EXISTS cuenta_aporte_corfo,
          DROP COLUMN IF EXISTS cuenta_aporte_ptec_cehta,
          DROP COLUMN IF EXISTS cuenta_aporte_empresa_directa,
          DROP COLUMN IF EXISTS cuenta_iva_corporativo,
          DROP COLUMN IF EXISTS bloquear_edicion_pct
        """
    )
    op.execute("DROP INDEX IF EXISTS core.ix_subsidios_estado")
    op.execute("DROP TABLE IF EXISTS core.subsidios")
