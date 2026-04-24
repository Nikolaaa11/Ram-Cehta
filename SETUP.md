# Setup de Ram-Cehta — paso a paso

Guía operativa para arrancar el repo desde cero en tu PC. Pensada para correr en
**Git Bash** (Windows) o cualquier shell Unix.

---

## 0. Requisitos

Instalar si no tienes:

- **Python 3.12+** → https://www.python.org/downloads/
- **Node.js 20+** → https://nodejs.org/
- **Git** → ya lo tienes
- **Docker Desktop** (opcional, para Postgres local) → https://www.docker.com/

Verificar:

```bash
python --version   # 3.12+ idealmente, 3.13 también sirve
node --version     # v20+
npm --version
git --version
```

---

## 1. Clonar (si no está ya)

```bash
cd C:/Users/DELL/Documents/0.11.Nikolaya
git clone https://github.com/Nikolaaa11/Ram-Cehta.git
cd Ram-Cehta
```

---

## 2. Pendientes ANTES de correr migraciones

### 2.1 Arreglar el scope del Personal Access Token de GitHub

Hoy tu PAT no tiene permiso `workflow`, por lo que los archivos de
`.github/workflows/*.yml` están **locales pero sin pushear**. Para arreglarlo:

1. Abre https://github.com/settings/tokens
2. Edita el token que usas para este repo (o crea uno nuevo).
3. Marca el scope **`workflow`** (además de `repo`).
4. Guarda y copia el token nuevo.
5. En tu terminal:
   ```bash
   # Git Credential Manager: re-autentica
   git credential-manager reject https://github.com
   # Al siguiente push te pedirá usuario + nuevo token
   cd C:/Users/DELL/Documents/0.11.Nikolaya/Ram-Cehta
   git add .github/workflows/
   git commit -m "ci: agrega workflows de backend, frontend, secrets y dependabot"
   git push
   ```

### 2.2 Obtener credenciales de Supabase

En el panel de Supabase del proyecto `dqwwqfhzejscgcynkbip`:

1. **Password de la DB** (lo que va en `[YOUR-PASSWORD]`):
   - Si ya lo perdiste: `Database → Settings → Reset password`.
   - Copia ese password — lo usarás en `backend/.env`.

2. **Connection string** (ya tienes el template):
   ```
   postgresql://postgres.dqwwqfhzejscgcynkbip:{PASSWORD}@aws-1-us-east-2.pooler.supabase.com:6543/postgres
   ```

3. **Service role key** (SECRETA — nunca la expongas en el browser):
   - `Settings → API → service_role` → copiar.

4. **JWT Secret**:
   - `Settings → API → JWT Settings → JWT Secret` → copiar.

5. **Publishable key** (la que ya me compartiste):
   - `sb_publishable_tG_dvNH4L36xI2yG4LChOQ_15I8Mdse`

---

## 3. Configurar archivos `.env`

### Backend

```bash
cp backend/.env.example backend/.env
```

Editar `backend/.env` y reemplazar:
- `REEMPLAZAR_PASSWORD` → el password de la DB
- `sb_publishable_xxxxx` → tu publishable key
- `sb_secret_xxxxx` → tu service_role key
- `REEMPLAZAR_JWT_SECRET` → el JWT secret

### Frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Editar `frontend/.env.local` y reemplazar:
- `sb_publishable_xxxxx` → tu publishable key (la misma)

**Verificar que están en .gitignore (NO deberían commitearse):**

```bash
git check-ignore backend/.env frontend/.env.local
# Output esperado:
# backend/.env
# frontend/.env.local
```

---

## 4. Instalar dependencias

### Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate    # Windows Git Bash
pip install --upgrade pip
pip install -e ".[dev]"
```

### Frontend

```bash
cd ../frontend
npm install
```

---

## 5. Aplicar schema a Supabase

```bash
cd ../backend
source .venv/Scripts/activate
alembic upgrade head
```

Esto corre la migración `0001_initial_schema` que aplica:
- `db/schema.sql` (4 schemas: raw, stg, core, audit + tablas + seeds)
- `db/views.sql` (5 vistas operativas)
- `db/rls.sql` (Row Level Security)

**Verificar en Supabase UI**: `Table Editor → core.empresas` debería tener 9 filas
(las empresas del portfolio).

---

## 6. Arrancar backend + frontend

### Terminal 1 — Backend

```bash
cd backend
source .venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```

Abrir http://localhost:8000/docs — deberías ver Swagger UI con los endpoints
`/api/v1/health` y `/api/v1/validate/rut`.

Probar:

```bash
curl "http://localhost:8000/api/v1/validate/rut?rut=77.221.203-8"
# {"valid":true,"formatted":"77.221.203-8","message":null}
```

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

Abrir http://localhost:3000 — al no haber auth configurada todavía, verás la
pantalla de login. La conexión real a Supabase Auth se completa en la Fase 2.2.

---

## 7. Correr tests

```bash
# Backend
cd backend
pytest

# Frontend
cd ../frontend
npm run test -- --run
```

---

## 8. Lo que sigue (próxima sesión)

Según el [Plan de plataforma](docs/claude-context/PLAN_PLATAFORMA_CEHTA.md):

- **Sesión 1**: Verificar que el ETL `cehta-etl` (en el kit) carga datos contra
  esta Supabase. Contar filas en `core.movimientos` y comparar con el Excel madre.
- **Sesión 2.2**: Auth real con Supabase Auth + crear primer usuario admin.
- **Sesión 2.3**: CRUD de proveedores con validación RUT mod-11.

---

## Troubleshooting

### "Can't find DATABASE_URL"
Revisa que `backend/.env` existe y tiene `DATABASE_URL` seteada.

### Error de conexión a Supabase
El pooler Transaction (6543) requiere `statement_cache_size=0` — ya está
configurado en `app/core/database.py`. Si hay errores de prepared statements,
reiniciar el backend.

### `alembic upgrade head` falla
Confirma que tienes `ALEMBIC_DATABASE_URL` en `backend/.env` (URL sin `+asyncpg`).

### "refusing to allow a Personal Access Token..."
Ver la sección 2.1.
