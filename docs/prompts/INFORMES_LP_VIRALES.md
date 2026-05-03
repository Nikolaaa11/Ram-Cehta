# 🚀 Master Prompt — Informes LP Virales

> **Visión:** Construir el sistema de reportes a inversionistas más impresionante del mercado chileno de FIPs ESG. Cada informe es una pieza editorial premium con datos reales en vivo del portafolio, personalizada por LP, diseñada para que **un LP que recibe el reporte lo comparta con 5 colegas** porque genuinamente quiere recomendar Cehta.
>
> **El KPI norte:** Tasa viral 1→5. Si mandamos 1.000 informes, 5.000 inversionistas terminan viéndolo orgánicamente. Cada vista trackeada.
>
> **Cuándo usar este prompt:** copiar como brief inicial para reconstruir desde cero (o agregar por primera vez) la sección "Reportes / Informes LP" en la plataforma Cehta Capital.

---

## 🎯 El problema real

Cehta Capital (FIP CEHTA ESG) compite por capital con cientos de FIPs y family offices chilenos. Los LPs reciben **decks idénticos en PowerPoint** todas las semanas: 14 slides, gráficos de Excel, fotos stock, narrativas genéricas. Nadie las recuerda. Nadie las comparte.

**Lo que vamos a construir:**
- Reportes que se leen como **un editorial de Bloomberg + Stripe Atlas + un buen Notion page**
- Datos **reales en vivo** del portafolio (no PowerPoint exportado de hace 3 meses)
- **Mecanismo viral genuino**: cada LP recibe un link único, lo abre, lo comparte y nosotros sabemos a quién — no porque sea spam, sino porque el contenido vale tanto que él QUIERE compartirlo.
- **Personalización profunda**: el reporte dice "Hola Sebastián" no "Estimado inversionista", muestra TUS empresas en TU portafolio destacadas, tu retorno acumulado, tu próximo distribución estimada.

Esto es la diferencia entre el fondo que crece +20% AUM/año y el que crece +200%.

---

## 👥 Personas — quién recibe el informe

### LP Activo (Sebastián Pérez, 58, family office Santiago)
- Ya invirtió USD 500K en CENERGY hace 18 meses
- Recibe ~12 reportes de FIPs distintos por mes — abre 3
- Quiere saber: ¿cómo va MI plata? ¿hay riesgos que no conozco? ¿cuándo es el próximo aporte?
- Si le encanta el reporte, manda screenshot por WhatsApp a su grupo "FIPs ESG" de 12 colegas
- Lee primero en celular (subway al trabajo), después en desktop (oficina)

### LP Potencial (Fernanda Riquelme, 42, gerente inversiones banco)
- Le pasaron el link por LinkedIn
- 30 segundos de atención inicial — si el hero no la engancha, se va
- Quiere: track record, equipo, tesis, ROI esperado, cómo comprar
- Si convence, agenda café con Camilo (el GP) la misma semana

### LP Influencer (Pablo Klein, 67, ex-banquero, conocido en mercado)
- 200+ contactos de inversionistas activos
- Si recomienda Cehta a su red, levantamos USD 5M en 6 meses
- Quiere sentir que está accediendo a algo exclusivo + bien curado
- Si comparte, espera reconocimiento sutil ("gracias por traer a 3 colegas")

### Camilo Salazar (GP / fundador, lado interno)
- Quiere mandar el informe en 1 click
- Quiere ver analytics: quién lo abrió, cuánto tiempo, qué páginas, quién compartió
- Quiere editar narrativa antes de publicar (no 100% AI)

---

## 🌟 El factor "wow" — qué hace que se comparta

Con qué se quedan los LPs después de cerrar el reporte:

1. **El hero los nombra.** "Sebastián, tu portafolio creció 23% YTD". No "Estimado inversionista".
2. **Los números cuentan UNA historia.** No 14 KPIs sin contexto, sino 3 narrativas: "Crecimos por X. Ganamos a benchmark por Y. Mirá esta apuesta concreta: Z."
3. **Empresas con cara y voz.** Foto del CEO de RHO en la planta solar. Quote de 1 línea: "Cumplimos hito BESS un mes antes". No logo + bullet.
4. **Datos en vivo, no estáticos.** Badge "Actualizado hace 2 horas" arriba a la derecha. Señal de respeto al lector.
5. **Impacto ESG como protagonista.** "Tu inversión equivale a quitar 1.847 autos de la calle por un año". Visualización concreta — no "30K toneladas CO2".
6. **El reporte respira.** Margen generoso. Tipografía editorial. Una idea por scroll. No PowerPoint comprimido.
7. **Compartir es invisible y premiado.** Botón "Pasalo a un colega que invierte" → genera link único trackeado → cuando el colega muestra interés, el LP original lo sabe ("3 personas a las que les pasaste el reporte agendaron café con Camilo este mes").
8. **CTA claros, no agresivos.** "¿Te interesa aumentar tu posición? Agendá 30min con Camilo" con un botón que de verdad agenda en su calendario (no email genérico).

---

## 📐 Stack técnico (no negociable)

- **Frontend:** Next.js 15.5 App Router + TS strict + Tailwind. Reutilizar `<Surface>`, `<Badge>`, `<EmpresaLogo>`. Página pública `/informe/[token]` (sin auth, fuera del `(app)` layout).
- **Animaciones:** Framer Motion (~20kb gzip) para fade-in stagger, count-up, scroll-triggered reveals. NO usar Lottie (heavy + lock-in).
- **Gráficos:** Recharts (ya está en el proyecto si revisamos package.json — si no, agregarlo) o impl propia con D3 + SVG. NO Chart.js (poco customizable).
- **PDF generation:** `puppeteer` server-side para "Descargar PDF" — renderiza la misma página con un flag `?pdf=true` que aplica un layout print-optimized.
- **Email:** Resend (mejor que SendGrid en DX, ya tiene templates React) — endpoint `POST /informes-lp/{id}/send` que renderiza el email con `react-email`.
- **Backend:** FastAPI + SQLAlchemy 2.x async. Schema nuevo en `core.informes_lp`. Service `informes_lp_service.py` con AI generation via Anthropic.
- **Analytics:** tabla `app.informes_lp_eventos` con event log granular (open, scroll, share, cta_click, time_spent_section).
- **AI:** Anthropic Claude para generar narrativas personalizadas. Soft-fail.

---

## 🏗 Arquitectura de datos

### Tablas nuevas

#### `core.lps` — pipeline de inversionistas (ya existe parcial en `02-Fondo/Inversionistas`)

```sql
CREATE TABLE IF NOT EXISTS core.lps (
    lp_id            BIGSERIAL PRIMARY KEY,
    nombre           TEXT NOT NULL,
    apellido         TEXT,
    email            TEXT UNIQUE,
    telefono         TEXT,
    empresa          TEXT,                    -- family office, banco, etc.
    rol              TEXT,                    -- "Gerente Inversiones"
    -- Status del LP
    estado           TEXT NOT NULL DEFAULT 'pipeline'
        CHECK (estado IN ('pipeline', 'cualificado', 'activo', 'inactivo', 'declinado')),
    primer_contacto  DATE,
    -- Personalización
    perfil_inversor  TEXT CHECK (perfil_inversor IN ('conservador', 'moderado', 'agresivo', 'esg_focused')),
    intereses_jsonb  JSONB DEFAULT '[]',      -- ["renovables", "minería responsable", "agro"]
    relationship_owner TEXT,                  -- email del GP que maneja el lp
    -- Capital
    aporte_total     NUMERIC(18, 2),          -- comprometido total
    aporte_actual    NUMERIC(18, 2),          -- ya integrado
    empresas_invertidas TEXT[],               -- ['RHO', 'CENERGY']
    -- Tracking
    notas            TEXT,
    metadata_        JSONB,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lps_estado ON core.lps(estado);
CREATE INDEX idx_lps_email ON core.lps(email);
```

#### `app.informes_lp` — informes generados

```sql
CREATE TABLE IF NOT EXISTS app.informes_lp (
    informe_id       BIGSERIAL PRIMARY KEY,
    lp_id            BIGINT REFERENCES core.lps(lp_id) ON DELETE SET NULL,
    -- Token compartible (URL-safe, 32 chars)
    token            TEXT UNIQUE NOT NULL,
    -- Padre: si este informe fue compartido por otro LP, link al token padre
    parent_token     TEXT REFERENCES app.informes_lp(token),
    -- Contenido (snapshot al momento de generación — los datos pueden cambiar)
    titulo           TEXT NOT NULL,
    periodo          TEXT,                    -- "Q1 2026"
    tipo             TEXT NOT NULL DEFAULT 'periodico'
        CHECK (tipo IN ('periodico', 'pitch_inicial', 'update_mensual', 'tear_sheet', 'memoria_anual')),
    -- Narrative AI (editable por humano antes de publicar)
    hero_titulo      TEXT,
    hero_narrativa   TEXT,
    secciones_jsonb  JSONB,                   -- estructura completa del informe
    -- Lifecycle
    estado           TEXT NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador', 'publicado', 'archivado')),
    publicado_at     TIMESTAMPTZ,
    expira_at        TIMESTAMPTZ,             -- después expira para evitar info vieja
    -- Tracking agregado (denormalized para fast dashboard)
    veces_abierto    INT DEFAULT 0,
    veces_compartido INT DEFAULT 0,
    tiempo_promedio_segundos INT,
    -- Audit
    creado_por       TEXT,                    -- email del GP
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_informes_lp_lp ON app.informes_lp(lp_id);
CREATE INDEX idx_informes_lp_token ON app.informes_lp(token);
CREATE INDEX idx_informes_lp_parent ON app.informes_lp(parent_token);
CREATE INDEX idx_informes_lp_estado ON app.informes_lp(estado);
```

#### `app.informes_lp_eventos` — analytics granular

```sql
CREATE TABLE IF NOT EXISTS app.informes_lp_eventos (
    evento_id        BIGSERIAL PRIMARY KEY,
    informe_id       BIGINT NOT NULL REFERENCES app.informes_lp(informe_id) ON DELETE CASCADE,
    token            TEXT NOT NULL,           -- redundancia para queries directas
    tipo             TEXT NOT NULL
        CHECK (tipo IN ('open', 'scroll', 'section_view', 'cta_click', 'share_click',
                        'pdf_download', 'video_play', 'time_spent', 'agendar_click')),
    -- Detalle del evento
    seccion          TEXT,                    -- "hero", "performance", "rho", "esg_impact"
    valor_numerico   INT,                     -- segundos, % scroll, etc.
    valor_texto      TEXT,
    -- Origen
    ip_hash          TEXT,                    -- SHA256(ip + salt) por privacidad
    user_agent       TEXT,
    referer          TEXT,                    -- de dónde viene (linkedin, whatsapp, email)
    pais             TEXT,                    -- via geo-IP
    metadata_        JSONB,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_informes_eventos_informe ON app.informes_lp_eventos(informe_id, created_at);
CREATE INDEX idx_informes_eventos_token ON app.informes_lp_eventos(token);
CREATE INDEX idx_informes_eventos_tipo ON app.informes_lp_eventos(tipo);
```

---

## 🔌 Backend — endpoints

### Generation

```
POST /informes-lp/generate
Body: {
  "lp_id": 42,
  "tipo": "update_mensual",
  "periodo": "2026-Q1",
  "incluir_empresas": ["RHO", "CENERGY", "REVTECH"],   // opcional, default todas
  "tono": "ejecutivo" | "narrativo" | "técnico"        // afecta el system prompt AI
}

Response: { "informe_id": 123, "token": "abc...", "preview_url": "/informe/abc..." }
```

Pipeline interno:
1. Pull datos del portafolio (KPIs, hitos completados último período, ESG metrics, riesgos)
2. Pull datos del LP (aporte, empresas en las que invirtió, primer contacto)
3. Llamar Anthropic con system prompt afinado para generar `hero_titulo`, `hero_narrativa`, y narrativa personalizada por sección
4. Persistir en `informes_lp` con `estado='borrador'`
5. Generar token único de 32 chars URL-safe (`secrets.token_urlsafe(24)`)
6. Devolver preview URL para que el GP edite antes de publicar

### Edit + publish

```
PATCH /informes-lp/{id}
Body: {
  "hero_titulo": "...",
  "secciones_jsonb": {...},
  "estado": "publicado"
}
```

Cuando pasa a `publicado`, dispara webhook a Resend para enviar email al LP (si email configurado).

### Vista pública (sin auth)

```
GET /informes-lp/by-token/{token}
Headers: opcionales
Response: { full informe content + datos en vivo del portafolio }
```

Acá ocurre la magia:
- **Snapshot vs live data:** algunos campos vienen del snapshot (narrativa AI, empresas elegidas), otros se pullean en vivo (precio última fila bancaria, hitos cumplidos hoy).
- **Soft expiration:** si `expira_at` pasó, mostrar banner "Este informe es de Q1 2026, los datos actuales pueden variar — pedile a tu relationship manager el último".

### Analytics tracking

```
POST /informes-lp/by-token/{token}/track
Body: {
  "tipo": "scroll" | "section_view" | "cta_click" | ...,
  "seccion": "hero",
  "valor_numerico": 75,    // % scroll
  "valor_texto": null
}
```

Endpoint público (no requiere auth). Rate limit: 30 req/min por IP. IP se hashea antes de persistir.

### Compartir con un colega

```
POST /informes-lp/by-token/{token}/share
Body: {
  "nombre_destinatario": "Pablo Klein",
  "email_destinatario": "pablo@klein.cl",
  "mensaje_personal": "Pablo, mirá este reporte..."
}
Response: { "child_token": "xyz..." }
```

Crea un nuevo informe con `parent_token = current` y mismo contenido. Manda email vía Resend con el child_token. Track de la cadena: si el child se abre, contamos al parent_token como "advocate".

### Admin — leaderboard de informes

```
GET /admin/informes-lp/analytics?from=&to=
Response: {
  total_generados, total_publicados, total_aperturas, tasa_conversion,
  top_advocates: [{lp_name, shared_count, downstream_views}],
  top_informes: [{titulo, opens, time_avg, shares}],
  cohorte_viral: { 1_to_avg: 3.7 }   // métrica clave
}
```

---

## 🎨 Frontend — componentes

### Estructura de archivos

```
frontend/
├── app/
│   ├── informe/                            ← layout PUBLICO (sin sidebar)
│   │   ├── layout.tsx                      ← layout minimal con tracking pixel
│   │   ├── [token]/
│   │   │   └── page.tsx                    ← informe completo
│   │   ├── compartir/[token]/page.tsx      ← form para mandar a colega
│   │   └── pdf/[token]/page.tsx            ← versión print-optimized
│   └── (app)/admin/informes-lp/            ← admin interno
│       ├── page.tsx                        ← list + analytics
│       ├── nuevo/page.tsx                  ← form de generación
│       └── [id]/edit/page.tsx              ← editor con preview
└── components/informe-lp/
    ├── HeroSection.tsx                     ← saludo + narrativa AI + KPI grande
    ├── PerformanceSection.tsx              ← AUM evolution + benchmark
    ├── TuPosicionSection.tsx               ← detalle del LP
    ├── EmpresaShowcase.tsx                 ← una "tarjeta editorial" por empresa
    ├── ESGImpactSection.tsx                ← métricas con visualizaciones equivalentes
    ├── OutlookSection.tsx                  ← roadmap próximos 6 meses
    ├── CTASection.tsx                      ← botones de acción
    ├── ShareCard.tsx                       ← "compartilo con un colega"
    ├── LiveDataBadge.tsx                   ← "Actualizado hace X"
    ├── CountUp.tsx                         ← animación de números
    ├── SparklineEmpresa.tsx                ← mini chart 7 días
    └── tracking.ts                         ← utility para POST events
```

### `HeroSection` — el primer 30%

Layout vertical full-bleed:

```
[GRADIENT BACKGROUND con gradient-mesh sutil cehta-green → ink-900]

  Cehta Capital · FIP CEHTA ESG          Q1 2026
  ─────────────────────────────────────────────

  Hola, Sebastián.                       [foto del LP si la tienen]

  Tu portafolio creció                    ← font-display 6xl
  23.4%                                   ← font-display 9xl, número con count-up
  este trimestre.                         ← font-display 6xl

  Ganamos al benchmark FIP por 11 puntos.
  Cumplimos 47 hitos clave. Sumamos
  CSL como nueva participación.

  [Botón "Ver detalle" — scroll a Performance]

  ↓ Live Data Badge: "Actualizado hace 2 horas" + dot verde
```

**Lo que hace especial:**
- Saludo personalizado con nombre real
- 1 número grande con animation `<CountUp />` desde 0 → valor real
- 3 oraciones max — sin bullets ni gráficos en hero
- Background animado sutil (mesh gradient con CSS `@property`)
- Si el LP no tiene foto, gradient con sus iniciales

### `PerformanceSection` — el "qué pasó"

3 columnas en desktop, stack vertical en mobile:

```
┌──────────────────┬──────────────────┬──────────────────┐
│ AUM Total        │ Tu Posición      │ vs Benchmark     │
│ $1.2B            │ $623K            │ +11.3 pts        │
│ ▁▂▃▅▆▇▇▇         │ ▂▃▅▆▆▇▇▆         │ +1.4% mes        │
│ "Crecimos +18%   │ "Vs aporte de    │ "Mejor que 87%   │
│ en 12 meses"     │ $500K, +24.6%"   │ de FIPs ESG"     │
└──────────────────┴──────────────────┴──────────────────┘
```

Sparklines con Recharts `<AreaChart>` y `gradient` definido en `<defs>`. Animation `animationBegin={300}` para stagger.

### `EmpresaShowcase` — el corazón storytelling

Para cada empresa relevante (las que tiene en cartera + 2-3 destacadas), una **"tarjeta editorial"**:

```
┌──────────────────────────────────────────────────────────┐
│ [foto full-bleed terreno BESS RHO con overlay gradient]  │
│                                                          │
│   ┌──┐                                                   │
│   │R │  RHO Generación · Renovables                      │
│   └──┘                                                   │
│                                                          │
│   "Inauguramos 8MW en Panimávida."                       │
│                                                          │
│   En enero conectamos a SEC el primer BESS de la         │
│   cartera, dos meses antes de plan. RHO ya genera        │
│   energía suficiente para 4.200 hogares chilenos.        │
│                                                          │
│   ┌────────┬────────┬────────┐                           │
│   │ 8MW    │ 99.4%  │ 4.200  │  ← métricas grandes       │
│   │ inst.  │ uptime │ hogares│                           │
│   └────────┴────────┴────────┘                           │
│                                                          │
│   ▰▰▰▰▰▰▰▰░░ 80% hitos Q1                                 │
│                                                          │
│   [foto + quote del CEO de RHO]                          │
│   "Cumplimos hito BESS un mes antes de lo planeado."     │
│   — Javier Álvarez, CEO RHO                              │
└──────────────────────────────────────────────────────────┘
```

**Datos del componente:**
- Foto: pull desde `01-Empresas/{cod}/01-Información General/Logo.png` o de un campo `hero_image_url` en la tabla `core.empresas`
- Métricas: las 3 más relevantes según el tipo de empresa (renovables: MW, uptime, hogares — minería: ton/año, valorización, empleos — agro: hectáreas, productividad, exports)
- Progress bar: % hitos Q1 cumplidos del Gantt importado
- Quote: campo `frase_destacada` en `core.empresas` (manual, editable por GP) o pull del último update mensual

### `ESGImpactSection` — el "wow" emocional

Visualización con iconografía + números equivalentes concretos:

```
┌──────────────────────────────────────────────────────────┐
│  Tu inversión en CEHTA evita...                          │
│                                                          │
│  🚗  1.847 autos                                         │
│      sacando de la calle por un año                      │
│                                                          │
│  🌳  214 hectáreas                                       │
│      de bosque preservadas equivalente                   │
│                                                          │
│  ⚡  4.200 hogares                                        │
│      con energía renovable en Chile                      │
│                                                          │
│  💼  127 empleos                                         │
│      directos creados en el portafolio                   │
└──────────────────────────────────────────────────────────┘
```

**Cálculos:**
- CO2 evitado por MW renovable instalado en RHO/CENERGY × factor emisión grid CL
- Equivalentes: factor "1 ton CO2 = 0.21 autos/año" del IPCC
- Pull desde una nueva tabla `core.empresa_esg_metrics` (o calcular on-the-fly desde Gantt + KPIs)

### `OutlookSection` — el "qué viene"

Aprovecha los hitos del Kanban del Sprint 2:

```
Próximos 6 meses

📅 Mayo · Cierre BESS Codegua (RHO0003)        $4.1M ARR esperado
📅 Junio · Lanzamiento PTEC Agrosphere         CORFO match $2M
📅 Julio · Validación EVOQUE Chiloé            primera fundición
📅 Agosto · Q2 distribuciones a LPs            ~$280K esperado
📅 Septiembre · Comité inversión REVTECH-08    decisión nueva participación
```

Pull desde `core.hitos` con `fecha_planificada BETWEEN now() AND now()+6mo` y `estado IN ('en_progreso', 'pendiente')`, ordenado por fecha. Mostrar top 8.

### `CTASection` — el cierre

3 CTAs con jerarquía visual clara:

```
┌──────────────────────────────────────────────────────────┐
│ ¿Querés saber más?                                       │
│                                                          │
│  [Agendá café con Camilo (30min)]      ← primary, grande │
│                                                          │
│   o                                                      │
│                                                          │
│  [Aumentar tu posición]   [Compartir con un colega]      │
│   secundario              terciario                      │
└──────────────────────────────────────────────────────────┘
```

- "Agendá café" → embed de Cal.com / Google Calendar appointment
- "Aumentar tu posición" → form simple con monto y nota → email al GP
- "Compartir con un colega" → modal del `<ShareCard />`

### `ShareCard` — el motor viral

Modal trigger desde el CTA + sticky en mobile (botón flotante):

```
┌──────────────────────────────────────────┐
│ 🎁  Pasalo a un colega que invierte     │
│                                          │
│ Si conocés a alguien que le calce esto,  │
│ mandale el reporte. Cuando ellos          │
│ agendan café con Camilo, te avisamos.    │
│                                          │
│ Nombre: [ Pablo Klein            ]       │
│ Email:  [ pablo@klein.cl         ]       │
│ Mensaje opcional:                        │
│ [ Pablo, mirá esto. PE chileno con  ]    │
│ [ tracción real en BESS y minería.  ]    │
│                                          │
│ ☐ Quiero saber cuándo lo abre            │
│                                          │
│ [Enviar a Pablo]                         │
└──────────────────────────────────────────┘

Después del envío:
"✅ Listo. Pablo recibió tu link. Te avisamos por mail si lo abre."
```

Backend:
- Crea informe `child` con `parent_token = current_token` y `lp_id = null` (todavía no es LP, es contacto)
- Manda email via Resend con template "Sebastián te recomendó Cehta"
- Si el child token genera 1+ open → mail al parent: "Pablo abrió el informe que le mandaste 🎉"
- Si el child token genera CTA "agendar café" → mail al parent: "Tu recomendación funcionó: Pablo agendó con Camilo"

---

## ✨ Especificaciones de diseño visual

### Tipografía
- **Display (títulos):** `DM Serif Display` (importar via next/font) — para los hero numbers + section titles. Es la diferencia entre "FIP cualquiera" y "FIP premium".
- **Body:** `Inter` (ya en el sistema)
- **Tabular:** `Inter` con `font-variant-numeric: tabular-nums` (ya está)

### Colores
- **Primary:** cehta-green (existente)
- **Accent:** **Gold** `#D4AF37` — usar SOLO en elementos de jerarquía top (hero number, ESG impact icons). Da el toque "lujo financiero".
- **Ink:** ink-900 para títulos editoriales (más profundo que el gris regular)
- **Backgrounds:** white principal, `ink-50` separadores, gradient mesh para hero
- **Status:** preservar el sistema (positive/negative/info/warning)

### Spacing
- **Más generoso que el dashboard interno.** Donde el dashboard usa `p-4`, acá usamos `p-8` o `p-12`.
- Section breaks con `py-24` (96px) en desktop, `py-16` (64px) mobile.
- Max-width: `max-w-3xl` para texto, `max-w-6xl` para grids.

### Animaciones (Framer Motion)
- Hero: `<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: "easeOut" }}>`
- Stagger: cada elemento del hero entra con +0.1s de delay
- Scroll triggers: `useScroll()` + `useTransform()` para parallax sutil en EmpresaShowcase
- CountUp: animación de 0 → valor en 1.5s con `easeOutCubic`
- Sparklines: `animationBegin={300}` y `animationDuration={1500}` en Recharts

### Imágenes
- **Hero backgrounds:** mesh gradient generado con CSS (no imagen). Color base: cehta-green-700 + accent dot golden.
- **Empresa hero:** foto del proyecto real (BESS RHO, planta REVTECH, etc.) — full-bleed con overlay gradient `from-black/70 to-transparent`. Si no hay foto: gradient con iniciales empresa.
- **CEO quotes:** foto circular 80px + nombre + cargo. Si no hay foto: avatar generado con iniciales en color de empresa.

### Mobile-first
- Hero: stack vertical, número se reduce a 7xl en mobile (sigue siendo enorme)
- Performance: 1 columna en mobile, swipe horizontal para sparklines
- EmpresaShowcase: aspect-ratio 4:5 en mobile, 16:9 desktop
- Sticky CTA bottom en mobile para "Agendá café"

### Print mode (para PDF)
- `@media print`: ocultar header/footer del navegador, animaciones desactivadas (`prefers-reduced-motion` forzado), márgenes A4 1.5cm, tipografía 11pt body / 28pt hero.
- URL del PDF: `/informe/pdf/[token]?nocache=1` — server-side puppeteer renderiza esa página y devuelve el blob.

---

## 🤖 Service AI — generación de narrativas

`backend/app/services/informes_lp_service.py`

### System prompts (uno por sección)

#### Hero narrative

```
Sos un copywriter senior de Cehta Capital. Tu tarea: generar la narrativa
hero de un informe trimestral a un LP específico.

INPUT que recibís:
- Datos del LP: nombre, aporte, empresas en las que invirtió
- KPIs del portafolio del último trimestre
- Highlights: hitos cumplidos, nuevas participaciones, performance vs bench

OUTPUT (JSON estricto):
{
  "titulo": "Tu portafolio creció X% este trimestre.",
  "subtitulo": "1-2 oraciones que cuenten la historia de POR QUÉ.",
  "kpi_destacado": { "valor": 23.4, "unidad": "%", "label": "ROI YTD" }
}

ESTILO:
- Personalizado: usar nombre del LP, sus empresas, su aporte cuando sea
  relevante.
- Cuantitativo: cada oración con un número concreto.
- Tono: confiado pero no arrogante. Castellano chileno-rioplatense formal.
- 30 palabras máximo en subtítulo.
- NO exclamaciones. NO superlativos vacíos ("excelente", "increíble").

EJEMPLOS BUENOS:
{ "titulo": "Tu portafolio creció 23.4% este trimestre.",
  "subtitulo": "Ganamos al benchmark FIP por 11 puntos. RHO inauguró BESS
  Panimávida un mes antes de plan." }

{ "titulo": "$623K bien puestos.",
  "subtitulo": "Tu aporte inicial de $500K se valorizó 24.6% en 18 meses,
  con la cobertura ESG más fuerte del FIP chileno." }

EVITAR:
- "¡Qué excelente trimestre!"
- "Es un placer compartirte..."
- "Como sabés, los mercados..."
```

#### Empresa showcase narrative (uno por empresa)

```
Sos un periodista de TechCrunch escribiendo para una memoria de fondo de
inversión. Tu tarea: contar EN UNA HISTORIA lo más relevante que pasó en
una empresa del portafolio en el período.

INPUT:
- Nombre + descripción de la empresa
- KPIs del trimestre + delta vs trimestre anterior
- Hitos cumplidos del Gantt en el período (top 5)
- ESG metrics
- Quote del CEO si existe

OUTPUT:
{
  "headline": "Una oración impactante de 8-12 palabras.",
  "parrafo": "2-3 oraciones que cuenten LA HISTORIA del trimestre.",
  "metricas_destacadas": [
    {"valor": "8MW", "label": "instalados"},
    {"valor": "99.4%", "label": "uptime"},
    {"valor": "4.200", "label": "hogares"}
  ]
}

ESTILO:
- Concreto, no abstracto. "Inauguramos BESS Panimávida" mejor que
  "avances en infraestructura".
- Los números importan, pero solo SI tienen narrativa que los acompaña.
- Si hay un milestone que demoró, mencionarlo brevemente — la confianza
  se construye con honestidad.

EJEMPLOS BUENOS:
{ "headline": "Inauguramos 8MW en Panimávida un mes antes.",
  "parrafo": "El BESS RHO entró a operación en enero, dos meses antes de
  plan original, gracias al adelanto del ingreso a SEC. Ya genera energía
  para 4.200 hogares chilenos." }
```

#### CTA personalizado

```
Sos consultor estratégico. Generá un CTA específico para este LP basado
en su perfil y comportamiento.

Si el LP NO ha aumentado su posición en últimos 12 meses Y el portafolio
performa bien:
  → "Tu posición está en una excelente curva. Hablemos de aumentar"

Si el LP es ACTIVO (compartió otro informe):
  → "Pablo, gracias por la red. Tenemos espacio para 2 LPs más en Q2"

Si el LP es POTENCIAL (parent_token presente):
  → "Quien te recomendó Cehta sabe lo que hace. Agendá 30min con Camilo"

OUTPUT:
{
  "cta_principal": "...",
  "cta_secundario_1": "...",
  "cta_secundario_2": "..."
}
```

### Cache strategy

- Cache de la generación AI por `(lp_id, periodo, tipo)` durante 7 días en `app.informes_lp.secciones_jsonb`
- El GP puede regenerar manualmente con un botón "Regenerar narrativa" → invalida cache
- Datos en vivo (KPIs, AUM) se pulean en cada `GET /informes-lp/by-token/{token}` — esos NO se cachean

---

## 📊 Personalización por perfil de LP

### Si LP es `conservador`
- Sección "Riesgos" más prominente
- "Performance" enfatiza estabilidad (sharpe ratio, max drawdown)
- Empresas con grade A en compliance van primero

### Si LP es `agresivo`
- "Outlook" con próximas participaciones (más riesgo, más upside)
- Métricas YoY agresivas
- Empresas en growth phase destacadas (REVTECH, EVOQUE)

### Si LP es `esg_focused`
- Sección ESG Impact se mueve al lugar #2 (después del hero)
- Métricas como CO2, MW renovable, hectáreas preservadas en el hero
- Quotes de CEOs sobre impacto, no sobre revenue

### Si LP tiene empresas en cartera específicas
- Esas empresas se muestran PRIMERO en el showcase
- Performance personal calculada vs benchmark de SUS empresas

---

## 📈 Mecanismo viral — la mecánica clave

### Cohort tracking 1→N

Cada vez que un LP hace `share`, se genera child_token con `parent_token = original`.

Cuando el child se abre, ScrolL completa, o hace CTA → cuenta como "downstream view".

Métricas:
```
Tasa viral = downstream_views / informes_publicados
```

Si tasa = 5, significa que 1 LP genera 5 vistas adicionales orgánicas → KPI norte.

### Notificaciones positivas

El sistema le manda al LP que compartió notificaciones POSITIVAS (no spam):

- 24h después de compartir: "Pablo abrió tu link 👀"
- 7d después: "Pablo terminó de leer tu reporte (estuvo 4 min)"
- Si Pablo agenda café: "🎉 Pablo agendó café con Camilo. ¡Gracias por la introducción!"

Cada noti tiene un button "Ver agradecimiento" que lleva a una página personalizada en `/informe/[token]/gracias` con un mensaje de Camilo.

### Top advocates leaderboard (interno)

En `/admin/informes-lp/analytics` mostrar tabla:

```
Top advocates Q1 2026
┌─────────────────────────────────────────────────────────┐
│ LP            │ Compartió a │ Aperturas │ Convertidos   │
├─────────────────────────────────────────────────────────┤
│ Sebastián P.  │ 12          │ 47        │ 3 ($1.2M)     │
│ Fernanda R.   │ 7           │ 28        │ 2 ($800K)     │
│ Pablo K.      │ 5           │ 18        │ 1 ($500K)     │
└─────────────────────────────────────────────────────────┘
```

Esto le da al GP visibilidad de qué LPs son sus mejores advocates → priorizar relación con ellos.

### Reciprocidad sutil

Si un LP genera 3+ conversiones via su red, mandar un físico (botella de vino, libro firmado por Camilo) — fuera del software, pero el software te ALERTA cuando llegar al threshold.

---

## 🎯 Métricas de éxito (medibles en 90 días)

| Métrica | Baseline (sin sistema) | Target |
|---|---|---|
| Tasa apertura informes | 30% (Mailchimp avg) | 75%+ |
| Tiempo promedio en informe | 45 seg | 4+ min |
| Tasa share | 0% | 15%+ |
| Tasa viral 1→N | 1.0 | 3.0+ |
| Conversion CTA → café | 1% | 12%+ |
| Cierre de LPs nuevos via informes | 1/mes | 4+/mes |
| AUM levantado atribuible | $0 | $5M+ Q1 |

---

## 🛠 Plan de sprints (5 sprints, ~8-10 días)

### Sprint 1 — Backend foundation (1-2 días)
- Migration: `core.lps`, `app.informes_lp`, `app.informes_lp_eventos`
- Schema Pydantic + repos
- Endpoint `POST /informes-lp/generate` (sin AI todavía, con datos mockeados)
- Endpoint `GET /informes-lp/by-token/{token}`
- Endpoint `POST /track`

### Sprint 2 — Service AI (1 día)
- `informes_lp_service.py` con 3 prompts (hero, empresa, CTA)
- Cache 7 días
- Tests con LP mock

### Sprint 3 — Frontend público + diseño hero (2 días)
- Layout `/informe/[token]` sin sidebar
- HeroSection con DM Serif Display + CountUp + gradient mesh background
- LiveDataBadge
- Tracking inicial (open + scroll)

### Sprint 4 — Frontend secciones (2-3 días)
- PerformanceSection con sparklines Recharts
- EmpresaShowcase storytelling cards
- ESGImpactSection con visualizaciones equivalentes
- OutlookSection con hitos próximos
- CTASection con buttons

### Sprint 5 — Mecanismo viral + admin (2 días)
- ShareCard modal + endpoint share
- Email integration con Resend
- Cohort tracking parent→child
- Admin panel con analytics + top advocates
- Notificaciones positivas (cron diario que emaila)

### Sprint 6 (opcional) — PDF + email + polish
- Puppeteer endpoint para PDF
- React Email templates con Resend
- Cron de "informe mensual automático"
- A/B test de hero narratives

---

## 🚦 Edge cases que SÍ tenés que cubrir

| Caso | Comportamiento |
|---|---|
| LP no existe en DB | Crear lead anónimo con email del share |
| Anthropic key no configurada | Fallback a templates Jinja2 con narrativas estáticas |
| Sin foto de empresa | Gradient con iniciales en color de empresa |
| Datos del portafolio vacíos | Mostrar empty states elegantes, NO números 0 |
| LP sin empresas en cartera | Skip "Tu posición", mostrar "Nuevo en Cehta — bienvenida" |
| Token inválido | Página 404 con CTA "Agendar café para acceder" |
| Token expirado | Banner "Este informe es de Q1 — pedí el último" |
| LP comparte 50 veces | Cap en 20 shares por informe (anti-abuse) |
| Mobile sin internet | Service Worker con cache offline del informe |
| Print mode | Layout simple sin animations, márgenes A4 |
| LP screenshot del informe | OG image personalizado para WhatsApp/LinkedIn |

---

## 🔒 Seguridad y privacidad

- **No PII en URLs.** Token de 32 chars URL-safe, no `?lp=42`.
- **IP hashing.** Eventos guardan SHA256(IP + salt) para tracking sin almacenar IP real.
- **GDPR-friendly.** El LP puede pedir "olvidame" → soft-delete del registro y anonimización de eventos.
- **Rate limiting.** 30 req/min por IP en endpoints públicos, 5 shares/hora.
- **Email validation.** Doble opt-in para `share`: email al destinatario "¿Querés ver el informe que Sebastián te mandó?" antes de mostrar el contenido.
- **Watermark sutil.** En el footer de cada informe: "Generado para [Nombre LP] · [fecha]" — disuade screenshots para difundir genéricamente.
- **Datos sensibles.** Información financiera del LP (su aporte, retorno) viene del JWT al cargar — nunca se guarda en el HTML estático del informe.

---

## ✅ Definición de Done

Después de los 5 sprints, este sistema debe:

1. **Generar un informe en menos de 30 segundos.** Click "Generar para Sebastián" → preview listo en <30s.
2. **Tasa apertura > 60%** en los primeros 30 envíos reales.
3. **Tiempo promedio en informe > 3 min** (medido por scroll + section_view events).
4. **Al menos 1 share por cada 5 envíos** en los primeros 90 días.
5. **Conversion rate CTA "agendar café" > 8%.**
6. **Lighthouse mobile > 85** en performance + 95 en a11y para `/informe/[token]`.
7. **PDF perfecto.** Lo descargás, lo mandás por WhatsApp, se ve igual que en web.
8. **Admin panel con analytics actuables.** El GP entra una vez por semana y ve qué LPs leyeron, qué secciones, quién compartió.
9. **System prompts editables** sin redeploy (admin UI con preview).
10. **Soft-fail completo.** Si Anthropic muere, los informes siguen funcionando con narrativas template.

---

## 🎁 Bonus features (cuando todo lo anterior funcione)

- **Versión audio del informe** (TTS via ElevenLabs) — "Escuchar el reporte 5min" para LPs que manejan
- **Comparativa interactiva** — slider que permite al LP simular: "si hubiera invertido $1M en vez de $500K..."
- **Heatmap del informe** (Hotjar-style) — el GP ve dónde clickearon los LPs y dónde scrollearon
- **A/B test del hero** — el sistema prueba 3 variantes de narrativa y elige la de mejor conversion
- **Dashboard de "salud relacional"** — qué LPs no han abierto en 60 días → riesgo de churn
- **Integración con CRM** — los eventos se sincronizan con HubSpot/Salesforce automáticamente
- **Webhook a Slack** — "🎉 Pablo Klein agendó café con Camilo gracias al share de Sebastián"

---

## 🚀 Cómo arrancar

Si tenés que decirme una sola cosa para empezar, decime:

1. **¿Qué empresas del portafolio querés destacar primero?** (Las que tienen mejor data y storytelling — RHO con BESS Panimávida es el más obvio.)
2. **¿Cuál es el calendar tool que usa Camilo?** (Cal.com, Google Calendar, Calendly — para integrar el "Agendar café".)
3. **¿Tenemos fotos profesionales de los proyectos en terreno?** (Sin fotos buenas, esto se ve a 30% del potencial. Vale la pena un día de fotógrafo en RHO/REVTECH si no las hay.)
4. **¿Quién maneja Resend / qué provider de email?** (Para integrar el envío.)
5. **¿Tenés 5 LPs piloto** que confíen en Cehta y nos dejen iterar el primer informe con su nombre real? (Para learning loop rápido antes de mandar al pipeline frío.)

Con esas 5 respuestas arrancamos Sprint 1 mañana.

---

**Esto no es un reporte. Es la mejor inversión en marketing que va a hacer Cehta este año.**
