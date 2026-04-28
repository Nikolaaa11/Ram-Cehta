"""fondos (V3 fase 5 — Búsqueda de Fondos / pipeline de capital)

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-26

Base curada de inversionistas, bancos, programas estatales y family
offices alineados con la thesis del FIP CEHTA ESG. Pipeline de outreach
con estados y notas. Sectores como TEXT[] con índice GIN para filtros.
"""
from __future__ import annotations

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.fondos (
            fondo_id               BIGSERIAL PRIMARY KEY,
            nombre                 TEXT NOT NULL,
            tipo                   TEXT NOT NULL CHECK (tipo IN (
                'lp','banco','programa_estado','family_office','vc','angel','otro'
            )),
            descripcion            TEXT,
            pais                   TEXT,
            region                 TEXT,
            ticket_min_usd         NUMERIC(18,2),
            ticket_max_usd         NUMERIC(18,2),
            sectores               TEXT[],
            stage                  TEXT[],
            thesis                 TEXT,
            website                TEXT,
            contacto_nombre        TEXT,
            contacto_email         TEXT,
            contacto_linkedin      TEXT,
            estado_outreach        TEXT NOT NULL DEFAULT 'no_contactado' CHECK (estado_outreach IN (
                'no_contactado','contactado','en_negociacion','cerrado','descartado'
            )),
            fecha_proximo_contacto DATE,
            notas                  TEXT,
            metadata               JSONB,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_fondos_tipo
            ON core.fondos(tipo);
        CREATE INDEX IF NOT EXISTS idx_fondos_estado
            ON core.fondos(estado_outreach);
        CREATE INDEX IF NOT EXISTS idx_fondos_sectores
            ON core.fondos USING gin(sectores);

        ALTER TABLE core.fondos ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS fondos_read ON core.fondos;
        CREATE POLICY fondos_read ON core.fondos
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS fondos_write ON core.fondos;
        CREATE POLICY fondos_write ON core.fondos
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP TRIGGER IF EXISTS trg_touch_fondos ON core.fondos;
        CREATE TRIGGER trg_touch_fondos
            BEFORE UPDATE ON core.fondos
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.fondos CASCADE;
        """
    )
