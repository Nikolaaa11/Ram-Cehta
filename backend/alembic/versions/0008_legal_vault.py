"""legal_documents (V3 fase 3+4 — Legal Vault por empresa)

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-26

V3 fase 3+4 — habilita la bóveda legal por empresa: contratos, actas,
declaraciones SII, permisos, pólizas, estatutos, etc. El binario vive en
Dropbox (`/Cehta Capital/01-Empresas/{codigo}/03-Legal/...`); en DB sólo
guardamos metadatos + ruta dropbox.

Decisiones:
- `categoria` y `estado` son CHECK constraints (whitelist exacta).
- Vista `core.v_legal_alerts` materializa los días para vencer y el nivel de
  alerta (vencido/critico/proximo/ok) — usado por el endpoint de alertas y
  por los notifications mailers.
- RLS: lectura abierta a `authenticated` (el backend filtra por empresa);
  escritura via `app.core.rbac` (admin/finance pueden crear/editar; sólo
  admin elimina). Mismo patrón que `trabajadores`.
"""
from __future__ import annotations

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- Bóveda legal empresa-scoped
        CREATE TABLE IF NOT EXISTS core.legal_documents (
            documento_id           BIGSERIAL PRIMARY KEY,
            empresa_codigo         TEXT NOT NULL REFERENCES core.empresas(codigo),
            categoria              TEXT NOT NULL CHECK (categoria IN (
                'contrato','acta','declaracion_sii','permiso','poliza','estatuto','otro'
            )),
            subcategoria           TEXT,
            nombre                 TEXT NOT NULL,
            descripcion            TEXT,
            contraparte            TEXT,
            fecha_emision          DATE,
            fecha_vigencia_desde   DATE,
            fecha_vigencia_hasta   DATE,
            monto                  NUMERIC(18,2),
            moneda                 TEXT,
            dropbox_path           TEXT,
            estado                 TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN (
                'vigente','vencido','renovado','cancelado','borrador'
            )),
            metadata               JSONB,
            uploaded_by            UUID,
            uploaded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_legal_empresa
            ON core.legal_documents(empresa_codigo);
        CREATE INDEX IF NOT EXISTS idx_legal_categoria
            ON core.legal_documents(categoria);
        CREATE INDEX IF NOT EXISTS idx_legal_vigencia
            ON core.legal_documents(fecha_vigencia_hasta)
            WHERE estado = 'vigente';

        -- Vista de alertas de vencimiento para Dashboard CEO + emails.
        CREATE OR REPLACE VIEW core.v_legal_alerts AS
        SELECT
            documento_id,
            empresa_codigo,
            categoria,
            nombre,
            contraparte,
            fecha_vigencia_hasta,
            (fecha_vigencia_hasta - CURRENT_DATE) AS dias_para_vencer,
            CASE
                WHEN fecha_vigencia_hasta < CURRENT_DATE THEN 'vencido'
                WHEN fecha_vigencia_hasta - CURRENT_DATE <= 30 THEN 'critico'
                WHEN fecha_vigencia_hasta - CURRENT_DATE <= 90 THEN 'proximo'
                ELSE 'ok'
            END AS alerta_nivel
        FROM core.legal_documents
        WHERE estado = 'vigente' AND fecha_vigencia_hasta IS NOT NULL;

        -- RLS: misma política que trabajadores.
        ALTER TABLE core.legal_documents ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS legal_read ON core.legal_documents;
        CREATE POLICY legal_read ON core.legal_documents
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS legal_write ON core.legal_documents;
        CREATE POLICY legal_write ON core.legal_documents
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP TRIGGER IF EXISTS trg_touch_legal ON core.legal_documents;
        CREATE TRIGGER trg_touch_legal
            BEFORE UPDATE ON core.legal_documents
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP VIEW IF EXISTS core.v_legal_alerts;
        DROP TABLE IF EXISTS core.legal_documents CASCADE;
        """
    )
