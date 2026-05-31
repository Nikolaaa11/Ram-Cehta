-- =============================================================================
-- Round 152t/u/v — Change Management features (NPS + Adopción + Aprendizaje)
-- =============================================================================
-- Aplica frameworks del curso "Liderazgo y Gestión del Cambio" (Ray Gallegos):
--   - Clase 4 p36: Comunicación bidireccional → user_feedback (NPS)
--   - Clase 2 p41: Mapeo de Actores → vista derivada de auth + audit
--   - Clase 1 p22: Formación continua → training_modules + training_progress
--
-- 3 tablas + 1 vista. Idempotente.
-- =============================================================================

-- ─── 1. NPS in-app (Clase 4 p36) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.user_feedback (
    feedback_id   BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- "voucher.firmar", "voucher.crear", "transferencia.confirmar", "general"
    action_type   TEXT NOT NULL,
    -- 1=difícil/triste, 2=ok/neutro, 3=fácil/contento (3 niveles tipo emoji)
    score         SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 3),
    comment       TEXT,
    -- contexto: ruta, voucher_id si aplica, etc.
    context       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_action_recent
    ON core.user_feedback (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user
    ON core.user_feedback (user_id, created_at DESC);


-- ─── 2. Training modules + progress (Clase 1 p22) ───────────────────────────
CREATE TABLE IF NOT EXISTS core.training_modules (
    module_id     SERIAL PRIMARY KEY,
    slug          TEXT UNIQUE NOT NULL,        -- "crear-voucher"
    title         TEXT NOT NULL,
    description   TEXT,
    -- "principiante", "intermedio", "avanzado"
    difficulty    TEXT NOT NULL DEFAULT 'principiante',
    -- minutos estimados
    duration_min  INT DEFAULT 5,
    -- markdown del contenido
    content_md    TEXT,
    -- preguntas y respuestas correctas
    quiz          JSONB,
    -- orden de display
    sort_order    INT DEFAULT 100,
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_modules_active_order
    ON core.training_modules (active, sort_order)
    WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS core.training_progress (
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    module_id     INT NOT NULL REFERENCES core.training_modules(module_id) ON DELETE CASCADE,
    -- 0-100, score del quiz
    score         SMALLINT CHECK (score BETWEEN 0 AND 100),
    completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_training_progress_user
    ON core.training_progress (user_id, completed_at DESC);


-- ─── 3. Vista de Mapa de Adopción (Clase 2 p41) ─────────────────────────────
-- Clasifica cada user en Aliado/Espectador/Detractor según actividad reciente.
-- No es una tabla — se computa on-demand desde auth + audit + roles.
CREATE OR REPLACE VIEW core.v_adoption_map AS
WITH user_activity AS (
    SELECT
        u.id AS user_id,
        u.email,
        u.last_sign_in_at,
        u.created_at AS account_created_at,
        -- Días desde último login (NULL = nunca)
        EXTRACT(EPOCH FROM (NOW() - u.last_sign_in_at)) / 86400 AS days_inactive,
        -- Cuántas acciones en últimos 30 días (de audit.action_log)
        COALESCE((
            SELECT COUNT(*) FROM audit.action_log a
            WHERE a.user_id = u.id
              AND a.created_at >= NOW() - INTERVAL '30 days'
        ), 0) AS actions_30d
    FROM auth.users u
),
user_role AS (
    SELECT
        ur.user_id,
        ur.app_role,
        (SELECT string_agg(DISTINCT empresa_codigo, ', ' ORDER BY empresa_codigo)
         FROM core.user_company_roles
         WHERE user_id = ur.user_id AND active = TRUE) AS empresas
    FROM core.user_roles ur
)
SELECT
    ua.user_id,
    ua.email,
    COALESCE(ur.app_role, 'sin_rol') AS app_role,
    ur.empresas,
    ua.last_sign_in_at::date AS last_login,
    ROUND(ua.days_inactive::numeric, 0) AS days_inactive,
    ua.actions_30d,
    ua.account_created_at::date AS member_since,
    -- Clasificación tipo "Mapeo de Actores" (Ray Gallegos · Clase 2 p41):
    CASE
        WHEN ua.last_sign_in_at IS NULL THEN 'sin_activacion'
        WHEN ua.days_inactive > 30 THEN 'detractor'  -- 30+ días sin entrar
        WHEN ua.actions_30d >= 20 THEN 'aliado'       -- 20+ acciones/mes = activo
        WHEN ua.actions_30d >= 5 THEN 'espectador'    -- moderado
        ELSE 'espectador'
    END AS classification,
    -- Impacto: A/M/B según rol y actividad
    CASE
        WHEN ur.app_role = 'admin' THEN 'A'
        WHEN ua.actions_30d >= 50 THEN 'A'
        WHEN ua.actions_30d >= 10 THEN 'M'
        ELSE 'B'
    END AS impact_level
FROM user_activity ua
LEFT JOIN user_role ur ON ur.user_id = ua.user_id
ORDER BY ua.actions_30d DESC NULLS LAST;
