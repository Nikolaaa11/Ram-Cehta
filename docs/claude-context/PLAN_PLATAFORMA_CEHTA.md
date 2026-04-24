# Plan de Construcción — Plataforma Cehta Capital

**Versión:** 1.0 · **Fecha:** Abril 2026

De Excel + Apps Script a plataforma productiva en \~8 semanas de trabajo enfocado. El plan asume que ya tienes: MVP en Google Sheets, el kit ETL a Postgres (entregado), y el `PROMPT\_MAESTRO\_CEHTA\_v2.md`.

\---

## Fase 0 — Fundaciones ✅ (ya hecho)

Al cierre de esta fase tienes:

* Esquema Postgres/Supabase diseñado (3 schemas: raw, core, audit)
* ETL Python que consume Excel madre desde Dropbox
* 9 empresas del portfolio seeded
* Validadores chilenos (RUT mod-11, IVA, UF, períodos F29)
* Docker Compose para Postgres local
* GitHub Actions para scheduling

**Entregable:** `cehta-etl.zip` corriendo localmente con `make up \&\& make etl`.

\---

## Fase 1 — Base de datos en producción (Semana 1)

El Postgres local sirve para desarrollo; en producción necesitas algo gestionado.

### 1.1 Crear proyecto Supabase

* Región: **South America (São Paulo)** — latencia menor desde Chile.
* Plan: **Pro** ($25/mes) si necesitas backups diarios y >500MB; Free para empezar.
* Guarda `DATABASE\_URL` en un gestor de secretos (no en Notion, no en Drive).

### 1.2 Aplicar schema y vistas

```bash
psql $DATABASE\_URL -f db/schema.sql
psql $DATABASE\_URL -f db/views.sql
```

### 1.3 Activar Row Level Security (RLS)

Crítico. Sin RLS, cualquier cliente con la `anon key` puede leer todo. Políticas mínimas:

* `core.movimientos`: solo usuarios autenticados con rol `admin` o `finance` leen.
* `core.ordenes\_compra`: todos los autenticados leen; solo `admin` y `finance\_creator` escriben.
* `core.empresas`: lectura a todos los autenticados; escritura solo a `admin`.

### 1.4 Primera carga real

Correr el ETL apuntando a Supabase y verificar en `audit.etl\_runs` que cargó N filas sin rechazos.

### 1.5 Backup manual de validación

Antes de construir encima, haz `pg\_dump` y guárdalo. Si algo se rompe en Fase 2-3, puedes reconstruir.

**Criterio de cierre:** `SELECT COUNT(\*) FROM core.movimientos` devuelve el mismo número de filas que tu Excel madre, y `audit.rejected\_rows` está vacío o con rechazos justificados.

\---

## Fase 2 — Backend FastAPI MVP (Semanas 2-3)

Un servicio Python que expone los datos a la app y orquesta las acciones (crear OC, aprobar pagos, generar PDFs).

### 2.1 Estructura de carpetas

```
backend/
├── app/
│   ├── core/
│   │   ├── config.py          # pydantic-settings + .env
│   │   ├── security.py        # JWT, hashing, RBAC
│   │   └── database.py        # async SQLAlchemy
│   ├── domain/                # entidades puras (sin I/O)
│   │   ├── empresa.py
│   │   ├── oc.py
│   │   ├── movimiento.py
│   │   └── proveedor.py
│   ├── infrastructure/
│   │   ├── repositories/      # implementaciones SQLAlchemy
│   │   ├── pdf/               # LibreOffice headless
│   │   └── storage/           # Supabase Storage o S3
│   ├── api/
│   │   ├── v1/
│   │   │   ├── auth.py
│   │   │   ├── oc.py
│   │   │   ├── proveedores.py
│   │   │   ├── movimientos.py
│   │   │   ├── dashboard.py
│   │   │   └── f29.py
│   │   └── deps.py            # dependencies (auth, db session)
│   ├── services/              # casos de uso
│   │   ├── oc\_service.py
│   │   ├── pdf\_service.py
│   │   └── payment\_service.py
│   └── main.py                # FastAPI app
├── tests/
├── migrations/                # alembic
├── Dockerfile
├── pyproject.toml
└── .env.example
```

### 2.2 Stack exacto

* Python 3.12
* FastAPI 0.115+
* SQLAlchemy 2.x async
* asyncpg (driver)
* pydantic 2.x + pydantic-settings
* alembic (migraciones)
* argon2-cffi (hash de passwords)
* python-jose (JWT)
* slowapi (rate limiting)
* httpx (cliente HTTP para integraciones)

### 2.3 Endpoints MVP (Fase 2 cierre)

```
POST   /api/v1/auth/login              → JWT
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me

GET    /api/v1/empresas                → lista empresas del portfolio
GET    /api/v1/empresas/{codigo}

GET    /api/v1/proveedores
POST   /api/v1/proveedores             → requiere rol finance
PUT    /api/v1/proveedores/{id}
GET    /api/v1/proveedores/validar-rut/{rut}

GET    /api/v1/oc                      → lista OCs (filtros: empresa, estado, fecha)
GET    /api/v1/oc/{id}
POST   /api/v1/oc                      → crea OC + genera PDF
PUT    /api/v1/oc/{id}/estado          → pagada | anulada
GET    /api/v1/oc/{id}/pdf             → descarga PDF firmado

GET    /api/v1/movimientos             → datos de `core.movimientos`, paginado
GET    /api/v1/movimientos/stats       → agregaciones (totales mes, etc.)

GET    /api/v1/dashboard/saldos        → v\_saldos\_actuales
GET    /api/v1/dashboard/flujo
GET    /api/v1/dashboard/iva
GET    /api/v1/dashboard/f29-alertas
```

### 2.4 Seguridad mínima (no negociable)

* Hashing: **argon2id** (no bcrypt en proyectos nuevos).
* JWT: access token 15 min + refresh token 7 días en httpOnly cookie.
* RBAC con 3 roles iniciales: `admin`, `finance`, `viewer`.
* Rate limiting: 100 req/min por IP en endpoints públicos, 10 req/min en `/auth/login`.
* CORS estricto: solo el dominio del frontend.
* Pydantic para validación de todo input — sin excepción.
* Logs estructurados JSON (loguru o structlog). Nunca loggear RUT completo ni tokens.

### 2.5 Generación de PDFs (módulo crítico)

Tienes 3 plantillas DOCX (Trongkai, CSL, Evoque) + 1 PDF (DTE) + 1 XLSX (Revtech). Para el MVP:

1. Convertir las 5 plantillas a formato **docxtpl** (Jinja2 sobre DOCX). Reemplazas `{{ proveedor.razon\_social }}` por el valor real.
2. Generar el DOCX con datos y convertir a PDF con `libreoffice --headless --convert-to pdf`.
3. Subir a Supabase Storage bucket `oc-pdfs/` con path `{empresa}/{año}/{numero\_oc}.pdf`.
4. Endpoint `GET /api/v1/oc/{id}/pdf` devuelve URL firmada con expiración de 1 hora.

### 2.6 Tests

* `pytest` + `pytest-asyncio` + `httpx.AsyncClient`
* Cobertura mínima para cierre de fase: **70%** en `domain/` y `services/`.
* Fixtures: base de datos en `testcontainers-python` (Postgres real, no SQLite).

**Criterio de cierre:** todos los endpoints responden 200 con datos reales, Swagger UI en `/docs` funciona, `pytest` pasa con 70%+ cobertura, puedes crear una OC desde curl y descargar el PDF generado.

\---

## Fase 3 — Frontend Next.js (Semanas 3-4)

La app que usarán Nikola, Benja y Egon día a día.

### 3.1 Stack

* Next.js 15 (App Router)
* TypeScript 5
* Tailwind CSS 4
* shadcn/ui
* TanStack Query (server state)
* React Hook Form + Zod (formularios con el mismo schema que valida el backend)
* Lucide (iconos)
* Recharts o Tremor (dashboards)

### 3.2 Estructura

```
frontend/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              # sidebar + header
│   │   ├── dashboard/page.tsx
│   │   ├── oc/
│   │   │   ├── page.tsx            # listado
│   │   │   ├── nueva/page.tsx      # formulario creación
│   │   │   └── \[id]/page.tsx       # detalle
│   │   ├── proveedores/page.tsx
│   │   ├── movimientos/page.tsx
│   │   ├── f29/page.tsx
│   │   └── configuracion/page.tsx
│   └── api/                        # BFF si hace falta
├── components/
│   ├── ui/                         # shadcn
│   ├── forms/
│   │   ├── OCForm.tsx              # el reemplazo del formulario HTML que ya tienes
│   │   └── ProveedorForm.tsx
│   ├── charts/
│   └── tables/
├── lib/
│   ├── api.ts                      # cliente axios/fetch tipado
│   ├── schemas.ts                  # Zod schemas compartidos
│   ├── auth.ts
│   └── utils.ts                    # formatoCLP, formatoUF, validarRut
└── types/
```

### 3.3 Pantallas MVP

1. **Login** — email/password, recordarme, recuperación por correo.
2. **Dashboard** — 4 tarjetas (saldos por empresa, flujo neto mes, IVA a pagar, F29 próximos). Un gráfico de egresos últimos 6 meses.
3. **Nueva OC** — el formulario que ya tenías en Apps Script, pero tipado y con validación Zod. Preview en vivo del PDF.
4. **Listado OC** — tabla con filtros por empresa, estado, rango de fechas. Acciones: ver, descargar PDF, marcar pagada.
5. **Proveedores** — CRUD. Autocomplete de RUT con validación mod-11 en vivo.
6. **Movimientos** — tabla paginada con todos los movimientos (consume el Postgres que llena el ETL). Filtros por empresa/proyecto/período.
7. **F29** — calendario con obligaciones por empresa y estado (pendiente/pagado).

### 3.4 Componentes clave a construir (componentizar temprano)

* `<RutInput />` — valida mod-11 mientras el usuario escribe.
* `<MontoInput moneda="CLP|UF" />` — formatea `1.234.567` según moneda.
* `<EmpresaSelect />` — select de las 9 empresas del portfolio.
* `<ConceptoSelect />` — dropdown jerárquico (general → detallado) que consume catálogos vivos del backend.
* `<PDFViewer />` — visor inline con react-pdf.

### 3.5 Autenticación en el cliente

* Next.js middleware protege rutas privadas.
* Tokens JWT en httpOnly cookie (nunca localStorage).
* Rotación automática del access token con el refresh.

**Criterio de cierre:** Benja puede crear una OC de punta a punta y descargar el PDF. Egon puede ver el dashboard de saldos. Lighthouse score ≥ 90 en performance y accesibilidad.

\---

## Fase 4 — CI/CD y despliegue (Semana 5)

### 4.1 Infraestructura

* **Backend**: Fly.io o Railway. Ambos corren Docker y tienen plan gratuito/barato para apps con poco tráfico. Fly.io es más configurable; Railway es más simple. Recomiendo **Fly.io** porque su `fly.toml` es reproducible.
* **Frontend**: Vercel. Gratis, deploys en push a `main`, preview automático en PRs.
* **Base de datos**: Supabase (ya en Fase 1).
* **Storage de PDFs**: Supabase Storage (incluido en Supabase).
* **Secretos**: GitHub Actions secrets + Fly.io secrets + Vercel env vars.

### 4.2 Pipelines GitHub Actions

```
.github/workflows/
├── etl.yml              # ya existe
├── backend-ci.yml       # ruff, mypy, pytest en PRs
├── backend-deploy.yml   # deploy a Fly.io en push a main
├── frontend-ci.yml      # lint, typecheck, build en PRs
└── e2e.yml              # Playwright contra staging
```

### 4.3 Ambientes

* **local** — Docker Compose con Postgres local
* **staging** — Supabase staging + Fly.io staging + Vercel preview
* **production** — Supabase prod + Fly.io prod + Vercel prod

Regla de oro: nada se mergea a `main` si no pasó por staging primero.

### 4.4 Monitoreo mínimo

* **Sentry** para errores runtime (backend y frontend) — plan gratuito cubre 5K errores/mes.
* **Uptime Robot** o **BetterStack** para health checks cada minuto.
* Log drain de Fly.io a un destino queryable (Logtail/BetterStack).

**Criterio de cierre:** push a `main` despliega automáticamente, alertas a tu correo si algo falla, rollback es `fly deploy --image <sha-anterior>` en <60 segundos.

\---

## Fase 5 — Módulos adicionales (Semanas 6-7)

Ahora que la plataforma está viva, iteras los 9 módulos de `PROMPT\_MAESTRO\_CEHTA\_v2.md`:

1. **Solicitudes de pago** — workflow: solicitud → aprobación → ejecución → registro. Estados + transiciones.
2. **Nóminas bancarias** — export a formato Santander/BCI/Chile. Cada banco tiene un `.txt` o `.csv` con layout específico.
3. **Dashboard de gastos** — tablas dinámicas que ya tienes en Excel (`6) Egresos por Proyecto`) pero interactivas.
4. **Recibos de suscripción de acciones FIP CEHTA** — el flujo que viste en los PDFs del proyecto. Template DOCX + firma electrónica.
5. **Gestión documental** — subida a Supabase Storage, indexación, búsqueda full-text en Postgres (`tsvector`).
6. **Calendario F29** — alertas 5 días antes del vencimiento por empresa.
7. **Reportes PDF para directorio** — agregaciones mensuales exportables a PDF.
8. **Auditoría de acciones** — `core.audit\_log` que registra quién hizo qué cuándo.
9. **Automatización de clasificación** — cuando Benja sube una factura, Claude (vía API) sugiere categoría basándose en el proveedor y descripción.

**Criterio de cierre de cada módulo:** tests backend ≥ 70% cobertura, pantalla frontend funcional con estados de carga/error, documentación del caso de uso en `/docs`.

\---

## Fase 6 — Integraciones (Semana 8+)

Solo cuando todo lo anterior esté estable:

### 6.1 Gmail MCP

Parser automático de correos entrantes. Cuando llega "Por favor gestionar pago" + adjunto, crea un borrador de OC en la plataforma.

* Requiere OAuth de Google Workspace.
* Gmail API scopes: `gmail.readonly`, `gmail.send`.
* Procesamiento vía Claude API con function calling (la categoría y monto salen del correo).

### 6.2 DocuSign

Para firma electrónica de OCs y recibos de suscripción.

* Alternativa chilena: **Signs**, **Trámites Chile**, o **e-Cert** (que ya usa Rho según el PDF que vi).
* Recomiendo **Signs** porque tiene API + es chileno + cumple Ley 19.799.

### 6.3 SII / DTE

Integración con el SII para Documentos Tributarios Electrónicos. Emisión automática de facturas electrónicas.

* Librerías: `simplefact` o integrar directo con el API del SII.
* Esto es un proyecto en sí — considera postergarlo a una Fase 7 dedicada.

### 6.4 Claude API en la app

Ya tienes la arquitectura en RAM Audit: endpoint backend que llama a la Anthropic API con un system prompt. Casos de uso en Cehta:

* Clasificación automática de gastos (categoría general/detallada).
* Redacción de observaciones de OC desde una descripción libre.
* Detección de anomalías en el flujo de caja.

\---

## Decisiones pendientes que debes tomar antes de Fase 2

1. **¿Supabase Auth o auth propia?**
Supabase Auth acelera Fase 2 en 3-5 días. Trade-off: acoplas tu app a Supabase. Recomiendo **sí Supabase Auth** para el MVP.
2. **¿Next.js en Vercel o self-hosted?**
Vercel hasta que el tráfico o los costos digan otra cosa. Vercel gratis cubre varios años de este caso de uso.
3. **¿Monorepo o dos repos separados?**
Dos repos separados (`cehta-backend`, `cehta-frontend`, `cehta-etl`). Más simple que configurar Turborepo/Nx para 3 proyectos pequeños.
4. **¿Qué plantilla OC implementar primero?**
Recomiendo **Trongkai** — es la estructura más limpia (tabla de campos + detalle + firma). Evoque después.
5. **¿Tests de integración con DB real o mocks?
DB real** con `testcontainers`. Los mocks de SQLAlchemy mienten.

\---

## Costos estimados mensuales

|Servicio|Plan|Costo|
|-|-|-|
|Supabase|Free → Pro (cuando pases de 500MB)|$0 → $25|
|Fly.io|shared-cpu-1x, 256MB|$0-5|
|Vercel|Hobby|$0|
|Sentry|Developer|$0|
|Dominio|.cl anual|\~$8/año|
|**Total MVP**||**\~$0-30/mes**|

Cuando escales: Supabase Pro + Fly Performance + Sentry Team → \~$100-150/mes.

\---

## Criterios de "hecho" globales

Antes de considerar la plataforma en producción:

* \[ ] Todos los RUTs del portfolio validados con mod-11 antes de persistir
* \[ ] RLS activo en todas las tablas de `core.\*`
* \[ ] HTTPS obligatorio (HSTS header)
* \[ ] Backups automáticos de Postgres (Supabase Pro lo hace)
* \[ ] Runbook de incidentes documentado en `/docs/INCIDENTES.md`
* \[ ] Al menos 2 personas con acceso root al Supabase project (tú + una persona de confianza)
* \[ ] Política de rotación de secretos definida (cada 90 días)
* \[ ] DPA (Data Processing Agreement) firmado con Anthropic si usas su API
* \[ ] Test E2E del flujo crítico (crear OC → generar PDF → marcar pagada) verde en CI
* \[ ] Benja y Egon capacitados en la interfaz nueva (1-2 sesiones de 1 hora)
* \[ ] Plan de migración del Excel madre: fecha de corte después de la cual el Excel es read-only y la fuente de verdad es la plataforma

\---

## Riesgos identificados y mitigación

|Riesgo|Probabilidad|Impacto|Mitigación|
|-|-|-|-|
|El equipo sigue usando el Excel y la plataforma diverge|Alta|Alto|Fecha de corte dura + ETL sigue corriendo como compatibilidad los primeros 30 días|
|Supabase tiene downtime y bloquea operaciones críticas|Baja|Alto|El ETL tiene copia local del Excel; un modo degradado del frontend puede leer de un snapshot|
|Una migración de schema rompe datos existentes|Media|Alto|Alembic con migraciones reversibles + `pg\_dump` antes de cada deploy a prod|
|Claves de API filtradas en un commit|Media|Crítico|`gitleaks` pre-commit hook + rotación inmediata si ocurre|
|Un cambio de estructura del Excel rompe el ETL|Alta|Medio|El ETL registra filas rechazadas en `audit`; alerta si >5% en una corrida|

\---

## Próxima acción concreta para ti

Esta semana:

1. Crea proyecto Supabase y aplica `schema.sql` + `views.sql`.
2. Corre el ETL apuntando a Supabase con `DRY\_RUN=true`; revisa rechazos.
3. Cuando los rechazos estén en 0 (o justificados), corre `DRY\_RUN=false`.
4. Verifica en `audit.etl\_runs` y en `core.movimientos` que la carga fue exitosa.
5. Cuando eso esté, abre el siguiente chat con el **Prompt Maestro v3** (adjunto) para que Claude Code empiece el backend FastAPI.

