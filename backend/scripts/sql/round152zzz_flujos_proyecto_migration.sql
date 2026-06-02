-- R152zzz · Flujo de caja proyectado por proyecto.
--
-- MEJORAS IA.docx #8: "ambas" (upload Excel + crear/editar en pantalla).
-- Cada proyecto contable (CORFO, Privado, Interno) tiene un flujo de caja
-- proyectado: matriz mes × categoría con monto proyectado. El monto REAL
-- se calcula desde vouchers ejecutados con ese proyecto_codigo asignado.

CREATE TABLE IF NOT EXISTS core.flujos_caja_proyecto (
    id BIGSERIAL PRIMARY KEY,
    proyecto_codigo TEXT NOT NULL REFERENCES core.proyectos_contables(codigo) ON DELETE CASCADE,
    periodo TEXT NOT NULL,                          -- 'YYYY-MM'
    categoria TEXT NOT NULL,                        -- 'INGRESOS', 'RRHH', 'OPERACION', etc.
    tipo TEXT NOT NULL DEFAULT 'EGRESO'
        CHECK (tipo IN ('INGRESO','EGRESO')),
    monto_proyectado NUMERIC(14,2) NOT NULL DEFAULT 0,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (proyecto_codigo, periodo, categoria)
);

CREATE INDEX IF NOT EXISTS idx_flujos_caja_proyecto
    ON core.flujos_caja_proyecto (proyecto_codigo, periodo);

COMMENT ON TABLE core.flujos_caja_proyecto IS
    'R152zzz: flujo de caja proyectado por proyecto contable. '
    'Matrix periodo × categoría. El monto_real se calcula on-demand '
    'agregando vouchers EXECUTED con ese proyecto_codigo.';

-- Vista que enriquece cada celda proyectada con el monto REAL ejecutado.
-- Calcula sumando vouchers EXECUTED con proyecto_codigo en sus líneas.
CREATE OR REPLACE VIEW core.v_flujos_caja_proyecto_con_real AS
WITH reales AS (
    SELECT
        vl.proyecto_codigo,
        to_char(v.fecha_contable, 'YYYY-MM') AS periodo,
        CASE
            WHEN v.tipo = 'VENTA' OR v.tipo = 'INGRESO' THEN 'INGRESOS'
            ELSE 'EGRESOS'
        END AS categoria_simple,
        SUM(CASE WHEN v.tipo IN ('VENTA','INGRESO') THEN vl.credit - vl.debit
                 ELSE vl.debit - vl.credit END) AS monto_real
    FROM core.voucher_lines vl
    JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
    WHERE v.status = 'EXECUTED' AND vl.proyecto_codigo IS NOT NULL
    GROUP BY vl.proyecto_codigo, to_char(v.fecha_contable, 'YYYY-MM'),
             CASE WHEN v.tipo = 'VENTA' OR v.tipo = 'INGRESO'
                  THEN 'INGRESOS' ELSE 'EGRESOS' END
)
SELECT
    f.id,
    f.proyecto_codigo,
    f.periodo,
    f.categoria,
    f.tipo,
    f.monto_proyectado,
    COALESCE(r.monto_real, 0) AS monto_real,
    f.notas,
    f.updated_at
FROM core.flujos_caja_proyecto f
LEFT JOIN reales r
    ON r.proyecto_codigo = f.proyecto_codigo
    AND r.periodo = f.periodo
    AND r.categoria_simple =
        CASE WHEN f.tipo = 'INGRESO' THEN 'INGRESOS' ELSE 'EGRESOS' END;
