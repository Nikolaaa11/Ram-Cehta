-- =====================================================================
-- VIEWS para consumo desde la app (FastAPI / Next.js)
-- =====================================================================

-- Egresos mensuales por empresa (replica la tabla dinámica de la hoja "6) Egresos por Proyecto")
CREATE OR REPLACE VIEW core.v_egresos_mensuales AS
SELECT
    empresa_codigo,
    proyecto,
    concepto_general,
    concepto_detallado,
    real_proyectado,
    anio,
    periodo,
    SUM(egreso) AS total_egreso,
    SUM(iva_credito_fiscal) AS total_iva_credito,
    COUNT(*) AS num_movimientos
FROM core.movimientos
WHERE egreso > 0
GROUP BY empresa_codigo, proyecto, concepto_general, concepto_detallado,
         real_proyectado, anio, periodo;

-- Saldo vigente por empresa (último registro por fecha)
CREATE OR REPLACE VIEW core.v_saldos_actuales AS
SELECT DISTINCT ON (empresa_codigo, banco)
    empresa_codigo,
    banco,
    fecha,
    saldo_contable,
    saldo_cehta,
    saldo_corfo
FROM core.movimientos
WHERE real_proyectado = 'Real'
ORDER BY empresa_codigo, banco, fecha DESC, movimiento_id DESC;

-- Flujo de caja proyectado vs real, mes a mes
CREATE OR REPLACE VIEW core.v_flujo_caja AS
SELECT
    empresa_codigo,
    anio,
    periodo,
    real_proyectado,
    SUM(abono) AS total_abonos,
    SUM(egreso) AS total_egresos,
    SUM(abono) - SUM(egreso) AS flujo_neto
FROM core.movimientos
GROUP BY empresa_codigo, anio, periodo, real_proyectado
ORDER BY empresa_codigo, anio, periodo;

-- IVA crédito/débito consolidado por período
CREATE OR REPLACE VIEW core.v_iva_consolidado AS
SELECT
    empresa_codigo,
    anio,
    periodo,
    SUM(iva_credito_fiscal) AS iva_credito,
    SUM(iva_debito_fiscal) AS iva_debito,
    SUM(iva_debito_fiscal) - SUM(iva_credito_fiscal) AS iva_a_pagar
FROM core.movimientos
GROUP BY empresa_codigo, anio, periodo
ORDER BY empresa_codigo, anio, periodo;

-- OC vigentes con proveedor
CREATE OR REPLACE VIEW core.v_oc_activas AS
SELECT
    oc.oc_id,
    oc.numero_oc,
    oc.empresa_codigo,
    e.razon_social AS empresa_razon_social,
    p.razon_social AS proveedor_razon_social,
    p.rut          AS proveedor_rut,
    oc.fecha_emision,
    oc.moneda,
    oc.neto,
    oc.iva,
    oc.total,
    oc.estado
FROM core.ordenes_compra oc
JOIN core.empresas e      ON e.codigo = oc.empresa_codigo
LEFT JOIN core.proveedores p ON p.proveedor_id = oc.proveedor_id
WHERE oc.estado IN ('emitida','parcial');

-- F29 próximos a vencer (útil para alertas en el dashboard)
CREATE OR REPLACE VIEW core.v_f29_alertas AS
SELECT
    empresa_codigo,
    periodo_tributario,
    fecha_vencimiento,
    monto_a_pagar,
    estado,
    (fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer
FROM core.f29_obligaciones
WHERE estado = 'pendiente'
  AND fecha_vencimiento >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY fecha_vencimiento;
