"""V5++ OCR Cartolas Bancarias — tracking de imports automáticos.

Pipeline:
  1. Servicio escanea `/Cehta Capital/01-Empresas/{COD}/04-Financiero/Cartolas Bancarias/`
  2. Por cada PDF nuevo (hash no visto):
     - Parse texto del PDF (pypdf)
     - Detecta banco por header (Santander, BCI, BancoEstado, etc.)
     - Extrae filas: fecha, concepto, abono/egreso, saldo
     - INSERT en core.movimientos (idempotente por natural_key)
  3. Track la corrida en core.cartolas_runs con stats.

Idempotencia:
  - file_hash UNIQUE → mismo archivo no se procesa dos veces
  - core.movimientos.natural_key incluye empresa+fecha+banco+desc+monto

Si la cartola es escaneada (imagen, no texto), pypdf devuelve texto vacío
→ marcamos run como `failed_ocr_required` y se puede reintentar después
con Claude vision (fase 2 — futuro).

Auditoría: cada run guarda quién lo disparó (manual vs cron) + timestamp
+ counts por outcome.
"""
from __future__ import annotations

from alembic import op

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.cartolas_runs (
            run_id              BIGSERIAL PRIMARY KEY,
            empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo),

            -- Source
            dropbox_path        TEXT NOT NULL,
            file_hash           TEXT NOT NULL,
            file_size_bytes     BIGINT,

            -- Detección
            banco_detectado     TEXT,              -- 'santander', 'bci', 'banco_estado', 'bice', etc.
            periodo_desde       DATE,              -- inferido del PDF
            periodo_hasta       DATE,

            -- Outcomes
            status              TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending',                -- creado, sin procesar
                                    'parsed',                 -- parse OK
                                    'imported',               -- movimientos insertados
                                    'failed_parse',           -- pypdf falló (PDF roto)
                                    'failed_ocr_required',    -- texto vacío (PDF escaneado)
                                    'failed_unknown_format',  -- banco no reconocido
                                    'skipped_duplicate'       -- file_hash ya procesado
                                )),
            rows_extracted      INT NOT NULL DEFAULT 0,
            rows_inserted       INT NOT NULL DEFAULT 0,
            rows_skipped        INT NOT NULL DEFAULT 0,    -- ya existían en movimientos
            error_message       TEXT,

            -- Trigger
            triggered_by        TEXT,              -- user_id o 'cron'
            triggered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at         TIMESTAMPTZ,

            -- Idempotencia
            UNIQUE (empresa_codigo, file_hash)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cartolas_runs_empresa "
        "ON core.cartolas_runs(empresa_codigo, triggered_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cartolas_runs_status "
        "ON core.cartolas_runs(status) WHERE status != 'imported'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.cartolas_runs")
