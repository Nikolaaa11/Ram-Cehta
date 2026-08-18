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
| 6 | `/vouchers` | [AUDIT_vouchers_2026-08-17.md](AUDIT_vouchers_2026-08-17.md) | 2026-08-17 | AUDITED · 16 findings (**3×P1**, 7×P2, 6×P3) |
| 7 | `/transferencias` | [AUDIT_transferencias_2026-08-17.md](AUDIT_transferencias_2026-08-17.md) | 2026-08-17 | AUDITED · 9 findings (**1×P1**, 3×P2, 5×P3) |

## ⚠ P1 abiertos (leer primero)

| Origen | Finding | Por qué urge |
|---|---|---|
| vouchers F1 | `GET /vouchers/search` **no valida scope multi-tenant** — el SQL no filtra por empresa y el endpoint no recibe `EmpresaScopeDep` | Viola el invariante §1.4.16 del SUPER_PROMPT_MAESTRO. Un usuario con rol en 1 empresa escribe 3 letras en el buscador y ve código/glosa/contraparte/**RUT**/monto de las 10. Fix ~30 min en `backend/app/api/v1/vouchers.py:126` |
| transferencias F1 | El modal "Marcar pagados" muestra el monto **filtrado** pero ejecuta el `selectedIds` **completo** | Plata + irreversible. Cambiar de chip de empresa entre selecciones marca EXECUTED vouchers que nunca aparecieron en la confirmación |
| vouchers F2 | Mismo bug en la firma masiva (`runBulkApprove(Array.from(selectedIds))` vs Σ total sobre `filteredVouchers`) | Misma causa raíz que el anterior — arreglar los dos juntos |
| vouchers F3 | Buscar con 3+ caracteres **descarta silenciosamente todos los demás filtros** (empresa, estado, proyecto, fechas) | Los selects siguen puestos y la URL también, pero la tabla los ignora. Contamina además el banner de "Total gastado" por proyecto |

## Pendientes de audit (en orden de prioridad)

1. `/action-center` — Centro de acción (en mejora por agente R152jj)
2. `/calendario` — Calendario unificado
3. `/asistente` — Asistente IA
4. `/cartas-gantt` — Gantts cross-empresa
5. `/empresa/[codigo]` — Detalle de empresa
6. `/compliance` — Compliance regulatorio
7. `/me` — Perfil de usuario
8. `/avance` — Avance del fondo

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
