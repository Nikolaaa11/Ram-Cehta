"""V4 fase 8.2 — `core.hitos.encargado` + indices para upcoming-tasks.

El parser de Gantt importa `encargado` de cada hito (José Cuevas, Felipe
Zúñiga, etc.) pero hasta acá lo dejábamos sólo en el dataclass interno.
Para que la Secretaria AI y el Kanban Upcoming Tasks puedan filtrar y
agregar por owner, lo persistimos en columna.

Cambios:
- ADD COLUMN `core.hitos.encargado TEXT NULL`. Nullable porque hitos
  legacy creados manualmente desde la UI no tienen encargado.
- INDEX parcial `idx_hitos_encargado_pendientes` — la query crítica del
  endpoint `GET /avance/portfolio/upcoming-tasks` filtra por
  `encargado` y `estado IN ('pendiente','en_progreso')`. Parcial es
  más barato que un índice completo (sólo indexa filas vivas).
- INDEX `idx_hitos_fecha_planificada_pendientes` — para el bucketing
  por (vencidas / hoy / esta semana / próximas) sobre filas no
  completadas. También parcial.

Sin CONCURRENTLY: corremos contra Supabase Transaction Pooler (PgBouncer
en modo txn) que rejecta CONCURRENTLY + COMMIT/BEGIN raw. Con ~3K hitos
en producción el ALTER + CREATE es <500ms — no bloquea seriamente.

Idempotencia: ADD COLUMN con IF NOT EXISTS (Postgres 9.6+) y CREATE
INDEX IF NOT EXISTS — correr la migración 2 veces es seguro.
"""
from __future__ import annotations

from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.hitos
        ADD COLUMN IF NOT EXISTS encargado TEXT NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_hitos_encargado_pendientes
        ON core.hitos (encargado, fecha_planificada)
        WHERE encargado IS NOT NULL
          AND estado IN ('pendiente', 'en_progreso');
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_hitos_fecha_planificada_pendientes
        ON core.hitos (fecha_planificada)
        WHERE fecha_planificada IS NOT NULL
          AND estado IN ('pendiente', 'en_progreso');
        """
    )
    # Compuesto proyecto + estado: hot path en HitoChecklist y group-by
    # del endpoint upcoming-tasks (lookup empresa via proyecto).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_hitos_proyecto_estado
        ON core.hitos (proyecto_id, estado);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.idx_hitos_encargado_pendientes;")
    op.execute("DROP INDEX IF EXISTS core.idx_hitos_fecha_planificada_pendientes;")
    op.execute("DROP INDEX IF EXISTS core.idx_hitos_proyecto_estado;")
    op.execute("ALTER TABLE core.hitos DROP COLUMN IF EXISTS encargado;")
