"""proyectos_empresa + hitos + riesgos (V3 fase 5 — Avance / Gantt)

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-26

V3 fase 5 — habilita la sección Avance por empresa: roadmap (Gantt),
hitos con progreso y registro de riesgos. Las tres tablas son
empresa-scoped (FK a `core.empresas` directa o via `proyecto_id`).

Decisiones:
- `estado` y `severidad` son CHECK constraints (whitelist exacta).
- `progreso_pct` constrained 0..100 a nivel DB.
- Índices: por empresa, por proyecto y por severidad (parcial sobre
  riesgos abiertos — el caso de uso típico es "qué riesgos están vivos").
- RLS: lectura abierta a `authenticated`, escritura admin/finance.
"""
from __future__ import annotations

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.proyectos_empresa (
            proyecto_id          BIGSERIAL PRIMARY KEY,
            empresa_codigo       TEXT NOT NULL REFERENCES core.empresas(codigo),
            nombre               TEXT NOT NULL,
            descripcion          TEXT,
            fecha_inicio         DATE,
            fecha_fin_estimada   DATE,
            estado               TEXT NOT NULL DEFAULT 'en_progreso' CHECK (estado IN (
                'planificado','en_progreso','completado','cancelado','pausado'
            )),
            progreso_pct         INT NOT NULL DEFAULT 0 CHECK (progreso_pct BETWEEN 0 AND 100),
            owner_email          TEXT,
            dropbox_roadmap_path TEXT,
            metadata             JSONB,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS core.hitos (
            hito_id           BIGSERIAL PRIMARY KEY,
            proyecto_id       BIGINT NOT NULL REFERENCES core.proyectos_empresa(proyecto_id) ON DELETE CASCADE,
            nombre            TEXT NOT NULL,
            descripcion       TEXT,
            fecha_planificada DATE,
            fecha_completado  DATE,
            estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                'pendiente','en_progreso','completado','cancelado'
            )),
            orden             INT NOT NULL DEFAULT 0,
            progreso_pct      INT NOT NULL DEFAULT 0 CHECK (progreso_pct BETWEEN 0 AND 100),
            deliverable_url   TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS core.riesgos (
            riesgo_id          BIGSERIAL PRIMARY KEY,
            proyecto_id        BIGINT REFERENCES core.proyectos_empresa(proyecto_id) ON DELETE CASCADE,
            empresa_codigo     TEXT REFERENCES core.empresas(codigo),
            titulo             TEXT NOT NULL,
            descripcion        TEXT,
            severidad          TEXT NOT NULL DEFAULT 'media' CHECK (severidad IN (
                'alta','media','baja'
            )),
            probabilidad       TEXT NOT NULL DEFAULT 'media' CHECK (probabilidad IN (
                'alta','media','baja'
            )),
            estado             TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN (
                'abierto','mitigado','aceptado','cerrado'
            )),
            owner_email        TEXT,
            mitigacion         TEXT,
            fecha_identificado DATE NOT NULL DEFAULT CURRENT_DATE,
            fecha_cierre       DATE,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_proyectos_empresa
            ON core.proyectos_empresa(empresa_codigo);
        CREATE INDEX IF NOT EXISTS idx_hitos_proyecto
            ON core.hitos(proyecto_id);
        CREATE INDEX IF NOT EXISTS idx_riesgos_empresa
            ON core.riesgos(empresa_codigo);
        CREATE INDEX IF NOT EXISTS idx_riesgos_severidad
            ON core.riesgos(severidad)
            WHERE estado = 'abierto';

        ALTER TABLE core.proyectos_empresa ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.hitos ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.riesgos ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS proyectos_read ON core.proyectos_empresa;
        CREATE POLICY proyectos_read ON core.proyectos_empresa
            FOR SELECT TO authenticated USING (TRUE);
        DROP POLICY IF EXISTS proyectos_write ON core.proyectos_empresa;
        CREATE POLICY proyectos_write ON core.proyectos_empresa
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP POLICY IF EXISTS hitos_read ON core.hitos;
        CREATE POLICY hitos_read ON core.hitos
            FOR SELECT TO authenticated USING (TRUE);
        DROP POLICY IF EXISTS hitos_write ON core.hitos;
        CREATE POLICY hitos_write ON core.hitos
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP POLICY IF EXISTS riesgos_read ON core.riesgos;
        CREATE POLICY riesgos_read ON core.riesgos
            FOR SELECT TO authenticated USING (TRUE);
        DROP POLICY IF EXISTS riesgos_write ON core.riesgos;
        CREATE POLICY riesgos_write ON core.riesgos
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP TRIGGER IF EXISTS trg_touch_proyectos ON core.proyectos_empresa;
        CREATE TRIGGER trg_touch_proyectos
            BEFORE UPDATE ON core.proyectos_empresa
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

        DROP TRIGGER IF EXISTS trg_touch_hitos ON core.hitos;
        CREATE TRIGGER trg_touch_hitos
            BEFORE UPDATE ON core.hitos
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

        DROP TRIGGER IF EXISTS trg_touch_riesgos ON core.riesgos;
        CREATE TRIGGER trg_touch_riesgos
            BEFORE UPDATE ON core.riesgos
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.riesgos CASCADE;
        DROP TABLE IF EXISTS core.hitos CASCADE;
        DROP TABLE IF EXISTS core.proyectos_empresa CASCADE;
        """
    )
