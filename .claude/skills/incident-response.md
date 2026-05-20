---
name: incident-response
description: Guía paso a paso para responder a incidentes en producción de Ram-Cehta. Sigue docs/RUNBOOK_INCIDENTES.md.
---

# Skill: Respuesta a Incidentes

Cuando el operador reporte un problema (500, página rota, dato incorrecto),
ejecutar este flujo.

## Paso 0: NO modificar nada antes de diagnosticar

Disciplina dura: el primer cambio sin entender la causa raíz amplifica el
problema. Diagnostico SIEMPRE primero.

## Paso 1: Identificar el síntoma

Preguntar (o leer del screenshot):

1. URL exacta donde se ve el error
2. HTTP status code (500 / 404 / 403 / blank screen)
3. Mensaje de error visible
4. Hora del incidente
5. Usuario afectado (admin / contador / GG / etc.)

## Paso 2: Verificar incidentes abiertos

```sql
SELECT * FROM core.system_incidents
WHERE status != 'RESOLVED'
ORDER BY detected_at DESC LIMIT 10;
```

Si el monitor cron (Round 126) ya detectó algo relacionado, **leer**
el `metrics` JSON y `title`.

## Paso 3: Triage por categoría

### Categoría: backend_down / backend_degraded
- `fly status -a cehta-backend`
- `fly logs -a cehta-backend --no-tail | Select -Last 50`
- Buscar: tracebacks, EMAXCONNSESSION, OOM kills
- Si hay deploy en curso: esperar
- Si no: ver §3 del RUNBOOK_INCIDENTES.md

### Categoría: backend_slow
- `GET /api/v1/health/perf` → ver db_pool_in_use vs db_pool_size
- Si cerca del límite: posible saturación → considerar migrar a transaction pooler
- Si DB rápida pero endpoint específico lento: profilear ese endpoint

### Categoría: vouchers_stuck
- Identificar quién es el firmante esperado
- Notificar al firmante con un email/Slack
- Si el firmante ya no está → reasignar rule

### Categoría: sii_gap
- ¿Falta sync RCV de algún mes?
- ¿Hay docs SII reales que la plataforma no tiene cargados?
- Acción: para cada gap, "Crear voucher desde DTE SII" (Round 121)

### Categoría: backup_stale
- Verificar `fly machine list -a cehta-backend` → existe machine
  `backup_cron`?
- Ver logs del último intento de backup
- Si falla por DB pool: esperar y reintentar
- Si falla por Dropbox auth: rotar token Dropbox

## Paso 4: Aplicar fix

**Cambios chicos (1 archivo, < 50 LOC)**:
- Hacer el cambio en una rama
- Test: `pytest tests/` + `tsc --noEmit`
- Commit con mensaje `fix(qa-roundNNN): descripcion`
- Deploy: `fly deploy --remote-only`
- Verificar /health 200

**Cambios grandes (multi-archivo, migración)**:
- Documentar en `scripts/sql/roundNNN_INSTRUCCIONES.md`
- Pedir review del operador antes de deploy
- Aplicar migración SQL manualmente en Supabase Studio
- Deploy
- Verificar incident automáticamente cerrado por monitor cron

## Paso 5: Cerrar el incidente

```sql
UPDATE core.system_incidents
SET status='RESOLVED', resolved_at=NOW(),
    resolution_notes='Round NNN: descripción del fix'
WHERE incident_id = X;
```

## Paso 6: Postmortem (si crítico)

Si el incidente fue SEVERITY='CRITICAL', escribir entrada en
`docs/RUNBOOK_INCIDENTES.md` §Histórico con:
- Fecha
- Síntoma
- Causa raíz
- Fix aplicado (round NNN)
- Prevención futura

## Patrones que indican algo grande

Si ves alguno, escalar inmediatamente:

- `scope.cross_tenant_attempt` (riesgo data leak)
- `credential_decrypt_failed` repetido (Fernet key comprometida?)
- Múltiples empresas con sync_status=FAILED en mismo período (SII caído?)
- Cartolas bancarias OCR con montos enormes inesperados
- Vouchers EXECUTED sin movimiento bancario asociado (¿se pagó realmente?)
