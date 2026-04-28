# 🚀 RUNBOOK V3 — Activar Plataforma Completa Cehta Capital

> **Para Nicolas**: Esta es la **guía maestra** para activar V3 completa.
> Si la plataforma ya está deployada (V1/V2 funcionando), ejecutá los pasos
> incrementales. Si arrancás de cero, seguí `docs/RUNBOOK.md` primero.
>
> **Tiempo total estimado**: 60-90 minutos.

**Última actualización**: 2026-04-27 · V3 fase 5 completa (commits `89d4094` → `b0322fa`)

---

## 📊 Lo que vas a tener cuando termines

### Sidebar 5 grupos + 9 empresas expandibles
```
EJECUTIVO              · Dashboard CEO consolidado, Calendario con eventos
OPERACIONES            · Dashboard, Proveedores, OC, Solicitudes, Movimientos, F29
EMPRESAS (9)           · cada una expandible:
                         Resumen · Trabajadores · Legal · Avance · AI Asistente
ESTRATEGIA             · Búsqueda Fondos
DOCUMENTOS             · Reportes
ADMIN (admin only)     · Usuarios · ETL Runs · Data Quality · Integraciones
```

### Features destacadas V3

| Feature | Ruta | Estado |
|---|---|---|
| AI Q&A por empresa con Claude + pgvector | `/empresa/{X}/asistente` | ✅ |
| Trabajadores HR + upload Dropbox | `/empresa/{X}/trabajadores` | ✅ |
| Legal vault con alertas vencimiento | `/empresa/{X}/legal` | ✅ |
| Avance + Gantt charts + Riesgos | `/empresa/{X}/avance` | ✅ |
| CEO Dashboard consolidado 9 empresas | `/ceo` | ✅ |
| Calendario con eventos auto (F29, reportes) | `/calendario` | ✅ |
| Búsqueda Fondos (LPs, bancos, programas) | `/fondos` | ✅ |
| ETL real Dropbox → Postgres (cron + webhook) | `/admin/etl` | ✅ |
| Email notifications con Resend | bg | ✅ |
| Reportes para inversionistas con PDF | `/reportes` | ✅ |

---

## ⚡ FASE A — Configurar credenciales nuevas (10 min)

V3 introduce 2 servicios externos nuevos: **OpenAI** (embeddings AI) y **Resend** (email).

### A.1 OpenAI API Key

1. Abrí: **https://platform.openai.com/signup** (si no tenés cuenta)
2. Una vez logueado: **API Keys → Create new secret key**
3. Nombre: `cehta-backend-prod`
4. Copia el `sk-...` (solo se muestra una vez)
5. **Recarga billing**: $5-10 USD alcanzan para empezar (text-embedding-3-small es muy barato)

### A.2 Resend API Key

1. **https://resend.com/signup** — gratis hasta 3K emails/mes
2. **Domains**: opciones:
   - **A**) Verificar dominio `cehta.cl` (recomendado): te pide agregar registros DNS (TXT, MX). Si tenés acceso al DNS, son 5 min.
   - **B**) Usar `onboarding@resend.dev` temporalmente sin verificar dominio (no llega a inboxes externos pero sirve para testing).
3. **API Keys → Create**
4. Nombre: `cehta-backend-prod`
5. Copia el `re_...`

---

## ⚡ FASE B — Setear secrets en Fly + Deploy (10 min)

```powershell
flyctl secrets set `
  OPENAI_API_KEY="sk-..." `
  RESEND_API_KEY="re_..." `
  EMAIL_FROM="noreply@cehta.cl" `
  EMAIL_ADMIN_RECIPIENTS="nikola@cehta.cl,contactocehta@gmail.com" `
  --app cehta-backend
```

Luego:

```powershell
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta
git pull
cd backend
flyctl deploy
```

El `release_command` aplica las migraciones automáticamente:
- **0006_trabajadores** — HR + documentos
- **0007_ai_qa** — pgvector + ai_conversations + ai_messages + ai_documents
- **0008_legal_vault** — legal_documents + view alertas
- **0009_proyectos** — proyectos_empresa + hitos + riesgos
- **0010_calendar** — calendar_events
- **0011_fondos** — fondos table

⏱ Esperá ~3-5 min hasta ver `Visit your newly deployed app at...`

### Verificación

```powershell
curl https://cehta-backend.fly.dev/api/v1/health
```
Esperado: `{"status":"ok","database":"ok"}`

---

## ⚡ FASE C — Configurar Webhook Dropbox para ETL real (5 min)

Esto hace que cuando edites el `Data Madre.xlsx` en Dropbox, la app lo sincronice **automáticamente en segundos** (en lugar de esperar el cron de 30 min).

1. Abrí: **https://www.dropbox.com/developers/apps**
2. Click en tu app de Cehta
3. Tab **Webhooks**
4. **Webhook URI**: `https://cehta-backend.fly.dev/api/v1/etl/webhook/dropbox`
5. Click **Add**
6. Dropbox manda un challenge → tu backend responde → status pasa a **Enabled** ✓

---

## ⚡ FASE D — Cron Fly.io para ETL automático (5 min)

Backup del webhook: cron cada 30 min que corre el ETL aunque el webhook falle.

```powershell
flyctl machine run --app cehta-backend `
  --schedule "*/30 * * * *" --process-group etl_cron `
  -- python -m scripts.etl_cron
```

> Alternativa simpler: GitHub Actions cron — ver `docs/etl-setup.md` §2.2.

---

## ⚡ FASE E — Armar carpetas Dropbox + datos iniciales (15 min)

Sigue `docs/GUIA_CARPETAS.md`. Resumen rápido:

### E.1 Estructura raíz

```
Dropbox/Cehta Capital/
├── 00-Inteligencia de Negocios/
│   └── Data Madre.xlsx           ← acá pegá tu Excel madre
├── 01-Empresas/
│   ├── TRONGKAI/  (idem para otras 8)
│   │   ├── 01-Información General/
│   │   ├── 02-Trabajadores/Activos/
│   │   ├── 03-Legal/{Contratos,Actas,Declaraciones SII,Permisos}/
│   │   ├── 04-Financiero/
│   │   ├── 05-Proyectos & Avance/
│   │   ├── 06-Reuniones/
│   │   ├── 07-Reportes Generados/
│   │   └── 08-AI Knowledge Base/
│   └── REVTECH, EVOQUE, DTE, CSL, RHO, AFIS, FIP_CEHTA, CENERGY/
├── 02-Fondo (FIP CEHTA)/
├── 03-Búsqueda de Capital/
└── 99-Templates Globales/
```

> **Tip**: armá una empresa primero (ej. TRONGKAI), después click derecho → Copy → Paste 8 veces y renombrá.

### E.2 AI Knowledge Base inicial (mínimo viable)

Por cada empresa, en `08-AI Knowledge Base/`, creá `company_overview.md`:

```markdown
# TRONGKAI — Resumen

## Qué hace
Agrotecnologías e Ingeniería SpA — solución X para Y mercado.

## Modelo de negocio
B2B SaaS / hardware / consultoría con tickets de $X-Y promedio.

## Stage actual
Series A, runway 18 meses, Q1 2026 break-even.

## KPIs operativos clave
- MRR: $X
- Clientes: N
- CAC: $X
- LTV/CAC: X.X

## Equipo
- CEO: Jaime Echevarria
- CTO: ...
- N empleados

## Roadmap 12 meses
- Q1: ...
- Q2: ...
```

Mientras más detalle pongas, mejor responde el AI. Subí también `.pdf` de pitch decks, contratos clave, planes estratégicos.

---

## ⚡ FASE F — Indexar AI Knowledge Base (5 min)

Una vez subidos los archivos al Dropbox de la KB, hay que indexarlos (chunking + embeddings).

Por ahora hacelo manualmente como admin:

```powershell
$TOKEN = "tu_supabase_access_token"  # del DevTools del browser

curl -X POST https://cehta-backend.fly.dev/api/v1/ai/index/TRONGKAI `
  -H "Authorization: Bearer $TOKEN"
```

Repetí para cada empresa (REVTECH, EVOQUE, DTE, CSL, RHO, AFIS, FIP_CEHTA, CENERGY).

> **Próxima fase**: vamos a tener un botón **"Reindexar"** en el panel IndexStatus de cada AI Asistente.

Verificá:
```
https://cehta-backend.fly.dev/api/v1/ai/index/TRONGKAI/status
```
Esperado: `{"chunks_count": 47, "files_indexed": 4, "last_indexed": "..."}`

---

## ⚡ FASE G — Smoke tests (10 min)

### G.1 ETL real

1. Subí `Data Madre.xlsx` a `00-Inteligencia de Negocios/`
2. Sidebar → Admin → ETL Runs → click **"Ejecutar ETL ahora"**
3. Esperá ~30s → ver row con `status: success`
4. Sidebar → Operaciones → Movimientos → ver datos sincronizados

### G.2 AI Q&A

1. Sidebar → click **TRONGKAI** → expand → **AI Asistente**
2. Hacé pregunta: **"¿Qué hace TRONGKAI?"**
3. Vas a ver respuesta streaming + citations [1] [2]...

### G.3 Trabajadores

1. **TRONGKAI → Trabajadores → + Nuevo trabajador**
2. Completá: nombre, RUT, cargo, fecha ingreso, contrato
3. **Crear** → aparece en lista
4. Click 📄 (FileText) → subir documento → drag-drop PDF → **Subir**
5. Verificá en Dropbox: archivo en `01-Empresas/TRONGKAI/02-Trabajadores/Activos/{rut} - {nombre}/`

### G.4 Legal Vault

1. **TRONGKAI → Legal → + Subir documento**
2. Categoría: Contrato, Subcategoría: Cliente
3. Datos: nombre "Servicios X", contraparte "Cliente Y", fecha vigencia
4. Upload PDF → guarda en Dropbox `03-Legal/Contratos/Cliente/`
5. Si vence en <30 días → aparece alerta en CEO Dashboard

### G.5 CEO Dashboard

1. Sidebar → **EJECUTIVO → Dashboard CEO** (visible si tu rol es admin)
2. Ver: 4 KPIs hero + comparador 9 empresas + heatmap + top alertas

### G.6 Calendario

1. Sidebar → **EJECUTIVO → Calendario**
2. Si hay F29 cargados, vas a ver eventos auto-generados 3 días antes
3. Click día → ver eventos detallados

### G.7 Email test

```powershell
curl -X POST https://cehta-backend.fly.dev/api/v1/notifications/test `
  -H "Authorization: Bearer $TOKEN"
```

Llega email a `EMAIL_ADMIN_RECIPIENTS` con template de prueba.

### G.8 Avance + Gantt

1. **TRONGKAI → Avance → + Nuevo proyecto**
2. Nombre, fechas inicio/fin, owner
3. Crear → ver tarjeta con Gantt mini
4. Click **+ Hito** → completá → marcar completado
5. Tab **Riesgos** → + Nuevo riesgo → severidad alta/media/baja

### G.9 Búsqueda de Fondos

1. Sidebar → **ESTRATEGIA → Búsqueda Fondos**
2. **+ Nuevo fondo** → tipo LP, ticket range, sectores
3. Estado outreach: no_contactado → contactado → en_negociacion
4. KPIs en header se actualizan

---

## 📊 Verificaciones técnicas finales

```powershell
# Backend tests
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
.venv\Scripts\Activate.ps1
pytest tests/unit -q
```
Esperado: **298 passed**

```powershell
# Frontend build
cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\frontend
npx next build
```
Esperado: 32+ páginas estáticas, sin errores.

---

## 🎯 Capabilities matrix V3 final

| Acción | admin | finance | viewer |
|---|:-:|:-:|:-:|
| **Operaciones** |
| Crear/Editar/Eliminar proveedor | ✅/✅/✅ | ✅/✅/— | ❌ |
| Crear/Editar OC, mark paid | ✅ | ✅ | ❌ |
| Anular OC | ✅ | ❌ | ❌ |
| F29 CRUD | ✅ | ✅ | ❌ |
| Movimientos read | ✅ | ✅ | ✅ |
| **Empresas** |
| Trabajadores CRUD | ✅ | ✅ (no delete) | read |
| Legal Vault CRUD | ✅ | ✅ (no delete) | read |
| AI Asistente | ✅ + reindex | ✅ chat | ✅ chat |
| Avance proyectos/hitos/riesgos | ✅ | ✅ | read |
| **Fondo** |
| CEO Dashboard | ✅ | ❌ | ❌ |
| Reportes inversionistas | ✅ | ✅ | read |
| Búsqueda Fondos | ✅ | ✅ | read |
| **Sistema** |
| Calendario events | ✅ + agents | ✅ create | read |
| Suscripciones acciones | ✅ | ✅ create | read |
| Admin (users/etl/quality) | ✅ | ❌ | ❌ |
| Email notifications | ✅ | ❌ | ❌ |

---

## 🛟 Troubleshooting V3

### "AI Asistente: 503 Service Unavailable"
- `OPENAI_API_KEY` no está seteado en Fly. Correr `flyctl secrets set OPENAI_API_KEY=sk-...`

### "Tab AI Asistente vacío, sin chunks"
- Hay que indexar primero. POST `/ai/index/{empresa_codigo}` o crear archivos en Dropbox `08-AI Knowledge Base/`

### "Email: notifications:status returns enabled=false"
- `RESEND_API_KEY` no está seteado. Correr `flyctl secrets set RESEND_API_KEY=re_...`

### "ETL falla con FK violation en empresa_codigo"
- Empresa en el Excel no existe en `core.empresas`. Agregarla manualmente con SQL.

### "Webhook Dropbox: signature mismatch"
- `DROPBOX_CLIENT_SECRET` en Fly no coincide con la app Dropbox. Verificar.

### "/admin/etl/run: 401 Unauthorized"
- Tu rol no es admin. Verificar con SQL en Supabase:
  ```sql
  SELECT u.email, r.app_role FROM core.user_roles r 
  JOIN auth.users u ON u.id = r.user_id 
  WHERE u.email = 'tu_email';
  ```

### "Calendar events vacío"
- Trigger los agents manualmente:
  ```powershell
  curl -X POST https://cehta-backend.fly.dev/api/v1/calendar/agents/run `
    -H "Authorization: Bearer $TOKEN"
  ```

---

## 📚 Documentación relacionada

| Doc | Propósito |
|---|---|
| `docs/RUNBOOK.md` | Deploy zero-to-prod inicial (V1/V2) |
| `docs/RUNBOOK_V3.md` | Este archivo — activar V3 features |
| `docs/V3_VISION.md` | Visión completa V3 (522 líneas) |
| `docs/GUIA_CARPETAS.md` | Estructura Dropbox (421 líneas) |
| `docs/V3_FASE_3_4.md` | Plan + costos V3 fases 3+4 |
| `docs/etl-setup.md` | Detalle técnico ETL + webhook |
| `docs/email-setup.md` | Resend setup detallado |
| `docs/dropbox-setup.md` | Dropbox OAuth + permisos |
| `docs/sentry-setup.md` | Observability |
| `docs/rotacion-credenciales.md` | Rotación credenciales |

---

## 💰 Costo operacional total V3

| Servicio | Mensual | Notas |
|---|---|---|
| Fly.io (api + etl_cron) | $15-30 | 2 procesos |
| Vercel | $0 | Hobby alcanza |
| Supabase Pro | $25 | Recomendado para pgvector + scaling |
| Anthropic Claude | $20-100 | depende uso AI Q&A |
| OpenAI Embeddings | $1-5 | text-embedding-3-small |
| Resend | $0 | free 3K/mes |
| Sentry | $0 | free 5K events |
| Dropbox API | $0 | within limits |
| **TOTAL** | **$60-160/mes** | escala con uso |

---

## ✅ Checklist final V3 deploy

- [ ] OpenAI account + API key
- [ ] Resend account + API key
- [ ] Fly secrets set (OPENAI, RESEND, EMAIL_FROM, EMAIL_ADMIN_RECIPIENTS)
- [ ] `flyctl deploy` exitoso (con migraciones 0006-0011)
- [ ] Webhook Dropbox configurado
- [ ] Cron Fly machine schedule */30
- [ ] Carpetas Dropbox creadas (00-Inteligencia, 01-Empresas/9, 02-Fondo, etc.)
- [ ] Excel madre subido a Inteligencia de Negocios
- [ ] AI Knowledge Base con `company_overview.md` por empresa
- [ ] Trigger inicial AI indexing por empresa
- [ ] Smoke tests pasados (G.1 a G.9)

Cuando todos los checks estén ✅, **V3 está LIVE en producción**.

---

## 🎉 Felicitaciones

Tenés una plataforma SaaS interna de clase enterprise con:
- 32 rutas frontend Apple-style
- 11+ routers backend con 298 unit tests
- AI integrado por empresa (Claude + pgvector)
- ETL automático 24/7
- Email notifications
- 4 reportes PDF para inversionistas
- 9 empresas del portfolio cada una con su sección completa
- 5 servicios externos integrados

**V4 ideas futuras** (cuando quieras):
- Mobile app native
- Bulk actions
- Audit log per-action
- OCR pipeline para PDFs escaneados
- Slack notifications
- API pública para LPs

Pero antes: **disfrutá V3 funcionando**. 🎊
