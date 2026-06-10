-- =====================================================================
-- Round 126 — Sistema de monitoreo automatizado + auto-sync
-- =====================================================================
-- INSTRUCCIONES PARA NICOLAS:
--   1. Supabase Studio → SQL Editor → New query
--   2. Pegá todo y RUN
-- =====================================================================

-- 1. Health checks: cada 10 min se inserta una fila con métricas
CREATE TABLE IF NOT EXISTS core.system_health_checks (
    check_id            BIGSERIAL PRIMARY KEY,
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Resultado básico
    backend_status      TEXT NOT NULL,           -- 'alive' | 'down' | 'degraded'
    backend_response_ms INTEGER,
    -- DB pool (de /health/perf)
    db_pool_size        INTEGER,
    db_pool_in_use      INTEGER,
    -- Contadores de errores en últimos 10 min (de logs Fly)
    errors_5xx_10min    INTEGER NOT NULL DEFAULT 0,
    tracebacks_10min    INTEGER NOT NULL DEFAULT 0,
    emaxconn_10min      INTEGER NOT NULL DEFAULT 0,
    sse_evictions_10min INTEGER NOT NULL DEFAULT 0,
    -- Backups
    last_backup_at      TIMESTAMPTZ,
    last_backup_age_hours INTEGER,
    -- Vouchers stuck
    drafts_over_7d      INTEGER NOT NULL DEFAULT 0,
    pendings_over_5d    INTEGER NOT NULL DEFAULT 0,
    -- Conciliación
    sii_docs_unmatched_30d INTEGER NOT NULL DEFAULT 0,
    -- Detalles si hay anomalía
    anomalies_detected  JSONB,
    notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_checked_at
    ON core.system_health_checks(checked_at DESC);
-- Solo mantenemos 30 días — los más viejos se borran en cleanup weekly
CREATE INDEX IF NOT EXISTS idx_health_anomalies
    ON core.system_health_checks(checked_at DESC)
    WHERE anomalies_detected IS NOT NULL;

-- 2. Incidentes (cuando el monitor detecta algo grave)
CREATE TABLE IF NOT EXISTS core.system_incidents (
    incident_id         BIGSERIAL PRIMARY KEY,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    severity            TEXT NOT NULL DEFAULT 'WARNING',
    category            TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    metrics             JSONB,
    -- Estado del incidente
    status              TEXT NOT NULL DEFAULT 'OPEN',
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     UUID,
    resolved_at         TIMESTAMPTZ,
    resolution_notes    TEXT,
    -- Notificación
    notified_at         TIMESTAMPTZ,
    notification_channel TEXT,
    -- Health check que lo originó
    health_check_id     BIGINT REFERENCES core.system_health_checks(check_id),
    CONSTRAINT chk_severity CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    CONSTRAINT chk_inc_status CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_open
    ON core.system_incidents(detected_at DESC) WHERE status != 'RESOLVED';

-- 3. Auto-sync runs (sync diario de SII + Nubox)
CREATE TABLE IF NOT EXISTS core.auto_sync_runs (
    run_id              BIGSERIAL PRIMARY KEY,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    -- Stats por empresa
    empresas_processed  INTEGER NOT NULL DEFAULT 0,
    sii_sync_ok         INTEGER NOT NULL DEFAULT 0,
    sii_sync_failed     INTEGER NOT NULL DEFAULT 0,
    nubox_sync_ok       INTEGER NOT NULL DEFAULT 0,
    nubox_sync_failed   INTEGER NOT NULL DEFAULT 0,
    conciliations_run   INTEGER NOT NULL DEFAULT 0,
    -- Detalle por empresa
    empresa_results     JSONB,
    status              TEXT NOT NULL DEFAULT 'STARTED',
    error_message       TEXT,
    -- R152HHHHHH — 'RATE_LIMITED': el SII detectó "consultas recurrentes"
    -- y el cron abortó el resto del run para evitar ban de IP.
    CONSTRAINT chk_auto_sync_status CHECK (status IN ('STARTED', 'OK', 'PARTIAL', 'FAILED', 'RATE_LIMITED'))
);
CREATE INDEX IF NOT EXISTS idx_auto_sync_started
    ON core.auto_sync_runs(started_at DESC);

-- R152HHHHHH — Idempotente: si la tabla ya existía con el constraint viejo
-- (sin 'RATE_LIMITED'), lo reemplazamos. Seguro de correr múltiples veces.
DO $$
BEGIN
    ALTER TABLE core.auto_sync_runs DROP CONSTRAINT IF EXISTS chk_auto_sync_status;
    ALTER TABLE core.auto_sync_runs ADD CONSTRAINT chk_auto_sync_status
        CHECK (status IN ('STARTED', 'OK', 'PARTIAL', 'FAILED', 'RATE_LIMITED'));
END $$;

SELECT 'core.system_health_checks' AS tabla,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'system_health_checks') AS existe
UNION ALL
SELECT 'core.system_incidents',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'system_incidents')
UNION ALL
SELECT 'core.auto_sync_runs',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'auto_sync_runs');
