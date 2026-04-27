# Rotación de credenciales — 2026-04-25

> **Por qué**: Las credenciales originales fueron escritas en `backend/.env`
> en disco. Aunque `.env` está en `.gitignore` y nunca se commiteó (verificado
> con `git log --all --full-history -- backend/.env`), un disco comprometido,
> backup, screenshot o copia las expone. Hay que rotar todas antes de deploy.
>
> Auditoría confirmó que **NO** quedó histórico en GitHub.

## Credenciales a rotar

| # | Credencial | Dashboard | Estado |
|---|---|---|---|
| 1 | Password Postgres | Supabase | ⏳ Pendiente |
| 2 | `SUPABASE_JWT_SECRET` | Supabase | ⏳ Pendiente |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase | ⏳ Pendiente |
| 4 | `ANTHROPIC_API_KEY` | console.anthropic.com | ⏳ Pendiente |
| 5 | `DROPBOX_REFRESH_TOKEN` | Dropbox App Console | ⏳ Pendiente |

## Paso 1 — Supabase (3 credenciales en una sesión)

1. Entrá a https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip
2. **Settings → Database → Connection string**:
   - Click **Reset database password**.
   - Confirmá. Anotá la nueva password en tu password manager (no la pierdas, no se puede recuperar).
3. **Settings → API**:
   - Sección **Project API keys**: click **Regenerate** en `service_role`. Confirma. Copia la nueva.
   - Sección **JWT Settings**: click **Generate new JWT secret**. ⚠️ **Esto invalida TODAS las sesiones activas** — cualquier usuario logueado tendrá que re-loguear. Como aún no hay usuarios reales, no hay impacto.
4. La `anon` key (publishable) NO necesita rotarse — es pública por diseño.

## Paso 2 — Anthropic

1. https://console.anthropic.com/settings/keys
2. Localizá la key que empieza con `sk-ant-api03-bUoYGq6...` y click **Revoke**.
3. **Create Key** → nombre: `cehta-backend-prod`. Copia la nueva.

## Paso 3 — Dropbox

1. https://www.dropbox.com/developers/apps
2. Abrí la app que estás usando para Cehta.
3. **Permissions** → revisar scopes.
4. **OAuth 2** → **Generate access token** (genera un nuevo refresh token).
5. Si querés invalidar el anterior: ve a **Settings → Connected apps** y desconectá la sesión vieja.

## Paso 4 — Actualizar `backend/.env` localmente

Editá el archivo `backend/.env` y reemplazá cada `REPLACE_AFTER_ROTATION` con el valor real correspondiente:

```bash
DATABASE_URL=postgresql+asyncpg://postgres.dqwwqfhzejscgcynkbip:NUEVA_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres
ALEMBIC_DATABASE_URL=postgresql://postgres.dqwwqfhzejscgcynkbip:NUEVA_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres
SUPABASE_ANON_KEY=sb_publishable_xxx... (la podés copiar igual del dashboard, no rotó)
SUPABASE_SERVICE_ROLE_KEY=NUEVO_VALOR
SUPABASE_JWT_SECRET=NUEVO_VALOR
ANTHROPIC_API_KEY=NUEVO_VALOR
DROPBOX_REFRESH_TOKEN=NUEVO_VALOR
```

`SECRET_KEY` ya tiene un valor válido generado (`a4d6d05c6209846b...`).

## Paso 5 — Cargar los secrets en Fly.io

Cuando vayas a deployar el backend:

```powershell
fly secrets set `
  DATABASE_URL="postgresql+asyncpg://postgres.dqwwqfhzejscgcynkbip:NUEVA_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres" `
  ALEMBIC_DATABASE_URL="postgresql://postgres.dqwwqfhzejscgcynkbip:NUEVA_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres" `
  SUPABASE_URL="https://dqwwqfhzejscgcynkbip.supabase.co" `
  SUPABASE_ANON_KEY="<sb_publishable_...>" `
  SUPABASE_SERVICE_ROLE_KEY="<NUEVO_service_role>" `
  SUPABASE_JWT_SECRET="<NUEVO_jwt_secret>" `
  SECRET_KEY="a4d6d05c6209846b2973338f1522d6037a463f22d714fee3468d324b60a7dc08" `
  CORS_ORIGINS="https://<TU_DOMINIO_VERCEL>.vercel.app" `
  ANTHROPIC_API_KEY="<NUEVA>" `
  DROPBOX_REFRESH_TOKEN="<NUEVO>" `
  --app cehta-backend
```

## Paso 6 — Cargar las 3 vars públicas en Vercel

En el dashboard de Vercel del proyecto `Ram-Cehta` → **Settings → Environment Variables** (Production + Preview + Development):

- `NEXT_PUBLIC_SUPABASE_URL` = `https://dqwwqfhzejscgcynkbip.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `<sb_publishable_...>`
- `NEXT_PUBLIC_API_URL` = `https://cehta-backend.fly.dev/api/v1`

## Paso 7 — Verificación

Una vez todo deployado:

```bash
# Backend liveness (no toca DB)
curl https://cehta-backend.fly.dev/health
# → {"status":"alive"}

# Backend readiness (toca DB con la nueva password)
curl https://cehta-backend.fly.dev/api/v1/health
# → {"status":"ok","database":"ok"}
```

Si la readiness falla, la password Postgres en Fly secrets no coincide con la nueva en Supabase. Re-correr `fly secrets set DATABASE_URL=...`.

Para verificar el JWT hook y el `app_role` claim:

1. Abrí la app frontend en el navegador, login con `nikola@cehta.cl`.
2. DevTools → Application → Cookies → busca cookie `sb-...-auth-token`. Decodifícala (es base64 de un JSON con `{access_token, ...}`).
3. Pegá el `access_token` en https://jwt.io.
4. En el panel **Decoded → Payload** debe aparecer:
   - `"iss": "https://dqwwqfhzejscgcynkbip.supabase.co/auth/v1"`
   - `"aud": "authenticated"`
   - `"app_role": "admin"` ← clave: si dice `"viewer"` o falta, el hook NO está activado.

## Marcado de estado

A medida que rotes, marcá las casillas en la tabla de arriba. Una vez todas en ✅, eliminá este archivo del repo (o movelo a una carpeta privada).
