"""V5 — Tabla `core.fondo_actas` para actas formales del FIP CEHTA.

Hoy las actas del fondo (Directorio AFIS, Comité de Inversión, Asamblea
de LPs, Comité de Vigilancia, Comité de Riesgo) viven sueltas en
Dropbox sin home en la DB. Esto es problemático porque:

  1. Auditoría CMF — el regulador puede pedir "muestren acta N°15 del
     Directorio AFIS" o "todas las actas del Comité de Inversión del
     2025" y no hay forma de listarlas/filtrarlas.
  2. Correlativos — los correlativos por órgano se llevan en planillas
     manuales, fácil saltar uno o duplicar.
  3. Quórum y acuerdos — sin estructura es imposible reportar
     "decisiones aprobadas en Q1 con quórum > X".
  4. Trazabilidad — qué acta aprobó qué inversión/política, sin esto
     se reconstruye a mano desde PDFs.

Diseño:
- `acta_id` BIGSERIAL PK.
- `tipo_organo` enum textual: `directorio_afis`, `comite_inversion`,
  `asamblea_lps`, `comite_vigilancia`, `comite_riesgo`, `otro`.
- `numero_acta` INT — correlativo dentro del tipo_organo.
- `fecha_reunion` DATE — cuándo se realizó.
- `lugar` TEXT NULL — "Santiago, oficinas Cehta" o "Videoconferencia".
- `quorum` / `quorum_total` INT NULL — asistentes / esperados.
- `presidente` / `secretario` TEXT NULL — quién presidió / tomó acta.
- `asistentes` JSONB — lista plana de nombres (o `{nombre, cargo}`).
- `temario` TEXT NULL — descripción del orden del día.
- `acuerdos` JSONB — lista de `{orden_dia, descripcion, votos_a_favor,
  votos_en_contra, abstenciones, aprobado}`.
- `dropbox_path` TEXT NULL — ruta absoluta al PDF firmado.
- `hash_sha256` TEXT NULL — para detectar cambios sin re-firmar.
- `estado` enum: `borrador` | `aprobada` | `firmada` | `archivada`.
- `metadata` JSONB — extras no estructurados.
- `created_at`/`updated_at` standard.

Idempotencia: UNIQUE (tipo_organo, numero_acta) — no se repiten
correlativos dentro del mismo órgano.

No hay FK a empresas porque estas actas son del fondo (FIP CEHTA),
NO de las empresas portfolio (esas viven en `core.legal_documents`
con `categoria='acta'`).
"""
from __future__ import annotations

from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.fondo_actas (
            acta_id        BIGSERIAL PRIMARY KEY,
            tipo_organo    TEXT NOT NULL CHECK (tipo_organo IN (
                'directorio_afis',
                'comite_inversion',
                'asamblea_lps',
                'comite_vigilancia',
                'comite_riesgo',
                'otro'
            )),
            numero_acta    INTEGER NOT NULL,
            fecha_reunion  DATE NOT NULL,
            lugar          TEXT,
            quorum         INTEGER,
            quorum_total   INTEGER,
            presidente     TEXT,
            secretario     TEXT,
            asistentes     JSONB NOT NULL DEFAULT '[]'::jsonb,
            temario        TEXT,
            acuerdos       JSONB NOT NULL DEFAULT '[]'::jsonb,
            dropbox_path   TEXT,
            hash_sha256    TEXT,
            estado         TEXT NOT NULL DEFAULT 'borrador'
                           CHECK (estado IN ('borrador', 'aprobada', 'firmada', 'archivada')),
            metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (tipo_organo, numero_acta)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fondo_actas_tipo "
        "ON core.fondo_actas(tipo_organo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fondo_actas_fecha "
        "ON core.fondo_actas(fecha_reunion DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fondo_actas_estado "
        "ON core.fondo_actas(estado);"
    )

    # Trigger para updated_at — usa la función `touch_updated_at()` que
    # vive en el schema public, definida en `db/schema.sql:372`.
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.fondo_actas
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.fondo_actas;")
    op.execute("DROP TABLE IF EXISTS core.fondo_actas;")
