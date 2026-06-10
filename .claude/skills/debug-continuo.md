---
name: debug-continuo
description: Escaneo de debugging completo de Ram-Cehta — sintaxis, imports, rutas, race conditions, queries, frontend. Correr al inicio de cada sesión de trabajo o tras cualquier cambio grande. Reporta y arregla.
---

# Skill: Debug Continuo

Escaneo sistemático de bugs en 7 capas. Cada capa tiene un comando de
verificación exacto y criterio de PASS/FAIL. **Arreglar lo que falle antes
de pasar a la siguiente capa.**

## Capa 1 — Sintaxis y compilación (2 min)

```bash
cd backend && python -c "
import ast, glob
errs = []
for f in glob.glob('app/**/*.py', recursive=True) + glob.glob('scripts/*.py'):
    try: ast.parse(open(f, encoding='utf-8').read())
    except SyntaxError as e: errs.append(f'{f}: {e}')
print('ERRORES:', errs) if errs else print('PASS — sintaxis OK')
"
```

PASS: 0 errores. FAIL: arreglar el archivo exacto que reporta.

## Capa 2 — Import completo + conteo de rutas (1 min)

```bash
cd backend && python -c "
from app.main import app
from fastapi.openapi.utils import get_openapi
spec = get_openapi(title='t', version='1', routes=app.routes)
print(f'{len(app.routes)} rutas / {len(spec[\"paths\"])} paths OpenAPI')
"
```

Baseline esperado: **523 rutas / 431 paths** (actualizar al agregar endpoints).
Si baja sin haber borrado endpoints a propósito → un router se cayó del
`__init__.py` o un import falló silenciosamente.

## Capa 3 — Frontend type-check + build (5 min)

```bash
cd frontend && npx tsc --noEmit && npm run build
```

PASS: build verde. FAIL: el error de Vercel será el mismo — arreglarlo local
ANTES de pushear.

## Capa 4 — Patrones de bugs conocidos (grep dirigido)

Buscar cada patrón; si aparece en código nuevo, es bug probable:

| Patrón | Por qué es bug | Buscar con |
|---|---|---|
| `date.today()` / `datetime.utcnow()` en lógica de negocio | Timezone Chile (usar `today_chile()` de `app/core/timezone.py`) | `grep -rn "date.today()\|datetime.utcnow()" app/services app/api` |
| `except Exception: pass` o `continue` sin log | Errores silenciados | `grep -rn -A1 "except.*:" app/ \| grep -B1 "pass$\|continue$"` |
| UPDATE/INSERT sin `FOR UPDATE` en flujos de firma/saldo | Race condition | revisar approve/execute/saldo nuevos |
| f-string con `{exc}` en `HTTPException(detail=...)` | Filtra internals al frontend | `grep -rn "detail=f" app/api \| grep exc` |
| Query sin filtro de empresa en endpoint no-admin | Leak multi-tenant | revisar endpoints nuevos vs `get_allowed_empresa_codes` |
| `float(` en montos | Precisión contable (usar Decimal) | `grep -rn "float(" app/services \| grep -i "monto\|saldo\|total"` |
| RUT completo en `log.` | PII Ley 19.628 | `grep -rn "rut" app/ \| grep "log\."` |

## Capa 5 — Salud de producción (read-only, 1 min)

```powershell
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/health
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/health/perf
```

Revisar: `db_pool_in_use` vs `db_pool_size` (si está cerca del límite →
saturación), status 200, latencia < 2s.

## Capa 6 — Logs de producción (errores última hora)

```powershell
fly logs -a cehta-backend --no-tail | Select-String -Pattern "ERROR|CRITICAL|Traceback" | Select-Object -Last 20
```

Cada traceback nuevo = bug a triagear con la skill `incident-response`.

## Capa 7 — Incidentes y sync runs en DB

```sql
SELECT * FROM core.system_incidents WHERE status != 'RESOLVED' ORDER BY detected_at DESC LIMIT 5;
SELECT status, COUNT(*) FROM core.sii_sync_runs WHERE started_at > NOW() - INTERVAL '7 days' GROUP BY status;
SELECT status, COUNT(*) FROM core.email_outbox GROUP BY status;
```

`email_outbox` con FAILED creciendo o sync runs FAILED repetidos = investigar.

## Reporte final

Terminar SIEMPRE con una tabla:

| Capa | Estado | Acción tomada |
|---|---|---|
| 1. Sintaxis | ✅/❌ | ... |
| ... | | |

Si TODAS pasan → "Plataforma sana". Si alguna falla y no se pudo arreglar →
crear entrada en docs/BACKLOG.md con prioridad H.
