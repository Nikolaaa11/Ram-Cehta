# PROMPT MAESTRO SUPREMO · Sección Remuneraciones

> Pedido de Nicolás: *"crear una sección de remuneraciones donde se puedan
> calcular todas las remuneraciones, que aparezcan todas las formas de
> realizarlo como ejemplo, que los cálculos se hagan correctamente, que
> sugiera configuraciones, que las calcule automáticamente y que nunca haya
> errores"*.

## 0. La promesa de "nunca errores", dicha con honestidad

Una liquidación chilena depende de parámetros que **cambian todos los meses**
(UF, UTM) o varias veces al año (ingreso mínimo, tope imponible, comisiones
AFP, SIS, calendario de la reforma previsional). Ningún sistema puede
"garantizar cero errores" adivinando esos valores. Lo que SÍ se puede
garantizar, y es lo que se construye:

1. **El motor nunca adivina.** Si al período le faltan la UF o la UTM, se
   niega a calcular y pide cargarlas (con link al SII). Un cálculo con
   parámetros vencidos es un error disfrazado de resultado.
2. **Las identidades cierran siempre, por construcción.**
   `líquido = haberes − descuentos`, `base tributable = imponible −
   previsionales`, bases topadas en 87,8/131,9 UF. Se calculan por resta,
   no por dos caminos que puedan divergir, y hay tests que lo fijan.
3. **Conciliación contra el libro del contador.** La plataforma ya tiene los
   libros de remuneraciones de MCG subidos (`core.libro_remuneraciones_lineas`,
   con el desglose completo por empleado). La sección compara MI cálculo
   contra SU libro, línea por línea y columna por columna, y muestra cada
   diferencia. Dos fuentes independientes que cierran es la única definición
   seria de "sin errores".
4. **Los ejemplos de la página los calcula el mismo motor** que las
   liquidaciones reales — no son texto estático que pueda quedar viejo.

## 1. Calibración contra el libro REAL (hallazgo clave del recon)

Hay un libro de MCG cargado: AFIS, abril 2026, 4 empleados. De sus líneas se
descifró (y queda fijado en golden tests):

| Dato | Valor | Cómo se dedujo |
|---|---|---|
| Ingreso mínimo (abr-2026) | **$539.000** | tope gratificación 213.354 = 4,75×IMM/12 |
| UTM abril 2026 | **$69.889** | impuesto único al centavo en 2 líneas |
| SIS | **1,62%** | 21.060/1.300.000 |
| Reforma previsional | **0,1% + 0,9%** | aporte_afp_empleador + seguro_social |
| AFC empleador indefinido | **2,4%** | 31.200/1.300.000 |
| Mutual AFIS | **2,63%** | 34.190/1.300.000 (adicional por actividad) |
| Comisión AFP (Claudia) | **1,44%** | previsionales 418.880 = (10+1,44+7+0,6)% |

La línea completa de Claudia Gotschlich cierra EXACTA con el motor:
imponible 2.200.000 → previsionales 418.880 → base tributable 1.781.120 →
impuesto 33.504,74 → líquido 1.747.615. Es el golden test maestro.

Convenciones de MCG que el motor adopta (para conciliar 1:1):
- `total_descuentos = previsionales + impuesto redondeado a peso`
- `base_tributable = imponible − previsionales` (si es isapre, el plan
  completo en UF rebaja, como lo hace el libro)
- el impuesto único se guarda con 2 decimales; el líquido en pesos enteros

## 2. La expertise codificada (reglas del motor)

- **Sueldo proporcional**: sueldo × días/30 (mes comercial).
- **Horas extra**: valor hora = sueldo × (1/30)×(7/jornada)×(1+recargo).
  ⚠️ Ley 21.561: jornada 44h desde abr-2024, **42h desde abr-2026**, 40h en
  2028. La jornada es parámetro del período — abril 2026 en adelante: 42.
- **Gratificación Art. 50 CT**: min(25% de lo devengado imponible,
  4,75×IMM/12). También admite "sin gratificación" y "monto fijo" (Art. 47
  convenida).
- **Imponible** = sueldo prop. + HE + comisiones + bonos imponibles +
  gratificación. **Base cotizaciones** = min(imponible, 87,8 UF).
  **Base AFC** = min(imponible, 131,9 UF).
- **No imponibles**: colación, movilización, viáticos, asignación familiar
  (por tramo según ingreso, por carga).
- **Trabajador**: AFP 10% + comisión (tabla por AFP) · salud 7% Fonasa o plan
  UF Isapre · AFC 0,6% sólo indefinido · APV régimen B rebaja tributable
  (tope 50 UF/mes) · impuesto único de segunda categoría.
- **Impuesto único** (mensual, en UTM — tramos de LEY, estables):
  exento ≤13,5 · 4% a 30 · 8% a 50 · 13,5% a 70 · 23% a 90 · 30,4% a 120 ·
  35% a 310 · 40% sobre 310. La rebaja NO se tabula: se **deriva por
  continuidad** de los tramos (rebaja_n = rebaja_{n-1} + límite×Δtasa), así
  no puede quedar desalineada de las tasas.
- **Empleador**: AFC 2,4% indefinido / 3,0% plazo fijo · SIS · mutual (base
  0,93%, adicional por empresa) · reforma ley 21.735: 0,1% cuenta individual
  + 0,9% seguro social (sube por calendario legal — parámetro editable).
- **Costo empresa** = imponible + no imponibles + aportes empleador.

## 3. Qué se construye

### 3.1 Motor puro — `backend/app/domain/value_objects/remuneracion.py`
Funciones puras con Decimal, sin BD. `ParametrosMes` (dataclass) +
`calcular_liquidacion(entrada, parametros)` → desglose completo con
advertencias (tope alcanzado, jornada según período, etc.). Golden tests
contra el libro real de MCG.

### 3.2 Persistencia — `backend/scripts/sql/remuneraciones_v1.sql`
- `core.remun_parametros` — un registro por período (UF, UTM, IMM, topes,
  tasas, jornada). UF/UTM pueden ser NULL = "falta cargar" y el motor se
  niega.
- `core.remun_afp_comisiones` — comisión por AFP por período.
- `core.remun_asignacion_familiar` — tramos por período.
- `core.remun_liquidaciones` — entrada (JSONB) + resultado (JSONB) + columnas
  de totales para listar, por empleado/empresa/período, estado
  BORRADOR/CONFIRMADA. UNIQUE (empresa, empleado, periodo).
- Seeds 2026: tasas confirmadas por el libro (SIS 1,62, reforma 0,1/0,9,
  IMM 539.000, jornada 42) + comisiones AFP conocidas (marcadas "verificar
  en Previred") + UF/UTM de abril derivada (69.889) y agosto en NULL.

### 3.3 API — `backend/app/api/v1/remuneraciones.py`
Con el MISMO gate de acceso que RRHH (`_check_rrhh_access` — es información
sensible). Endpoints: parámetros GET/PUT · `POST /calcular` (vista previa
pura) · `POST /generar-mes` (batch: borradores para todos los empleados
activos con config sugerida) · CRUD liquidaciones · `GET /sugerencias`
(config por empleado desde `core.empleados` + su última liquidación + el
último libro) · `GET /conciliacion` (mi cálculo vs libro MCG, columna por
columna, diferencias > $2) · `GET /ejemplos` (5 casos didácticos calculados
por el motor en vivo).

### 3.4 Pantalla — `/remuneraciones` con subpestañas
1. **Nómina del mes** — generar/ver las liquidaciones del período, totales,
   y el estado de conciliación contra el libro si existe.
2. **Calcular** — formulario completo con desglose en vivo (haberes,
   descuentos, aportes, costo empresa) y las advertencias del motor.
3. **Parámetros del mes** — los indicadores editables, con aviso grande
   cuando falta la UF/UTM y links a SII/Previred.
4. **Guía y ejemplos** — la teoría (§2) con los 5 ejemplos vivos.

Más entrada en el sidebar bajo RRHH.

## 4. Lo que NO se hace (v1)
- No genera archivo Previred ni asientos contables (los asientos siguen
  siendo de MCG/Nubox; la conciliación es el puente).
- No finiquitos, no licencias médicas, no semana corrida.
- No pisa el módulo RRHH existente: los libros siguen siendo la palabra del
  contador; esto calcula y CONCILIA.

## 5. Invariantes y trampas del repo
Los 22 de `SUPER_PROMPT_MAESTRO.md`. El peso sin centavos (salvo impuesto,
2 decimales como MCG) · `is not None`, nunca `or`, con ceros legítimos ·
Pydantic v2 `= None` · verificar el esquema REAL en la BD antes del SQL ·
regenerar `openapi.json` → `gen:types` · verificar contra producción, no
sólo tests.

## 6. Definición de terminado
- [ ] La línea real de Claudia (libro MCG) se reproduce EXACTA en un test.
- [ ] El impuesto único de las 2 líneas reales cierra al centavo.
- [ ] Sin UF/UTM cargadas el motor se niega con mensaje accionable.
- [ ] Batch de AFIS abril 2026 + conciliación contra el libro corrida en
      producción, con las diferencias explicadas.
- [ ] Los ejemplos de la página salen del motor, no de texto.
- [ ] Suites verdes, desplegado, verificado e2e.
