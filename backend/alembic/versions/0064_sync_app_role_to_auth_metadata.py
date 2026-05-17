"""Round 71 — sincroniza core.user_roles.app_role -> auth.users.raw_app_meta_data.

Bug encontrado por el operador: "intente anular y crear vouchers y no me deja".
Investigando: el JWT que emite Supabase NO incluye `app_role` porque el campo
`auth.users.raw_app_meta_data.app_role` esta vacio en 45/45 users, aunque la
tabla `core.user_roles` tiene los roles correctos (1 admin + 44 finance).

El backend `security.py` extrae el rol del JWT con:
    app_role = claims.get("app_role") or claims.get("app_metadata", {}).get("app_role") or "viewer"

Si `app_metadata` no tiene `app_role`, cae al default `viewer` (read-only).
Resultado: cualquier POST a /vouchers (require_scope "voucher:write") o
/vouchers/{id}/void (require_scope "legal:write") devuelve 403, incluso para
admins. Por eso "no me deja crear ni anular".

Fix de esta migration (idempotente):
1. Backfill: UPDATE auth.users SETeando app_role desde core.user_roles para
   todas las filas donde difiera (incluye INSERT inicial si estaba vacio).
2. Trigger: AFTER INSERT/UPDATE OF app_role en core.user_roles propaga el
   cambio a auth.users.raw_app_meta_data en tiempo real, asi nunca mas
   queda desincronizado.

IMPORTANTE PARA EL OPERADOR: despues de aplicar esta migration, hay que
hacer **logout + login** una vez para que el JWT nuevo traiga el claim.
Los JWT viejos siguen siendo viewer hasta su expiracion natural (1 hora).
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0064_sync_app_role_auth"
down_revision = "0063_idx_voucher_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Backfill — copia el rol desde core.user_roles a auth.users metadata.
    op.execute(
        """
        UPDATE auth.users au
        SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb)
                                || jsonb_build_object('app_role', ur.app_role)
        FROM core.user_roles ur
        WHERE ur.user_id = au.id
          AND (au.raw_app_meta_data->>'app_role' IS DISTINCT FROM ur.app_role)
        """
    )

    # 2) Funcion + trigger — mantiene la sincronia automatica a futuro.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.sync_app_role_to_auth()
        RETURNS TRIGGER AS $$
        BEGIN
          UPDATE auth.users
          SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                                  || jsonb_build_object('app_role', NEW.app_role)
          WHERE id = NEW.user_id;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS sync_app_role_trg ON core.user_roles")
    op.execute(
        """
        CREATE TRIGGER sync_app_role_trg
        AFTER INSERT OR UPDATE OF app_role ON core.user_roles
        FOR EACH ROW
        EXECUTE FUNCTION core.sync_app_role_to_auth();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS sync_app_role_trg ON core.user_roles")
    op.execute("DROP FUNCTION IF EXISTS core.sync_app_role_to_auth()")
    # No revertimos el backfill (eso seria mas destructivo que util).
