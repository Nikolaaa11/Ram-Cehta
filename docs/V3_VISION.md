# 🌟 Visión V3 — Plataforma Ultra Pro Cehta Capital

> **Para Nicolas + Guido Rietta (CEO)**: Esta es la arquitectura completa
> de la plataforma a 6-12 meses vista. Define las 7 secciones, la
> integración con Dropbox como fuente de verdad, la estructura de
> carpetas y el orden en que vamos a construir todo.

**Última actualización**: 2026-04-27.

---

## 1. Las 7 secciones organizadas en 5 grupos

```
┌─ SIDEBAR CEHTA CAPITAL ─────────────────────┐
│  Cehta Capital · FIP CEHTA ESG               │
├──────────────────────────────────────────────┤
│                                              │
│  EJECUTIVO  (visible: admin, CEO)            │
│   • Dashboard CEO     ← consolidado todas    │
│   • Calendario        ← reportes + alertas   │
│                                              │
│  OPERACIONES  (visible: admin, finance)      │
│   • Proveedores       ← V1                   │
│   • Órdenes de Compra ← V1                   │
│   • Solicitudes Pago  ← V1                   │
│   • Movimientos       ← V1 (lectura ETL)     │
│   • F29 / Tributario  ← V1                   │
│                                              │
│  ESTRATEGIA  (visible: todos roles)          │
│   • Avance Empresas   ← Gantt + KPIs         │
│   • Búsqueda Fondos   ← LP/banco/programa    │
│   • AI Asistente      ← Q&A por empresa      │
│                                              │
│  DOCUMENTOS  (visible: todos los roles)      │
│   • Legal             ← contratos/actas      │
│   • Reportes          ← PDFs generados       │
│                                              │
│  ADMIN  (visible: solo admin)                │
│   • Usuarios          ← V2                   │
│   • ETL Runs          ← V2                   │
│   • Data Quality      ← V2                   │
│                                              │
│  user@email.com                              │
│  [Cerrar sesión]                             │
└──────────────────────────────────────────────┘
```

### 1.1 Dashboard CEO (Sección 1)

**Audiencia**: Guido Rietta (CEO), Nicolas (admin), comité.

**Contenido**:
- KPIs consolidados (todos los empresas suma): AUM total, flujo neto, OCs pendientes, F29 vencidas, IVA del mes
- **Comparador de empresas**: scoreboard 9 empresas con métricas en columnas (saldo, flujo neto, ROE proyectado, runway en meses)
- **Heatmap de salud**: matriz empresa × KPI con color (verde/amarillo/rojo)
- **Insights AI generados**: "Esta semana: TRONGKAI subió 12% saldo Cehta. CSL bajó 8% flujo proyectado. RHO sin movimientos en 14 días."
- **Acciones recomendadas** (auto-generadas por LLM): top 3 cosas a revisar esta semana

### 1.2 Calendario & Reportes Auto (Sección 2)

**Función**: cumplir con el reglamento interno automáticamente.

**Contenido**:
- **Calendario tipo Google Calendar** con eventos:
  - F29 mensual (vence día 12 de cada mes)
  - Reporte mensual a LPs (envío día 5 del mes siguiente)
  - Reporte trimestral compliance (días 15 enero/abril/julio/octubre)
  - Reuniones de comité (programadas)
- **Agentes que procesan info**:
  - "Generador de F29": 3 días antes del vencimiento, prepara borrador con datos del mes
  - "Compilador de Reporte Mensual LPs": día 1 del mes, agrega datos + genera PDF + envía draft por email
  - "Validador de Compliance": cada noche corre checks SII y alerta inconsistencias
- **Notificaciones**: bell icon en sidebar con count, email diario con resumen.

### 1.3 Operaciones (Sección 3) — YA EXISTE

Ya construida en V1+V2:
- Proveedores (CRUD + soft-delete)
- Órdenes de Compra (CRUD + estado machine + PDF)
- Solicitudes de Pago (vista filtrada de OC `estado=emitida`)
- Movimientos (lectura ETL)
- F29 (CRUD + mark paid + delete)

V3 agrega:
- **Reorganización visual** en grupo "Operaciones" del sidebar
- **Bulk actions** (eliminar/exportar varios proveedores u OCs juntos)
- **Audit log** por recurso (quién creó, quién editó, cuándo)

### 1.4 Avance por Empresa (Sección 4)

**Audiencia**: comité, due diligence, equipo operativo de cada empresa.

**Contenido por empresa**:
- **Gantt chart** con hitos del proyecto (fases, deliverables, fechas)
- **KPIs operativos**: ingresos proyectados vs reales, gastos por fase, headcount
- **Estado de avance** semanal con narrative: "Esta semana: completado deliverable X, retraso 5d en Y, próximo hito Z"
- **Documentos relacionados**: link a Dropbox `/Cehta Capital/Proyectos/{empresa}/`
- **Riesgos identificados**: lista priorizada con owner + mitigación

**Implementación técnica**:
- Backend: nuevas tablas `core.proyectos_empresa`, `core.hitos`, `core.riesgos`
- Frontend: lib `gantt-chart` (probablemente `frappe-gantt` o custom con SVG)
- Update: cada empresa tiene su responsable que actualiza semanalmente

### 1.5 Búsqueda de Fondos (Sección 5)

**Audiencia**: Guido + equipo de fundraising.

**Contenido**:
- **Base de datos curada** de:
  - Inversionistas (LPs potenciales por geografía, ticket size, thesis)
  - Bancos aliados (programas de financiamiento, créditos)
  - Programas estatales (CORFO, ANID, otros)
  - Family offices y multi-family offices
- **Filtros inteligentes**: alineamiento con thesis del FIP CEHTA ESG
- **Pipeline de outreach**: status (no contactado / contactado / en negociación / cerrado)
- **AI matchmaker**: dado un proyecto/empresa del portfolio, sugiere LPs/programas relevantes
- **Watchlist**: alertas cuando un fondo abre nueva ronda

**Fuentes de datos**:
- Dropbox `/Cehta Capital/Fondos & Inversionistas/` (Excels manuales)
- API públicas: Crunchbase (paid), CORFO (web scraping), Banco Central
- Manual entry desde la app

### 1.6 AI Asistente por Empresa (Sección 6)

**Audiencia**: cada usuario solo de su empresa (RBAC empresa-scoped).

**Contenido**:
- Chat tipo ChatGPT, contexto = TODA la información de la empresa
- Datos en contexto:
  - Movimientos financieros (3 años)
  - OCs históricas
  - F29 pagados
  - Documentos legales (PDFs parseados)
  - Notas de reuniones (uploaded por el equipo)
  - Roadmap del proyecto
- **Casos de uso**:
  - "¿Cuánto gastamos en marketing último trimestre?"
  - "Resumime los acuerdos del último contrato con BancoEstado"
  - "Genera 3 ideas de mejora basadas en nuestros KPIs"
  - "Prepara un draft de reporte mensual para nuestro inversor"
  - "¿Qué riesgos veo en nuestro flujo de caja proyectado?"
  - "Brainstorm de cómo bajar costos operativos"
- **Memoria persistente**: cada conversación se guarda, se puede retomar

**Implementación técnica**:
- Backend: nueva tabla `core.ai_conversations` y `core.ai_messages`
- Endpoint: `POST /ai/chat?empresa_codigo=X` con streaming SSE
- LLM: Anthropic Claude API (key ya en secrets)
- Vector DB para búsqueda semántica: pgvector en Supabase Postgres
- Embeddings: OpenAI text-embedding-3-small (más barato y bueno)
- Pipeline ETL: cada doc subido a Dropbox/empresa se chunkea + embeddinguea + guarda en pgvector

### 1.7 Sección Legal (Sección 7)

**Audiencia**: todos los roles (con scope por empresa).

**Contenido**:
- **Bóveda de documentos** organizada por empresa:
  - Contratos (con contraparte, monto, vigencia)
  - Estatutos
  - Actas
  - Declaraciones tributarias
  - Permisos / certificaciones
  - Pólizas de seguro
  - Powers of attorney
- **Alertas automatizadas**:
  - "Contrato X vence en 30 días, renovación pendiente"
  - "Falta firma del documento Y"
  - "Certificación Z caducada"
- **Edición colaborativa**: cualquiera con permiso puede subir nueva versión, queda histórico
- **Guías de uso**: cada tipo de doc tiene template + instructivo
- **Generador**: form que llena un template y produce PDF firmable
- **Compliance dashboard**: % de docs al día por empresa

**Implementación técnica**:
- Backend: nueva tabla `core.legal_documents` con metadata + link a Dropbox
- Storage: archivos en Dropbox `/Cehta Capital/Documentos Legales/{empresa}/{categoria}/`
- Indexación: cada PDF se OCR-ea (si no es texto) y se vectorizar para búsqueda
- Templates: en Dropbox `/Cehta Capital/Documentos Legales/Templates/`

---

## 2. Estructura de carpetas en Dropbox (FUENTE DE VERDAD)

Esta es la **estructura definitiva** de tu Dropbox. La plataforma sincroniza desde acá:

```
📁 Dropbox/
└── 📁 Cehta Capital/
    ├── 📁 Inteligencia de Negocios/        ← LA QUE NO ENCUENTRA HOY
    │   ├── 📊 Data Madre.xlsx               ← Excel principal del ETL
    │   ├── 📁 Histórico/                    ← snapshots mensuales
    │   │   ├── 📊 2026-01-Data-Madre.xlsx
    │   │   ├── 📊 2026-02-Data-Madre.xlsx
    │   │   └── ...
    │   └── 📁 Templates/
    │       ├── 📊 Plantilla F29.xlsx
    │       └── 📊 Plantilla Reporte LP.xlsx
    │
    ├── 📁 Documentos Legales/
    │   ├── 📁 TRONGKAI/
    │   │   ├── 📁 Contratos/
    │   │   ├── 📁 Estatutos/
    │   │   ├── 📁 Actas/
    │   │   ├── 📁 Declaraciones SII/
    │   │   └── 📁 Permisos/
    │   ├── 📁 REVTECH/        (misma estructura)
    │   ├── 📁 EVOQUE/         (misma estructura)
    │   ├── 📁 DTE/            (misma estructura)
    │   ├── 📁 CSL/            (misma estructura)
    │   ├── 📁 RHO/            (misma estructura)
    │   ├── 📁 AFIS/           (misma estructura)
    │   ├── 📁 FIP_CEHTA/      (misma estructura)
    │   ├── 📁 CENERGY/        (misma estructura)
    │   └── 📁 Templates/
    │       ├── 📄 Contrato Tipo.docx
    │       ├── 📄 Acta Tipo.docx
    │       └── 📄 Declaración Tipo.docx
    │
    ├── 📁 Proyectos/                        ← Gantt + roadmaps
    │   ├── 📁 TRONGKAI/
    │   │   ├── 📊 Roadmap.xlsx
    │   │   ├── 📁 Hitos/
    │   │   ├── 📁 Reportes Avance/
    │   │   │   ├── 📄 2026-W17.md
    │   │   │   └── 📄 2026-W18.md
    │   │   └── 📁 Riesgos/
    │   ├── (... una carpeta por empresa)
    │   └── 📁 Templates/
    │       ├── 📊 Roadmap-Template.xlsx
    │       └── 📄 Reporte-Avance-Template.md
    │
    ├── 📁 Reportes Generados/               ← outputs de la app
    │   ├── 📁 Mensuales/
    │   │   ├── 📄 2026-01-Estado-Fondo.pdf
    │   │   ├── 📄 2026-01-Composicion-Portfolio.pdf
    │   │   └── ...
    │   ├── 📁 Trimestrales/
    │   ├── 📁 Anuales/
    │   └── 📁 Ad-hoc/
    │
    ├── 📁 Fondos & Inversionistas/
    │   ├── 📊 Inversionistas Activos.xlsx
    │   ├── 📊 LPs Pipeline.xlsx
    │   ├── 📁 Bancos/
    │   │   ├── 📊 Bancos Aliados.xlsx
    │   │   └── 📁 Programas/
    │   ├── 📁 Estado/
    │   │   ├── 📊 CORFO Programas.xlsx
    │   │   └── 📊 ANID Programas.xlsx
    │   └── 📁 Watchlist/
    │
    ├── 📁 Reuniones & Notas/
    │   ├── 📁 Comité/
    │   │   ├── 📄 2026-01-Acta-Comité.md
    │   │   └── ...
    │   ├── 📁 Estratégicas/
    │   └── 📁 Por Empresa/
    │       ├── 📁 TRONGKAI/
    │       └── ...
    │
    └── 📁 AI Knowledge Base/                ← contexto para AI Q&A
        ├── 📁 TRONGKAI/
        │   ├── 📄 company_overview.md
        │   ├── 📄 financial_context.md
        │   ├── 📁 docs_processed/           ← PDFs OCR'd
        │   └── 📁 embeddings/                ← cache
        └── (... una carpeta por empresa)
```

---

## 3. Cómo funciona la actualización automática

### 3.1 ETL Inteligente (Dropbox → Postgres)

```
Dropbox/Inteligencia de Negocios/Data Madre.xlsx
                ↓ (cada 30 min, vía cron)
        ┌───────────────┐
        │ cehta-etl     │ servicio Python
        │ (Fly.io app)  │
        └───────────────┘
                ↓ valida + transforma
        ┌───────────────┐
        │ raw.* tables  │ (volcado original)
        └───────────────┘
                ↓ limpia
        ┌───────────────┐
        │ stg.* tables  │ (validados)
        └───────────────┘
                ↓ normaliza
        ┌───────────────┐
        │ core.* tables │ ← consume la app
        └───────────────┘
                ↓
        ┌───────────────┐
        │ audit.etl_runs│ ← log de runs
        └───────────────┘
```

**Implementación V3**:
- Servicio Python separado en Fly.io: `cehta-etl`
- Trigger: cron cada 30 min + webhook Dropbox cuando archivo cambia
- Detecta cambios: SHA256 del archivo
- Idempotente: si el hash es igual al último run exitoso, skip
- Backup: cada run exitoso guarda snapshot en `Histórico/YYYY-MM-DD-Data-Madre.xlsx`

### 3.2 Sync de Documentos Legales

```
Dropbox/Documentos Legales/{empresa}/{categoria}/
                ↓ (webhook Dropbox)
        ┌─────────────────┐
        │ Watcher service │
        └─────────────────┘
                ↓
        Para cada archivo nuevo/modificado:
        1. Descarga
        2. OCR si es PDF escaneado (Tesseract)
        3. Extract metadata (firma, vigencia, contraparte)
        4. Chunk + embeddings (OpenAI)
        5. Insert en core.legal_documents + pgvector
        6. Genera alerta si vence pronto
                ↓
        ┌──────────────────────┐
        │ core.legal_documents │
        │ + pgvector embeddings│
        └──────────────────────┘
```

### 3.3 AI Knowledge Base

```
Dropbox/AI Knowledge Base/{empresa}/
                ↓ (webhook + cron diario)
        ┌────────────────┐
        │ Indexer        │
        └────────────────┘
                ↓
        Lee TODOS los .md, .pdf, .docx de la carpeta
                ↓
        Chunk (1000 chars con overlap 200)
                ↓
        Embeddings (text-embedding-3-small)
                ↓
        ┌──────────────────────────┐
        │ core.ai_documents        │
        │ + pgvector embeddings    │
        │ scoped by empresa_codigo │
        └──────────────────────────┘
```

Cuando un usuario hace pregunta:
1. Embedding de la query
2. Vector similarity search en pgvector (top 10 chunks)
3. Build context con esos chunks + system prompt
4. Stream a Anthropic Claude
5. Respuesta + citations

---

## 4. Roadmap de implementación (4 fases)

### 🟢 Fase 1: Foundation (1-2 semanas)
- [x] JWT fix (asymmetric Supabase)
- [ ] Sidebar reorganización en 5 grupos
- [ ] Páginas landing por sección (CEO, Estrategia, Documentos, Admin)
- [ ] Dropbox OAuth flow real (refresh token persistido)
- [ ] Endpoint `/dropbox/files?path=X` (listar contenido carpeta)
- [ ] Detección automática de "Inteligencia de Negocios" folder

### 🟡 Fase 2: CEO + Reportes (2-3 semanas)
- [ ] Dashboard CEO con consolidado 9 empresas
- [ ] Heatmap de salud + comparador
- [ ] Calendario con eventos automáticos (F29, reportes)
- [ ] Agentes scheduled (cron) para generar borradores
- [ ] Sistema de notificaciones (bell icon + email)
- [ ] Mejoras CRUD V2 ya entregadas

### 🟠 Fase 3: Estrategia + AI (3-4 semanas)
- [ ] Avance por Empresa con Gantt charts
- [ ] Tablas `proyectos_empresa`, `hitos`, `riesgos`
- [ ] Búsqueda de Fondos con base curada
- [ ] AI Asistente por empresa (Anthropic + pgvector)
- [ ] Pipeline de embeddings para documents

### 🔵 Fase 4: Legal + Polish (2-3 semanas)
- [ ] Sección Legal con bóveda + alertas
- [ ] Generador de documentos desde templates
- [ ] OCR pipeline para PDFs escaneados
- [ ] Audit log per-action
- [ ] Email notifications (Resend)
- [ ] Mobile responsive deep
- [ ] Performance optimization

---

## 5. Stack técnico V3 (extensiones)

| Necesidad | Tecnología | Por qué |
|---|---|---|
| Vector DB | **pgvector** (extensión Postgres) | Ya en Supabase, sin servicio extra |
| Embeddings | **OpenAI text-embedding-3-small** | $0.02/1M tokens, ranking top |
| LLM Q&A | **Anthropic Claude** (key ya en secrets) | Best-in-class para razonamiento financiero |
| Cron / Schedules | **Fly.io scheduled machines** | Sin servicio extra |
| Email | **Resend** | $0/mes hasta 3K emails, simple API |
| Gantt charts | **frappe-gantt** o custom SVG | Lightweight, custom-styleable Apple-style |
| OCR | **Tesseract** + **PyMuPDF** | Open source, suficiente para PDFs simples |
| Dropbox SDK | **dropbox-sdk-python** | Oficial, soporta refresh token |
| Webhook handler | **FastAPI route** + **Dropbox webhooks** | Native, no service extra |

---

## 6. Cómo subir información (guía para vos y tu equipo)

### 6.1 Para actualizar el Excel madre
1. Editás `Dropbox/Cehta Capital/Inteligencia de Negocios/Data Madre.xlsx` como ya lo haces
2. **El ETL lo detecta en ~30 min** y actualiza Postgres
3. Ves el resultado en Movimientos / Dashboard inmediatamente

### 6.2 Para subir un documento legal nuevo
1. Subir el archivo a `Dropbox/Cehta Capital/Documentos Legales/{empresa}/{categoria}/`
2. Nombrar el archivo con formato `YYYY-MM-DD - Descripción.pdf`
3. **El watcher lo detecta** y aparece en la sección Legal de la app
4. La app extrae metadata + envía al AI Knowledge Base
5. Si tiene fecha de vencimiento, se programa alerta automática

### 6.3 Para que el AI sepa más de una empresa
1. Crear `Dropbox/Cehta Capital/AI Knowledge Base/{empresa}/`
2. Agregar archivos `.md` o `.pdf` con info: roadmap, OKRs, contexto histórico, etc.
3. **El indexer corre cada noche** y actualiza embeddings
4. Mañana el AI ya conoce esa info y la puede usar en respuestas

### 6.4 Para agregar un nuevo inversionista a tracking
1. Editar `Dropbox/Cehta Capital/Fondos & Inversionistas/LPs Pipeline.xlsx`
2. Aparece en la sección "Búsqueda de Fondos" en próximo sync (~30 min)
3. AI matchmaker ya considera ese LP para recomendaciones

### 6.5 Para subir reportes externos
1. Subir a `Dropbox/Cehta Capital/Reportes Generados/`
2. Aparece en la sección "Documentos > Reportes" de la app
3. Searchable y descargable desde la UI

---

## 7. Permisos y seguridad

### 7.1 Roles del sistema (extendidos en V3)

| Rol | Operaciones | Estrategia | Documentos | Admin | AI Empresa |
|---|:-:|:-:|:-:|:-:|:-:|
| **admin** | ✓ todo | ✓ todo | ✓ todo | ✓ todo | ✓ todas |
| **ceo** 🆕 | ✓ ver | ✓ todo | ✓ todo | — | ✓ todas |
| **finance** | ✓ todo | ✓ ver | ✓ ver | — | ✓ asignadas |
| **viewer** | ✓ ver | ✓ ver | ✓ ver | — | ✓ asignadas |
| **company_user** 🆕 | ✓ ver propia | ✓ ver propia | ✓ ver propia | — | ✓ propia |

### 7.2 RBAC empresa-scoped (V3)

Para AI Q&A y Legal, agregamos:
- Tabla `core.user_empresa_access` (user_id, empresa_codigo)
- Filtros automáticos: cada query con `WHERE empresa_codigo IN (user empresas)`
- Admin ve todo, company_user ve solo su empresa.

---

## 8. Costo operacional estimado mensual

| Servicio | Costo | Notas |
|---|---|---|
| Fly.io (backend + ETL) | $5-15 | 2 apps small |
| Vercel (frontend) | $0 | Free tier alcanza |
| Supabase (Postgres + Auth) | $0-25 | Free tier o Pro |
| Anthropic Claude | $20-100 | Depende uso AI Q&A |
| OpenAI embeddings | $1-5 | text-embedding-3-small es barato |
| Sentry (errors) | $0-26 | Free tier 5K events/mes |
| Resend (email) | $0-20 | Free 3K emails/mes |
| Dropbox API | $0 | Free dentro de límites |
| **TOTAL** | **$26-191/mes** | escalando con uso |

---

## 9. Timeline realista

Si trabajamos a velocidad agresiva con agentes paralelos:

| Fecha estimada | Hito |
|---|---|
| Hoy (2026-04-27) | JWT fix + V3 doc + sidebar reorg |
| +1 semana | Dropbox OAuth + ETL real + landing pages |
| +3 semanas | CEO Dashboard + Calendario + agentes |
| +6 semanas | AI Q&A + pgvector + Gantt charts |
| +9 semanas | Legal vault + Fund search |
| +12 semanas | Polish + mobile + email + V3 release |

**3 meses para tener V3 completo**.

---

## 10. Próximas acciones inmediatas

Mientras Nicolas redeploya con el fix JWT, voy a:

1. ✅ Documentar V3 (este archivo)
2. Reorganizar sidebar en 5 grupos
3. Crear landing pages de cada sección nueva (placeholders elegantes)
4. Empezar Dropbox OAuth flow real
5. Setup pgvector en Supabase (preparar para AI Q&A)

---

## 11. Referencias

- `docs/RUNBOOK.md` — deploy zero to prod
- `docs/GUIA_V2.md` — V2 features (CRUD, reportes, admin)
- `docs/rotacion-credenciales.md` — rotación
- `docs/sentry-setup.md` — observabilidad
- `e2e/README.md` — Playwright tests
