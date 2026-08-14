# Audits de pestañas · Ram-Cehta

Este índice registra los audits visuales hechos por el agente `ram-cehta-weekly-ux-audit` (corre los lunes 9:23am).

## Auditadas

| # | Página | Audit doc | Fecha | Status |
|---|---|---|---|---|
| 1 | `/admin/adopcion` | (mejorado en R152u + R152cc, sin audit formal) | 2026-05-31 | DONE |
| 2 | `/aprender` | (mejorado en R152v + R152aa, sin audit formal) | 2026-05-31 | DONE |
| 3 | `/admin/feedback` | (creado en R152dd) | 2026-05-31 | NEW |
| 4 | `/dashboard` | [AUDIT_dashboard_2026-07-06.md](AUDIT_dashboard_2026-07-06.md) | 2026-07-06 | AUDITED · 6 findings (1×P1, 2×P2, 3×P3) · **F1 resuelto 2026-08-14 (R152kk)** |
| 5 | `/aprobaciones` | [AUDIT_aprobaciones_2026-07-06.md](AUDIT_aprobaciones_2026-07-06.md) | 2026-07-06 | AUDITED · 7 findings (0×P1, 3×P2, 4×P3) |

## Pendientes de audit (en orden de prioridad)

1. `/vouchers` — Listado de vouchers (en mejora por agente R152hh)
2. `/transferencias` — Confirmar pagos (en mejora por agente R152ii)
3. `/action-center` — Centro de acción (en mejora por agente R152jj)
4. `/calendario` — Calendario unificado
5. `/asistente` — Asistente IA
6. `/cartas-gantt` — Gantts cross-empresa
7. `/empresa/[codigo]` — Detalle de empresa
8. `/compliance` — Compliance regulatorio
9. `/me` — Perfil de usuario
10. `/avance` — Avance del fondo

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
