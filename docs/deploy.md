# Guía de Deploy — Cehta Capital

## Backend en Fly.io

### Primera vez

```bash
# 1. Instalar flyctl
# Windows: https://fly.io/docs/hands-on/install-flyctl/

# 2. Desde la carpeta backend/
cd backend
fly auth login

# 3. Crear la app (solo una vez)
fly apps create cehta-backend

# 4. Setear todos los secretos
fly secrets set \
  DATABASE_URL="postgresql+asyncpg://postgres.dqwwqfhzejscgcynkbip:<PASSWORD>@aws-1-us-east-2.pooler.supabase.com:6543/postgres" \
  ALEMBIC_DATABASE_URL="postgresql://postgres.dqwwqfhzejscgcynkbip:<PASSWORD>@aws-1-us-east-2.pooler.supabase.com:6543/postgres" \
  SUPABASE_URL="https://dqwwqfhzejscgcynkbip.supabase.co" \
  SUPABASE_ANON_KEY="<SUPABASE_ANON_KEY>" \
  SUPABASE_SERVICE_ROLE_KEY="<SUPABASE_SERVICE_ROLE_KEY>" \
  SUPABASE_JWT_SECRET="<SUPABASE_JWT_SECRET>" \
  SECRET_KEY="<RANDOM_SECRET_32_CHARS>" \
  CORS_ORIGINS="https://cehta-capital.vercel.app"

# 5. Deploy
fly deploy

# 6. Verificar
fly logs
curl https://cehta-backend.fly.dev/health
curl https://cehta-backend.fly.dev/api/v1/health
```

### Deploys siguientes

```bash
cd backend
fly deploy
```

### Correr migraciones en producción

```bash
fly ssh console -C "alembic upgrade head"
```

---

## Frontend en Vercel

### Primera vez

1. Ve a [vercel.com](https://vercel.com) → New Project → Import Git Repository
2. Selecciona `Nikolaaa11/Ram-Cehta`
3. **Root Directory**: `frontend`
4. **Framework Preset**: Next.js
5. Agrega estas **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://dqwwqfhzejscgcynkbip.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse`
   - `NEXT_PUBLIC_API_URL` = `https://cehta-backend.fly.dev/api/v1`
6. Deploy

### Redeploys

Automáticos en cada push a `main`.

---

## Monitoreo

### Uptime (gratuito)
- [UptimeRobot](https://uptimerobot.com/) → Add Monitor → HTTP → `https://cehta-backend.fly.dev/health`
- Alertas por email cuando caiga.

### Logs backend
```bash
fly logs --app cehta-backend
```

### Sentry (opcional — Fase 2)
```bash
pip install sentry-sdk[fastapi]
fly secrets set SENTRY_DSN="https://..."
```

---

## Checklist pre-deploy

- [ ] `fly secrets set` con todos los valores de producción
- [ ] `CORS_ORIGINS` apunta al dominio real de Vercel
- [ ] `SECRET_KEY` es un string aleatorio de 32+ chars (no `change-me-dev-only`)
- [ ] Hook de Supabase Auth (`custom_access_token_hook`) activado
- [ ] Usuario admin creado en Supabase Auth y con rol en `core.user_roles`
- [ ] `/api/v1/health` responde `{"status":"ok","database":"ok"}` en producción
