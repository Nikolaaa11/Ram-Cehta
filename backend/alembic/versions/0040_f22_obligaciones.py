"""F22 — obligación anual de impuesto a la renta (SII Chile).

Análogo a `core.f29_obligaciones` pero con cadencia anual:
  - F29: mensual, vencimiento día 12 (o 20 si paga online), próximo mes
  - F22: anual, vencimiento abril del año siguiente al período tributario

Periodo tributario = año calendario completo. Ej: F22 2025 vence en abril 2026.

Estructura:
  - empresa_codigo            : FK a core.empresas
  - año_tributario            : INT (2025, 2026, ...)
  - fecha_vencimiento         : DATE (típicamente abril 30 del año siguiente)
  - monto_a_pagar             : NUMERIC(18,2) — opcional, llenado al cargar
  - fecha_pago                : DATE — null hasta que se paga
  - estado                    : pendiente / pagado / vencido / prorrogado
  - comprobante_url           : path Dropbox o URL externa
  - dropbox_path              : path al PDF declarado en /03-Legal/Declaraciones SII/F22/
  - created_at / updated_at   : timestamps

Sync Dropbox:
  Lee `/Cehta Capital/01-Empresas/{COD}/03-Legal/Declaraciones SII/F22/{YYYY}.pdf`.
  Si el archivo existe y el row no, lo crea con estado=pendiente.

Idempotencia: UNIQUE (empresa_codigo, año_tributario).
"""
from __future__ import annotations

from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.f22_obligaciones (
            f22_id              BIGSERIAL PRIMARY KEY,
            empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo),
            ano_tributario      INT NOT NULL CHECK (ano_tributario BETWEEN 2000 AND 2100),
            fecha_vencimiento   DATE NOT NULL,
            monto_a_pagar       NUMERIC(18,2),
            fecha_pago          DATE,
            estado              TEXT NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente','pagado','vencido','prorrogado','exento')),
            comprobante_url     TEXT,
            dropbox_path        TEXT,
            notas               TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(empresa_codigo, ano_tributario)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_f22_empresa_ano ON core.f22_obligaciones(empresa_codigo, ano_tributario DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_f22_vencimiento ON core.f22_obligaciones(fecha_vencimiento) WHERE estado='pendiente'"
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.touch_f22_updated_at() RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_f22_updated_at ON core.f22_obligaciones;
        CREATE TRIGGER trg_f22_updated_at
            BEFORE UPDATE ON core.f22_obligaciones
            FOR EACH ROW
            EXECUTE FUNCTION core.touch_f22_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_f22_updated_at ON core.f22_obligaciones")
    op.execute("DROP FUNCTION IF EXISTS core.touch_f22_updated_at()")
    op.execute("DROP TABLE IF EXISTS core.f22_obligaciones")
