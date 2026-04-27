"""trabajadores HR module + documentos uploaded a Dropbox

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-26

V3 fase 2 — habilita tracking de empleados por empresa del portafolio Cehta y
custodia de su carpeta documental en Dropbox.

Decisiones:
- `trabajadores` es **empresa-scoped**: FK a `core.empresas(codigo)` y UNIQUE
  `(empresa_codigo, rut)`. Un mismo RUT puede aparecer en distintas empresas
  (ej: ejecutivo cross-portfolio).
- `dropbox_folder` guarda el path absoluto en Dropbox (single-tenant);
  el path canónico es
  `/Cehta Capital/01-Empresas/{codigo}/02-Trabajadores/Activos/{rut} - {nombre}/`.
  Se calcula al crear y se rota en `mark_inactive` (mueve a `Inactivos/`).
- `trabajador_documentos` lleva la lista de archivos custodiados (contrato,
  liquidaciones, anexos, etc.). El binario vive en Dropbox; sólo guardamos
  el path + metadatos.
- RLS: lectura para cualquier `authenticated` (el backend filtra por empresa
  según las reglas de negocio); escritura sólo para admin/finance vía
  `public.app_role()` — alineado con la matriz canónica `app.core.rbac`.
"""
from __future__ import annotations

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- Trabajadores (employees) per empresa
        CREATE TABLE IF NOT EXISTS core.trabajadores (
            trabajador_id     BIGSERIAL PRIMARY KEY,
            empresa_codigo    TEXT NOT NULL REFERENCES core.empresas(codigo),
            nombre_completo   TEXT NOT NULL,
            rut               TEXT NOT NULL,
            cargo             TEXT,
            email             TEXT,
            telefono          TEXT,
            fecha_ingreso     DATE NOT NULL,
            fecha_egreso      DATE,
            sueldo_bruto      NUMERIC(18,2),
            tipo_contrato     TEXT CHECK (tipo_contrato IN ('indefinido','plazo_fijo','honorarios','part_time')),
            estado            TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','licencia')),
            dropbox_folder    TEXT,
            notas             TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (empresa_codigo, rut)
        );

        CREATE INDEX IF NOT EXISTS idx_trabajadores_empresa
            ON core.trabajadores(empresa_codigo);
        CREATE INDEX IF NOT EXISTS idx_trabajadores_estado
            ON core.trabajadores(estado);
        CREATE INDEX IF NOT EXISTS idx_trabajadores_rut
            ON core.trabajadores(rut);

        -- Documentos uploaded por trabajador
        CREATE TABLE IF NOT EXISTS core.trabajador_documentos (
            documento_id      BIGSERIAL PRIMARY KEY,
            trabajador_id     BIGINT NOT NULL REFERENCES core.trabajadores(trabajador_id) ON DELETE CASCADE,
            tipo              TEXT NOT NULL,
            nombre_archivo    TEXT NOT NULL,
            dropbox_path      TEXT NOT NULL,
            tamano_bytes      BIGINT,
            uploaded_by       UUID,
            uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata          JSONB
        );

        CREATE INDEX IF NOT EXISTS idx_trab_docs_trabajador
            ON core.trabajador_documentos(trabajador_id);
        CREATE INDEX IF NOT EXISTS idx_trab_docs_tipo
            ON core.trabajador_documentos(tipo);

        -- RLS: cada empresa ve solo sus trabajadores (backend filtra por empresa).
        ALTER TABLE core.trabajadores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE core.trabajador_documentos ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS trabajadores_read ON core.trabajadores;
        CREATE POLICY trabajadores_read ON core.trabajadores
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS trabajadores_write ON core.trabajadores;
        CREATE POLICY trabajadores_write ON core.trabajadores
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        DROP POLICY IF EXISTS trab_docs_read ON core.trabajador_documentos;
        CREATE POLICY trab_docs_read ON core.trabajador_documentos
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS trab_docs_write ON core.trabajador_documentos;
        CREATE POLICY trab_docs_write ON core.trabajador_documentos
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));

        -- Triggers para updated_at
        DROP TRIGGER IF EXISTS trg_touch_trabajadores ON core.trabajadores;
        CREATE TRIGGER trg_touch_trabajadores
            BEFORE UPDATE ON core.trabajadores
            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.trabajador_documentos CASCADE;
        DROP TABLE IF EXISTS core.trabajadores CASCADE;
        """
    )
