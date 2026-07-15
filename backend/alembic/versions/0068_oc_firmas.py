"""MEGAPROMPT F3 — Flujo de firmas de OC: tabla oc_firmas + vínculos.

Contexto: el ciclo de vida pedido es
  borrador → en_firma → firmada → enviada_proveedor → facturada → voucher
`ordenes_compra.estado` es TEXT sin CHECK (verificado en BD viva), así que los
estados nuevos son valores adicionales — los existentes (emitida, pagada,
anulada, parcial) siguen válidos y no se migra data (0 OCs post marcha blanca).

Cambios:
  1. core.oc_firmas — tabla nueva. Una row por (OC, firmante). Registra la
     firma en 1 click: quién, cuándo, hash SHA-256 (mismo patrón que
     core.voucher_approvals), IP y user-agent. `notified_at` y
     `reminder_sent_at` alimentan el recordatorio de 48h del monitor horario.
     El firmante puede ser usuario de la plataforma (firmante_user_id) o un
     invitado externo por correo (solo email — firma vía usuario cuando se
     registre; hoy la UI exige login).

  2. core.ordenes_compra.created_by — UUID del creador (para CC al enviar la
     OC firmada al proveedor). Nullable: las OCs históricas no lo tienen.

  3. core.vouchers.oc_id — FK directa voucher↔OC (antes el vínculo era solo
     vía oc_cuotas). ON DELETE SET NULL: borrar una OC no borra el asiento.
"""
from __future__ import annotations

from alembic import op

revision = "0068_oc_firmas"
down_revision = "0067_empresa_extra_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.oc_firmas (
            firma_id         BIGSERIAL PRIMARY KEY,
            oc_id            BIGINT NOT NULL
                             REFERENCES core.ordenes_compra(oc_id) ON DELETE CASCADE,
            firmante_user_id UUID,
            firmante_email   TEXT NOT NULL,
            firmante_nombre  TEXT,
            firmante_cargo   TEXT,
            orden            INT NOT NULL DEFAULT 1,
            status           TEXT NOT NULL DEFAULT 'PENDIENTE'
                             CHECK (status IN ('PENDIENTE', 'FIRMADA', 'RECHAZADA')),
            signed_at        TIMESTAMPTZ,
            signature_hash   TEXT,
            ip_address       TEXT,
            user_agent       TEXT,
            comments         TEXT,
            notified_at      TIMESTAMPTZ,
            reminder_sent_at TIMESTAMPTZ,
            invited_by       UUID,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (oc_id, firmante_email)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_oc_firmas_oc ON core.oc_firmas(oc_id)"
    )
    # Parcial: el monitor horario barre solo firmas pendientes para el
    # recordatorio 48h — mantenerlo barato.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_oc_firmas_pendientes
        ON core.oc_firmas(notified_at)
        WHERE status = 'PENDIENTE'
        """
    )
    op.execute(
        "ALTER TABLE core.ordenes_compra ADD COLUMN IF NOT EXISTS created_by UUID"
    )
    op.execute(
        """
        ALTER TABLE core.vouchers
        ADD COLUMN IF NOT EXISTS oc_id BIGINT
        REFERENCES core.ordenes_compra(oc_id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_vouchers_oc
        ON core.vouchers(oc_id)
        WHERE oc_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.idx_vouchers_oc")
    op.execute("ALTER TABLE core.vouchers DROP COLUMN IF EXISTS oc_id")
    op.execute(
        "ALTER TABLE core.ordenes_compra DROP COLUMN IF EXISTS created_by"
    )
    op.execute("DROP TABLE IF EXISTS core.oc_firmas")
