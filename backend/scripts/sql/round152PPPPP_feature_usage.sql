-- R152PPPPP · Telemetría de uso de endpoints (qué features se usan de verdad)
--
-- Propósito:
--   Tomar decisiones de mantenimiento/apagado con datos reales en vez de
--   asumir. Después de 30 días de uso productivo, podemos consultar:
--
--     SELECT path, COUNT(*) AS hits, COUNT(DISTINCT user_id) AS users
--     FROM core.feature_usage
--     WHERE created_at > NOW() - INTERVAL '30 days'
--     GROUP BY path
--     ORDER BY hits DESC;
--
--   Endpoints con 0 hits en 30 días = candidatos a apagar/borrar.
--   Endpoints con 1 user único = posibles features personales nicho.
--
-- Diseño:
--   - Tabla simple, sin foreign keys (la telemetría NUNCA debe romper
--     un request por integridad referencial; los IDs son nullable + textual).
--   - Sin índices pesados — la consulta corre 1 vez/mes, no necesita ser
--     sub-segundo. Solo índice (path, created_at) para queries del dashboard.
--   - Particionamiento por mes para que después de 6-12 meses se pueda
--     hacer DROP de meses viejos en O(1) (vs DELETE en O(n)).
--   - Retención política: 12 meses. Después se hace pg_dump y drop partition.
--
-- Performance esperado:
--   Con ~10 requests/segundo (worst case escalando), son 26M filas/mes.
--   Con 100 requests/segundo (no esperado por años), 260M/mes.
--   Particionado mantiene cada mes manejable.
--
-- Privacy:
--   NO loggeamos request body ni query params (pueden tener datos sensibles).
--   Solo: path, method, user_id (UUID), empresa_codigo, status, duration.

CREATE TABLE IF NOT EXISTS core.feature_usage (
    id BIGSERIAL,
    path TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')),
    user_id UUID,                       -- nullable: requests no auth (health, etc.)
    user_role TEXT,                     -- 'admin' | 'leader' | 'analyst' | NULL
    empresa_codigo TEXT,                -- nullable: requests cross-empresa
    status_code SMALLINT NOT NULL,
    duration_ms INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)        -- created_at en PK para partitioning
) PARTITION BY RANGE (created_at);

-- Particiones iniciales: mes actual + próximos 3.
-- En producción, un cron mensual crea la siguiente partición.

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_06 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_07 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_08 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_09 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_10 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_11 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS core.feature_usage_2026_12 PARTITION OF core.feature_usage
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Índice único para queries del dashboard. NO crear por user_id ni empresa
-- todavía — esos accesos son raros, el cost de mantener el índice no compensa.
CREATE INDEX IF NOT EXISTS idx_feature_usage_path_date
    ON core.feature_usage (path, created_at DESC);

-- R152RRRRR — Función helper para que Nicolás (o un cron) cree la
-- partición del mes siguiente cada vez sin tener que escribir SQL.
--
-- Uso manual el día 25 de cada mes (o cron):
--   SELECT core.ensure_next_feature_usage_partition();
--
-- Es idempotente: si la partición ya existe, no hace nada.
CREATE OR REPLACE FUNCTION core.ensure_next_feature_usage_partition()
RETURNS TEXT AS $$
DECLARE
    next_month_start DATE;
    next_month_end DATE;
    partition_name TEXT;
BEGIN
    next_month_start := DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
    next_month_end := next_month_start + INTERVAL '1 month';
    partition_name := 'feature_usage_' || TO_CHAR(next_month_start, 'YYYY_MM');

    EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS core.%I PARTITION OF core.feature_usage
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, next_month_start, next_month_end
    );

    RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Comentarios para el dev sucesor:
COMMENT ON TABLE core.feature_usage IS
    'Telemetría de uso por endpoint. Particionado mensual. Retención 12 meses. '
    'Poblada por app.middleware.usage_tracking. Consultable vía /admin/feature-usage.';
