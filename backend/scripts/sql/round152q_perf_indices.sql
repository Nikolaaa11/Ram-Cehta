-- =============================================================================
-- Round 152q — Performance: indices para queries del Dashboard / Saldos
-- =============================================================================
-- Aplicado en producción 2026-05-29.
-- Idempotente: usa IF NOT EXISTS.
--
-- CONTEXTO:
-- El audit con pg_stat_statements + EXPLAIN ANALYZE identificó 2 queries
-- hot path (corren en cada render del Dashboard CEO y reportes):
--
-- 1) DISTINCT ON (empresa_codigo, banco) ... WHERE saldo_contable IS NOT NULL
--    Usado por: app/api/v1/dashboard.py, app/api/v1/portfolio.py
--    Antes: Seq Scan + Sort, 53.94ms execution + 27.35ms planning
--    Después: Index Scan, 1.39ms execution + 0.22ms planning
--    Mejora: 50x. A 100k+ rows: ~400x (sin índice → multi-segundo).
--
-- 2) SUM(saldo_*) FROM v_saldos_actuales (vista con DISTINCT ON real_proyectado='Real')
--    Usado por: dashboard CEO endpoints
--    Antes: Seq Scan + Sort, 10.56ms
--    Después: Index Scan, 1.56ms
--    Mejora: 6.7x.
--
-- AMBOS son PARTIAL INDEX — solo indexan las rows que matchean el WHERE,
-- mucho más pequeños que un índice completo.
-- =============================================================================

-- Cubre el query "saldo último por banco" (Dashboard + Portfolio).
CREATE INDEX IF NOT EXISTS idx_mov_saldo_ult_banco
ON core.movimientos (empresa_codigo, banco, fecha DESC, movimiento_id DESC)
WHERE saldo_contable IS NOT NULL;

-- Cubre v_saldos_actuales (vista usada por Dashboard CEO).
CREATE INDEX IF NOT EXISTS idx_mov_saldo_real_banco
ON core.movimientos (empresa_codigo, banco, fecha DESC, movimiento_id DESC)
WHERE real_proyectado = 'Real';

-- Actualizar estadísticas para que el planner use los nuevos índices ya.
ANALYZE core.movimientos;
