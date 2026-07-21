"""OAuth CSRF state compartido entre máquinas — arregla la reconexión de Dropbox.

Bug que esto cierra (detectado 2026-07-21 con logs de Fly):
    21:46:07  GET /dropbox/connect   → 200  (máquina 784792dc672e58)
    21:46:31  GET /dropbox/callback  → 400  (máquina e82d444c629de8)

`app/api/v1/dropbox.py` guardaba el CSRF token del flow OAuth en un dict
en memoria del proceso (`_oauth_session`). La app corre con 2 máquinas en
Fly detrás del balanceador, así que `/callback` casi siempre cae en una
máquina distinta a la que atendió `/connect` — esa no tiene el token en su
memoria y `DropboxOAuth2Flow.finish()` aborta con BadState → 400.

Efecto real: era IMPOSIBLE reconectar Dropbox (y por lo tanto imposible
sumar el permiso de escritura `files.content.write`). La conexión seguía
sirviendo solo lectura desde el 07-05-2026.

Fix: el state pasa a Postgres, que las 2 máquinas sí comparten.
Uso único (el callback lo borra al leerlo) y vencimiento de 15 minutos,
que además protege contra replay.
"""
from __future__ import annotations

from alembic import op

revision = "0069_oauth_states"
down_revision = "0068_oc_firmas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.oauth_states (
            provider   TEXT PRIMARY KEY,
            csrf_token TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.oauth_states")
