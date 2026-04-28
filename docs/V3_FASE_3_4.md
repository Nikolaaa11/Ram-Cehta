# 🚀 V3 Fases 3 + 4 — Plan + Estado

> **Fase 3**: AI Asistente por empresa, CEO Dashboard real, ETL service real, Avance Gantt
>
> **Fase 4**: Legal vault + alertas, Calendario+agentes, Email notifications, Búsqueda Fondos

**Última actualización**: 2026-04-27 · V3 Fase 3+4 en curso

---

## 1. Lo que se está construyendo AHORA (en paralelo)

### Agente A — AI Q&A completo (Fase 3 highlight)

**Backend**:
- Migración 0007 con `pgvector` extension + 3 tablas (`ai_conversations`, `ai_messages`, `ai_documents`)
- Anthropic Claude SDK integration (modelo `claude-3-5-sonnet`)
- OpenAI embeddings (`text-embedding-3-small`)
- Streaming chat endpoint con Server-Sent Events
- Indexing pipeline: lee `08-AI Knowledge Base/{empresa}/` de Dropbox → chunks (1000 chars + 200 overlap) → embeddings → guarda en pgvector
- Vector similarity search con cosine distance
- 7 endpoints `/ai/*`

**Frontend**:
- Chat UI completo con sidebar de conversaciones + área principal de mensajes
- Streaming en vivo con cursor blinking
- Markdown rendering (react-markdown + remark-gfm)
- Citations clickables con tooltip mostrando snippet del source
- Empty states + loading states elegantes
- Empresa-scoped: `/empresa/{codigo}/asistente`

**Coste operacional estimado**:
- OpenAI embeddings: ~$1-3/mes (text-embedding-3-small es muy barato)
- Anthropic Claude: ~$20-100/mes según uso (depende cuánto chatean los usuarios)
- pgvector en Supabase: $0 (incluido)

### Agente B — CEO Dashboard + Legal Vault + Email

**CEO Dashboard real** (`/ceo`):
- Endpoint backend `/dashboard/ceo-consolidated` con: AUM total, deltas 30d/90d, breakdown por empresa, heatmap 9×6, top alertas
- 4 KPIs hero, comparador 9 empresas con sparklines, heatmap visual, top alertas priorizadas
- Solo admin/ceo

**Legal Vault** (`/empresa/{codigo}/legal`):
- Migración 0008 con `core.legal_documents` + view `v_legal_alerts`
- Categorías: contrato, acta, declaracion_sii, permiso, poliza, estatuto
- Alertas automáticas por nivel: vencido / crítico (<30d) / proximo (<90d)
- 8 endpoints `/legal/*` con upload a Dropbox
- Frontend: tabla con filtros, dialog crear, drawer detalle

**Email notifications** con Resend:
- Servicio + 4 templates (legal_alert, f29_reminder, welcome_user, monthly_report)
- Setup doc para Nicolas
- Soft fail: si no está configurado, los flows siguen sin romper

---

## 2. Lo que viene después (Fase 5+)

Features que **NO** entran en este sprint pero están planeadas:

### Pendientes de Fase 3
- **ETL Service real**: cron 30min + webhook Dropbox para sync automático del Excel madre
- **Avance Gantt**: parsea `Roadmap.xlsx` por empresa, render Gantt visual, KPIs operativos

### Pendientes de Fase 4
- **Calendario + Agentes**: vista calendar con eventos automáticos (F29, reportes mensuales), cron jobs en Fly.io
- **Búsqueda de Fondos**: base curada de LPs/bancos/programas + AI matchmaker

### Phase 5 (futuras)
- **Bulk actions** en cualquier tabla
- **Audit log per-action**
- **Mobile app responsive deep**
- **OCR pipeline** para PDFs escaneados

---

## 3. Cronograma actualizado

| Fase | Estado | Highlights |
|---|---|---|
| ✅ V1 | Done | Auth, RBAC, Proveedores, OC, F29 básico |
| ✅ V2 | Done | CRUD completo, Reportes inversionistas, Admin panel |
| ✅ V3 Fase 1 | Done | JWT fix, sidebar reorg, Dropbox OAuth, V3 vision doc |
| ✅ V3 Fase 2 | Done | Trabajadores HR, empresa-scoped UI, admin integraciones |
| 🔄 V3 Fase 3+4 | En curso | AI Q&A, CEO Dashboard, Legal Vault, Email |
| 🔵 V3 Fase 5 | Pendiente | ETL real, Gantt, Calendario, Búsqueda Fondos |

Tiempo estimado para terminar V3 completo: **2-3 semanas** trabajando con agentes en paralelo.

---

## 4. Costo total operacional V3 estimado

| Servicio | Costo mensual estimado | Notas |
|---|---|---|
| Fly.io (backend + ETL futuro) | $15-30 | 2 apps small |
| Vercel (frontend) | $0-20 | Hobby free, Pro si tráfico crece |
| Supabase (Postgres + Auth + pgvector) | $0-25 | Free tier alcanza, Pro si AI Q&A heavy |
| Anthropic Claude (AI Q&A) | $20-100 | Depende uso |
| OpenAI Embeddings | $1-5 | text-embedding-3-small |
| Resend (email) | $0-20 | Free 3K/mes |
| Sentry (errors) | $0-26 | Free tier 5K events |
| Dropbox API | $0 | Within limits |
| **TOTAL** | **$36-226/mes** | escala con uso |

Como mínimo viable (free tiers + uso bajo): **~$20-40/mes**.

---

## 5. Próximos pasos para Nicolas

Una vez que los agentes terminen:

### Configurar OpenAI API Key (para AI Q&A)
1. https://platform.openai.com/api-keys
2. Crear key, copiar
3. `flyctl secrets set OPENAI_API_KEY="sk-..." --app cehta-backend`

### Configurar Resend (para emails)
1. https://resend.com → signup gratis
2. Verificar dominio cehta.cl (o usar onboarding@resend.dev temporalmente)
3. Generar API key
4. `flyctl secrets set RESEND_API_KEY="re_..." EMAIL_FROM="noreply@cehta.cl" --app cehta-backend`

### Indexar AI Knowledge Base
1. En Dropbox `/Cehta Capital/01-Empresas/{codigo}/08-AI Knowledge Base/`, subir archivos `.md` con contexto de la empresa:
   - `company_overview.md` (1 párrafo qué hace, modelo de negocio, etapa)
   - `financial_context.md` (KPIs, runway, burn rate)
   - `strategic_priorities.md` (OKRs trimestre)
   - `key_people.md` (founders, advisors, equipo)
2. Como admin en la app: `POST /api/v1/ai/index/{empresa_codigo}` (o botón en UI cuando esté listo)
3. Esperar ~30s mientras se indexa
4. Probar el chat preguntando "¿Qué hace TRONGKAI?"

### Probar legal vault
1. Subir un PDF de contrato vía la UI: `/empresa/TRONGKAI/legal` → + Subir documento
2. Setear fecha vencimiento
3. Verificar que aparece la alerta en el dashboard CEO

### Probar emails
```powershell
curl -X POST https://cehta-backend.fly.dev/api/v1/notifications/test `
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. Referencias

- `docs/V3_VISION.md` — visión completa V3 (522 líneas)
- `docs/GUIA_CARPETAS.md` — folder structure Dropbox (421 líneas)
- `docs/RUNBOOK.md` — deploy zero to prod
- `docs/dropbox-setup.md` — Dropbox OAuth setup
- `docs/sentry-setup.md` — observabilidad

Cuando los agentes terminen agregamos:
- `docs/ai-qa-setup.md` (OpenAI key + indexing first time)
- `docs/email-setup.md` (Resend signup + verification)
