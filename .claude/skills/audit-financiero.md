---
name: audit-financiero
description: Auditoría completa del estado financiero/contable/tributario de las empresas del FIP CEHTA ESG. Devuelve un informe con hallazgos y acciones recomendadas.
---

# Skill: Auditoría Financiera Ram-Cehta

Cuando el operador invoque este skill, ejecutar la siguiente auditoría
contra producción y devolver un informe estructurado.

## Pre-requisito: leer

1. `docs/SUPER_PROMPT_MAESTRO.md` (los 22 invariantes son la base)
2. Estado actual de Fly + DB

## Auditoría (en orden)

### Sección 1: Infraestructura

- [ ] `GET /health` → status 200, response_ms < 2000ms
- [ ] `GET /api/v1/health/perf` → db_pool_size == 3, workers == 1
- [ ] Logs Fly últimas 24h: contar 5xx, EMAXCONNSESSION, tracebacks
- [ ] Backup más reciente <36h de antigüedad
- [ ] Última fila `core.system_health_checks` < 15 min (monitor cron vivo)

### Sección 2: Contabilidad

Por cada empresa activa:

- [ ] `SUM(debit) = SUM(credit)` en todos vouchers `status != 'DRAFT'`
- [ ] No hay vouchers DRAFT > 7 días sin actividad
- [ ] No hay vouchers PENDING > 5 días esperando firma
- [ ] Numeración `codigo` correlativa sin huecos por año/empresa

### Sección 3: Tributario SII

Por cada empresa:

- [ ] Sincronización SII del último mes hecha (`sii_sync_runs` con OK)
- [ ] Documentos SII sin voucher local del último mes (gap real)
- [ ] F29 estimado vs F29 declarado oficial (preguntar al operador)
- [ ] Vouchers COMPRA con `iva_credito_fiscal` correcto (no NULL)
- [ ] **Invariante E8**: ninguna línea `CORFO_SUBSIDIO` toca cuenta IVA

### Sección 4: Control interno

- [ ] Cada voucher APPROVED tiene 2+ firmas
- [ ] Ningún `approver_user_id` aparece 2 veces en mismo voucher
- [ ] Vouchers COMPRA/VENTA con `attachments.count >= 1`
- [ ] Vouchers `EXECUTED` tienen `fecha_ejecucion IS NOT NULL`

### Sección 5: Tesorería

- [ ] Cartolas bancarias bajadas del último mes
- [ ] Movimientos bancarios huérfanos (cartola sin voucher EXECUTED)
- [ ] Cuentas con saldo > 6 meses gastos operativos (caja ociosa)

### Sección 6: RRHH

- [ ] Trabajadores activos con liquidación del último mes
- [ ] Trabajadores con >2 períodos vacaciones acumuladas
- [ ] Contratos vencidos no renovados

### Sección 7: Seguridad

- [ ] `audit.scope_violations` últimos 7 días: count == 0
- [ ] `credential_decrypt_failed` logs últimos 7 días: count == 0
- [ ] Tokens API SII / Nubox con `ultima_validacion_ok = true`
- [ ] 2FA habilitado para todos los admin

## Formato del informe

```
# Auditoría Ram-Cehta · YYYY-MM-DD

## Resumen ejecutivo
[Estado general: ✅ Todo OK | ⚠️ N hallazgos menores | 🔴 M hallazgos críticos]

## Hallazgos críticos (acción inmediata)
1. [Categoría] descripción · Acción recomendada · Tiempo estimado

## Hallazgos warning (esta semana)
...

## Métricas
- Vouchers DRAFT > 7d: N
- Pendings > 5d: N
- DTE SII sin voucher: N
- Backup más reciente: hace Xh
- ...

## Recomendaciones de mejora
1. ...
```

## NO hacer

- NO modificar código durante la auditoría
- NO marcar incidentes como RESOLVED sin verificar con operador
- NO compartir credenciales descifradas en el informe
- Si un dato no se puede leer (timeout, permisos), **reportar** no inferir
