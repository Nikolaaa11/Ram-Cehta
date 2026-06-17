# SÚPER MEGA PROMPT — Test total de la plataforma (foco contable + financiero)

> **Qué es**: el prompt más exhaustivo para probar Ram-Cehta de punta a
> punta, con énfasis en que **la plata cuadre al peso**. Copialo y pegalo
> tal cual en Claude Code (en la carpeta Ram-Cehta).
>
> **Cuándo usarlo**: antes de la marcha blanca contable, antes de cada
> cierre mensual, y después de cualquier cambio que toque montos, IVA,
> impuestos, cuotas o conciliación.
>
> **Última actualización**: 2026-06-12 · Round 152PPPPPP

---

## ⭐ EL SÚPER MEGA PROMPT (copiar todo lo de abajo)

```
Soy Nicolás Rietta, opero Ram-Cehta (FIP CEHTA ESG). Necesito una prueba
EXHAUSTIVA de toda la plataforma, con foco absoluto en la parte CONTABLE y
FINANCIERA. El estándar es: ningún número puede estar mal ni siquiera por
un peso. Trabajá como tech lead + auditor contable senior. No estimes en
tokens — gastá los necesarios. Usá agentes en paralelo donde convenga.

LEÉ PRIMERO:
- docs/SUPER_PROMPT_MAESTRO.md (los 22 invariantes mandan)
- docs/BACKLOG.md

FASE 1 — MOTOR CONTABLE (la plata al peso)
Corré la skill test-contable-financiero COMPLETA (12 secciones). Para cada
sección reportá PASS/FAIL con el número esperado vs el obtenido. Foco en:
  1. Aritmética: Decimal everywhere, IVA 19% half-up, impuesto específico
     ($ monto y % del neto), sin float ni round() crudo en montos.
  2. Partida doble: Σ debe = Σ haber; el schema rechaza descuadres.
  3. Cuotas: la suma SIEMPRE da el total exacto; ninguna cuota ≤ 0.
  4. Máquina de estados: DRAFT→PENDING→APPROVED→EXECUTED→RECONCILED sin
     saltos ilegales; APPROVED exige 2+ firmas; locks contra doble-firma.
  5. Conciliación SII↔vouchers: match por monto + moneda + tolerancia.
  6. F29 / IVA consolidado: iva_a_pagar nunca negativo (crédito>débito →
     remanente).
  7. Transferencias masivas: el Excel cuadra exacto con los vouchers.
  8. CORFO: invariante E8 (ninguna línea CORFO_SUBSIDIO toca cuenta IVA).
  9. Nubox export: glosas con ; o , no se rompen; montos sin separador que
     confunda a Nubox.
  10. Multi-moneda: formatos CLP/UF/USD correctos.

FASE 2 — VERIFICACIÓN CONTRA DATOS REALES (read-only, producción)
Con acceso a Supabase (read-only) verificá sobre los datos vivos:
  - Ningún voucher no-DRAFT con Σ debit ≠ Σ credit (tolerancia 0.01).
  - Ningún voucher EXECUTED sin fecha_ejecucion.
  - Ningún voucher APPROVED/EXECUTED con < 2 firmas de roles distintos.
  - Correlativos de código sin huecos por empresa/año.
  - Folios SII únicos por (empresa, tipo_dte, folio, rut).
  - Saldos por empresa coherentes (el dashboard suma lo mismo que la suma
    de movimientos).
  - iva_a_pagar del período nunca negativo.
Mostrame una tabla por empresa con el resultado.

FASE 3 — FLUJOS FINANCIEROS DE PUNTA A PUNTA (smoke read-only)
Probá que respondan sin 500 y con datos coherentes (no NaN/null):
  - GET /dashboard, /dashboard/kpis, /dashboard/cashflow
  - GET /vouchers/paginated, /vouchers/counts
  - GET /ordenes-compra (lista + 1 PDF de OC de RHO con formato Panimávida)
  - Conciliación: KPIs + movimientos huérfanos
  - F29 preview, transferencias (lista de APPROVED)
  - Reportes contables / libro mayor / Nubox export

FASE 4 — AGENTES EN PARALELO (auditoría profunda de código contable)
Lanzá agentes que busquen, con verificación adversarial de cada hallazgo:
  - Precisión: float/round en montos, pérdida de centavos, redondeos.
  - Integridad: IVA mal calculado, neto+IVA≠total, sumas en Python que
    deberían ser SQL.
  - Estados: transiciones de voucher/OC sin validar el estado anterior.
  - Race conditions en firmas, ejecución de pagos, correlativos.

FASE 5 — E2E SUPERVISADO (pedime autorización ANTES, escribe en prod)
Si autorizo: creá 1 voucher de prueba con caja chica (neto $10.000 + IVA
$1.900 = $11.900), seguí el ciclo DRAFT→2 firmas→EXECUTED→conciliación, y
ANULALO al terminar para dejar la BD limpia. Reportá cada paso.

REGLAS DURAS:
- Producción: solo lecturas, salvo el E2E que yo autorice explícitamente.
- Cualquier número que no cuadre es un BUG — reportalo con esperado vs
  obtenido y el archivo:línea.
- No toques credenciales ni las muestres descifradas.
- Modelo IA de la plataforma: Sonnet (no cambiar).

ENTREGABLE FINAL:
1. Tabla de las 12 secciones del motor (PASS/FAIL).
2. Tabla por empresa de la verificación contra datos reales.
3. Lista de bugs encontrados (esperado vs obtenido, archivo:línea).
4. Veredicto: "Motor contable y financiero correcto al peso" o "N bugs a
   corregir" — y si hay bugs, arreglá los críticos y re-corré esa sección.
5. Guardá el reporte en docs/TEST_CONTABLE_YYYY_MM_DD.md.
```

---

## Versión corta (test rápido del motor, 5 min)

Para correr solo la batería sintética sin tocar producción:

```
Soy Nicolás. Corré la skill test-contable-financiero secciones 1, 2, 3 y 10
(solo código, sin tocar la base). Reportame PASS/FAIL de cada caso con el
número esperado vs el obtenido. Decime en una línea: ¿el motor contable
está sano al peso?
```

---

## Qué cubre exactamente (mapa de lo que se prueba)

| Área | Qué valida |
|---|---|
| **IVA** | 19% con ROUND_HALF_UP (no banker's); neto+IVA=total |
| **Impuesto específico** | $ monto fijo (combustibles) y % del neto (ILA, suntuarios) |
| **Partida doble** | Σ debe = Σ haber; rechazo de descuadres |
| **Cuotas** | suma exacta = total; sin cuotas ≤ 0 |
| **Decimal** | sin float ni round() crudo en montos |
| **Estados** | máquina válida; 2+ firmas; locks anti doble-firma |
| **Conciliación** | match monto + moneda + tolerancia |
| **F29 / IVA mensual** | iva_a_pagar ≥ 0; débito − crédito correcto |
| **Transferencias** | Excel cuadra con vouchers seleccionados |
| **CORFO** | invariante E8 (subsidio no toca IVA) |
| **Nubox export** | glosas y montos íntegros en el CSV |
| **Multi-moneda** | CLP / UF / USD bien formateados |

---

## Relación con las otras skills (ver docs/PROMPTS_MAESTROS.md)

- `test-contable-financiero` — **este**: prueba el MOTOR (software) con casos
  sintéticos. Correr tras cambios de montos.
- `audit-financiero` — audita los DATOS reales de producción (vouchers
  trabados, gaps SII, caja ociosa). Correr pre-cierre.
- `cierre-mensual` — wizard del cierre día 1-10.
- `qa-produccion` — smoke E2E general (no solo contable).

Los tres se complementan: este prueba que la calculadora esté bien,
audit-financiero revisa qué hay adentro, cierre-mensual ejecuta el cierre.
