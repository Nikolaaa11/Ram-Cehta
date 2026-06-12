-- R152NNNNNN — Performance dashboard. Idempotente. YA APLICADO a Supabase
-- el 2026-06-12 (directo). Este archivo es registro para repos nuevos.

-- Índice compuesto para el LATERAL "último movimiento por empresa" del
-- dashboard y los DISTINCT ON de saldos-por-empresa / ceo-consolidated.
-- Sin él, Postgres ordenaba todos los movimientos por empresa en memoria.
CREATE INDEX IF NOT EXISTS idx_movimientos_empresa_fecha_desc
    ON core.movimientos(empresa_codigo, fecha DESC, movimiento_id DESC);
