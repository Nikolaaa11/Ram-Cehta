"""calendar_events (V3 fase 5 — Calendario + Agentes scheduled)

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-26

Calendario tipo Google Calendar para eventos del reglamento interno
(F29 mensual, reportes LP, comités) + ad-hoc. Algunos eventos los
generan agentes (auto_generado=true) y otros los crea un humano.
"""
from __future__ import annotations

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.calendar_events (
            event_id             BIGSERIAL PRIMARY KEY,
            titulo               TEXT NOT NULL,
            descripcion          TEXT,
            tipo                 TEXT NOT NULL CHECK (tipo IN (
                'f29','reporte_lp','comite','reporte_trimestral','vencimiento','otro'
            )),
            empresa_codigo       TEXT REFERENCES core.empresas(codigo),
            fecha_inicio         TIMESTAMPTZ NOT NULL,
            fecha_fin            TIMESTAMPTZ,
            todo_el_dia          BOOLEAN NOT NULL DEFAULT TRUE,
            recurrencia          TEXT,
            notificar_dias_antes INT NOT NULL DEFAULT 3,
            notificar_emails     TEXT[],
            metadata             JSONB,
            auto_generado        BOOLEAN NOT NULL DEFAULT FALSE,
            completado           BOOLEAN NOT NULL DEFAULT FALSE,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_calendar_fecha
            ON core.calendar_events(fecha_inicio);
        CREATE INDEX IF NOT EXISTS idx_calendar_empresa
            ON core.calendar_events(empresa_codigo);
        CREATE INDEX IF NOT EXISTS idx_calendar_tipo
            ON core.calendar_events(tipo);

        ALTER TABLE core.calendar_events ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS calendar_read ON core.calendar_events;
        CREATE POLICY calendar_read ON core.calendar_events
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS calendar_write ON core.calendar_events;
        CREATE POLICY calendar_write ON core.calendar_events
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP TRIGGER IF EXISTS trg_touch_calendar ON core.calendar_events;
        CREATE TRIGGER trg_touch_calendar
            BEFORE UPDATE ON core.calendar_events
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.calendar_events CASCADE;
        """
    )
