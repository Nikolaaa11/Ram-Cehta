-- R152BBBBB · Idempotency-Key middleware (server-side dedup de mutaciones)
--
-- Tabla para cachear respuestas de mutaciones (POST/PATCH/PUT/DELETE) por
-- header `Idempotency-Key`. El cliente (apiClient.ts R152AAAAA) ya genera
-- un UUID v4 por cada mutación. Este middleware cachea la respuesta durante
-- 5 minutos. Si llega la misma key dos veces (network retry, double-click,
-- duplicate POST por cliente buggy), se devuelve la respuesta cacheada
-- en lugar de re-ejecutar el handler.
--
-- Protección extra: si la misma key viene con BODY distinto, devolvemos
-- 409 Conflict — alguien está reusando la key incorrectamente, no es un
-- retry real del mismo request.
--
-- Idempotente · IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS core.idempotency_keys (
    key TEXT PRIMARY KEY,
    -- Quién la mandó (puede ser null si la auth no completó).
    user_email TEXT,
    -- Method + path nos permite reusar la misma key en endpoints distintos
    -- (improbable pero defensive).
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    -- Hash SHA256 del body para detectar reuso de key con payload distinto.
    request_hash TEXT NOT NULL,
    -- Respuesta cacheada (puede ser null mientras la request está in-flight).
    response_status INTEGER,
    response_body JSONB,
    -- Timing.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- TTL para auto-limpieza. Default 5 min.
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

-- Índice para purga eficiente de keys expiradas.
CREATE INDEX IF NOT EXISTS idx_idempotency_expires
    ON core.idempotency_keys (expires_at);

-- Comentarios para humanos.
COMMENT ON TABLE core.idempotency_keys IS
    'R152BBBBB · Cache de mutaciones HTTP por header Idempotency-Key. TTL 5min.';
COMMENT ON COLUMN core.idempotency_keys.request_hash IS
    'SHA256 hex del body — detecta reuso de key con payload distinto.';
COMMENT ON COLUMN core.idempotency_keys.response_status IS
    'NULL = request in-flight; INT = completada y cacheada.';
