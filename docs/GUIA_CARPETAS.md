# 📁 Guía Completa — Estructura de Carpetas Dropbox Cehta Capital

> **Para Nicolas, Guido y el equipo**: esta es la **estructura DEFINITIVA**
> de tu Dropbox para que la plataforma funcione 100%. Cada carpeta tiene
> un propósito claro y la app la lee/escribe automáticamente.
>
> **TL;DR**: Cehta Capital es un FIP con 9 empresas. **TODO se separa por
> empresa**. Las carpetas globales son solo para datos del fondo.

**Última actualización**: 2026-04-27 · V3 Fase 2

---

## 🎯 Reglas de oro

1. **Por empresa, no por tema**. Si un documento es de `TRONGKAI`, vive bajo `Empresas/TRONGKAI/`. Aunque sea legal o financiero.
2. **Numeración consistente**. Carpetas internas con prefijo `01-`, `02-`, etc. para orden visual.
3. **Naming convention**: `YYYY-MM-DD - Descripción.ext` para documentos individuales. Ej: `2026-04-15 - Contrato Banco Estado.pdf`.
4. **Sin acentos ni espacios** en nombres de archivos críticos para ETL (Data Madre, templates).
5. **Templates al final**. Cualquier carpeta termina con `Templates/` opcional.
6. **NUNCA borrar la estructura**. La app espera estos paths exactos.

---

## 🏗 Estructura completa

```
📁 Dropbox/
└── 📁 Cehta Capital/                               ← root del fondo
    │
    ├── 📁 00-Inteligencia de Negocios/             ← ⚡ ETL lee de aquí
    │   ├── 📊 Data Madre.xlsx                       ← FUENTE DE VERDAD
    │   ├── 📁 Histórico/                            ← snapshots ETL automáticos
    │   │   ├── 📊 2026-01-Data-Madre.xlsx
    │   │   └── ...
    │   └── 📁 Templates/
    │       ├── 📊 Plantilla F29.xlsx
    │       └── 📊 Plantilla Reporte LP.xlsx
    │
    ├── 📁 01-Empresas/                              ← 🎯 todo por empresa
    │   ├── 📁 TRONGKAI/
    │   │   ├── 📁 01-Información General/           ← logos, identidad, constitución
    │   │   │   ├── 📷 Logo.png
    │   │   │   ├── 📄 Estatutos.pdf
    │   │   │   ├── 📄 Acta de Constitución.pdf
    │   │   │   └── 📄 RUT.pdf
    │   │   │
    │   │   ├── 📁 02-Trabajadores/                  ← 🆕 HR
    │   │   │   ├── 📁 Activos/
    │   │   │   │   ├── 📁 12345678-9 - Juan Pérez/
    │   │   │   │   │   ├── 📄 2026-01-15 - Contrato Indefinido.pdf
    │   │   │   │   │   ├── 📄 2026-01-15 - Anexo Cláusula Confidencialidad.pdf
    │   │   │   │   │   ├── 📄 2026-04-01 - Anexo Aumento Sueldo.pdf
    │   │   │   │   │   ├── 📄 DNI - Cara Frontal.pdf
    │   │   │   │   │   ├── 📄 DNI - Cara Posterior.pdf
    │   │   │   │   │   ├── 📄 Certificado AFP.pdf
    │   │   │   │   │   ├── 📄 Certificado FONASA.pdf
    │   │   │   │   │   ├── 📄 CV.pdf
    │   │   │   │   │   └── 📁 Liquidaciones/
    │   │   │   │   │       ├── 📄 2026-01.pdf
    │   │   │   │   │       ├── 📄 2026-02.pdf
    │   │   │   │   │       └── ...
    │   │   │   │   └── 📁 11223344-5 - María García/
    │   │   │   │       └── ...
    │   │   │   ├── 📁 Inactivos/
    │   │   │   │   └── 📁 99887766-K - Pedro Soto (egreso 2025-12-31)/
    │   │   │   │       ├── 📄 Carta Renuncia.pdf
    │   │   │   │       ├── 📄 Finiquito.pdf
    │   │   │   │       └── 📄 Pago Vacaciones Proporcionales.pdf
    │   │   │   ├── 📁 Procesos Selección/
    │   │   │   │   └── 📁 2026-04 - Senior Backend/
    │   │   │   │       ├── 📄 Job Description.md
    │   │   │   │       ├── 📁 Postulantes/
    │   │   │   │       └── 📁 Entrevistas/
    │   │   │   └── 📁 Templates/
    │   │   │       ├── 📄 Contrato Indefinido Tipo.docx
    │   │   │       ├── 📄 Contrato Plazo Fijo Tipo.docx
    │   │   │       ├── 📄 Anexo Sueldo Tipo.docx
    │   │   │       └── 📄 Carta Despido Tipo.docx
    │   │   │
    │   │   ├── 📁 03-Legal/
    │   │   │   ├── 📁 Contratos/
    │   │   │   │   ├── 📁 Clientes/
    │   │   │   │   ├── 📁 Proveedores/
    │   │   │   │   ├── 📁 Bancarios/
    │   │   │   │   └── 📁 Otros/
    │   │   │   ├── 📁 Actas/
    │   │   │   │   ├── 📄 2026-01-15 - Acta Junta Directorio.pdf
    │   │   │   │   └── ...
    │   │   │   ├── 📁 Declaraciones SII/
    │   │   │   │   ├── 📁 F29/
    │   │   │   │   │   ├── 📄 2026-01.pdf
    │   │   │   │   │   └── ...
    │   │   │   │   ├── 📁 F22 (Renta Anual)/
    │   │   │   │   └── 📁 Otros/
    │   │   │   ├── 📁 Permisos & Certificaciones/
    │   │   │   │   ├── 📄 Permiso Municipal.pdf
    │   │   │   │   ├── 📄 Certificación SII.pdf
    │   │   │   │   └── 📄 Patente Comercial.pdf
    │   │   │   └── 📁 Pólizas Seguros/
    │   │   │
    │   │   ├── 📁 04-Financiero/
    │   │   │   ├── 📁 Estados Financieros/
    │   │   │   │   ├── 📁 Mensuales/
    │   │   │   │   ├── 📁 Trimestrales/
    │   │   │   │   └── 📁 Anuales/
    │   │   │   ├── 📁 Balances/
    │   │   │   ├── 📁 Cartolas Bancarias/
    │   │   │   │   ├── 📁 BancoEstado/
    │   │   │   │   ├── 📁 Banco Chile/
    │   │   │   │   └── ...
    │   │   │   ├── 📁 Facturas Emitidas/
    │   │   │   ├── 📁 Facturas Recibidas/
    │   │   │   └── 📁 Boletas Honorarios/
    │   │   │
    │   │   ├── 📁 05-Proyectos & Avance/
    │   │   │   ├── 📊 Roadmap.xlsx                  ← Gantt + hitos
    │   │   │   ├── 📁 Hitos/
    │   │   │   │   ├── 📄 H1 - Producto MVP.md
    │   │   │   │   └── ...
    │   │   │   ├── 📁 Reportes Avance Semanal/
    │   │   │   │   ├── 📄 2026-W17.md
    │   │   │   │   └── ...
    │   │   │   ├── 📁 Riesgos/
    │   │   │   │   └── 📊 Risk Register.xlsx
    │   │   │   └── 📁 OKRs/
    │   │   │       ├── 📄 2026-Q1.md
    │   │   │       └── 📄 2026-Q2.md
    │   │   │
    │   │   ├── 📁 06-Reuniones/
    │   │   │   ├── 📁 Actas/
    │   │   │   │   ├── 📁 Directorio/
    │   │   │   │   ├── 📁 Comité Operativo/
    │   │   │   │   └── 📁 1on1/
    │   │   │   ├── 📁 Notas/
    │   │   │   └── 📁 Grabaciones/
    │   │   │
    │   │   ├── 📁 07-Reportes Generados/             ← outputs de la app
    │   │   │   ├── 📁 Mensuales/
    │   │   │   ├── 📁 Trimestrales/
    │   │   │   └── 📁 Ad-hoc/
    │   │   │
    │   │   └── 📁 08-AI Knowledge Base/              ← contexto para AI Q&A
    │   │       ├── 📄 company_overview.md
    │   │       ├── 📄 financial_context.md
    │   │       ├── 📄 strategic_priorities.md
    │   │       ├── 📁 docs_processed/                ← PDFs OCR'd
    │   │       └── 📁 embeddings/                    ← cache
    │   │
    │   ├── 📁 REVTECH/        (misma estructura 01-08)
    │   ├── 📁 EVOQUE/         (misma estructura 01-08)
    │   ├── 📁 DTE/            (misma estructura 01-08)
    │   ├── 📁 CSL/            (misma estructura 01-08)
    │   ├── 📁 RHO/            (misma estructura 01-08)
    │   ├── 📁 AFIS/           (misma estructura 01-08)
    │   ├── 📁 FIP_CEHTA/      (misma estructura 01-08)
    │   └── 📁 CENERGY/        (misma estructura 01-08)
    │
    ├── 📁 02-Fondo (FIP CEHTA)/                       ← solo lo del FIP como fondo
    │   ├── 📁 Inversionistas (LPs)/
    │   │   ├── 📊 LPs Activos.xlsx
    │   │   ├── 📊 LPs Pipeline.xlsx
    │   │   └── 📁 Subscripciones/
    │   │       ├── 📁 LP-001 - Familia Pérez/
    │   │       │   ├── 📄 Contrato Suscripción.pdf
    │   │       │   ├── 📄 Recibos Aporte/
    │   │       │   └── 📄 Reportes Enviados/
    │   │       └── ...
    │   ├── 📁 Comité de Inversión/
    │   │   ├── 📁 Actas/
    │   │   ├── 📁 Decisiones/
    │   │   └── 📁 Reportes Comité/
    │   ├── 📁 Reglamento Interno/
    │   ├── 📁 Memorias Anuales/
    │   └── 📁 Reportes Consolidados/
    │       ├── 📁 Mensuales/
    │       ├── 📁 Trimestrales/
    │       └── 📁 Anuales/
    │
    ├── 📁 03-Búsqueda de Capital/                    ← prospecting
    │   ├── 📁 LPs Potenciales/
    │   │   ├── 📊 Pipeline Outreach.xlsx
    │   │   └── 📁 Decks Enviados/
    │   ├── 📁 Bancos Aliados/
    │   │   ├── 📊 Bancos.xlsx
    │   │   └── 📁 Programas/
    │   ├── 📁 Estado/
    │   │   ├── 📁 CORFO/
    │   │   ├── 📁 ANID/
    │   │   └── 📁 Otros/
    │   └── 📁 Family Offices/
    │
    └── 📁 99-Templates Globales/                      ← templates compartidos
        ├── 📄 Contrato Indefinido.docx
        ├── 📄 Acta Directorio.docx
        ├── 📄 NDA.docx
        ├── 📊 Plantilla Roadmap.xlsx
        └── 📊 Plantilla Risk Register.xlsx
```

---

## 📊 Mapeo: Sección de la app ↔ Carpeta Dropbox

| Sección plataforma | Carpeta(s) Dropbox | Acceso |
|---|---|---|
| Dashboard CEO | `00-Inteligencia de Negocios/Data Madre.xlsx` (consolidado) | admin/ceo |
| Movimientos | `00-Inteligencia de Negocios/Data Madre.xlsx` (hoja Resumen) | todos |
| F29 / Tributario | `01-Empresas/{codigo}/03-Legal/Declaraciones SII/F29/` | todos |
| **Empresa > Trabajadores** | `01-Empresas/{codigo}/02-Trabajadores/` | todos (de la empresa) |
| Empresa > Legal | `01-Empresas/{codigo}/03-Legal/` | todos (de la empresa) |
| Empresa > Avance | `01-Empresas/{codigo}/05-Proyectos & Avance/` | todos (de la empresa) |
| Empresa > Documentos | `01-Empresas/{codigo}/01-Información General/` + 04-Financiero | todos (de la empresa) |
| Empresa > AI Asistente | `01-Empresas/{codigo}/08-AI Knowledge Base/` | todos (de la empresa) |
| Reportes (consolidados) | `02-Fondo/Reportes Consolidados/` | admin/ceo |
| Búsqueda de Fondos | `03-Búsqueda de Capital/` | admin/finance |
| Comité Inversión | `02-Fondo/Comité de Inversión/` | admin/ceo |

---

## 🛠 Cómo subir información — guía paso a paso por caso de uso

### Caso 1 — Subir un nuevo trabajador

**Ejemplo**: Juan Pérez (RUT 12.345.678-9) ingresa a TRONGKAI el 1 de mayo 2026.

**Opción A — Vía la plataforma** (recomendado):
1. Sidebar → `Empresas` → `TRONGKAI` → `Trabajadores`
2. Click `+ Nuevo trabajador`
3. Form: nombre, RUT, cargo, email, teléfono, fecha ingreso
4. **Submit** → la plataforma crea automáticamente la carpeta `01-Empresas/TRONGKAI/02-Trabajadores/Activos/12345678-9 - Juan Pérez/` en Dropbox
5. En la página del trabajador, click `Subir documento` → select archivo → tipo (Contrato/DNI/etc.) → upload

**Opción B — Manualmente en Dropbox**:
1. Crear carpeta `01-Empresas/TRONGKAI/02-Trabajadores/Activos/12345678-9 - Juan Pérez/`
2. Subir documentos siguiendo naming `YYYY-MM-DD - Descripción.pdf`
3. La plataforma los detecta en el próximo sync (~5 min vía webhook Dropbox)

### Caso 2 — Trabajador renuncia / despido

1. Plataforma → empresa → trabajadores → click trabajador → `Marcar inactivo`
2. Cargar carta renuncia o finiquito
3. La carpeta del trabajador se **mueve automáticamente** de `Activos/` a `Inactivos/` con sufijo `(egreso YYYY-MM-DD)`
4. Sus datos quedan en histórico pero no aparecen en lista activa

### Caso 3 — Subir Excel madre actualizado

1. Editar `00-Inteligencia de Negocios/Data Madre.xlsx` como ya lo haces
2. Guardar (Dropbox sync automático)
3. **El ETL detecta cambio en ~30 min** (o instant via webhook si está configurado)
4. Postgres se actualiza
5. Dashboard refleja datos nuevos

### Caso 4 — Subir contrato nuevo (legal)

1. Plataforma → empresa → Legal → click `+ Subir documento`
2. Tipo: Contrato Cliente/Proveedor/Banco/Otro
3. Datos: contraparte, vigencia desde, vigencia hasta, monto
4. Upload PDF
5. Va a `01-Empresas/{empresa}/03-Legal/Contratos/{categoria}/`
6. Si tiene fecha de vencimiento, alerta automática 30 días antes

### Caso 5 — Hito completado en proyecto

1. Plataforma → empresa → Avance
2. Click hito en el Gantt → `Marcar completado`
3. Adjuntar evidencia (deliverable PDF, screenshots, etc.)
4. Va a `01-Empresas/{empresa}/05-Proyectos/Hitos/`
5. KPIs del Dashboard CEO se recalculan

### Caso 6 — Reporte mensual a inversionistas

1. Plataforma → Reportes → Mensual del Fondo
2. Selecciona mes
3. Click `Generar PDF`
4. Descarga local + se guarda automáticamente en `02-Fondo/Reportes Consolidados/Mensuales/`
5. Click `Enviar a LPs` (V3 fase 2) → email automático con PDF adjunto

### Caso 7 — Agregar contexto al AI Asistente

1. En la app: empresa → AI Asistente → `Configurar contexto`
2. **O manualmente**: editá `01-Empresas/{empresa}/08-AI Knowledge Base/company_overview.md`
3. El indexer corre cada noche y actualiza embeddings
4. Mañana el AI ya conoce esa info

---

## 📋 Checklist inicial — lo que tenés que armar esta semana

### Día 1 (1h) — Crear la estructura raíz
- [ ] `Dropbox/Cehta Capital/`
- [ ] `Dropbox/Cehta Capital/00-Inteligencia de Negocios/`
- [ ] `Dropbox/Cehta Capital/01-Empresas/`
- [ ] `Dropbox/Cehta Capital/02-Fondo (FIP CEHTA)/`
- [ ] `Dropbox/Cehta Capital/03-Búsqueda de Capital/`
- [ ] `Dropbox/Cehta Capital/99-Templates Globales/`

### Día 1 (30min) — Mover el Excel madre
- [ ] Copiar tu `Data Madre.xlsx` actual a `00-Inteligencia de Negocios/`
- [ ] Probar `https://cehta-backend.fly.dev/api/v1/dropbox/data-madre` (debe encontrarlo)

### Día 2 (2h) — Crear las 9 carpetas de empresa
Para cada una de las 9 empresas (TRONGKAI, REVTECH, EVOQUE, DTE, CSL, RHO, AFIS, FIP_CEHTA, CENERGY), crear:

- [ ] `01-Empresas/{CODIGO}/01-Información General/`
- [ ] `01-Empresas/{CODIGO}/02-Trabajadores/Activos/`
- [ ] `01-Empresas/{CODIGO}/02-Trabajadores/Inactivos/`
- [ ] `01-Empresas/{CODIGO}/02-Trabajadores/Procesos Selección/`
- [ ] `01-Empresas/{CODIGO}/02-Trabajadores/Templates/`
- [ ] `01-Empresas/{CODIGO}/03-Legal/Contratos/`
- [ ] `01-Empresas/{CODIGO}/03-Legal/Actas/`
- [ ] `01-Empresas/{CODIGO}/03-Legal/Declaraciones SII/F29/`
- [ ] `01-Empresas/{CODIGO}/03-Legal/Permisos & Certificaciones/`
- [ ] `01-Empresas/{CODIGO}/04-Financiero/Estados Financieros/`
- [ ] `01-Empresas/{CODIGO}/04-Financiero/Cartolas Bancarias/`
- [ ] `01-Empresas/{CODIGO}/05-Proyectos & Avance/`
- [ ] `01-Empresas/{CODIGO}/06-Reuniones/Actas/`
- [ ] `01-Empresas/{CODIGO}/07-Reportes Generados/`
- [ ] `01-Empresas/{CODIGO}/08-AI Knowledge Base/`

> **Tip**: armá una empresa primero (ej. TRONGKAI), y después en Dropbox click derecho → Copy → Paste en cada empresa, y renombrá los códigos.

### Día 3 (1-2h) — Subir documentos críticos por empresa
Por cada empresa, mover los archivos que ya tengas a la carpeta correcta:
- [ ] Estatutos → `01-Información General/`
- [ ] F29 últimos 12 meses → `03-Legal/Declaraciones SII/F29/`
- [ ] Contratos vigentes → `03-Legal/Contratos/{categoría}/`
- [ ] Estados financieros últimos 12 meses → `04-Financiero/Estados Financieros/Mensuales/`

### Día 4 (1h) — Trabajadores
- [ ] Listar todos los trabajadores activos de cada empresa
- [ ] Vía plataforma o manual: crear carpetas en `02-Trabajadores/Activos/`
- [ ] Subir contratos vigentes

### Día 5 (1h) — AI Knowledge Base inicial
Por cada empresa, escribir un `company_overview.md` con:
- [ ] Qué hace la empresa (1 párrafo)
- [ ] Modelo de negocio (1 párrafo)
- [ ] Stage actual (semilla, growth, etc.)
- [ ] KPIs operativos clave
- [ ] Equipo founder + key people
- [ ] Roadmap 12 meses
- [ ] Riesgos identificados

Esto desbloquea el AI Q&A con respuestas relevantes desde el primer día.

---

## 🤖 Qué hace la plataforma automáticamente

Cuando todo esté armado, la plataforma:

| Acción del usuario | Lo que hace la plataforma |
|---|---|
| Sube nueva versión de Data Madre.xlsx | ETL corre, actualiza Postgres, dashboard refleja en 30 min |
| Sube contrato a Legal | Detecta vencimiento, programa alerta, indexa para búsqueda |
| Sube doc a Trabajador | Lo categoriza, lo asocia al trabajador, queda visible en su perfil |
| Genera reporte mensual | Lo guarda en Reportes Generados, opción de enviar por email |
| Agrega .md a AI Knowledge Base | Indexa con embeddings, AI lo usa en respuestas próximas |
| Edita Roadmap.xlsx de un proyecto | Sincroniza Gantt en la app, actualiza KPIs CEO Dashboard |

---

## ⚠️ Qué NO hacer

- ❌ Mover el `Data Madre.xlsx` a otro lugar — el ETL lo busca por path exacto
- ❌ Renombrar la carpeta `Cehta Capital/` — la plataforma busca ese nombre
- ❌ Borrar `00-Inteligencia de Negocios/Histórico/` — son backups del ETL
- ❌ Cambiar nombres de empresas (los códigos tienen que ser exactos)
- ❌ Subir archivos > 100MB sin avisar (Dropbox tiene límites por tier)
- ❌ Documentos confidenciales en carpetas compartidas con todo el equipo (usar permisos Dropbox por subcarpeta)

---

## 🔐 Permisos en Dropbox (recomendación)

Configurar en Dropbox las siguientes shared folders:

| Carpeta | Acceso | Quién |
|---|---|---|
| `Cehta Capital/00-Inteligencia de Negocios/` | Edit | Solo Nicolas (admin) |
| `Cehta Capital/01-Empresas/{empresa}/` | Edit | Trabajadores de esa empresa |
| `Cehta Capital/01-Empresas/{empresa}/02-Trabajadores/` | View only | Todos · Edit: HR + admin |
| `Cehta Capital/02-Fondo/` | View | Comité, admin · Edit: admin |
| `Cehta Capital/03-Búsqueda de Capital/` | Edit | Admin, finance |
| `Cehta Capital/99-Templates Globales/` | View all · Edit admin | |

---

## 📈 Roadmap de cosas que podemos automatizar (V4+)

- [ ] Webhook Dropbox → trigger ETL al instante (vs 30min cron)
- [ ] OCR automático de PDFs escaneados (Tesseract en Fly)
- [ ] Extracción de metadata de contratos (fecha, partes, monto) con LLM
- [ ] Generación auto de liquidaciones mensuales por trabajador
- [ ] Email con resumen semanal de cambios en Dropbox
- [ ] Alertas Slack cuando se sube contrato nuevo
- [ ] Versionado: detectar nuevas versiones de templates

---

## 📞 Si algo no anda

1. Verificar conexión Dropbox: `https://cehta-capital.vercel.app/admin/integraciones`
2. Verificar detección Data Madre: `curl https://cehta-backend.fly.dev/api/v1/dropbox/data-madre -H "Authorization: Bearer $TOKEN"`
3. Logs backend: `flyctl logs --app cehta-backend`
4. Pegamelo y debuggeo.

---

## 🎯 Métrica de éxito

Cuando esto esté armado y funcionando, vas a poder:

- ✅ Ver consolidado de las 9 empresas en un solo dashboard
- ✅ Cada gerente de empresa ve solo SU empresa
- ✅ Subir un contrato y que se categorice + alerte de vencimiento solo
- ✅ Onboarding de trabajadores en 5 clicks (vs ~30 min hoy)
- ✅ Generar reportes mensuales para LPs en 1 click (vs ~4 horas hoy)
- ✅ Preguntarle al AI "¿Cuánto gastamos en marketing en TRONGKAI Q1?" y tener respuesta con citations
- ✅ Búsqueda full-text en TODA la documentación legal de las 9 empresas
