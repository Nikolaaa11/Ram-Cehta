-- R152BBBB · Trigger: sincronizar oc_cuotas.estado con voucher.status.
--
-- Cuando un voucher pasa a EXECUTED, la cuota linkeada queda PAGADA
-- automáticamente. Cuando el voucher es ANULADO, la cuota vuelve a
-- PENDIENTE (sin voucher) para que se pueda regenerar.
--
-- Idempotente. Aplicar en Supabase Studio.

-- =====================================================================
-- 1. Function: sync_cuota_estado_from_voucher
-- =====================================================================

CREATE OR REPLACE FUNCTION core.sync_cuota_estado_from_voucher()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo nos interesan cambios de status
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Buscar cuotas linkeadas a este voucher
        IF NEW.status = 'EXECUTED' THEN
            UPDATE core.oc_cuotas
            SET estado = 'PAGADA',
                pagada_at = COALESCE(pagada_at, NOW()),
                updated_at = NOW()
            WHERE voucher_id = NEW.voucher_id
              AND estado IN ('PENDIENTE','VOUCHER_GENERADO');

        ELSIF NEW.status IN ('ANULADO','REJECTED','VOID') THEN
            -- Vuelve a PENDIENTE y se desliga del voucher
            UPDATE core.oc_cuotas
            SET estado = 'PENDIENTE',
                voucher_id = NULL,
                pagada_at = NULL,
                updated_at = NOW()
            WHERE voucher_id = NEW.voucher_id;

        ELSIF NEW.status = 'APPROVED' THEN
            -- Aprobado pero aún no ejecutado — VOUCHER_GENERADO es OK
            UPDATE core.oc_cuotas
            SET estado = 'VOUCHER_GENERADO',
                updated_at = NOW()
            WHERE voucher_id = NEW.voucher_id
              AND estado = 'PENDIENTE';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION core.sync_cuota_estado_from_voucher() IS
    'R152BBBB: trigger function que mantiene oc_cuotas.estado sincronizada '
    'con voucher.status. EXECUTED -> PAGADA, ANULADO -> PENDIENTE (desliga), '
    'APPROVED -> VOUCHER_GENERADO. Solo afecta cuotas linkeadas via voucher_id.';

-- =====================================================================
-- 2. Trigger sobre core.vouchers
-- =====================================================================

DROP TRIGGER IF EXISTS trg_sync_cuota_estado ON core.vouchers;

CREATE TRIGGER trg_sync_cuota_estado
    AFTER UPDATE OF status ON core.vouchers
    FOR EACH ROW
    EXECUTE FUNCTION core.sync_cuota_estado_from_voucher();

COMMENT ON TRIGGER trg_sync_cuota_estado ON core.vouchers IS
    'R152BBBB: dispara sync_cuota_estado_from_voucher() cuando cambia el '
    'status del voucher. Sin impacto si el voucher no está linkeado a '
    'ninguna cuota.';

-- =====================================================================
-- 3. Re-sincronizar estado actual (one-shot para vouchers existentes)
-- =====================================================================

-- Vouchers ya EXECUTED con cuota PENDIENTE/VOUCHER_GENERADO → marcar PAGADA
UPDATE core.oc_cuotas c
SET estado = 'PAGADA',
    pagada_at = COALESCE(pagada_at, NOW()),
    updated_at = NOW()
FROM core.vouchers v
WHERE c.voucher_id = v.voucher_id
  AND v.status = 'EXECUTED'
  AND c.estado IN ('PENDIENTE','VOUCHER_GENERADO');
