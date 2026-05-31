# Audits de pestañas · Ram-Cehta

Este índice registra los audits visuales hechos por el agente `ram-cehta-weekly-ux-audit` (corre los lunes 9:23am).

## Auditadas

| # | Página | Audit doc | Fecha | Status |
|---|---|---|---|---|
| 1 | `/admin/adopcion` | (mejorado en R152u + R152cc, sin audit formal) | 2026-05-31 | DONE |
| 2 | `/aprender` | (mejorado en R152v + R152aa, sin audit formal) | 2026-05-31 | DONE |
| 3 | `/admin/feedback` | (creado en R152dd) | 2026-05-31 | NEW |

## Pendientes de audit (en orden de prioridad)

1. `/dashboard` — Dashboard institucional principal
2. `/vouchers` — Listado de vouchers (en mejora por agente R152hh)
3. `/transferencias` — Confirmar pagos (en mejora por agente R152ii)
4. `/action-center` — Centro de acción (en mejora por agente R152jj)
5. `/aprobaciones` — Cola de firmas
6. `/calendario` — Calendario unificado
7. `/asistente` — Asistente IA
8. `/cartas-gantt` — Gantts cross-empresa
9. `/empresa/[codigo]` — Detalle de empresa
10. `/compliance` — Compliance regulatorio
11. `/me` — Perfil de usuario
12. `/avance` — Avance del fondo

## Formato del audit

Cada audit doc sigue este template:

```
# Audit: <pagina> · YYYY-MM-DD

## Findings

### F1 · <título> · P1
**Tipo**: bug | nice-to-have | accessibility | performance
**Esfuerzo**: S (1h) | M (4h) | L (1d)
**Severidad**: P1 (bloqueante) | P2 (importante) | P3 (mejora)

Descripción del finding.

Sugerencia de fix con snippet de código si aplica.

### F2 · ...
```
