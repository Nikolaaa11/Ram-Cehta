"""Round 115 — Empresa extra data + credenciales cifradas + directorio + inversionistas.

Contexto: Nicolas envio resumen Excel con data faltante de las 9 empresas
operativas (pagina web, contabilidad, direccion SII, multiples cuentas
bancarias) ademas de claves SII + Previred, directorio formal, inversionistas
aportantes y gerentes generales.

Cambios:
  1. core.empresas — columnas nuevas (todas nullable):
       - pagina_web
       - contabilidad_proveedor (ej. 'MCG Consultores')
       - direccion_sii (la que figura en el portal, distinta de direccion
         operativa)

  2. core.empresa_credenciales — tabla nueva. Una row por (empresa, sistema).
       Campos sensibles encriptados con Fernet symetrico. La clave maestra
       vive en env var CREDENTIALS_FERNET_KEY (Fly secret).

  3. core.directorio_miembros — directorio formal del fondo. NO ES lo
       mismo que user_company_roles (que es operativo de la plataforma).

  4. core.inversionistas_aportantes — aportantes del FIP CEHTA ESG.

Las credenciales SII y Previred del Excel van encriptadas en (2). Nunca
se loguean ni se devuelven en plaintext via API — solo el modulo
credentials_service.decrypt_credential las puede leer.
"""
from __future__ import annotations

from alembic import op

revision = "0067_empresa_extra_data"
down_revision = "0066_proy_aportes"
branch_labels = None
depends_on = None


SISTEMAS_CREDENCIAL = ["sii", "previred"]


def upgrade() -> None:
    # 1. Extender core.empresas
    op.execute(
        """
        ALTER TABLE core.empresas
            ADD COLUMN IF NOT EXISTS pagina_web TEXT,
            ADD COLUMN IF NOT EXISTS contabilidad_proveedor TEXT,
            ADD COLUMN IF NOT EXISTS direccion_sii TEXT;
        """
    )

    # 2. core.empresa_credenciales
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.empresa_credenciales (
            credencial_id   BIGSERIAL PRIMARY KEY,
            empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            sistema         TEXT NOT NULL,
            rut_usuario     TEXT NOT NULL,
            password_encrypted TEXT NOT NULL,
            notas           TEXT,
            ultima_validacion_at TIMESTAMPTZ,
            ultima_validacion_ok BOOLEAN,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_sistema CHECK (sistema IN ('sii', 'previred')),
            CONSTRAINT uq_empresa_sistema UNIQUE (empresa_codigo, sistema)
        );
        CREATE INDEX IF NOT EXISTS idx_empresa_cred_sistema
            ON core.empresa_credenciales(sistema);
        """
    )

    # 3. core.directorio_miembros
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.directorio_miembros (
            miembro_id      BIGSERIAL PRIMARY KEY,
            nombre          TEXT NOT NULL,
            rut             TEXT,
            direccion       TEXT,
            telefono        TEXT,
            banco           TEXT,
            cuenta          TEXT,
            codigo_banco    TEXT,
            correo          TEXT,
            activo          BOOLEAN NOT NULL DEFAULT TRUE,
            notas           TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_directorio_activo
            ON core.directorio_miembros(activo) WHERE activo = TRUE;
        """
    )

    # 4. core.inversionistas_aportantes
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.inversionistas_aportantes (
            inversionista_id BIGSERIAL PRIMARY KEY,
            nombre          TEXT NOT NULL,
            rut             TEXT,
            direccion       TEXT,
            telefono        TEXT,
            banco           TEXT,
            cuenta          TEXT,
            codigo_banco    TEXT,
            correo          TEXT,
            tipo            TEXT NOT NULL DEFAULT 'aportante',
            activo          BOOLEAN NOT NULL DEFAULT TRUE,
            notas           TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_tipo_inversionista CHECK (tipo IN ('aportante', 'inversionista'))
        );
        CREATE INDEX IF NOT EXISTS idx_inversionistas_activo
            ON core.inversionistas_aportantes(activo) WHERE activo = TRUE;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.inversionistas_aportantes")
    op.execute("DROP TABLE IF EXISTS core.directorio_miembros")
    op.execute("DROP TABLE IF EXISTS core.empresa_credenciales")
    op.execute(
        """
        ALTER TABLE core.empresas
            DROP COLUMN IF EXISTS pagina_web,
            DROP COLUMN IF EXISTS contabilidad_proveedor,
            DROP COLUMN IF EXISTS direccion_sii;
        """
    )
