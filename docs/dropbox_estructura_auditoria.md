# Auditoría — Estructura de Carpetas Dropbox vs App

Comparativa entre la guía oficial de Cehta (`GUIA_DROPBOX_CEHTA.docx`) y los paths que el backend efectivamente lee. **Lo que la app sincroniza** vs **lo que falta** vs **lo que conviene crear**.

---

## TL;DR ejecutivo

| Carpeta | Status | Acción inmediata |
|---|---|---|
| `00-Inteligencia de Negocios/Data Madre.xlsx` | ✅ App lee | Mantener |
| `01-Empresas/{cod}/01-Información General/` | 🔴 No se sync | Existente OK; sirve como vault humano |
| `01-Empresas/{cod}/02-Trabajadores/Activos/` | ✅ App sync | Tener `{RUT} - {NOMBRE}/` por trabajador |
| `01-Empresas/{cod}/02-Trabajadores/Inactivos/` | ✅ App sync | Mover egresos acá con `(egreso YYYY-MM-DD)` |
| `01-Empresas/{cod}/02-Trabajadores/Procesos Selección/` | 🟡 Falta | Crear si quieren centralizar postulaciones |
| `01-Empresas/{cod}/02-Trabajadores/Templates/` | 🟡 Falta | Crear con contratos modelo, anexos, finiquitos |
| `01-Empresas/{cod}/03-Legal/Contratos/{Clientes,Proveedores,Bancarios,Otros}/` | ✅ App sync (recursivo) | Mantener |
| `01-Empresas/{cod}/03-Legal/Actas/` | ✅ App sync | Mantener (cae bajo legal_documents) |
| `01-Empresas/{cod}/03-Legal/Declaraciones SII/F29/` | ✅ App sync (`YYYY-MM.pdf`) | Mantener nombre estricto |
| `01-Empresas/{cod}/03-Legal/Declaraciones SII/F22/` | 🔴 No se sync | Crear; agregar handler en backend (ver §5) |
| `01-Empresas/{cod}/03-Legal/Permisos/` | ✅ App sync (legal_documents) | Mantener |
| `01-Empresas/{cod}/03-Legal/Pólizas/` | ✅ App sync (legal_documents) | Mantener |
| `01-Empresas/{cod}/04-Financiero/Estados Financieros/{Mensuales,Trimestrales,Anuales}/` | ✅ App sync | Mantener |
| `01-Empresas/{cod}/04-Financiero/Balances/` | 🟡 Falta | Crear; backend solo lee Estados Financieros/ |
| `01-Empresas/{cod}/04-Financiero/Cartolas Bancarias/` | 🔴 No se sync | Crear; valioso para conciliación bancaria (ver §5) |
| `01-Empresas/{cod}/04-Financiero/Facturas Emitidas/` | 🔴 No se sync | Crear; valioso para módulo Vouchers VENTA |
| `01-Empresas/{cod}/04-Financiero/Facturas Recibidas/` | 🔴 No se sync | Crear; valioso para módulo Vouchers COMPRA |
| `01-Empresas/{cod}/04-Financiero/Boletas Honorarios/` | 🔴 No se sync | Crear; valioso para módulo Vouchers COMPRA |
| `01-Empresas/{cod}/05-Proyectos & Avance/Roadmap.xlsx` | ✅ App sync | Mantener (también `Carta Gantt.xlsx`) |
| `01-Empresas/{cod}/05-Proyectos & Avance/Hitos/` | 🟡 Sub-carpeta humana | Crear PDFs de soporte de cada hito |
| `01-Empresas/{cod}/05-Proyectos & Avance/Riesgos/` | 🟡 Sub-carpeta humana | Crear matriz de riesgos por proyecto |
| `01-Empresas/{cod}/05-Proyectos & Avance/Reportes Avance/` | 🟡 Sub-carpeta humana | Crear reportes mensuales del PM |
| `01-Empresas/{cod}/05-Proyectos & Avance/OKRs/` | 🟡 Sub-carpeta humana | Crear OKRs trimestrales |
| `01-Empresas/{cod}/06-Reuniones/Actas/{Directorio,Comité,1on1}/` | 🔴 No se sync | Crear; futuro — `secretaria_ai_service` puede leer |
| `01-Empresas/{cod}/06-Reuniones/Notas/` | 🔴 No se sync | Crear; notas tomadas por Nicolás |
| `01-Empresas/{cod}/06-Reuniones/Grabaciones/` | 🔴 No se sync | Crear; mp4/m4a de Zoom/Meet |
| `01-Empresas/{cod}/07-Reportes Generados/` | 🟢 Output (no input) | Mantener; acá la app deposita PDFs futuros |
| `01-Empresas/{cod}/08-AI Knowledge Base/` | 🟢 Output (no input) | Mantener; index AI puede leer (ver §5) |
| `02-Fondo (FIP CEHTA)/Inversionistas LPs/` | 🔴 No se sync | Existente OK, pero los datos viven en DB (`/lps`) |
| `02-Fondo (FIP CEHTA)/Comité Inversión/` | 🔴 No se sync | Crear; relacionar a `core.fondo_actas` |
| `02-Fondo (FIP CEHTA)/Reglamento/` | 🔴 No se sync | Crear; relacionar a `core.policies_fondo` |
| `02-Fondo (FIP CEHTA)/Memorias/` | 🔴 No se sync | Memorias anuales formales |
| `02-Fondo (FIP CEHTA)/Reportes Consolidados/` | 🔴 No se sync | Output de informes_lp |
| `02-Fondo (FIP CEHTA)/Vouchers/{empresa}/{año}/{codigo}/` | ✅ App sync (módulo V5) | Mantener |
| `03-Búsqueda de Capital/{LPs Potenciales,Bancos,Estado,Family Offices}/` | 🔴 No se sync | Mantener manual; los pipelines están en DB |
| `99-Templates Globales/` | 🟢 No aplica | Templates estáticos para humanos |

**Leyenda**
- ✅ La app ya lee/sincroniza esa carpeta
- 🟢 La carpeta es output (la app escribe ahí, no lee)
- 🟡 La carpeta es vault humano útil pero la app no la procesa (no genera valor ni problema)
- 🔴 Carpeta del docx que falta o que la app NO lee — algunas son oportunidades para extender la sync

---

## 1. Lo que la app SINCRONIZA hoy

`backend/app/services/dropbox_sync_service.py` activa estos flujos cuando corre el ETL o el botón "Sync Dropbox":

### 1.1 Trabajadores
- Path: `/Cehta Capital/01-Empresas/{COD}/02-Trabajadores/Activos/{RUT} - {NOMBRE}/`
- Cada subcarpeta de empleado debe llamarse exactamente `{RUT con guion} - {Nombre Apellido}` (ej: `12.345.678-9 - Juan Perez`).
- Adentro: contratos, anexos, CV, certificados AFP/Fonasa. La app infiere el `tipo` por el nombre (`contrato_*.pdf`, `anexo_*.pdf`, `cv_*.pdf`, `cert_afp_*.pdf`).
- Inactivos: cuando dan baja, mover la carpeta a `Inactivos/` y agregar al final `(egreso YYYY-MM-DD)`.

### 1.2 Legal (recursivo, max 4 niveles)
- Path: `/Cehta Capital/01-Empresas/{COD}/03-Legal/{cualquier subcarpeta}/`
- Categorías que la app reconoce automáticamente del path: `Contratos`, `Actas`, `Declaraciones SII`, `Permisos`, `Pólizas`, `Otros`.
- Subcategoría: lo que venga después (`Contratos/Clientes/...` → categoria=Contratos, subcategoria=Clientes).
- Acepta extensiones: pdf, docx, xlsx, jpg, png.

### 1.3 F29 (declaración mensual SII)
- Path: `/Cehta Capital/01-Empresas/{COD}/03-Legal/Declaraciones SII/F29/{YYYY-MM}.pdf`
- **El nombre del archivo es crítico**: la app extrae el período (`MM_YY`) del nombre. Si no respeta `YYYY-MM.pdf` no se sincroniza.

### 1.4 Estados Financieros (V5)
- Path: `/Cehta Capital/01-Empresas/{COD}/04-Financiero/Estados Financieros/{Mensuales|Trimestrales|Anuales}/`
- La app infiere período del nombre del archivo (`2025-Q4`, `2025-T4`, `2025-S1`, `2026-03`, `2025`).

### 1.5 Roadmap / Carta Gantt
- Paths esperados:
  - `/Cehta Capital/01-Empresas/{COD}/05-Proyectos & Avance/Roadmap.xlsx`
  - `/Cehta Capital/01-Empresas/{COD}/05-Proyectos & Avance/Carta Gantt.xlsx`
- Si no existe ninguno de los dos, no se cargan hitos para esa empresa.

### 1.6 Adjuntos Vouchers (módulo V5)
- Path: `/Cehta Capital/02-Fondo (FIP CEHTA)/Vouchers/{empresa}/{año}/{codigo}/{filename}`
- La app crea estas carpetas automáticamente cuando subís un PDF al voucher desde la UI.

### 1.7 Inbox emails (V5+, recién agregado)
- Path: `/Cehta Capital/00-Inbox/{año}/{mes}/{filename}`
- Los adjuntos de emails entrantes a `contactocehta@gmail.com` se guardan acá automáticamente cuando el cron de inbox corra (ver §5).

---

## 2. Lo que falta agregar AHORA en cada empresa (acción manual)

Para las 9 empresas (TRONGKAI, CSL, EVOQUE, DTE, REVTECH, CENERGY, RHO, AFIS, FIP_CEHTA) crear esta estructura mínima si no existe:

```
01-Empresas/{COD}/
├── 01-Información General/
│   ├── Logo.png
│   ├── Estatutos.pdf
│   ├── Acta Constitución.pdf
│   ├── RUT.pdf
│   └── Datos Fiscales.txt        ← útil para que la app autocomplete
│
├── 02-Trabajadores/
│   ├── Activos/                  ← ya existe, sigue formato {RUT} - {Nombre}
│   ├── Inactivos/                ← idem + sufijo "(egreso YYYY-MM-DD)"
│   ├── Procesos Selección/       ← OPCIONAL: postulaciones por cargo
│   └── Templates/                ← OPCIONAL: plantillas contrato, finiquito
│
├── 03-Legal/
│   ├── Contratos/
│   │   ├── Clientes/
│   │   ├── Proveedores/
│   │   ├── Bancarios/
│   │   └── Otros/
│   ├── Actas/                    ← actas de directorio empresa portfolio
│   ├── Declaraciones SII/
│   │   ├── F29/                  ← {YYYY-MM}.pdf STRICT
│   │   └── F22/                  ← {YYYY}.pdf  (anual; ver §5 propuesta)
│   ├── Permisos/                 ← municipales, ambientales, etc.
│   └── Pólizas/                  ← seguros vigentes
│
├── 04-Financiero/
│   ├── Estados Financieros/
│   │   ├── Mensuales/            ← 2026-03.pdf, 2026-04.pdf...
│   │   ├── Trimestrales/         ← 2026-Q1.pdf...
│   │   └── Anuales/              ← 2025.pdf, 2024.pdf...
│   ├── Balances/                 ← extracto contable formal del contador
│   ├── Cartolas Bancarias/       ← {YYYY-MM}_{banco}.pdf (ver §5)
│   ├── Facturas Emitidas/        ← {YYYY-MM-DD}_{folio}.pdf (ver §5)
│   ├── Facturas Recibidas/       ← {YYYY-MM-DD}_{rut}_{folio}.pdf (ver §5)
│   └── Boletas Honorarios/       ← {YYYY-MM-DD}_{rut}_{folio}.pdf (ver §5)
│
├── 05-Proyectos & Avance/
│   ├── Roadmap.xlsx              ← REQUIRED para sync Gantt
│   ├── Hitos/                    ← PDFs de soporte por hito
│   ├── Reportes Avance/          ← reporte mensual del PM
│   ├── Riesgos/                  ← matriz riesgo
│   └── OKRs/                     ← OKRs trimestrales
│
├── 06-Reuniones/
│   ├── Actas/
│   │   ├── Directorio/           ← actas mensuales del directorio
│   │   ├── Comité/               ← comités específicos
│   │   └── 1on1/                 ← 1-on-1 con Nicolás / Guido
│   ├── Notas/                    ← notas crudas
│   └── Grabaciones/              ← mp4/m4a Zoom/Meet
│
├── 07-Reportes Generados/        ← output de la app (auto)
└── 08-AI Knowledge Base/         ← markdown que el AI puede consumir
```

### Para 02-Fondo (FIP CEHTA)/

```
02-Fondo (FIP CEHTA)/
├── Inversionistas LPs/
│   ├── {LP_Name}/                ← uno por inversionista
│   │   ├── Contrato Suscripción.pdf
│   │   ├── KYC.pdf
│   │   ├── Side Letter.pdf
│   │   ├── Recibos Aporte/
│   │   ├── W-8 o W-9.pdf
│   │   └── Pasaporte/RUT.pdf
├── Comité Inversión/             ← actas del CI (los archivos vienen de fondo_actas)
├── Reglamento/                   ← reglamento interno + sus modificaciones
├── Manual UAF/
├── Código Ética/
├── Memorias/                     ← memorias anuales públicas
├── Reportes Consolidados/        ← output (la app deposita acá)
└── Vouchers/                     ← gestionado 100% por la app, no tocar manual
    └── {empresa}/{año}/{codigo}/
```

### Para 03-Búsqueda de Capital/

```
03-Búsqueda de Capital/
├── LPs Potenciales/              ← un PDF por LP
├── Bancos/                       ← ofertas crédito, financiamiento bancario
├── Estado/
│   ├── CORFO/                    ← contratos, rendiciones
│   └── ANID/                     ← becas, fondos investigación
└── Family Offices/               ← propuestas, NDAs
```

---

## 3. Convenciones de naming críticas

La app es estricta con algunos patrones. Si no se respetan, el archivo NO se sincroniza.

| Carpeta/archivo | Patrón obligatorio | Ejemplo válido | Ejemplo inválido |
|---|---|---|---|
| Trabajador (folder) | `{RUT} - {Nombre}` | `12.345.678-9 - Juan Pérez` | `Juan Pérez 12345678-9` |
| Trabajador inactivo | `{RUT} - {Nombre} (egreso YYYY-MM-DD)` | `12.345.678-9 - Juan Pérez (egreso 2026-04-15)` | `12.345.678-9 - Juan Pérez egreso 15-04-2026` |
| F29 | `YYYY-MM.pdf` | `2026-03.pdf` | `F29 marzo 2026.pdf` |
| EEFF mensual | `YYYY-MM.pdf` | `2026-03.pdf` | `EEFF marzo.pdf` |
| EEFF trimestral | `YYYY-Q{1-4}.pdf` o `YYYY-T{1-4}.pdf` | `2026-Q1.pdf` | `Q1 2026.pdf` |
| EEFF semestral | `YYYY-S{1-2}.pdf` | `2026-S1.pdf` | `1er Semestre 2026.pdf` |
| EEFF anual | `YYYY.pdf` | `2025.pdf` | `EEFF 2025.pdf` |
| Documento legal | Cualquiera, idealmente con fecha `YYYY-MM-DD_*.pdf` | `2026-03-15_Contrato_Acme.pdf` | `Contrato.pdf` |

---

## 4. Carpetas que SOBRAN (se pueden borrar sin riesgo)

Si encontrás estas, son legacy y la app no las usa:
- Cualquier `Antiguos/`, `Old/`, `Backup/` dentro de `01-Empresas/`
- `Misc/` o `Sin Clasificar/` — mover el contenido a la categoría correcta antes de borrar
- Carpetas vacías (la app igual las skipea, pero ensucian el árbol)

---

## 5. Oportunidades de extender la sync (próximos sprints)

Las carpetas marcadas 🔴 que conviene activar:

### 5.1 Cartolas Bancarias → conciliación automática
- Path: `01-Empresas/{COD}/04-Financiero/Cartolas Bancarias/{YYYY-MM}_{banco}.pdf`
- Plan: `dropbox_sync_service.sync_cartolas(empresa)` que lee PDFs, OCR + parser, inserta en `core.movimientos` para alimentar `/admin/conciliacion`.
- ROI: elimina el upload manual de cartolas. Cada empresa suele tener 1-3 bancos, 12 meses/año = 12-36 PDFs/año/empresa × 9 = ~300/año.

### 5.2 Facturas Emitidas/Recibidas → vouchers auto-pre-llenados
- Path: `01-Empresas/{COD}/04-Financiero/Facturas {Emitidas|Recibidas}/{YYYY-MM-DD}_{folio}.pdf`
- Plan: AI Document Analyzer (`document_analyzer_service.py`) parsea folio, monto, RUT, fecha → crea voucher draft tipo COMPRA/VENTA listo para revisar.
- ROI: ahorra el data-entry manual del módulo V5 Vouchers. Cada factura toma ~3min escribir; pasa a 30s revisar.

### 5.3 Boletas Honorarios → vouchers COMPRA por servicios independientes
- Mismo patrón que facturas pero con `tipo='boleta_honorarios'` en clasificación.

### 5.4 F22 (declaración anual) → módulo F22 análogo a F29
- Path: `01-Empresas/{COD}/03-Legal/Declaraciones SII/F22/{YYYY}.pdf`
- Plan: tabla `core.f22_obligaciones` con calendario abril cada año, alerta cuando se acerca el plazo.
- ROI: 1 vez al año pero crítico — multas de SII por no presentar.

### 5.5 06-Reuniones → contexto para Secretaria AI
- Plan: `ai_indexing_service` lee actas de directorio + notas y las indexa para que `secretaria_ai_service` pueda contestar "qué se decidió en el último directorio de TRONGKAI".

### 5.6 08-AI Knowledge Base → contexto adicional
- Plan: markdown de operación de cada empresa que el AI puede leer. Ej: `08-AI Knowledge Base/contexto.md` con info de modelo de negocio, key people, riesgos. El chat de la app (`/ai`) lo trae como context primario.

---

## 6. Checklist concreta para Nicolás (próximas 2 semanas)

- [ ] Para cada una de las 9 empresas, validar que existan las carpetas en negro (✅ App sync) de la tabla.
- [ ] Asegurar que las F29 estén en `YYYY-MM.pdf` exacto (no `F29-marzo-2026.pdf`).
- [ ] Crear las carpetas 🟡 que tengan sentido por empresa (Procesos Selección, Templates, Hitos, OKRs, Riesgos).
- [ ] Crear las carpetas 🔴 marcadas como "valioso" (Cartolas Bancarias, Facturas Emitidas/Recibidas, Boletas Honorarios) aunque la app no las lea aún — vamos a activarlas en el próximo sprint.
- [ ] Asegurar que `02-Fondo (FIP CEHTA)/Inversionistas LPs/{LP_Name}/` exista con la subestructura para los LPs ya firmados.
- [ ] Mover cualquier `Misc/` o `Sin Clasificar/` que encuentres a la categoría que corresponda.

---

## 7. Comandos para sincronizar después de organizar

Cuando termines de mover las carpetas, correr estos sync por empresa:

```
POST /api/v1/trabajadores/sync-dropbox/{COD}
POST /api/v1/legal/sync-dropbox/{COD}
POST /api/v1/f29/sync-dropbox/{COD}
POST /api/v1/estados-financieros/sync-dropbox/{COD}
```

O desde la UI: `/admin/etl` → botón "Ejecutar ETL" hace todo en cascada.

---

**Última actualización**: 2026-05-04 (V5 + V5+ inbox)
