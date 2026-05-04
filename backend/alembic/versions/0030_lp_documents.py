"""V5 — Tabla `core.lp_documents` para vault de documentos por LP.

Cada LP (Limited Partner / inversionista del FIP) tiene un set de
documentos legales y operativos que el fondo necesita custodiar:

  - Contrato de suscripción de cuotas firmado.
  - KYC / DDQ / AML-PEP — onboarding compliance.
  - Side letters — términos especiales pactados.
  - Recibos de aporte (uno por desembolso).
  - Acta de aprobación del directorio del LP autorizando la inversión
    (corporate LPs).
  - Forms tributarios (W-8 / W-9) para LPs no chilenos.
  - DNI / pasaporte / poder notarial.

Hoy todo eso vive disperso en email + Dropbox + carpetas físicas, sin
trazabilidad ni alertas de vencimiento. Esto es problemático porque:

  1. CMF/UAF — el regulador puede pedir "muestren toda la
     documentación KYC del LP X al 2026-01-01" y no hay query.
  2. Vencimientos — pasaportes y poderes expiran. Sin tabla, no hay
     alerta y se puede operar con doc vencido.
  3. Auditoría interna — reconstruir qué se firmó cuándo, imposible.

Diseño:
- `lp_doc_id` BIGSERIAL PK.
- `lp_id` FK NOT NULL → core.lps. ON DELETE CASCADE: si se borra el LP
  del pipeline, su vault se va con él (no preservamos huérfanos).
- `tipo` enum textual: 11 categorías cubriendo el flujo completo.
- `nombre` TEXT — título legible.
- `fecha_firma` DATE NULL — cuándo se firmó/emitió.
- `fecha_vigencia_hasta` DATE NULL — para docs con expiry (pasaporte,
  poder notarial). Usado por el partial index para alertas.
- `monto_clp` NUMERIC(18,2) NULL — para recibos de aporte.
- `dropbox_path` TEXT NULL — ruta absoluta al PDF.
- `hash_sha256` TEXT NULL — para detectar cambios sin re-versionar.
- `estado` enum: vigente | vencido | borrador | archivado.
- `metadata` JSONB — extras no estructurados (firmantes, notario,
  número de folio, observaciones del compliance officer).
- `uploaded_by` UUID NULL — Supabase user_id del que subió el doc.
- `created_at` / `updated_at` standard.

Nota: a diferencia de `policies_fondo`, NO hay UNIQUE constraint
porque un LP puede tener múltiples docs del mismo tipo (varios recibos
de aporte, side letters de distintos años, etc.).

Borrado físico OK (cascade desde lps). Las políticas del fondo se
derogan; los docs LP se borran si el GP lo decide (típicamente nunca,
pero está permitido).
"""
from __future__ import annotations

from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.lp_documents (
            lp_doc_id              BIGSERIAL PRIMARY KEY,
            lp_id                  BIGINT NOT NULL
                                   REFERENCES core.lps(lp_id) ON DELETE CASCADE,
            tipo                   TEXT NOT NULL CHECK (tipo IN (
                'contrato_suscripcion',
                'kyc',
                'ddq',
                'side_letter',
                'aml_pep',
                'recibo_aporte',
                'acta_aprobacion',
                'w8_w9_tax',
                'dni_pasaporte',
                'power_of_attorney',
                'otro'
            )),
            nombre                 TEXT NOT NULL,
            fecha_firma            DATE,
            fecha_vigencia_hasta   DATE,
            monto_clp              NUMERIC(18, 2),
            dropbox_path           TEXT,
            hash_sha256            TEXT,
            estado                 TEXT NOT NULL DEFAULT 'vigente'
                                   CHECK (estado IN (
                                       'vigente', 'vencido', 'borrador', 'archivado'
                                   )),
            metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
            uploaded_by            UUID,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lp_documents_lp_id "
        "ON core.lp_documents(lp_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lp_documents_tipo "
        "ON core.lp_documents(tipo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lp_documents_estado "
        "ON core.lp_documents(estado);"
    )
    # Partial index para alertas de vencimientos próximos: solo docs
    # vigentes con fecha de expiry definida. Lo usa el cron de
    # reminders y la pantalla de "vencimientos en 30 días".
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lp_documents_vigencia "
        "ON core.lp_documents(fecha_vigencia_hasta) "
        "WHERE fecha_vigencia_hasta IS NOT NULL AND estado = 'vigente';"
    )

    # Trigger para updated_at — usa la función `touch_updated_at()` que
    # vive en el schema public, definida en `db/schema.sql:372`.
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.lp_documents
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.lp_documents;")
    op.execute("DROP TABLE IF EXISTS core.lp_documents;")
