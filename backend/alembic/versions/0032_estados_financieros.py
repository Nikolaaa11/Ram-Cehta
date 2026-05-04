"""V5 — Tabla `core.estados_financieros` para EEFF de empresas portfolio.

Hoy los Estados Financieros (Balance, Estado de Resultados, Flujo de Caja,
Cambios de Patrimonio, Consolidados, Notas) viven sueltos en Dropbox bajo
`/Cehta Capital/01-Empresas/{cod}/04-Financiero/Estados Financieros/`
(subcarpetas: Mensuales, Trimestrales, Semestrales, Anuales) sin home en
la DB. Esto es problemático porque:

  1. Auditoría CMF — el regulador puede pedir "muestren EEFF auditados de
     INKAFLEX al cierre 2025" y no hay query para listarlo.
  2. Trazabilidad de aprobación — cuándo el directorio aprobó qué EEFF,
     quién auditó, sin tabla no se sabe.
  3. Alertas — EEFF sin auditar más antiguos de 90 días deberían disparar
     un aviso al GP. Sin tabla no hay forma.

Diseño:
- `ef_id` BIGSERIAL PK.
- `empresa_codigo` FK NOT NULL → core.empresas(codigo). ON DELETE CASCADE:
  si se elimina la empresa portfolio del set, sus EEFF se van con ella.
- `tipo_ef` enum textual: `balance`, `estado_resultados`, `flujo_caja`,
  `cambios_patrimonio`, `consolidado`, `notas`.
- `periodo_tipo` enum textual: `mensual`, `trimestral`, `semestral`, `anual`.
- `periodo` TEXT — formato libre ("2025-Q4" / "2026-03" / "2025-anual").
- `fecha_corte` DATE — último día del período (usado para sort y filtros).
- `auditado` BOOLEAN — si está auditado externamente.
- `auditor` TEXT NULL — ej. "Deloitte", "PwC", "Interno".
- `aprobado_directorio` BOOLEAN — aprobado por directorio de la empresa.
- `fecha_aprobacion` DATE NULL.
- `dropbox_path` TEXT NULL — ruta absoluta al PDF/XLSX.
- `hash_sha256` TEXT NULL — para detectar cambios sin re-versionar.
- `metadata` JSONB — KPIs extraídos del EEFF (ingresos, costos, utilidad,
  EBITDA, flujo operacional, etc.) — alimenta dashboards.
- `created_at` / `updated_at` standard.

Idempotencia: UNIQUE (empresa_codigo, tipo_ef, periodo) — no se pueden
subir dos versiones del mismo tipo+periodo para una empresa (la última
sobrescribe vía PATCH si fuera necesario). Compatible con sync Dropbox
idempotente vía ON CONFLICT DO NOTHING.

Indices:
- `empresa_codigo` para joins/filtros por empresa.
- `fecha_corte DESC` para ordenar el listado cross-empresa (último cierre
  primero, default UI).
- Partial sobre `auditado=false` — habilita la query rápida "EEFF sin
  auditar más antiguos de 90 días" para alertas al GP, sin escanear la
  tabla entera.
"""
from __future__ import annotations

from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.estados_financieros (
            ef_id                BIGSERIAL PRIMARY KEY,
            empresa_codigo       TEXT NOT NULL
                                 REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            tipo_ef              TEXT NOT NULL CHECK (tipo_ef IN (
                'balance',
                'estado_resultados',
                'flujo_caja',
                'cambios_patrimonio',
                'consolidado',
                'notas'
            )),
            periodo_tipo         TEXT NOT NULL CHECK (periodo_tipo IN (
                'mensual',
                'trimestral',
                'semestral',
                'anual'
            )),
            periodo              TEXT NOT NULL,
            fecha_corte          DATE NOT NULL,
            auditado             BOOLEAN NOT NULL DEFAULT false,
            auditor              TEXT,
            aprobado_directorio  BOOLEAN NOT NULL DEFAULT false,
            fecha_aprobacion     DATE,
            dropbox_path         TEXT,
            hash_sha256          TEXT,
            metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (empresa_codigo, tipo_ef, periodo)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_estados_financieros_empresa "
        "ON core.estados_financieros(empresa_codigo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_estados_financieros_fecha_corte "
        "ON core.estados_financieros(fecha_corte DESC);"
    )
    # Partial index para alertas "EEFF sin auditar más antiguos de 90 días".
    # Solo indexa filas con auditado=false → query barato incluso con miles
    # de EEFF auditados acumulados. Usado por el cron de reminders al GP.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_estados_financieros_no_auditados "
        "ON core.estados_financieros(fecha_corte) "
        "WHERE auditado = false;"
    )

    # Trigger para updated_at — usa la función `touch_updated_at()` que
    # vive en el schema public, definida en `db/schema.sql:372`.
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.estados_financieros
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.estados_financieros;")
    op.execute("DROP TABLE IF EXISTS core.estados_financieros;")
