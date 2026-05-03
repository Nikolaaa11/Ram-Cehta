# 🔥 MEGA PROMPT — Extracción KB multi-archivo con reconciliación

> **Para usar cuando:** tenés VARIOS documentos de una empresa (brochure + teaser + 2 briefs + organigrama + estados financieros) y querés que la AI los lea TODOS, **detecte contradicciones**, y produzca un Knowledge Base **consolidado y consistente**.
>
> **Output:** los 5+ markdowns del KB de una empresa, con datos cruzados y trazabilidad multi-fuente.
>
> **Tiempo estimado:** 30-45 min (la AI procesa 4-8 archivos en paralelo).

---

## El prompt (copiar y pegar)

```
Sos un knowledge engineer SENIOR + investigador de inteligencia
competitiva trabajando para Cehta Capital (FIP CEHTA ESG, fondo de
inversión chileno). Tu tarea no es solo extraer datos — es ORQUESTAR
la lectura de múltiples fuentes, RECONCILIAR contradicciones entre
ellas, y entregar un Knowledge Base CONSISTENTE para que el AI Asistente
y el sistema de Informes LP citen información sin riesgo.

CONTEXTO DEL TRABAJO:

Empresa target: {EMPRESA_CODIGO} (ej: RHO, EVOQUE, REVTECH, DTE, TRONGKAI)

Documentos que voy a pasarte (en este orden):
{LISTA_DOCS}
Ej:
  1. Teaser Rho Generación.pdf — pitch comercial para LPs
  2. Brochure.pptx (exportado a PDF) — institucional general
  3. Brief - Panimávida.pptx — proyecto RHO0001
  4. Brief - La Ligua.pptx — proyecto RHO0002
  5. Organigrama.pptx + Organigrama_RHO_CORPORATIVO.pptx
  6. Vigencia Sociedad.pdf, Vigencia Poder.pdf, Certificado Capital.pdf

Datos previos del KB que ya tenemos (para que detectes drift y updates):
{KB_ACTUAL_RESUMIDO}
Ej: capacidad nominal Panimávida 3 MW (Gantt), encargado Javier Álvarez,
12 proyectos en cartera, etc.

TU MISIÓN:

Producir un set de 5-N markdowns para el KB de esta empresa:
- 08-AI Knowledge Base/company_overview.md
- 08-AI Knowledge Base/financial_context.md
- 08-AI Knowledge Base/strategic_priorities.md
- 08-AI Knowledge Base/projects/{CODIGO_PROYECTO}.md (uno por proyecto)
- 08-AI Knowledge Base/people/{nombre-apellido}.md (uno por directivo
  encontrado en organigramas)
- 08-AI Knowledge Base/_changelog.md (qué cambió desde el KB previo)
- 08-AI Knowledge Base/_inconsistencias.md (alertas para el GP)

REGLAS NO NEGOCIABLES — además de las del SUPER PROMPT, sumás:

9. CRUCE DE FUENTES OBLIGATORIO. Cada dato cuantitativo (MW, CAPEX,
   fechas, cargos) debe verificarse en al menos 2 documentos si existen.
   Si solo aparece en 1, marcar confianza="media" y citar única fuente.

10. RECONCILIAR CONTRADICCIONES. Si Brochure dice "5 MW" y Brief dice
    "3 MW" para el mismo proyecto:
    a. NO elegir un valor.
    b. Levantar alerta en `_inconsistencias.md`.
    c. En el KB, escribir el valor con MAYOR confianza
       (más reciente / más detallado / fuente operativa) y citar la
       discrepancia: "3 MW (según Brief - Panimávida.pptx slide 3,
       fecha 2026-04-13). NOTA: Brochure.pptx slide 8 indica 5 MW —
       diferencia probable por escalamiento posterior. Validar con GP."

11. TIMESTAMPING. Cada fuente con fecha de emisión visible. Si dos
    documentos contradicen, el más reciente prevalece DEFAULT a menos
    que tenga señales de copia/plantilla obsoleta.

12. PRIORIZACIÓN DE FUENTES (orden de confianza descendente):
    a. Documentos institucionales firmados (Certificado Capital,
       Vigencia Sociedad) — verdad legal absoluta
    b. Estados financieros auditados — verdad financiera
    c. Briefs de proyecto — verdad técnica reciente
    d. Gantt master importado — verdad operativa al momento del import
    e. Brochure — material comercial (puede tener round numbers)
    f. Teaser — material de marketing (acepta rangos genéricos)
    g. Organigrama — verdad organizacional (puede estar desactualizado)

13. PERSONAS COMO ENTIDADES. Si encuentro 3 menciones a "Javier Álvarez"
    (en Gantt, Brief, y Organigrama), creo UN archivo
    people/javier-alvarez.md con todas sus referencias cruzadas, no
    repito en cada archivo.

14. PROYECTOS COMO ENTIDADES. Mismo principio: un archivo
    projects/{CODIGO}.md por proyecto, referenciado desde
    company_overview.md y strategic_priorities.md.

15. CHANGELOG. _changelog.md detalla qué se agregó / qué cambió / qué
    se sacó respecto al KB previo. Formato:
      ## 2026-05-03 — actualización desde 6 documentos
      ### Agregado
      - projects/RHO0001-panimavida.md: CAPEX confirmado $4.2B (Brief slide 12)
      - people/javier-alvarez.md: cargo "Líder Acceso Abierto" (Organigrama slide 4)
      ### Cambiado
      - company_overview.md: capacidad RHO0001 actualizada de 3 MW (estimación) a 3 MW + 1 MWh BESS (confirmado Brief slide 5)
      ### Removido
      - financial_context.md: el placeholder "Banco probable Estado o Santander" — se confirma Banco Estado (Cartola enero slide 1)
      ### Inconsistencias detectadas
      - 1 conflicto en MW de Panimávida (ver _inconsistencias.md #1)

16. INCONSISTENCIAS COMO TICKETS. _inconsistencias.md formato:
      ### #1 — Capacidad Panimávida
      Fuentes en conflicto:
        - Brochure.pptx slide 8: "5 MW de capacidad instalada"
        - Brief - Panimávida.pptx slide 3: "3 MW solar + 1 MWh BESS"
      Hipótesis: Brochure usa cifra agregada (gen + BESS); Brief desagrega.
      Acción sugerida: confirmar con Javier Álvarez / Camilo si la
      capacidad oficial a comunicar es 3 MW (gen) o 4 MW (gen+BESS).
      Estado: 🔴 abierta
      Asignado a: GP / Operativo
      Vence: 2026-05-10

PROCESO QUE SEGUÍS:

Paso 1 — Inventariar documentos
Listar todos los archivos recibidos con: nombre, fecha emisión (si visible),
páginas, tipo de contenido detectado. Output preliminar:
  ## Inventario
  | # | Archivo | Fecha | Páginas | Tipo |
  | 1 | Teaser RHO.pdf | 2026-04 | 12 | comercial |
  ...

Paso 2 — Lectura paralela + indexación interna
Para cada archivo, extraés todos los hechos en una tabla interna
(no la mostrás aún):
  | hecho | valor | unidad | fuente | página | confianza |
  | "capacidad RHO0001" | 3 | MW | Brief Panimávida | 3 | alta |
  | "capacidad RHO0001" | 5 | MW | Brochure | 8 | media |
  | "encargado RHO0001" | "Javier Álvarez" | nombre | Gantt | hoja | alta |
  | "encargado RHO0001" | "Javier A." | nombre | Brief | 14 | alta |

Paso 3 — Reconciliación
Agrupás por hecho. Si hay >1 valor distinto:
  → si son nominalmente iguales (Javier Álvarez vs Javier A.) → fusionás
  → si son numéricamente distintos (3 MW vs 5 MW) → flag inconsistencia
  → si son temporalmente progresivos (estado "en planificación" en doc viejo,
     "en construcción" en doc reciente) → tomás el más reciente

Paso 4 — Construcción de archivos KB
En el orden:
  1. people/*.md primero (las personas son referenciadas por todo lo demás)
  2. projects/*.md (referencian personas)
  3. financial_context.md (referencia personas + datos legales)
  4. strategic_priorities.md (referencia projects + people)
  5. company_overview.md (índice de todo lo anterior)
  6. _changelog.md
  7. _inconsistencias.md

Paso 5 — Quality gates
Antes de entregar, validás internamente:
  - ¿Hay datos sin fuente? → ninguno debería pasar.
  - ¿Hay inconsistencias sin levantar? → buscar contradicciones implícitas.
  - ¿Las personas están normalizadas? (ej: no tener "J. Álvarez" y
    "Javier Álvarez" como dos personas distintas)
  - ¿Los códigos de proyecto son consistentes? (ej: RHO0001 vs RHO-1 vs RHO 0001)

OUTPUT FINAL:

Entregame los archivos en este formato secuencial:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ARCHIVO 1/N: people/javier-alvarez.md
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {contenido markdown completo}

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ARCHIVO 2/N: projects/RHO0001-panimavida.md
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {contenido markdown completo}

  ... etc

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ARCHIVO N/N: _inconsistencias.md
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {contenido markdown completo}

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RESUMEN DE LA EXTRACCIÓN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  - Documentos procesados: N
  - Hechos extraídos: N
  - Personas identificadas: N
  - Proyectos identificados: N
  - Inconsistencias detectadas: N (de las cuales N son críticas)
  - Datos faltantes que requieren input humano: N

  ## Top 5 datos más importantes que SÍ confirmaste
  ...

  ## Top 3 inconsistencias que requieren acción del GP
  ...

  ## Estimación de tiempo de revisión humana: N min

ARRANCÁ cuando recibas todos los archivos. Si algún archivo no se puede
leer (formato corrupto, password protected), lo flag-eás y seguís con
los demás.
```

---

## Cómo usar el MEGA prompt

### 1) Preparación

Recolectá TODOS los documentos disponibles de la empresa target:
- Brochure / Teaser
- Briefs por proyecto
- Organigramas
- Documentos institucionales (Vigencia, Capital, Inscripción)
- Estados financieros si los hay (PDF)

Si tenés `.pptx`, **exportá a PDF primero** — Claude lee PDFs mucho mejor.

### 2) Ejecutar

Pegale el MEGA prompt a Claude (o tu AI), llenando las variables:
- `{EMPRESA_CODIGO}`: `RHO`
- `{LISTA_DOCS}`: lista numerada de los 6-10 docs
- `{KB_ACTUAL_RESUMIDO}`: copia el contenido actual de los .md (si ya existen)

Adjuntá los PDFs a la conversación.

### 3) Revisar `_inconsistencias.md` PRIMERO

Antes de aceptar el output, abrí ese archivo y resolvé los conflictos con el operativo / Camilo. Cada inconsistencia debería tener una decisión humana antes de cerrar el ciclo.

### 4) Pegar archivos al KB

Para cada archivo en el output:
1. Abrir el archivo destino en Dropbox `08-AI Knowledge Base/...`
2. Reemplazar contenido con el output (o mergear si hay info que vale la pena preservar)
3. Pasar a Markdown puro (sin formato extraño)

### 5) Reindexar

```
/empresa/{cod}/asistente → "Reindexar KB"
```

### 6) Test de regresión

Hacele al AI Asistente 5 preguntas de las que ya conocés la respuesta:
- "¿Cuántos MW tiene Panimávida?"
- "¿Quién maneja el proyecto Codegua?"
- "¿Cuándo fue la última actualización del KB?"

Si responde con datos correctos + cita fuente → KB sano.

---

## Cuándo NO usar este prompt

- **1 solo archivo:** SUPER PROMPT es más rápido.
- **Mantenimiento continuo:** ULTRA-MEGA prompt + automatización.
- **Datos vivos** (no documentos): conectá las queries a la DB directo, no pases por el KB.

---

**Última actualización:** 2026-05-03 — V1 del MEGA PROMPT.
