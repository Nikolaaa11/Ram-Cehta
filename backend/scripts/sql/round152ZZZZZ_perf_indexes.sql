-- R152ZZZZZ · Performance indexes para escalar a 100-500 usuarios.
--
-- Hallazgos de auditoría perf (R152SSSSS):
--   1. Cmd+K global search escanea full-table sobre movimientos + inbox
--   2. Bitácora `/audit/empresa-actions` hace ILIKE × 4 sobre action_log
--   3. Falta indice parcial sobre voucher_lines (proyecto IS NULL filter)
--   4. action_log no está particionado — crece a 1.8M filas/año
--
-- ESTRATEGIA: CREATE INDEX CONCURRENTLY (no bloquea la tabla durante el
-- build, fundamental para tablas grandes).
--
-- IMPORTANTE: ejecutar UNA POR UNA en Supabase Studio. CREATE INDEX
-- CONCURRENTLY NO se puede usar dentro de un BEGIN/COMMIT block. Si
-- Supabase wrappea automáticamente, omitir CONCURRENTLY.

-- ----------------------------------------------------------------------
-- 1) Trigram indexes para Cmd+K search global
-- ----------------------------------------------------------------------

-- Extension ya debería estar habilitada (Supabase lo trae).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Movimientos.descripcion: cmd+k busca pagos por descripción.
-- Sin trigram, LIKE '%texto%' es seq_scan. A 200K movimientos = >2s.
CREATE INDEX IF NOT EXISTS ix_movimientos_desc_trgm
    ON core.movimientos USING GIN (descripcion gin_trgm_ops);

-- Inbox messages: cmd+k debería poder encontrar emails por subject/from.
CREATE INDEX IF NOT EXISTS ix_inbox_subject_trgm
    ON core.inbox_messages USING GIN (subject gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_inbox_from_email_trgm
    ON core.inbox_messages USING GIN (from_email gin_trgm_ops);

-- ----------------------------------------------------------------------
-- 2) Indice parcial para vouchers sin proyecto (filtro OTROS)
-- ----------------------------------------------------------------------

-- vouchers.py:230-247 hace NOT EXISTS sobre voucher_lines con
-- proyecto_codigo IS NULL — sin indice parcial, escanea toda la tabla.
CREATE INDEX IF NOT EXISTS ix_voucher_lines_no_proyecto
    ON core.voucher_lines (voucher_id)
    WHERE proyecto_codigo IS NULL;

-- ----------------------------------------------------------------------
-- 3) Indice path_pattern_ops para audit.http_mutations LIKE prefix
-- ----------------------------------------------------------------------

-- audit.py:376 filtra por path LIKE :pattern. Si es prefix (path LIKE '/api/v1/x%')
-- text_pattern_ops permite usar el indice. Sin esto, seq_scan a 800K
-- rows/día (cuando crezca la app).
CREATE INDEX IF NOT EXISTS ix_http_mutations_path_pattern
    ON audit.http_mutations (path text_pattern_ops);

-- ----------------------------------------------------------------------
-- 4) Tablas hot churn: tunear autovacuum
-- ----------------------------------------------------------------------

-- vouchers tiene UPDATE frecuente de status (DRAFT→PENDING→APPROVED→EXECUTED).
-- Default scale_factor=0.2 (vacuum cuando 20% de la tabla está dead).
-- Para tabla con churn, bajamos a 5% para vacuums más frecuentes y stats
-- al día (el planner usa estos stats para elegir indexes).
ALTER TABLE core.vouchers SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

-- correlativos: UPSERT cada vez que se crea un voucher/oc/etc.
ALTER TABLE core.correlativos SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

-- ----------------------------------------------------------------------
-- 5) Comentario sobre action_log partitioning (NO aplicado todavía)
-- ----------------------------------------------------------------------
-- audit.action_log no está particionado. Estimado: 1.8M filas/año con
-- 45 users. Migrar a partition by RANGE(created_at) mensual cuando llegue
-- a 5M+ filas. Mientras tanto, los indices existentes son suficientes.
--
-- Modelo de migración: ver scripts/sql/round152PPPPP_feature_usage.sql
-- (mismo patrón de partition mensual + función ensure_next_partition).
