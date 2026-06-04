-- R152DDDDD · Tabla centralizada de correlativos
--
-- Reemplaza el patrón `pg_advisory_xact_lock + SELECT COUNT(*)` usado en
-- generar_vouchers y _crear_oc por un mecanismo más limpio basado en
-- UPSERT + RETURNING, atomico en una sola query.
--
-- Por qué no PostgreSQL SEQUENCE nativo:
--   - SEQUENCE no se reutiliza después de ROLLBACK (deja huecos).
--   - Crear una SEQUENCE por (empresa, año, tipo) requeriría 100+
--     sequences (10 empresas × ~10 años × N tipos), management complejo.
--   - Esta tabla tiene una row por combinación y la actualizamos con
--     UPDATE ... RETURNING, atomico a nivel row.
--
-- Schema:
--   PRIMARY KEY (empresa_codigo, year, tipo) — combinación única
--   last_seq                                  — último número usado
--   updated_at                                — para observabilidad
--
-- Uso:
--   INSERT INTO core.correlativos (empresa, year, tipo, last_seq)
--   VALUES (:e, :y, :t, 1)
--   ON CONFLICT (empresa_codigo, year, tipo)
--     DO UPDATE SET last_seq = correlativos.last_seq + :n,
--                   updated_at = NOW()
--   RETURNING last_seq;
--
-- Esto es 100% atomico — solo una row a la vez, sin advisory lock externo.

CREATE TABLE IF NOT EXISTS core.correlativos (
    empresa_codigo TEXT NOT NULL
        REFERENCES core.empresas(codigo)
        ON DELETE RESTRICT,
    year INTEGER NOT NULL CHECK (year >= 2020 AND year <= 2099),
    tipo TEXT NOT NULL CHECK (tipo IN ('OC', 'COM', 'VEN', 'EGR', 'ING')),
    last_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_codigo, year, tipo)
);

-- Inicializar correlativos a partir de datos existentes (idempotente).
-- Esto preserva la numeración actual cuando hagamos el switch del código.
INSERT INTO core.correlativos (empresa_codigo, year, tipo, last_seq)
SELECT
    empresa_codigo,
    EXTRACT(YEAR FROM fecha_emision)::INT AS year,
    'OC' AS tipo,
    COUNT(*) AS last_seq
FROM core.ordenes_compra
WHERE fecha_emision IS NOT NULL
GROUP BY empresa_codigo, EXTRACT(YEAR FROM fecha_emision)
ON CONFLICT (empresa_codigo, year, tipo)
    DO UPDATE SET last_seq = GREATEST(
        correlativos.last_seq,
        EXCLUDED.last_seq
    );

INSERT INTO core.correlativos (empresa_codigo, year, tipo, last_seq)
SELECT
    empresa_codigo,
    -- Extraer año del codigo: {EMP}-{YEAR}-COM-{NNNNN}
    NULLIF(
        substring(codigo FROM '\-(\d{4})\-'),
        ''
    )::INT AS year,
    'COM' AS tipo,
    -- Tomar el max NNNNN visto.
    MAX(
        NULLIF(
            substring(codigo FROM '\-COM\-(\d{5})$'),
            ''
        )::INT
    ) AS last_seq
FROM core.vouchers
WHERE codigo ~ '\-\d{4}\-COM\-\d{5}$'
GROUP BY empresa_codigo, substring(codigo FROM '\-(\d{4})\-')
HAVING substring(codigo FROM '\-(\d{4})\-') IS NOT NULL
ON CONFLICT (empresa_codigo, year, tipo)
    DO UPDATE SET last_seq = GREATEST(
        correlativos.last_seq,
        EXCLUDED.last_seq
    );

COMMENT ON TABLE core.correlativos IS
    'R152DDDDD · Correlativos centralizados por (empresa, año, tipo). '
    'Reemplaza advisory_lock + COUNT(*) con UPSERT atomico.';
