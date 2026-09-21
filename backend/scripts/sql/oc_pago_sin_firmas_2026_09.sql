-- ============================================================================
-- Constancia de "OC marcada pagada sin todas las firmas" (2026-09-21)
-- ============================================================================
-- Desde el commit 71eb590 una OC con firmas PENDIENTE se puede marcar pagada
-- (caso real TECMAVIDA: el proveedor ya cobró y un firmante nunca entró a la
-- plataforma), exigiendo un motivo. Ese motivo NO puede vivir sólo en
-- audit.action_log: audit_log se escribe DESPUÉS del commit y es best-effort
-- (si falla, se traga el error), así que la OC podía quedar pagada sin la
-- constancia. Esta columna se escribe en la MISMA transacción que el cambio
-- de estado: o quedan las dos cosas, o ninguna.
--
-- Forma del JSON (la escribe app/api/v1/ordenes_compra.py):
--   {"motivo": "...", "firmas_pendientes": ["José ..."], "estado_previo":
--    "en_firma", "estado_nuevo": "pagada", "por_user_id": "<uuid>",
--    "por_email": "...", "el": "2026-09-21T15:00:00+00:00", "via": "ficha"|"masivo"}
--
-- Nullable y aditivo: el código viejo no la conoce y no se rompe. Aplicar
-- ANTES de desplegar el backend que la mapea en el ORM.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS pago_sin_firmas JSONB;

COMMENT ON COLUMN core.ordenes_compra.pago_sin_firmas IS
    'Constancia de haberla marcado pagada/parcial con firmas PENDIENTE: motivo, quiénes faltaban, quién y cuándo. NULL = no aplica.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'core' AND table_name = 'ordenes_compra'
                      AND column_name = 'pago_sin_firmas' AND data_type = 'jsonb') THEN
        RAISE EXCEPTION 'FAIL · falta core.ordenes_compra.pago_sin_firmas';
    END IF;
    RAISE NOTICE 'OK · core.ordenes_compra.pago_sin_firmas lista';
END $$;

COMMIT;
