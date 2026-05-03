"""V4 fase 9 — Informes LP virales (foundation backend).

Sistema de reportes a inversionistas con tracking viral 1→N. Cada LP
recibe un token único; cuando comparte, se genera un child_token con
parent_token apuntando al original — así trackeamos cohort viral.

Tablas:
1. core.lps — pipeline + activos. Master list de inversionistas.
2. app.informes_lp — un row por informe generado, con snapshot del
   contenido + token URL-safe.
3. app.informes_lp_eventos — log granular de open/scroll/share/cta_click
   para analytics. IP hasheada (SHA256+salt) para privacy.

Decisión de schema: `core` para datos del negocio (LPs son entidades del
fondo), `app` para artefactos generados por la plataforma (informes son
output de la app). Mismo criterio que `core.empresas` vs
`app.entregables_regulatorios`.

Sin CONCURRENTLY — corremos contra Supabase Transaction Pooler.
Con DDL fresh, el ALTER es <1s.
"""
from __future__ import annotations

from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------
    # 1) core.lps — pipeline + activos
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.lps (
            lp_id              BIGSERIAL PRIMARY KEY,
            nombre             TEXT NOT NULL,
            apellido           TEXT,
            email              TEXT UNIQUE,
            telefono           TEXT,
            empresa            TEXT,
            rol                TEXT,

            estado             TEXT NOT NULL DEFAULT 'pipeline'
                CHECK (estado IN (
                    'pipeline', 'cualificado', 'activo', 'inactivo', 'declinado'
                )),
            primer_contacto    DATE,

            -- Personalización del informe
            perfil_inversor    TEXT
                CHECK (perfil_inversor IS NULL OR perfil_inversor IN (
                    'conservador', 'moderado', 'agresivo', 'esg_focused'
                )),
            intereses          JSONB DEFAULT '[]'::jsonb,
            relationship_owner TEXT,

            -- Capital
            aporte_total       NUMERIC(18, 2),
            aporte_actual      NUMERIC(18, 2),
            empresas_invertidas TEXT[] DEFAULT '{}'::text[],

            notas              TEXT,
            metadata           JSONB DEFAULT '{}'::jsonb,

            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lps_estado ON core.lps(estado);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lps_email ON core.lps(email) WHERE email IS NOT NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lps_owner ON core.lps(relationship_owner);"
    )

    # -----------------------------------------------------------------
    # 2) app.informes_lp — informes generados
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.informes_lp (
            informe_id         BIGSERIAL PRIMARY KEY,
            lp_id              BIGINT REFERENCES core.lps(lp_id) ON DELETE SET NULL,

            -- Token URL-safe (32 chars, secrets.token_urlsafe(24))
            token              TEXT UNIQUE NOT NULL,
            -- Si fue creado via "share", apunta al token padre
            parent_token       TEXT REFERENCES app.informes_lp(token),

            -- Metadata del informe
            titulo             TEXT NOT NULL,
            periodo            TEXT,
            tipo               TEXT NOT NULL DEFAULT 'periodico'
                CHECK (tipo IN (
                    'periodico', 'pitch_inicial', 'update_mensual',
                    'tear_sheet', 'memoria_anual'
                )),

            -- Contenido (snapshot al momento de generación)
            hero_titulo        TEXT,
            hero_narrativa     TEXT,
            secciones          JSONB DEFAULT '{}'::jsonb,

            -- Lifecycle
            estado             TEXT NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador', 'publicado', 'archivado')),
            publicado_at       TIMESTAMPTZ,
            expira_at          TIMESTAMPTZ,

            -- Tracking agregado (denormalized para fast dashboard)
            veces_abierto      INTEGER NOT NULL DEFAULT 0,
            veces_compartido   INTEGER NOT NULL DEFAULT 0,
            tiempo_promedio_segundos INTEGER,

            -- Audit
            creado_por         TEXT,

            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_lp_lp ON app.informes_lp(lp_id);"
    )
    # token UNIQUE crea índice automático — no hace falta otro
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_lp_parent ON app.informes_lp(parent_token) WHERE parent_token IS NOT NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_lp_estado ON app.informes_lp(estado);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_lp_publicado ON app.informes_lp(publicado_at DESC) WHERE estado = 'publicado';"
    )

    # -----------------------------------------------------------------
    # 3) app.informes_lp_eventos — analytics granular
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.informes_lp_eventos (
            evento_id          BIGSERIAL PRIMARY KEY,
            informe_id         BIGINT NOT NULL
                REFERENCES app.informes_lp(informe_id) ON DELETE CASCADE,
            -- Token redundante para queries rápidas sin join
            token              TEXT NOT NULL,

            tipo               TEXT NOT NULL CHECK (tipo IN (
                'open', 'scroll', 'section_view', 'cta_click',
                'share_click', 'pdf_download', 'video_play',
                'time_spent', 'agendar_click'
            )),

            seccion            TEXT,
            valor_numerico     INTEGER,
            valor_texto        TEXT,

            -- Privacy: IP hasheada (SHA256 + salt) NUNCA cruda
            ip_hash            TEXT,
            user_agent         TEXT,
            referer            TEXT,
            pais               TEXT,

            metadata           JSONB DEFAULT '{}'::jsonb,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_eventos_informe ON app.informes_lp_eventos(informe_id, created_at);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_eventos_token ON app.informes_lp_eventos(token);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_eventos_tipo ON app.informes_lp_eventos(tipo, created_at);"
    )

    # -----------------------------------------------------------------
    # Trigger updated_at en lps + informes_lp
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION app.set_updated_at_informes_lp()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_informes_lp_updated_at ON app.informes_lp;
        CREATE TRIGGER trg_informes_lp_updated_at
        BEFORE UPDATE ON app.informes_lp
        FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_informes_lp();
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_lps_updated_at ON core.lps;
        CREATE TRIGGER trg_lps_updated_at
        BEFORE UPDATE ON core.lps
        FOR EACH ROW EXECUTE FUNCTION app.set_updated_at_informes_lp();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_lps_updated_at ON core.lps;"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_informes_lp_updated_at ON app.informes_lp;"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS app.set_updated_at_informes_lp();"
    )
    op.execute("DROP TABLE IF EXISTS app.informes_lp_eventos CASCADE;")
    op.execute("DROP TABLE IF EXISTS app.informes_lp CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.lps CASCADE;")
