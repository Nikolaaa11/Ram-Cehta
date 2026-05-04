"""V5 — Tabla `core.policies_fondo` para políticas internas del FIP.

Hoy las políticas del fondo (reglamento interno, manual prevención
lavado activos UAF, código de ética, política PEP, política inversión,
etc.) viven sueltas en Dropbox sin home en la DB. Esto es problemático
porque:

  1. Auditoría CMF — el regulador puede pedir "muestren reglamento
     interno vigente firmado al 2026-01-01" y no hay forma de listarlo
     versionado en la app.
  2. Vigencia — algunas políticas tienen fecha de revisión obligatoria
     (UAF exige revisión anual del manual). Sin tabla, no hay alerta.
  3. Trazabilidad — quién aprobó qué versión, cuándo, sin esto no se
     sabe.

Diseño:
- `policy_id` BIGSERIAL PK.
- `tipo` enum textual: `reglamento_interno`, `manual_uaf`, `codigo_etica`,
  `politica_pep`, `politica_inversion`, `politica_riesgo`,
  `politica_conflicto_interes`, `manual_compliance`, `otro`.
- `nombre` TEXT — título legible.
- `version` TEXT — semver libre ("v1.0", "2026-01", "Rev. 3").
- `fecha_aprobacion` DATE — cuándo se firmó/aprobó.
- `fecha_vigencia_desde` DATE NULL — opcional, default = fecha_aprobacion.
- `fecha_proxima_revision` DATE NULL — para alertas de revisión.
- `aprobado_por` TEXT — nombre+rol ("Guido Rietta · GP" o "Directorio
  AFIS · Acta N°15").
- `dropbox_path` TEXT NULL — ruta absoluta al PDF en Dropbox.
- `hash_sha256` TEXT NULL — para detectar cambios sin re-versionar.
- `estado` enum: `vigente` | `derogada` | `borrador`.
- `metadata` JSONB — extras no estructurados (firmantes, observaciones).
- `created_at`/`updated_at` standard.

Idempotencia: UNIQUE (tipo, version) — no se pueden subir dos versiones
iguales del mismo tipo.

No hay FK a empresas porque estas políticas son del fondo (FIP CEHTA),
NO de las empresas portfolio (esas viven en `core.legal_documents`).
"""
from __future__ import annotations

from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.policies_fondo (
            policy_id              BIGSERIAL PRIMARY KEY,
            tipo                   TEXT NOT NULL CHECK (tipo IN (
                'reglamento_interno',
                'manual_uaf',
                'codigo_etica',
                'politica_pep',
                'politica_inversion',
                'politica_riesgo',
                'politica_conflicto_interes',
                'manual_compliance',
                'otro'
            )),
            nombre                 TEXT NOT NULL,
            version                TEXT NOT NULL,
            fecha_aprobacion       DATE NOT NULL,
            fecha_vigencia_desde   DATE,
            fecha_proxima_revision DATE,
            aprobado_por           TEXT,
            dropbox_path           TEXT,
            hash_sha256            TEXT,
            estado                 TEXT NOT NULL DEFAULT 'vigente'
                                   CHECK (estado IN ('vigente', 'derogada', 'borrador')),
            metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (tipo, version)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_policies_fondo_tipo "
        "ON core.policies_fondo(tipo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_policies_fondo_estado "
        "ON core.policies_fondo(estado);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_policies_fondo_proxima_revision "
        "ON core.policies_fondo(fecha_proxima_revision) "
        "WHERE fecha_proxima_revision IS NOT NULL AND estado = 'vigente';"
    )

    # Trigger para updated_at — usa la función `touch_updated_at()` que
    # vive en el schema public, definida en `db/schema.sql:372`.
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.policies_fondo
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.policies_fondo;")
    op.execute("DROP TABLE IF EXISTS core.policies_fondo;")
