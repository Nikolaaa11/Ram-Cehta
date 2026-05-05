"""V5 Fase 3 — Tracking de exportaciones a Nubox.

Hasta tener API directa de Nubox confirmada, el flujo es:
  1. Vouchers en APPROVED se acumulan
  2. COO/CONTADOR genera un "batch" de exportación → CSV con todos los
     asientos pendientes
  3. Carga el CSV manualmente en Nubox (Importar Asientos)
  4. Vuelve a la app con los folios devueltos por Nubox y marca cada
     voucher como SYNCED con su folio

Esta tabla trackea cada batch generado para auditoría:
  - Quién lo generó, cuándo
  - Qué vouchers incluyó (FK opcional: cada voucher tiene
    nubox_status='exported_in_batch_X')
  - Hash del archivo (deduplicación + integridad)
  - Estado del batch: pending/imported/failed

Si en el futuro tenemos API Nubox, el batch se puede automatizar.
La estructura no cambia.
"""
from __future__ import annotations

from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.nubox_export_batches (
            batch_id           BIGSERIAL PRIMARY KEY,
            empresa_codigo     TEXT NOT NULL REFERENCES core.empresas(codigo),
            fecha_desde        DATE,
            fecha_hasta        DATE,
            -- Cantidad de vouchers incluidos + total monto
            voucher_count      INT NOT NULL DEFAULT 0,
            total_debit        NUMERIC(18, 2) NOT NULL DEFAULT 0,
            total_credit       NUMERIC(18, 2) NOT NULL DEFAULT 0,
            -- Archivo generado
            file_name          TEXT NOT NULL,
            file_format        TEXT NOT NULL DEFAULT 'csv'
                               CHECK (file_format IN ('csv', 'xlsx', 'xml')),
            file_hash          TEXT,
            file_size_bytes    BIGINT,
            -- Estado del batch
            status             TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN (
                'GENERATED',     -- archivo creado, pendiente de cargar
                'UPLOADED',      -- COO/CONTADOR cargó en Nubox
                'CONFIRMED',     -- Nubox devolvió folios y se asignaron
                'FAILED',        -- Nubox rechazó la carga
                'CANCELLED'      -- COO descartó el batch
            )),
            generated_by       UUID,
            generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            uploaded_at        TIMESTAMPTZ,
            confirmed_at       TIMESTAMPTZ,
            error_message      TEXT,
            notas              TEXT
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nubox_export_batches_empresa "
        "ON core.nubox_export_batches(empresa_codigo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nubox_export_batches_status "
        "ON core.nubox_export_batches(status);"
    )

    # Tabla join: qué vouchers incluyó cada batch
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.nubox_export_voucher (
            batch_id     BIGINT NOT NULL REFERENCES core.nubox_export_batches(batch_id) ON DELETE CASCADE,
            voucher_id   BIGINT NOT NULL REFERENCES core.vouchers(voucher_id),
            included_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (batch_id, voucher_id)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_nubox_export_voucher_voucher "
        "ON core.nubox_export_voucher(voucher_id);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.nubox_export_voucher CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.nubox_export_batches CASCADE;")
