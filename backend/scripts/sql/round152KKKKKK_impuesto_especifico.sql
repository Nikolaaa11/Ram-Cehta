-- R152KKKKKK — Impuesto específico en vouchers (IEPD combustibles).
-- Las facturas de combustible traen Neto + IVA 19% + Impuesto Específico
-- (códigos SII 28 diésel / 35 gasolinas). El form Nubox solo calculaba
-- Neto×1.19, así que el total nunca cuadraba con la factura física.
-- Idempotente: seguro de correr múltiples veces.

ALTER TABLE core.vouchers
    ADD COLUMN IF NOT EXISTS impuesto_especifico NUMERIC(18, 2);

-- R152LLLLLL — tasa % cuando el impuesto se ingresó como % del neto
-- (ILA bebidas alcohólicas/analcohólicas, suntuarios, etc.). Trazabilidad:
-- impuesto_especifico guarda el monto calculado, _pct la tasa usada.
ALTER TABLE core.vouchers
    ADD COLUMN IF NOT EXISTS impuesto_especifico_pct NUMERIC(6, 3);

COMMENT ON COLUMN core.vouchers.impuesto_especifico IS
    'Impuesto específico/adicional del documento (IEPD combustibles, ILA, '
    'suntuarios). Total real = total_debit (neto) + IVA + impuesto_especifico. '
    'NULL = no aplica. R152KKKKKK/LLLLLL 2026-06-10.';

COMMENT ON COLUMN core.vouchers.impuesto_especifico_pct IS
    'Tasa % sobre el neto usada para calcular impuesto_especifico '
    '(ej. ILA 20.5, suntuarios 15). NULL = se ingresó monto directo.';

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'core' AND table_name = 'vouchers'
  AND column_name = 'impuesto_especifico';
