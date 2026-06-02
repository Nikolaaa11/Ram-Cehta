-- R152yyy · OC cuotas + vouchers automáticos.
--
-- MEJORAS IA.docx #6: "desglosa, claro cada cuota debería generar un voucher".
-- Cuando una OC se paga en cuotas (ej: 30/60/90 días, o N pagos mensuales),
-- el operador define el desglose y el sistema genera 1 voucher DRAFT por
-- cuota — listos para aprobar y pagar individualmente.
--
-- Idempotente. Aplicar en Supabase Studio.

-- =====================================================================
-- 1. core.oc_cuotas — desglose de pagos por OC
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.oc_cuotas (
    cuota_id BIGSERIAL PRIMARY KEY,
    oc_id BIGINT NOT NULL REFERENCES core.ordenes_compra(oc_id) ON DELETE CASCADE,
    numero_cuota INTEGER NOT NULL,              -- 1, 2, 3...
    monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
    fecha_vencimiento DATE NOT NULL,
    descripcion TEXT,                            -- "Anticipo 50%", "Entrega final", etc.
    -- FK opcional al voucher creado para esta cuota.
    -- NULL = aún no generado. Una vez creado, queda enlazado.
    voucher_id BIGINT REFERENCES core.vouchers(voucher_id) ON DELETE SET NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','VOUCHER_GENERADO','PAGADA','ANULADA')),
    pagada_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (oc_id, numero_cuota)
);

CREATE INDEX IF NOT EXISTS idx_oc_cuotas_oc
    ON core.oc_cuotas (oc_id, numero_cuota);

CREATE INDEX IF NOT EXISTS idx_oc_cuotas_voucher
    ON core.oc_cuotas (voucher_id) WHERE voucher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oc_cuotas_vencimiento
    ON core.oc_cuotas (fecha_vencimiento)
    WHERE estado IN ('PENDIENTE','VOUCHER_GENERADO');

COMMENT ON TABLE core.oc_cuotas IS
    'R152yyy: desglose de pagos por orden de compra. Una OC puede tener '
    'N cuotas. Cada cuota genera 1 voucher DRAFT al confirmar el split. '
    'voucher_id se popula cuando se ejecuta /ordenes-compra/{id}/generar-vouchers.';

COMMENT ON COLUMN core.oc_cuotas.estado IS
    'PENDIENTE → cuota creada, sin voucher. '
    'VOUCHER_GENERADO → voucher DRAFT creado y linkeado. '
    'PAGADA → voucher EXECUTED (sync con voucher.status). '
    'ANULADA → cuota descartada (el operador no la va a pagar).';

-- =====================================================================
-- 2. Vista útil: cuotas + estado del voucher asociado
-- =====================================================================

CREATE OR REPLACE VIEW core.v_oc_cuotas_estado AS
SELECT
    c.cuota_id,
    c.oc_id,
    c.numero_cuota,
    c.monto,
    c.fecha_vencimiento,
    c.descripcion,
    c.estado AS estado_cuota,
    c.voucher_id,
    v.codigo AS voucher_codigo,
    v.status AS voucher_status,
    v.fecha_contable AS voucher_fecha,
    -- Días hasta vencimiento (negativo = vencida)
    (c.fecha_vencimiento - CURRENT_DATE) AS dias_a_vencer
FROM core.oc_cuotas c
LEFT JOIN core.vouchers v ON v.voucher_id = c.voucher_id;

-- =====================================================================
-- 3. Function helper para mantener sumatoria en check
-- =====================================================================

-- Vista para validar que la suma de cuotas = total OC (informativa, no enforced)
CREATE OR REPLACE VIEW core.v_oc_cuotas_balance AS
SELECT
    oc.oc_id,
    oc.numero_oc,
    oc.total AS total_oc,
    COALESCE(SUM(c.monto), 0) AS suma_cuotas,
    oc.total - COALESCE(SUM(c.monto), 0) AS diferencia,
    COUNT(c.cuota_id) AS cantidad_cuotas
FROM core.ordenes_compra oc
LEFT JOIN core.oc_cuotas c
    ON c.oc_id = oc.oc_id AND c.estado != 'ANULADA'
GROUP BY oc.oc_id, oc.numero_oc, oc.total;

COMMENT ON VIEW core.v_oc_cuotas_balance IS
    'R152yyy: para chequear que la suma de cuotas activas de una OC '
    'coincide con el total de la OC. Diferencia != 0 indica desbalance.';
