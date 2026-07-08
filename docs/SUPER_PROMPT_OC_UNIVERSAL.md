# SUPER PROMPT — Órdenes de Compra universales (formato Panimávida) + creación conversacional

> **Objetivo del usuario (Nicolás):** "Las órdenes de compra tienen que ser con este diseño
> [los 3 PDFs Panimávida hechos en Word]. Que se puedan armar a través de un mensaje o
> conversación o mail. Las de las otras empresas: cambiar su logo y estilo."

## Contexto verificado (diagnóstico previo)

- **El diseño objetivo** (los PDFs `OC0028/OC0016/OC0029-PAN001`) es el formato **carta formal**:
  header con logo + Nro/Fecha/Moneda, dos bloques **PROVEEDOR | MANDANTE**, tabla itemizada
  (Ítem/Descripción/Un./Cant./P.Unit./Total), NETO + IVA 19% + TOTAL, notas de arbitraje,
  y hoja 2 de firmas. Esos PDFs se hicieron a mano en Word — son el "gold standard".
- **La plataforma YA replica ese diseño**: template `orden_compra_panimavida.html` (v2, WeasyPrint),
  **totalmente parametrizado** por empresa (color, logo, razón social, giro, RUT, firmantes).
- **PERO solo está activado en RHO** (`empresas.oc_template = 'panimavida'`). Las otras 9 empresas
  usan `orden_compra.html` (grid institucional distinto).
- **Todas las empresas tienen el mismo color** `#236C4F` en BD (aunque el código tiene una paleta
  distinta por empresa como fallback). Todas tienen logo cargado.
- **Los flujos de creación ya existen**: `/ordenes-compra/nueva` (manual),
  `/ordenes-compra/desde-mensaje` (pega texto → IA arma OC), `/ordenes-compra/importar`
  (archivo/foto → IA), y `auto_create_oc_from_inbox.py` (email → OC automática).
- **Renderer**: `oc_pdf_renderer` (secret `OC_PDF_RENDERER` en Fly). v2 = WeasyPrint (necesario
  para el diseño Panimávida). v1 = reportlab (viejo).

## Tareas

### 1. Diseño Panimávida = estándar universal
- En `oc_pdf_v2_service.py`, invertir la selección de template: **panimavida es el default**;
  `orden_compra.html` queda solo si `oc_template == 'legacy'` explícito.
- En BD, setear `oc_template = 'panimavida'` para las 10 empresas (explícito y reversible).
- Garantizar renderer v2 en producción (`OC_PDF_RENDERER=v2` + default de código a v2).

### 2. Branding por empresa (logo + estilo)
- Asignar un `oc_color_primario` **distinto y profesional por empresa** (paleta curada).
- Verificar que cada empresa tenga logo correcto (los 10 archivos ya existen).
- Garantizar `oc_firmantes` o `gerente_general_nombre` por empresa (para que la hoja de firmas
  muestre el firmante de la empresa, no solo el del proveedor).

### 3. Creación por mensaje / conversación / mail
- Verificar que `/ordenes-compra/desde-mensaje` (texto → OC) funcione end-to-end y genere el
  diseño nuevo. Hacerla más visible/accesible.
- Verificar el flujo email → OC automática (`auto_create_oc_from_inbox`) y que use el PDF v2.

### 4. Verificación
- Renderizar una OC de muestra para **cada una de las 10 empresas** y confirmar: diseño Panimávida,
  logo correcto, color propio, MANDANTE = la empresa, sin errores.
- Deploy backend (Fly) + commit. Smoke test en producción.

## Invariantes a respetar
- Multi-tenant: scope por empresa en todos los endpoints de OC.
- No romper RHO (que ya funciona con este formato).
- Reversible: cada empresa puede volver a `legacy` si quisiera.
