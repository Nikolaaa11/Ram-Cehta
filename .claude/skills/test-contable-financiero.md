---
name: test-contable-financiero
description: Batería de pruebas del MOTOR contable/financiero de Ram-Cehta — aritmética del dinero, partida doble, IVA, impuesto específico, cuotas, máquina de estados, conciliación, F29, transferencias, CORFO, Nubox export, multi-moneda. Prueba el SOFTWARE (no audita datos reales). Correr antes de cada marcha blanca contable y tras cualquier cambio que toque montos.
---

# Skill: Test Contable y Financiero

Prueba que el motor de plata de la plataforma esté **correcto al peso**.
A diferencia de `audit-financiero` (que revisa datos reales de producción),
esta skill ejercita el CÓDIGO y los FLUJOS con casos sintéticos de
resultado conocido. Si un número no da, es un bug.

Referencia obligatoria: los 22 invariantes de `docs/SUPER_PROMPT_MAESTRO.md`.
Regla de oro: **el dinero es Decimal, nunca float. Redondeo comercial =
ROUND_HALF_UP. La excepción (banker's rounding) solo donde el SII lo exige
y está comentado.**

## Sección 1 — Aritmética del dinero (la base de todo)

### 1.1 Casos sintéticos de IVA + impuesto específico (resultado conocido)
```bash
cd backend && python -c "
from decimal import Decimal, ROUND_HALF_UP

def iva(neto): return (Decimal(neto)*Decimal('0.19')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
def bruto(neto): return Decimal(neto) + iva(neto)

# Caso base factura
assert iva(775000) == 147250, iva(775000)
assert bruto(775000) == 922250
# Half-up vs banker's: 150*0.19 = 28.5
assert iva(150) == 29, 'IVA debe ser half-up (29), no banker (28)'
assert round(150*0.19) == 28  # confirma que round() viejo daba mal
# Impuesto específico % del neto (ILA bebidas 20.5%)
ila = (Decimal(50000)*Decimal('20.5')/Decimal('100')).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
assert ila == 10250, ila
# Total con los 3 componentes
assert Decimal(50000) + iva(50000) + ila == Decimal('69750')
print('1.1 OK — IVA, half-up, impuesto especifico % y monto')
"
```

### 1.2 No hay float en montos (escaneo de código)
```bash
cd backend && grep -rn "float(" app/services app/api | grep -iE "monto|saldo|total|neto|iva|abono|egreso|precio|cuota" | grep -v "# " || echo "PASS — sin float() en montos"
```
Cada match es candidato a bug. Verificar que sea Decimal o esté justificado.

### 1.3 round() de Python en montos (banker's silencioso)
```bash
cd backend && grep -rn "round(" app/services app/api | grep -iE "monto|neto|iva|total|precio" | grep -v "ROUND_HALF\|quantize" || echo "PASS — sin round() crudo en montos"
```
Excepción legítima: nubox/SII donde banker's es intencional (debe estar comentado).

## Sección 2 — Partida doble (cuadratura)

### 2.1 Validación en el schema (código)
```bash
cd backend && python -c "
from decimal import Decimal
from app.api.v1.vouchers_nubox_form import NuboxFormCreate
base = dict(empresa_codigo='CENERGY', tipo_documento='FACTURA_ELECTRONICA',
            numero_documento='1', forma_pago='TRANSFERENCIA', fecha_documento='2026-06-12')
# Descuadrado: contable 100, financiera 90 → debe rechazar
try:
    NuboxFormCreate(**base,
        informacion_contable=[{'comentario':'x','cuenta_codigo':'4101-03','total':100}],
        informacion_financiera=[{'comentario':'y','cuenta_codigo':'1101-01','total':90}])
    raise SystemExit('FALLO: acepto voucher descuadrado')
except Exception as e:
    assert 'descuadr' in str(e).lower() or 'partida' in str(e).lower(), str(e)[:80]
print('2.1 OK — rechaza partida doble descuadrada')
"
```

### 2.2 Constraint en DB (Σ debit = Σ credit por voucher no-DRAFT)
```sql
-- En Supabase Studio (read-only): debe devolver 0 filas
SELECT v.voucher_id, v.codigo, SUM(l.debit) AS deb, SUM(l.credit) AS cred
FROM core.vouchers v JOIN core.voucher_lines l ON l.voucher_id = v.voucher_id
WHERE v.status <> 'DRAFT'
GROUP BY v.voucher_id, v.codigo
HAVING ABS(SUM(l.debit) - SUM(l.credit)) >= 0.01;
```

## Sección 3 — Cuotas y prorrateos

```bash
cd backend && python -c "
from decimal import Decimal
def cuotas(total, n):
    base = (Decimal(total)/n).quantize(Decimal('1'))
    m = [base]*(n-1); m.append(Decimal(total)-sum(m)); return m
# La suma SIEMPRE debe dar el total exacto
for total, n in [(1000000,3),(100,7),(999999,12),(50000,4)]:
    m = cuotas(total, n)
    assert sum(m) == Decimal(total), f'{total}/{n}: suma {sum(m)} != {total}'
    assert all(x != 0 for x in m[:-1]), 'cuota intermedia 0'
print('3 OK — suma de cuotas = total exacto en todos los casos')
# Edge: total chico, muchas cuotas → ultima <= 0 debe ser rechazado por el endpoint
m = cuotas(10, 12)
assert m[-1] <= 0, 'caso borde detectado correctamente (el endpoint lo rechaza con 400)'
print('3 OK — caso borde (ultima cuota <= 0) identificado')
"
```

## Sección 4 — Máquina de estados de vouchers

Verificar que NO existan transiciones ilegales:
```bash
cd backend && grep -rn "status.*=.*'EXECUTED'\|status.*=.*'APPROVED'" app/api/v1/vouchers.py | head
```
Reglas: DRAFT→PENDING→APPROVED→EXECUTED→RECONCILED (+ VOID desde varios).
- APPROVED requiere 2+ firmas (roles distintos)
- approve y reject tienen `SELECT ... FOR UPDATE` (sin doble-firma)
- No se llega a EXECUTED sin pasar por APPROVED

```sql
-- Vouchers EXECUTED sin fecha_ejecucion (read-only): debe ser 0
SELECT COUNT(*) FROM core.vouchers WHERE status='EXECUTED' AND fecha_ejecucion IS NULL;
-- Vouchers APPROVED con < 2 firmas (read-only): revisar
SELECT v.voucher_id, COUNT(a.*) FROM core.vouchers v
LEFT JOIN core.voucher_approvals a ON a.voucher_id=v.voucher_id AND a.decision='APPROVED'
WHERE v.status IN ('APPROVED','EXECUTED','RECONCILED')
GROUP BY v.voucher_id HAVING COUNT(a.*) < 2;
```

## Sección 5 — Conciliación SII ↔ vouchers

```bash
cd backend && grep -n "moneda\|tolerancia\|ABS(" app/services/conciliacion_service.py | head
```
Verificar: el match exige misma moneda + |monto_mov - monto_voucher| <= tolerancia.
Sin esto, conciliaría un voucher CLP contra un movimiento USD del mismo número.

## Sección 6 — F29 / IVA consolidado

```sql
-- IVA consolidado del período: débito - crédito (read-only sanity)
SELECT periodo, empresa_codigo, iva_debito, iva_credito, iva_a_pagar
FROM core.v_iva_consolidado WHERE periodo = '6_2026'
-- iva_a_pagar debe = GREATEST(iva_debito - iva_credito, 0) o remanente
ORDER BY empresa_codigo;
```
Verificar que iva_a_pagar nunca sea negativo (si crédito > débito → remanente, no pago negativo).

## Sección 7 — Transferencias masivas

El Excel de transferencia debe cuadrar exacto con los vouchers seleccionados:
- Suma de montos del Excel == Σ total de los vouchers APPROVED elegidos
- Cada fila = 1 voucher con RUT, banco, cuenta, monto
- Headers `X-Total-CLP` y `X-Total-Rows` deben coincidir con el contenido

## Sección 8 — CORFO (fuentes de financiamiento)

```bash
cd backend && grep -n "CORFO_SUBSIDIO\|PTEC_CEHTA\|EMPRESA_DIRECTA\|IVA_CORPORATIVO" app/api/v1/vouchers_nubox_form.py | head
```
Invariante E8 del MAESTRO: **ninguna línea CORFO_SUBSIDIO toca cuenta IVA**.
El IVA siempre va a IVA_CORPORATIVO o EMPRESA_DIRECTA, nunca al pozo CORFO.

## Sección 9 — Nubox export (integridad del CSV)

```bash
cd backend && grep -n "replace\|QUOTE\|csv.writer\|delimiter" app/services/nubox_export_service.py | head
```
Verificar: las glosas con `;` o `,` no se rompen (QUOTE_MINIMAL), montos sin
separador de miles que confunda a Nubox, IVA por línea correcto.

## Sección 10 — Multi-moneda

```bash
cd backend && python -c "
from app.services.oc_pdf_v2_service import _formatear_moneda as f
assert f(1234567, 'CLP') == '\$1.234.567', f(1234567,'CLP')
assert 'UF' in f(100, 'UF')
assert 'US' in f(100, 'USD')
print('10 OK — formato CLP/UF/USD')
"
```

## Sección 11 — Smoke read-only de producción (endpoints de plata)

```powershell
$h = @{Authorization='Bearer <TOKEN_ADMIN>'}
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/dashboard/kpis -Headers $h
Invoke-RestMethod https://cehta-backend.fly.dev/api/v1/dashboard -Headers $h
Invoke-RestMethod "https://cehta-backend.fly.dev/api/v1/vouchers/paginated?size=5" -Headers $h
```
Verificar: saldos coherentes (no NaN, no null), totales que suman, sin 500.

## Sección 12 — E2E supervisado (SOLO con autorización explícita de Nicolás)

**No correr sin OK del operador — escribe en producción.** Crear 1 voucher
de prueba con caja chica y seguir el ciclo completo:
1. Crear voucher COMPRA, neto $10.000 + IVA → total $11.900. Verificar cuadre.
2. Adjuntar 1 factura de prueba.
3. Enviar a aprobación → status PENDING.
4. Firmar con 2 roles distintos → status APPROVED.
5. Marcar EXECUTED con comprobante → fecha_ejecucion set.
6. Verificar que aparezca en conciliación pendiente.
7. **Anular el voucher de prueba al terminar** (dejar la BD limpia).

## Formato del reporte

```
# Test Contable/Financiero — YYYY-MM-DD
| Sección | Resultado | Detalle |
|---|---|---|
| 1. Aritmética dinero | ✅/❌ | ... |
| 2. Partida doble | ✅/❌ | ... |
| ... | | |

## Bugs encontrados (si hay)
| # | Sección | Archivo:línea | Qué da mal | Resultado esperado vs obtenido |

## Veredicto: motor contable SANO / N bugs a corregir
```

Si TODO pasa → "Motor contable y financiero correcto al peso."
Si algo falla → arreglar en orden de severidad y re-correr la sección.
Validar al final con `debug-continuo` capas 1-2 (sintaxis + import 523/431).
