---
name: cierre-mensual
description: Guía al operador paso a paso por el cierre contable mensual del FIP CEHTA ESG. Aplica las reglas del MAESTRO §3.3.
---

# Skill: Cierre Mensual Ram-Cehta

Acompañar al operador desde el día 1 al día 10 del mes siguiente al cierre.

## Pre-condiciones

- Mes a cerrar = mes anterior al actual
- Operador tiene scope admin
- SII no está en mantenimiento
- Nubox API operativa (o disponer del Libro de Remuneraciones manual)

## Pasos del cierre (preguntar uno a uno, no asumir)

### Día 1-3: Sincronización de data externa

**Paso 1.1: SII RCV por empresa**

Por cada una de las 9 empresas:
- ¿Sync RCV ejecutado para el período YYYY-MM? Verificar
  `SELECT * FROM core.sii_sync_runs WHERE empresa_codigo='X' AND periodo='YYYY-MM' ORDER BY started_at DESC LIMIT 1`
- Si no: ir a `/admin/sii`, click "Sync periodo" en esa empresa
- Si falla: bajar CSV manual del portal y subir en sección amber

**Paso 1.2: Conciliación SII ↔ vouchers**

Por cada empresa con sync OK:
- Click "Conciliar con vouchers" en `/admin/sii`
- Anotar count: `matched_exact` + `matched_fuzzy` + `unmatched`

**Paso 1.3: Nubox API (si está activado)**

Por cada empresa con credencial Nubox API:
- `POST /admin/nubox-api/sync-sales/{empresa}?periodo=YYYY-MM`
- Verificar `nubox_ventas.count` para ese período

**Paso 1.4: Libro de Remuneraciones**

Por cada empresa con trabajadores:
- Bajar `Libro de Remuneraciones` xlsx de Nubox web
- Subir en `/admin/nubox` → sección "Subir Excel"

### Día 4-7: Cuadrar y completar

**Paso 2.1: Gaps SII**

En `/admin/sii` → filtrar "Sin matchear":
- Para cada gap, click "Crear voucher" → se crea DRAFT precargado
- Editar las cuentas placeholder (`1-0-0-0`, `2-0-0-0`) con códigos reales
- Asignar `proyecto_codigo` + `area_codigo`
- Submit → flujo de aprobación normal

**Paso 2.2: Aprobaciones pendientes**

En `/aprobaciones`:
- Firmar lo que requiera tu firma
- Recordatorio: 2 firmas siempre (GG titular + DIRECTOR)

**Paso 2.3: Transferencias del mes**

En `/transferencias`:
- Filtrar APPROVED del período
- Descargar planilla en formato del banco (Santander/GENERICO)
- Subir al portal bancario
- Volver y marcar EXECUTED con fecha real

### Día 8-10: Cierre y declaración

**Paso 3.1: F29 estimado vs Nubox**

En `/admin/sii` con empresa+período seleccionados, mirar card F29:
- IVA débito (ventas)
- IVA crédito (compras)
- F29 a pagar
- Comparar con borrador F29 en SII oficial

**Paso 3.2: Cuadre con MCG Consultores**

- Generar export Nubox CSV desde Ram-Cehta
- Mandar a MCG
- Resolver diferencias antes de declarar

**Paso 3.3: Declarar F29 oficial**

- En sii.cl → Servicios online → F29
- Pegar valores ya validados
- Pagar (si saldo a pagar)
- Marcar el voucher de pago F29 como EXECUTED

**Paso 3.4: Previred (día 10 hábil)**

- Pago cotizaciones previsionales en previred.cl
- Voucher EGRESO Previred → EXECUTED

**Paso 3.5: Cerrar período**

`UPDATE core.periodo_cierre SET status='CLOSED', closed_at=NOW()
WHERE year=YYYY AND month=MM;`

## Validación final

Antes de marcar el cierre OK, verificar:

- [ ] Cada empresa tiene `sii_sync_runs.status='OK'` para el período
- [ ] Conciliación ejecutada en cada empresa
- [ ] 0 gaps "sin voucher" críticos (>$1M)
- [ ] F29 declarado y pagado
- [ ] Previred pagado
- [ ] Liquidaciones de sueldo emitidas y firmadas
- [ ] Backup DB de fin de mes archivado en Dropbox

**Frase de cierre**: "Todo cuadrado, todo trazable, todo respaldado."

Si no podés decir esa frase con sinceridad → no marcar CLOSED, escalar.
