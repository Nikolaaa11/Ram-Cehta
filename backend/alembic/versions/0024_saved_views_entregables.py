"""V4 fase 7.6/7.7 — Extender SavedViews a entregables, cartas_gantt,
suscripciones y calendario.

La tabla `app.saved_views` tiene un CHECK constraint cerrado sobre
la columna `page`. Para que estos módulos puedan usar `SavedViewsMenu`
(combos guardados de filtros), extendemos el enum.

Estrategia: drop + recreate del CHECK. Idempotente — primero quita
el constraint si existe y luego lo crea con el set actualizado.
"""
from __future__ import annotations

from alembic import op

revision = "0024"
down_revision: str | None = "0023"
branch_labels = None
depends_on = None


_PAGES_NEW = (
    "oc", "f29", "trabajadores", "proveedores", "legal", "fondos",
    "entregables", "cartas_gantt", "suscripciones", "calendario",
)
_PAGES_OLD = (
    "oc", "f29", "trabajadores", "proveedores", "legal", "fondos"
)


def _format_in(values: tuple[str, ...]) -> str:
    return ",".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE app.saved_views
        DROP CONSTRAINT IF EXISTS saved_views_page_check;
        """
    )
    op.execute(
        f"""
        ALTER TABLE app.saved_views
        ADD CONSTRAINT saved_views_page_check
        CHECK (page IN ({_format_in(_PAGES_NEW)}));
        """
    )


def downgrade() -> None:
    # Limpiar registros que solo existen en el set nuevo antes de
    # restaurar el CHECK antiguo (si no, falla la creación del check).
    op.execute(
        """
        DELETE FROM app.saved_views
        WHERE page IN ('entregables', 'cartas_gantt', 'suscripciones', 'calendario');
        """
    )
    op.execute(
        """
        ALTER TABLE app.saved_views
        DROP CONSTRAINT IF EXISTS saved_views_page_check;
        """
    )
    op.execute(
        f"""
        ALTER TABLE app.saved_views
        ADD CONSTRAINT saved_views_page_check
        CHECK (page IN ({_format_in(_PAGES_OLD)}));
        """
    )
