# 📂 Guía Dropbox para el equipo Cehta Capital

> **Para:** todo el equipo que va a subir documentos al Dropbox de Cehta Capital
> **Objetivo:** que la plataforma cargue automáticamente toda la información que suban
> **Tiempo estimado de lectura:** 10 minutos
> **Versión:** Abril 2026

---

## 🎯 ¿Por qué importa la estructura?

La plataforma de Cehta Capital **lee Dropbox automáticamente** y crea registros en la base de datos: trabajadores, contratos, F29, etc. Para que esto funcione, los archivos tienen que estar en la **carpeta correcta** y con el **nombre correcto**.

**Si subís bien:** click en "Sincronizar Dropbox" en la plataforma → todo aparece automáticamente.
**Si subís mal:** la plataforma no encuentra el archivo y queda fuera del sistema.

---

## 🌳 Estructura general de carpetas

Toda la información vive bajo **`/Cehta Capital/`** en Dropbox. Cada empresa del portafolio tiene su propia carpeta con la misma estructura interna:

```
📁 Cehta Capital/
├── 📁 01-Empresas/
│   ├── 📁 CENERGY/
│   │   ├── 📁 01-General/
│   │   ├── 📁 02-Trabajadores/
│   │   │   ├── 📁 Activos/
│   │   │   └── 📁 Inactivos/
│   │   ├── 📁 03-Legal/
│   │   │   ├── 📁 Contratos/
│   │   │   ├── 📁 Actas/
│   │   │   ├── 📁 Estatutos/
│   │   │   ├── 📁 Polizas/
│   │   │   ├── 📁 Permisos/
│   │   │   └── 📁 Declaraciones SII/
│   │   │       └── 📁 F29/
│   │   ├── 📁 04-Bancos/
│   │   ├── 📁 05-Proveedores/
│   │   └── 📁 06-OCs/
│   ├── 📁 RHO/
│   │   └── (misma estructura)
│   ├── 📁 CSL/
│   ├── 📁 TRONGKAI/
│   ├── 📁 REVTECH/
│   ├── 📁 DTE/
│   ├── 📁 EVOQUE/
│   ├── 📁 AFIS/
│   └── 📁 FIP_CEHTA/
│
└── 📁 02-Inteligencia Negocios/
    └── 📄 Consolida bbdd 2.xlsx   ← (Excel madre, lo lee el ETL)
```

> ⚠️ **IMPORTANTE — Nombres EXACTOS:**
> - Las carpetas de empresa van en **MAYÚSCULAS** sin tildes ni espacios: `CENERGY`, `RHO`, `TRONGKAI` (no "Cenergy", no "Rho Generación")
> - La estructura `01-Empresas`, `02-Trabajadores`, `03-Legal` se respeta literal con los números delante
> - Las subcarpetas Activos / Inactivos / Contratos / Actas / etc. con la primera letra mayúscula

---

# 📋 Cómo subir cada tipo de documento

## 1️⃣ TRABAJADORES (contratos, finiquitos, fichas)

### 📍 Dónde va

```
/Cehta Capital/01-Empresas/[CODIGO_EMPRESA]/02-Trabajadores/Activos/[RUT - NOMBRE COMPLETO]/
```

### 📝 Reglas del nombre de la carpeta del trabajador

La carpeta del trabajador se llama: `RUT - NOMBRE COMPLETO`

✅ **Bien:**
- `12.345.678-9 - Juan Pérez González`
- `8.765.432-1 - María José López Soto`
- `9.876.543-K - Pedro Soto Vergara`

❌ **Mal:**
- `juanperez` (falta RUT y mayúsculas)
- `Juan Pérez 12345678-9` (orden invertido, RUT sin formato)
- `12345678-9 Juan` (falta el guión separador y nombre completo)

### 📄 Qué archivos van adentro

Dentro de la carpeta de cada trabajador podés subir cualquier archivo PDF/imagen relevante:
- `contrato_laboral.pdf`
- `anexo_contrato.pdf`
- `ficha_personal.pdf`
- `liquidacion_sueldo_2025_06.pdf`
- `finiquito.pdf` (cuando egresa)

### 🔄 ¿Y los que ya no trabajan?

Cuando un trabajador egresa, la plataforma automáticamente mueve su carpeta de `Activos/` a `Inactivos/`. **No la muevas vos a mano** — usá el dialog "Marcar como inactivo" en `/empresa/[codigo]/trabajadores`.

### 📸 Paso a paso para tu equipo

**Ejemplo: agregar a "Roberto Muñoz Salinas" (RUT 14.567.890-3) a CENERGY**

1. Abrir Dropbox web o desktop
2. Navegar a `Cehta Capital → 01-Empresas → CENERGY → 02-Trabajadores → Activos`
3. Click derecho → **"Nueva carpeta"**
4. Escribir el nombre **exacto**: `14.567.890-3 - Roberto Muñoz Salinas`
5. Entrar a esa carpeta
6. Arrastrar todos los PDFs del trabajador (contrato, ficha, anexos)
7. Esperar a que sincronice Dropbox (verde el ícono)

### ✅ Cómo activar el sync en la plataforma

1. Andar a **`https://[tu-plataforma]/empresa/CENERGY/trabajadores`**
2. Arriba a la derecha, click en **"Sincronizar Dropbox"**
3. Toast verde: *"3 trabajadores nuevos, 5 docs sincronizados"*
4. La lista se actualiza inmediatamente

---

## 2️⃣ DOCUMENTOS LEGALES (contratos, actas, pólizas)

### 📍 Dónde va

```
/Cehta Capital/01-Empresas/[CODIGO]/03-Legal/[CATEGORÍA]/[archivo]
```

### 🗂️ Categorías válidas (subcarpetas dentro de 03-Legal)

| Subcarpeta | Qué va ahí |
|---|---|
| **Contratos/** | Contratos comerciales, arriendos, leasing, prestación de servicios |
| **Actas/** | Actas de directorio, juntas, comités |
| **Estatutos/** | Estatutos sociales, reformas, escrituras |
| **Polizas/** | Pólizas de seguro de cualquier tipo |
| **Permisos/** | Permisos municipales, sectoriales, sanitarios |
| **Declaraciones SII/** | Documentos tributarios SII (F22 anual, certificados) |

> **NOTA:** F29 mensuales tienen su propia subcarpeta — ver sección 3.

### 📝 Reglas del nombre del archivo

El nombre debe ser **descriptivo** y, si aplica, contener la **fecha** o **período**:

✅ **Bien:**
- `contrato-arriendo-oficina-2025-2027.pdf`
- `acta-directorio-2025-06-15.pdf`
- `poliza-incendio-vigente-2025.pdf`
- `estatuto-modificacion-2024-11.pdf`

❌ **Mal:**
- `documento.pdf` (sin descripción)
- `IMG_20250615_123456.pdf` (nombre de scan crudo)
- `Untitled.pdf` (sin contexto)

### 🎁 Bonus: Auto-fill con AI

Cuando subís un documento legal a la plataforma vía el botón "Subir documento" en `/empresa/[codigo]/legal`, **la AI lee el PDF y prellena automáticamente** los campos:
- Contraparte
- Fecha de vigencia desde / hasta
- Monto + moneda
- Categoría detectada
- Descripción

Solo confirmás y guardás. **Si el PDF es escaneado** (no digital), la AI igual usa OCR para extraer texto.

### 📸 Paso a paso

**Ejemplo: subir el contrato de arriendo de la oficina de RHO**

1. Dropbox: `Cehta Capital → 01-Empresas → RHO → 03-Legal → Contratos`
2. Arrastrar `contrato-arriendo-oficina-2025.pdf`
3. Plataforma: `/empresa/RHO/legal` → "Sincronizar Dropbox"
4. Aparece el documento con metadata vacía
5. Click "Editar" → la AI ya prellenó los campos → revisás y guardás

---

## 3️⃣ F29 MENSUALES (declaración tributaria SII)

### 📍 Dónde va

```
/Cehta Capital/01-Empresas/[CODIGO]/03-Legal/Declaraciones SII/F29/[YYYY-MM].pdf
```

### 📝 Regla del nombre — CRÍTICA

El archivo se llama **`YYYY-MM.pdf`** (año-mes con guión, formato ISO):

✅ **Bien:**
- `2025-01.pdf` (enero 2025)
- `2025-06.pdf` (junio 2025)
- `2025-12.pdf` (diciembre 2025)

❌ **Mal:**
- `enero-2025.pdf` (mes en texto)
- `2025_01.pdf` (underscore en vez de guión)
- `F29_enero.pdf` (con prefijo y sin año)
- `25-01.pdf` (año de 2 dígitos)

### 📋 Qué meter en el PDF

El archivo PDF de cada mes debe contener:
- F29 emitido por el SII (descarga del portal SII)
- Idealmente página 1 con datos básicos: período, monto a pagar, fecha vencimiento
- Si no la tenés digitalizada, scan a PDF (OCR no es necesario — la plataforma extrae con AI)

### 🔄 Cómo cargar todas las F29 históricas de una empresa

**Si tenés F29 de varios meses** (digamos, enero a junio 2025 de TRONGKAI):

1. En Dropbox crear carpeta `2025/` no necesario — todos los `.pdf` van directos en `F29/`
2. Subí los 6 archivos de una vez:
   - `2025-01.pdf`
   - `2025-02.pdf`
   - `2025-03.pdf`
   - `2025-04.pdf`
   - `2025-05.pdf`
   - `2025-06.pdf`
3. Plataforma: `/f29` → filtrar por empresa **TRONGKAI** → "Sincronizar Dropbox"
4. Toast: *"6 F29 nuevas"*
5. La plataforma calcula automáticamente:
   - Período: `01-25`, `02-25`, etc.
   - Fecha de vencimiento: día 12 del mes siguiente
   - Estado inicial: `pendiente`

### 📸 Caso práctico

**"Tenemos los F29 de CENERGY del año pasado en una carpeta suelta — ¿cómo los subo?"**

1. En tu computadora, renombrá cada PDF al formato `YYYY-MM.pdf`:
   - `F29 enero 2024 cenergy.pdf` → `2024-01.pdf`
   - `F29 febrero 2024 cenergy.pdf` → `2024-02.pdf`
   - etc.
2. Subir los 12 archivos a `Cehta Capital → 01-Empresas → CENERGY → 03-Legal → Declaraciones SII → F29/`
3. En la plataforma: `/f29` → filtrar **CENERGY** → "Sincronizar Dropbox"
4. Listo: 12 F29 cargadas, te dice cuáles están vencidas, cuáles pagadas, etc.

---

## 4️⃣ EXCEL MADRE — DATOS FINANCIEROS (movimientos)

Esto **NO va en `/01-Empresas/`** — va aparte porque es transversal a todas las empresas.

### 📍 Dónde va

```
/Cehta Capital/02-Inteligencia Negocios/Consolida bbdd 2.xlsx
```

### 📝 Reglas

- **Una sola hoja** llamada `CONSOLIDA` con todos los movimientos consolidados
- Headers en la fila 1, datos a partir de fila 2
- Columnas esperadas (en cualquier orden, la plataforma matchea por nombre):
  - `Fecha`, `Descripción`, `Abono`, `Egreso`, `Saldo Contable`, `Empresa`, `Concepto General`, `Concepto Detallado`, `Tipo Egreso`, `Fuente`, `Proyecto`, `Banco`, `Real/Proyectado`, `Año`, `Período`, `Tipo Documento`, `Número Documento`, `Hyper-Vinculo`

### 🔄 ¿Cómo se sincroniza?

A diferencia de los otros, este se carga vía **ETL automático** que corre cada 30 minutos. Cuando actualizás el Excel:

1. Subir/reemplazar el archivo en Dropbox
2. **Esperar 30 minutos** → ETL automático corre
3. **O forzarlo manual:** plataforma → `/admin/etl-runs` → botón "Re-correr ETL"
4. La plataforma carga ~2.700 filas en BD para alimentar todos los dashboards

### ⚠️ Cuidado con

- **No renombrar** la hoja CONSOLIDA
- **No cambiar headers** sin avisarme antes (rompe el parser)
- **No dejar filas vacías** en medio (cortan el parser)
- **Empresas tienen que matchear** los códigos exactos (ya hay normalización para variantes: "Cenergy" → CENERGY, "C&E" → CENERGY, "Trongkai" → TRONGKAI)

---

## 5️⃣ DOCUMENTOS GENERALES DE EMPRESA (carpeta 01-General)

### 📍 Dónde va

```
/Cehta Capital/01-Empresas/[CODIGO]/01-General/
```

Esta carpeta es **libre** — puede tener:
- Logo de la empresa
- Memoria anual
- Pitch deck
- Información corporativa
- One-pagers
- Lo que el equipo necesite tener accesible

> ⚠️ Esta carpeta **NO se sincroniza automáticamente** a la plataforma. Es solo storage compartido. Si querés que un documento aparezca en la plataforma, va en `03-Legal/[categoría]/`.

---

## 6️⃣ FONDOS / PIPELINE DE CAPITAL

### 📍 Dónde va

```
/Cehta Capital/02-Inteligencia Negocios/Pipeline Fondos/
```

Acá van one-pagers, pitch decks, info de LPs/bancos/family offices con los que contactaste o vas a contactar.

### 🔄 Cómo sincronizar

Plataforma → `/fondos` → botón **"Importar desde Dropbox"** (solo admin) → escanea la carpeta y crea fondos faltantes.

---

# 🎯 Flujo recomendado para nuevos miembros del equipo

### Día 1 — Setup básico

1. Pedir acceso a la carpeta compartida `Cehta Capital/` en Dropbox
2. Instalar **Dropbox Desktop** (recomendado) — sincroniza más rápido que la web
3. Familiarizarse con la estructura de las 9 empresas

### Día 2 — Primera carga

1. **Si te asignaron una empresa** (digamos REVTECH):
   - Subir las **F29 del último año** a `01-Empresas/REVTECH/03-Legal/Declaraciones SII/F29/`
   - Subir los **contratos de trabajadores activos** a `02-Trabajadores/Activos/[RUT - NOMBRE]/`
   - Subir los **contratos comerciales vigentes** a `03-Legal/Contratos/`

2. Después de subir, abrir la plataforma y darle "Sincronizar Dropbox" a cada sección
3. **Validar** que todo apareció correctamente
4. Si algo falta, revisar el nombre del archivo/carpeta — el formato es lo más común que falla

### Semana 1 — Limpieza histórica

1. Buscar emails antiguos con F29, contratos, etc. de tu empresa asignada
2. Renombrar los PDFs al formato correcto
3. Subir todo en bloque
4. Sincronizar y validar

### Semana en curso — Mantenimiento

1. **Cuando llega un F29 nuevo:** descargar del SII, renombrar `YYYY-MM.pdf`, subir
2. **Cuando se firma un contrato:** subir a `Contratos/` con nombre descriptivo + fecha
3. **Cuando contratan a alguien:** crear carpeta `RUT - Nombre` en `Activos/`, subir contrato
4. **Cuando alguien renuncia:** desde la plataforma marcar como inactivo (la plataforma mueve la carpeta automáticamente)
5. **Cada lunes:** abrir `/action-center` en la plataforma → revisar pendientes de la semana

---

# ❌ Errores comunes que rompen el sync

| Error | Síntoma | Solución |
|---|---|---|
| Carpeta empresa con tildes / minúsculas | El sync no encuentra archivos de esa empresa | Renombrar a MAYÚSCULAS sin tildes |
| F29 con nombre `enero-2025.pdf` | F29 no aparece en la plataforma | Renombrar a `2025-01.pdf` |
| Trabajador con carpeta `Juan Perez` (sin RUT) | Trabajador no se crea | Renombrar a `12345678-9 - Juan Perez` |
| Contrato en `03-Legal/` directo (sin subcategoría) | Aparece pero sin categoría | Mover a `03-Legal/Contratos/` |
| Excel madre con hoja renombrada | ETL falla con 0 filas | Renombrar la hoja a `CONSOLIDA` |
| Subir desde web, no esperar a sincronizar | Falta archivos al disparar sync | Esperar a que el ícono Dropbox quede verde antes de "Sincronizar Dropbox" |

---

# 🆘 Si algo no aparece después de sincronizar

1. **Verificá el nombre exacto** de la carpeta y archivo (formato + mayúsculas + guiones)
2. **Esperá 30 segundos** y volvé a darle "Sincronizar Dropbox"
3. **Mirá en `/admin/audit`** si hay algún error de sync registrado
4. **Si nada funciona:** hablá con Nicolás con un screenshot de la carpeta de Dropbox + el toast/error que ves en la plataforma

---

# 📎 Resumen rápido (imprime esta hoja para tu equipo)

| ¿Qué subir? | ¿Dónde? | ¿Nombre del archivo? |
|---|---|---|
| Contrato de trabajador | `01-Empresas/[EMPRESA]/02-Trabajadores/Activos/[RUT - Nombre Completo]/` | Cualquier nombre descriptivo |
| F29 mensual | `01-Empresas/[EMPRESA]/03-Legal/Declaraciones SII/F29/` | `2025-06.pdf` (formato YYYY-MM) |
| Contrato comercial | `01-Empresas/[EMPRESA]/03-Legal/Contratos/` | `descriptivo-fecha.pdf` |
| Acta de directorio | `01-Empresas/[EMPRESA]/03-Legal/Actas/` | `acta-directorio-YYYY-MM-DD.pdf` |
| Póliza de seguro | `01-Empresas/[EMPRESA]/03-Legal/Polizas/` | `poliza-tipo-vigencia.pdf` |
| Permiso municipal | `01-Empresas/[EMPRESA]/03-Legal/Permisos/` | `permiso-tipo-fecha.pdf` |
| Excel madre con movimientos | `02-Inteligencia Negocios/` | `Consolida bbdd 2.xlsx` |
| Logo / pitch deck / one-pager | `01-Empresas/[EMPRESA]/01-General/` | Libre (no se sincroniza) |
| Pipeline de fondos | `02-Inteligencia Negocios/Pipeline Fondos/` | Libre |

---

# 🎬 Después de subir → activar el sync en la plataforma

| Sección | URL | Botón |
|---|---|---|
| Trabajadores de una empresa | `/empresa/[CODIGO]/trabajadores` | "Sincronizar Dropbox" arriba derecha |
| Documentos legales de una empresa | `/empresa/[CODIGO]/legal` | "Sincronizar Dropbox" arriba derecha |
| F29 de una empresa | `/f29` (filtrá por empresa) | "Sincronizar Dropbox" arriba derecha |
| Multi-recurso desde el header empresa | `/empresa/[CODIGO]` | Botón "Sincronizar Dropbox" → menú con sub-items |
| Excel madre (movimientos) | `/admin/etl-runs` | "Re-correr ETL" (o esperar 30 min al cron) |
| Pipeline de fondos | `/fondos` | "Importar desde Dropbox" |

---

**🟢 Cuando todo está OK:** el toast verde dice *"X nuevos, Y ya existentes"*.
**🟡 Cuando hay un error:** el toast amarillo te dice exactamente cuál archivo falló y por qué.

---

*Guía mantenida por Nicolás Rietta. Si encontrás algo que no está documentado, decime y lo agrego.*
