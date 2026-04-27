# 🚀 Runbook — Deploy Cehta Capital

> **Para Nicolas (no-ingeniero)**: este documento te lleva del cero a producción
> en una sola sesión. Cada bloque es copy-paste exacto. Si algo falla, salta a
> la sección **Troubleshooting** al final.

**Tiempo total estimado**: 45-60 minutos.
**Última actualización**: 2026-04-25 (post-auditoría completa, commits `eeeaba5` → `b6bca29`).

---

## ✅ Pre-requisitos

Antes de empezar, verificá que tenés:

- [ ] Acceso al dashboard de Supabase (proyecto `dqwwqfhzejscgcynkbip`)
- [ ] Cuenta en [console.anthropic.com](https://console.anthropic.com)
- [ ] Cuenta en [Dropbox developers](https://www.dropbox.com/developers/apps) con la app de Cehta
- [ ] Cuenta en [vercel.com](https://vercel.com) (gratuita)
- [ ] Cuenta en [fly.io](https://fly.io) (gratuita)
- [ ] PowerShell de Windows (ya lo tenés)

---

## 🔐 FASE 1 — Rotación de credenciales (10 min)

Las credenciales originales fueron expuestas en disco. Hay que rotar 5 valores antes de hacer cualquier deploy.

### 1.1 Supabase (3 credenciales)

Abrí: **https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip**

**Password Postgres**:
1. Sidebar → **Project Settings** (engranaje) → **Database**
2. Sección **Database password** → botón **Reset database password**
3. Confirmá → **Copia y pegá** la nueva password en este bloque para no perderla:

```
NUEVA_DB_PASSWORD = ___________________________________
```

**JWT Secret**:
1. Sidebar → **Project Settings** → **API**
2. Sección **JWT Settings** → **Generate new JWT secret** → confirma
3. Copia el nuevo:

```
NUEVO_JWT_SECRET = _____________________________________
```

**Service role key**:
1. Misma pantalla **API**
2. Sección **Project API keys** → fila `service_role` → click el icono circular de regenerate
3. Confirma. Copia:

```
NUEVO_SERVICE_ROLE = sb_secret_________________________
```

**Anon key (NO rotar)** — copiala como está:

```
ANON_KEY = sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse
```

### 1.2 Anthropic (1 credencial)

Abrí: **https://console.anthropic.com/settings/keys**

1. Encuentra la key activa actual → **⋯** → **Revoke**
2. **Create Key** → nombre: `cehta-backend-prod` → copia:

```
ANTHROPIC_KEY = sk-ant-api03-___________________________
```

### 1.3 Dropbox (1 credencial)

Abrí: **https://www.dropbox.com/developers/apps**

1. Abre tu app Cehta → **Settings** tab → scroll a **OAuth 2**
2. **Generated access token** → click **Generate** → copia:

```
DROPBOX_TOKEN = _________________________________________
```

> **Nota**: este token es de testing (~4h vida). Para producción real necesitás
> implementar el OAuth flow completo con refresh token. Hablamos después.

---

## 🛠 FASE 2 — Setup local (5 min)

### 2.1 Actualizar `.env` local

Abre `backend/.env` con tu editor (VS Code o Notepad). Vas a ver placeholders `REPLACE_AFTER_ROTATION`. Reemplazalos así:

```env
# ----- Database -----
DATABASE_URL=postgresql+asyncpg://postgres.dqwwqfhzejscgcynkbip:NUEVA_DB_PASSWORD@aws-1-us-east-2.pooler.supabase.com:6543/postgres
ALEMBIC_DATABASE_URL=postgresql://postgres.dqwwqfhzejscgcynkbip:NUEVA_DB_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres

# ----- Supabase -----
SUPABASE_URL=https://dqwwqfhzejscgcynkbip.supabase.co
SUPABASE_ANON_KEY=sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse
SUPABASE_SERVICE_ROLE_KEY=NUEVO_SERVICE_ROLE
SUPABASE_JWT_SECRET=NUEVO_JWT_SECRET

# ----- Security (ya configurado) -----
SECRET_KEY=a4d6d05c6209846b2973338f1522d6037a463f22d714fee3468d324b60a7dc08

# ----- Integraciones -----
ANTHROPIC_API_KEY=ANTHROPIC_KEY
DROPBOX_REFRESH_TOKEN=DROPBOX_TOKEN
```

> **NO commitees `backend/.env`** (ya está en `.gitignore`).

### 2.2 Instalar `flyctl`

En PowerShell:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Cierra y reabre PowerShell. Verifica:

```powershell
flyctl version
```

Debe imprimir algo como `flyctl v0.x.x`.

---

## 🗄 FASE 3 — Configurar Supabase (5 min)

### 3.1 Crear usuario admin

Abrí: **https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip/auth/users**

1. Click **Add user** → **Create new user**
2. Email: `nikola@cehta.cl`
3. Password: una password fuerte (anota en password manager)
4. Toggle **Auto Confirm User**: **ON**
5. Click **Create**

### 3.2 Activar el JWT hook (CRÍTICO)

Sin esto, los usuarios no tendrán rol `app_role` en su token y la app no funciona.

1. Sidebar → **Authentication** → **Hooks**
2. Sección **Custom Access Token Hook**:
   - Toggle **Enable hook**: **ON**
   - **Schema**: `public`
   - **Function**: `custom_access_token_hook` (debe aparecer en el dropdown — si no aparece, primero corre las migraciones de Fase 5)
3. Click **Save**

### 3.3 Asignar rol admin a tu usuario

1. Sidebar → **SQL Editor** → **New query**
2. Pega esto y click **Run**:

```sql
INSERT INTO core.user_roles (user_id, app_role, assigned_by)
SELECT id, 'admin', 'manual-bootstrap'
FROM auth.users
WHERE email = 'nikola@cehta.cl'
ON CONFLICT (user_id) DO UPDATE SET app_role = 'admin';
```

Debe responder `Success. 1 row affected`.

---

## 🐍 FASE 4 — Deploy backend a Fly.io (10 min)

### 4.1 Login y crear app

```powershell
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
flyctl auth login
flyctl apps create cehta-backend
```

Si la app ya existe, ignora el error.

### 4.2 Setear todos los secrets

**Antes de pegar**, reemplaza cada `_VALOR_` con tus valores reales de la Fase 1:

```powershell
flyctl secrets set `
  DATABASE_URL="postgresql+asyncpg://postgres.dqwwqfhzejscgcynkbip:_NUEVA_DB_PASSWORD_@aws-1-us-east-2.pooler.supabase.com:6543/postgres" `
  ALEMBIC_DATABASE_URL="postgresql://postgres.dqwwqfhzejscgcynkbip:_NUEVA_DB_PASSWORD_@aws-1-us-east-2.pooler.supabase.com:5432/postgres" `
  SUPABASE_URL="https://dqwwqfhzejscgcynkbip.supabase.co" `
  SUPABASE_ANON_KEY="sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse" `
  SUPABASE_SERVICE_ROLE_KEY="_NUEVO_SERVICE_ROLE_" `
  SUPABASE_JWT_SECRET="_NUEVO_JWT_SECRET_" `
  SECRET_KEY="a4d6d05c6209846b2973338f1522d6037a463f22d714fee3468d324b60a7dc08" `
  ANTHROPIC_API_KEY="_ANTHROPIC_KEY_" `
  DROPBOX_REFRESH_TOKEN="_DROPBOX_TOKEN_" `
  CORS_ORIGINS="https://cehta-capital.vercel.app" `
  --app cehta-backend
```

> **Nota sobre CORS**: el dominio real lo confirmaremos después del primer deploy
> de Vercel. Por ahora pega el placeholder; se actualiza en Fase 5.4.

### 4.3 Deploy

```powershell
flyctl deploy
```

Esto va a:
1. Buildear el Docker image (~3-5 min la primera vez)
2. Pushearlo al registry de Fly
3. Correr `alembic upgrade head` (release_command, configurado en `fly.toml`)
4. Lanzar la máquina y rutear tráfico

Si todo sale bien, al final verás `Visit your newly deployed app at https://cehta-backend.fly.dev/`.

### 4.4 Verificación backend

```powershell
curl https://cehta-backend.fly.dev/health
```
**Esperado**: `{"status":"alive"}`

```powershell
curl https://cehta-backend.fly.dev/api/v1/health
```
**Esperado**: `{"status":"ok","database":"ok"}`

Si la segunda falla con `"database":"unreachable"`, las credenciales de DB en Fly secrets no coinciden con la nueva password de Supabase. Verifica con `flyctl secrets list` (no muestra valores, sólo nombres) y vuelve a correr el `flyctl secrets set` con la password correcta.

---

## ▲ FASE 5 — Deploy frontend a Vercel (10 min)

### 5.1 Importar el proyecto

1. Abrí: **https://vercel.com/new**
2. Si pide conectar GitHub, autoriza acceso a `Nikolaaa11/Ram-Cehta`
3. **Import** el proyecto

### 5.2 Configurar el build

1. **Project Name**: `cehta-capital` (o lo que prefieras)
2. **Framework Preset**: Next.js (autodetect)
3. **Root Directory**: click **Edit** → seleccioná **`frontend`** → click **Continue**
4. **Build & Output Settings**: dejar todo en automático

### 5.3 Environment Variables

Antes de click **Deploy**, expandí **Environment Variables** y agrega estas 3 (para los 3 ambientes: Production + Preview + Development):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dqwwqfhzejscgcynkbip.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse` |
| `NEXT_PUBLIC_API_URL` | `https://cehta-backend.fly.dev/api/v1` |

Click **Deploy**.

### 5.4 Actualizar CORS en Fly

Después del deploy de Vercel, copia el dominio que te asignó (algo como `https://cehta-capital-xxx.vercel.app`) y volvé a actualizar el CORS en Fly:

```powershell
flyctl secrets set CORS_ORIGINS="https://cehta-capital-xxx.vercel.app" --app cehta-backend
```

Esto reinicia el backend automáticamente.

---

## 🧪 FASE 6 — Smoke tests (10 min)

### 6.1 Login funciona

1. Abre el dominio Vercel en el navegador
2. Te redirige a `/login`
3. Email: `nikola@cehta.cl` + tu password
4. Debe redirigirte a `/dashboard`

### 6.2 JWT tiene `app_role`

1. DevTools (F12) → **Application** → **Cookies** → busca cookie `sb-...-auth-token`
2. Decodifícala (es JSON con `{access_token, ...}`). El `access_token` es un JWT.
3. Pegalo en **https://jwt.io** (es seguro, no envía nada al server)
4. En **Decoded → Payload** debe aparecer:

```json
{
  "iss": "https://dqwwqfhzejscgcynkbip.supabase.co/auth/v1",
  "aud": "authenticated",
  "app_role": "admin",
  "email": "nikola@cehta.cl",
  ...
}
```

**Si dice `"app_role": "viewer"` o falta el campo** → el hook de Fase 3.2 no está activo. Volvé a Authentication → Hooks y verificá que el toggle esté ON.

### 6.3 Dashboard carga

- Hero KPIs deben aparecer (saldo consolidado, flujo neto, OCs pendientes, F29).
- Si dice "Aún no hay datos disponibles" — es esperado, el ETL todavía no corrió.

### 6.4 CRUD funciona

Como admin debés poder:
- [ ] Ir a Proveedores → click **+ Nuevo proveedor** → completar form → **Guardar** → ver el proveedor en la lista
- [ ] Ir a Órdenes de Compra → click **+ Nueva OC** → completar → **Crear**
- [ ] Ver detalle del proveedor (click "Ver detalle" en la lista)
- [ ] Cerrar sesión (botón abajo en sidebar) → te lleva a `/login`

---

## 📡 FASE 7 — Monitoreo (5 min, opcional pero recomendado)

### UptimeRobot

1. **https://uptimerobot.com** → registrate gratis
2. **Add New Monitor**:
   - Type: HTTP(s)
   - URL: `https://cehta-backend.fly.dev/api/v1/health`
   - Monitoring interval: 5 min
   - Alert contact: tu email

Te avisa por email si el backend cae.

---

## 🔧 Troubleshooting

### "Error: app `cehta-backend` not found"
La app no existe aún. Corré `flyctl apps create cehta-backend`.

### "Error: SUPABASE_JWT_SECRET inválido o placeholder"
Volviste a deployar sin actualizar el secret tras la rotación. Re-corré el `flyctl secrets set ...` con el nuevo JWT secret.

### "ETL hace 7 días" en el badge del header
Es informativo. El ETL externo (`cehta-etl`) puebla `core.movimientos` desde el Excel de Dropbox. Si el ETL no corre, el dashboard muestra ceros pero la app funciona.

### Login dice "Email not confirmed"
En Supabase, edita el user en Authentication → Users → toggle "Confirmed" ON.

### Dashboard dice 401 / no autorizado
Sesión vencida. Cerrá sesión y volvé a entrar. Si persiste, la `SECRET_KEY` o `JWT_SECRET` no coinciden entre Fly y Supabase. Re-corré la rotación de la Fase 1.

### `alembic upgrade head` falla en deploy
La carpeta `db/` no entró al Docker image. Verifica que tenés el commit `eeeaba5` o posterior con `git log`. Si no, `git pull origin main`.

### Build de Vercel falla con "next/headers"
Bug histórico ya resuelto. Asegurate de estar en commit `fc61de5` o posterior.

### Build de Vercel falla con "prefer-const"
Bug ya resuelto. Asegurate de estar en `eb06a35` o posterior.

---

## 📚 Documentos relacionados

- `docs/rotacion-credenciales.md` — detalle de la rotación
- `docs/deploy.md` — versión legacy (este RUNBOOK lo reemplaza)
- `docs/SECURITY.md` — modelo de amenazas
- `SETUP.md` — desarrollo local

---

## 📞 Cuándo pedir ayuda

Si algo no funciona después de seguir este runbook:
1. Copia el error exacto
2. `flyctl logs --app cehta-backend` (últimas 50 líneas)
3. Mandalo y te ayudo a debuggear.
