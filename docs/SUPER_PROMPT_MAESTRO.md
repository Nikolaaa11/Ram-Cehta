# SUPER PROMPT MAESTRO — Ram-Cehta · FIP CEHTA ESG

> **Propósito**: Orquestar la plataforma Ram-Cehta y las 9 empresas del
> portafolio bajo disciplinas contables, tributarias, legales y financieras
> de clase institucional, de modo que **nada de lo que ocurra hoy pueda
> generar contingencia mañana** —ni ante el SII, CMF, Dirección del Trabajo,
> auditores externos o socios LP—, manteniendo flujo de caja perfecto,
> cuadres exactos, trazabilidad completa y mejora continua sin romper lo
> existente.
>
> **Quién usa este documento**: Nicolás Rietta (operador) + cualquier agente
> de IA (Claude / GPT / Gemini) que opere o modifique la plataforma. Este
> prompt es la **fuente única de verdad operativa**.
>
> **Última actualización**: 2026-05-19 · Round 124 · 18 sistemas integrados.

---

## 0. Identidad del sistema

### 0.1. Estructura del fondo

**Cehta Capital** es la AGF (administradora general de fondos). El vehículo
de inversión es el **FIP CEHTA ESG** (fondo de inversión privado, regulado
bajo Ley 20.712 si supera umbrales CMF).

**Portafolio del fondo (9 portfolio companies + 1 holding):**

| Código | Razón social | RUT | Giro |
|---|---|---|---|
| **CEHTA** | Cehta Capital (holding/AGF) | — | Administración fondos |
| **AFIS** | AFIS SA | 77.423.556-6 | Administradora de fondos |
| **FIP_CEHTA** | FIP CEHTA | 77.751.766-K | Fondo inversión privado |
| **CENERGY** | Cenergy Ltda. | 76.108.687-1 | Ingeniería + biomasa |
| **EVOQUE** | Evoque Energy SpA | 76.282.088-9 | I+D + asesorías |
| **CSL** | Climate Smart Leasing SpA | 77.868.887-5 | Arriendo maquinarias |
| **TRONGKAI** | Agrotecnologías SpA | 77.221.203-8 | Agroindustria |
| **RHO** | RHO Generación SpA | 77.931.386-7 | Generación |
| **REVTECH** | Ingeniería e Innovación SpA | 77.018.739-7 | Ingeniería |
| **DTE** | DTE SpA | 77.826.369-6 | Consultoría |

**Contabilidad externa**: MCG Consultores lleva la contabilidad oficial en
**Nubox**. Ram-Cehta es el sistema **operativo** del equipo Cehta y le
manda los asientos a Nubox vía export CSV o API REST (Round 124).

### 0.2. Subsidios activos

| Código | Programa | Monto | Coejecutores | Vigencia |
|---|---|---|---|---|
| `CORFO-2026-REVTECH-TRONGKAI` | CORFO | $3.000.000.000 CLP | REVTECH (50%) + TRONGKAI (50%) | 2026-01-01 → 2027-12-31 |

**Estructura Bloque E** (CORFO):
- `CORFO_SUBSIDIO` — cargo al pozo del subsidio CORFO
- `PTEC_CEHTA` — aporte pecuniario empresarial (P-tec) vía CEHTA Capital
- `EMPRESA_DIRECTA` — gasto 100% empresa, fuera del subsidio
- `IVA_CORPORATIVO` — IVA crédito fiscal, **siempre** corporativo

### 0.3. Stack técnico (frozen unless upgrade explícito)

- **Backend**: FastAPI + Python 3.12 + SQLAlchemy 2.x async (asyncpg)
- **DB**: PostgreSQL 16 en Supabase (Free Tier · cap 15 conexiones)
- **Frontend**: Next.js 15 + React 19 + TypeScript strict + TanStack Query
- **Auth**: Supabase Auth (ES256 + JWKS)
- **Deploy**: backend en Fly.io (región gru), frontend en Vercel
- **Cifrado**: Fernet symmetric para credenciales sensibles
  (env `CREDENTIALS_FERNET_KEY`)
- **Documentos**: Dropbox API (carpetas por empresa/trabajador/voucher)

### 0.4. Sistemas externos integrados

| Sistema | Round | Estado | Para qué |
|---|---|---|---|
| SII (RCV scraping httpx) | 117 | ⚙️ activación | Bajar Registro Compras y Ventas |
| SII (import CSV manual) | 118 | ✅ código | Fallback robusto del RCV |
| Conciliación SII ↔ vouchers | 118 | ✅ código | Matchear DTE con voucher local |
| F29 estimado | 119 | ✅ código | Preview IVA mensual |
| Crear voucher desde DTE SII | 121 | ✅ código | Cerrar gaps mes a mes |
| Nubox scraping (libro remu) | 123 | ⚙️ activación | Bajar Libro de Remuneraciones |
| **Nubox API REST oficial** | **124** | ⚙️ esperando credenciales | **Emitir DTE + sync ventas** |
| Previred | — | ❌ pendiente | Bajar nómina/pagos previsionales |

---

## 1. Invariantes (NO NEGOCIABLES — la plataforma rompe si se violan)

Estas son las **reglas absolutas**. Cualquier feature/cambio que las
ponga en duda **se rechaza inmediatamente**, sin importar urgencia.

### 1.1. Contables

1. **Partida doble**: `SUM(debit) == SUM(credit)` en cada voucher
   `status != 'DRAFT'`. Validado en 3 capas (UI Zod · API Pydantic ·
   trigger Postgres).
2. **Líneas debit XOR credit**: cada `voucher_line` tiene `debit > 0` o
   `credit > 0`, **nunca ambos > 0**, nunca ambos en 0.
3. **Imputación triple** cuando aplica: `cuenta_codigo × proyecto_codigo
   × area_codigo`. Los gastos operativos exigen los 3; cuentas de balance
   puro pueden tener proyecto/área en NULL.
4. **Inmutabilidad post-aprobación**: un voucher `APPROVED` o `EXECUTED`
   **no se edita**. Sólo se anula (`VOID`) con razón obligatoria o se
   reversa (tipo `REVERSO` con `reversal_of` apuntando al original).
5. **Numeración correlativa sin saltos**: `voucher.codigo` por empresa+año,
   incremental. No se permiten huecos.

### 1.2. Tributarias (SII)

6. **IVA jamás al pozo CORFO** (regla E8 del Bloque E): ninguna línea
   con `fuente_financiamiento = 'CORFO_SUBSIDIO'` puede tocar la cuenta
   IVA crédito (`1170-01`). Validado pre-submit en UI + bloqueo en
   `POST /vouchers/{id}/submit`.
7. **Folio DTE único por empresa+tipo**: el folio del SII no se duplica.
   Si Nubox API responde 409 (idempotence_id ya usado), no se reemite.
8. **F29 mensual obligatorio**: cierre y declaración antes del **día 12**
   del mes siguiente. El sistema avisa con **5 días** de antelación.
9. **F22 anual obligatorio**: declaración antes del **30 de abril**.
   El sistema avisa con **30 días** de antelación.
10. **Boletas de honorarios con retención 13.75%** (tabla 2026, sube
    progresivamente hasta 17% en 2028). El sistema mantiene la tasa
    actualizada en `core.tax_config`.

### 1.3. Aprobación / control interno

11. **2 firmas siempre** para vouchers `PENDING → APPROVED`: GG titular
    de la empresa primero, DIRECTOR (Guido Rietta o backup) segundo.
12. **Anti-doble-firma**: un mismo `user_id` no puede firmar 2 pasos
    distintos del mismo voucher.
13. **Threshold reforzado**: vouchers sobre umbrales monetarios definidos
    en `core.approval_rules` exigen firma adicional (COO + Compliance).
14. **Adjuntos obligatorios**: tipo `COMPRA` o `VENTA` requiere al menos
    1 adjunto factura/boleta antes de pasar a `APPROVED`. Tipo importación
    (DTE 110/111/112) requiere checklist: Invoice + DIN + Factura
    Importación.

### 1.4. Seguridad

15. **Credenciales sensibles cifradas**: SII, Previred, Nubox passwords
    nunca en plaintext. Solo `credentials_service.encrypt_credential()`
    + Fernet. Logs jamás muestran la clave.
16. **Scope multi-tenant**: cada endpoint que toca datos de empresa
    valida `assert_empresa_access(user, empresa_codigo)`. Cross-tenant
    intent loguea a `audit.scope_violations`.
17. **2FA obligatorio para admin** en acciones críticas (crear usuario,
    rotar webhook, enviar digest, configurar API tokens).
18. **JWT con expiración**: el sistema detecta tokens expirados
    client-side (Round 105) y rechaza server-side. SSE reconecta solo
    con token fresco.

### 1.5. Operacionales

19. **Cap pool DB 4 conexiones por worker** (Round 109). NO subir hasta
    migrar a Supabase Pro (transaction pooler port 6543).
20. **Backup DB diario** automatizado en Fly cron → Dropbox
    `/99-Backups/`. Si falla 2 días seguidos → alerta.
21. **Audit log inmutable**: `audit.http_mutations` registra cada
    POST/PATCH/PUT/DELETE. NO se borra. Retención: 90 días auto-cleanup
    para no inflar DB.
22. **Idempotencia en operaciones externas**: cada POST a SII/Nubox
    lleva `X-Idempotence-Id` (UUID v4) para que un retry no duplique.

---

## 2. Disciplinas operativas

### 2.1. Contabilidad

**Plan de cuentas único**: el operativo de Cehta y el de Nubox deben
estar 1:1. La migración `plan_cuentas` mantiene un mapeo
`cuenta_codigo_cehta → nubox_code`. Si el contador agrega cuenta en
Nubox, se replica en Cehta en 24h.

**Asientos manuales**: el operador NO inventa cuentas. Si una operación
nueva requiere cuenta nueva, se solicita a MCG Consultores → ellos la
crean en Nubox → el operador la replica en Cehta vía `/admin/plan-cuentas`.

**Centros de costo**: el `area_codigo` (3 letras) es **obligatorio** para
todo gasto operativo. Lista cerrada en `core.areas`. No se permite "área
nueva" sin aprobación del COO.

**Cierre contable mensual** (proceso del 1 al 10 del mes siguiente):
1. Bajar RCV del SII (`/admin/sii` sync o CSV manual)
2. Conciliar SII ↔ vouchers locales
3. Para cada gap "sin voucher": crear voucher DRAFT vía botón
4. Cerrar vouchers DRAFT → PENDING → APPROVED
5. Ver F29 estimado en `/admin/sii` (preview vs Nubox)
6. Cuadrar con MCG Consultores en Nubox
7. Marcar período como CLOSED en `core.periodo_cierre`
8. Generar export Nubox CSV (los vouchers se marcan `nubox_status=EXPORTED`)

### 2.2. Tributario · SII

**Calendario SII (no negociable)**:

| Obligación | Fecha límite | Sistema responsable |
|---|---|---|
| F29 (IVA + PPM mensual) | Día 12 mes siguiente | `/admin/sii/f29-preview` |
| F50 (otros impuestos) | Día 12 mes siguiente | Manual en SII |
| F22 (renta anual) | 30 de abril | Pendiente Round 125+ |
| DJ 1879 (honorarios) | 22 marzo | Pendiente |
| DJ 1887 (sueldos) | 22 marzo | Pendiente |
| DJ 1929 (operaciones exterior) | 22 marzo | Pendiente |
| DJ 1948 (subsidios CORFO) | 31 mayo | Pendiente |

**Práctica obligatoria**: el sistema **avisa 5 días antes** del
vencimiento de cada obligación. Si la empresa la pasa por alto:
- Multa SII: 10-30 UTM por DJ no presentada
- Intereses 1.5% mensual sobre impuestos no pagados
- Cierre temporal del giro tras reincidencia

**Rebaja de IVA**: por cada compra con factura electrónica (DTE 33), el
IVA crédito se reúsa contra IVA débito de ventas. **NO se pierde IVA
crédito** porque (a) está cargado en RCV, (b) está conciliado con voucher.
Si hay factura física antigua sin registrar, el operador la sube vía
upload manual en `/admin/sii`.

### 2.3. Previsional · Previred

**Cotizaciones obligatorias** (por trabajador con contrato):

| Concepto | % sobre haber imponible | Tope imponible 2026 |
|---|---|---|
| AFP | 11.45-12.74% | 84.6 UF |
| Salud Fonasa | 7% | 84.6 UF |
| Salud Isapre | 7% mínimo (puede ser más) | sin tope |
| AFC trabajador | 0.6% | 126.7 UF |
| SIS patronal | 1.85% | 84.6 UF |
| AFC patronal | 2.4% indefinido / 3% plazo fijo | 126.7 UF |
| Mutual ACHS/IST | 0.93-3.4% según giro | 84.6 UF |

**Plazo pago Previred**: día 10 hábil del mes siguiente. Multa: 2%
sobre lo no pagado por mes de atraso.

**Práctica**: el sistema baja el Libro de Remuneraciones de Nubox
(Round 123) y compara con la centralización contable. Si hay
diferencias, se escala a MCG.

### 2.4. Laboral · Dirección del Trabajo

**Documentos por trabajador** (en Dropbox + DB `core.trabajador_documentos`):

- Contrato firmado en ambas hojas (físico + digital)
- Anexos (cambio de cargo, sueldo, jornada)
- DNI / CV
- **Liquidación de sueldo** mensual firmada
- Cert. AFP + Fonasa/Isapre (al ingreso)
- Finiquito firmado ante notario (al egreso)

**Libros obligatorios** (DT puede fiscalizar):
- Libro de asistencia (digital permitido si hay sistema con autenticación)
- Libro de remuneraciones (mensual)
- Libro de vacaciones

**Vacaciones**: 15 días hábiles por año trabajado (Art. 67 CT). El
sistema debe alertar cuando un trabajador tiene >2 períodos sin tomar
vacaciones acumuladas (riesgo de demanda).

### 2.5. Tesorería · Bancos

**Cuentas bancarias por empresa** (`core.bancos_cuentas` post-Round 116):

| Banco | Código SBIF | Usado por |
|---|---|---|
| Santander Santiago | 37 | AFIS, CENERGY, CSL, RHO, DTE |
| Itaú | 39 | AFIS, FIP_CEHTA, CENERGY |
| BCI | 16 | TRONGKAI |
| Banco de Chile | 01 | REVTECH |

**Flujo de pago** (post-aprobación voucher):
1. Voucher en `APPROVED` → aparece en `/transferencias`
2. Operador selecciona los del día (cap 50/lote para no saturar)
3. Descarga **planilla bancaria**:
   - Formato `GENERICO` para BCI/Itaú/Chile (CSV simple)
   - Formato `SANTANDER` para Santander (13 columnas específicas,
     Round 103)
4. Sube la planilla al portal del banco
5. Vuelve a Ram-Cehta y marca como `EXECUTED` con fecha real
6. Voucher se marca `nubox_status=EXPORTED` al siguiente cierre

**Conciliación bancaria**: las cartolas se bajan vía OCR (módulo
`cartolas`) y se cruzan con `core.vouchers WHERE status=EXECUTED`. Si
hay movimiento bancario sin voucher → alerta de "movimiento huérfano".

### 2.6. Aprobaciones

**Matriz de aprobación** (`core.approval_rules`):

```
Tipo voucher · Monto · Treatment → Roles requeridos (en orden)

COMPRA hasta $500K       → [CONTADOR, GG]
COMPRA $500K - $5M       → [CONTADOR, GG, DIRECTOR]
COMPRA > $5M             → [CONTADOR, COO, GG, DIRECTOR]
COMPRA CapEx > $50M      → +Comité de Inversiones
VENTA cualquier monto    → [CONTADOR, GG]
EGRESO sueldos           → [CONTADOR, GG]
TRASPASO entre cuentas   → [TESORERIA, GG]
REVERSO                  → 2 firmas del flujo original
```

**Threshold reforzado** (`reforzado=true`): obliga **una firma extra**
del DIRECTOR aunque el monto no llegue al umbral, cuando:
- El balance treatment dominante es `ACTIVACION` (cargo a activo fijo)
- O cuando es CapEx
- O cuando la cuenta es de balance puro y >$1M

### 2.7. Documentos / Dropbox

**Estructura única** (no negociable, Round 88+):
```
Cehta Capital/
├── 01-Empresas/
│   ├── REVTECH/
│   │   ├── 01-Tributario/ {F29, F22, RCV exports}
│   │   ├── 02-Trabajadores/ {por nombre}/ {contratos, liquidaciones}
│   │   ├── 03-Vouchers/ {por año-mes}/ {PDFs voucher + adjuntos}
│   │   ├── 04-Bancarios/ {cartolas, transferencias}
│   │   ├── 05-Contratos/ {clientes, proveedores}
│   │   └── 06-Legal/ {actas, estatutos, modificaciones}
│   └── ... (1 carpeta por empresa)
├── 02-Fondo/
│   ├── FIP_CEHTA/ {actas comité, reportes LP, suscripciones}
│   └── Inversionistas/ {KYC, FATCA, contratos suscripción}
├── 03-Subsidios/
│   └── CORFO-2026-REVTECH-TRONGKAI/ {bases, rendiciones, informes}
└── 99-Backups/ {DB snapshot diario}
```

**Permisos**: Dropbox usa link compartido por carpeta con expiración.
NO compartir credenciales de cuenta Dropbox.

---

## 3. Procesos cíclicos (calendario operativo)

### 3.1. Diario (5 min al inicio del día)

1. Abrir `/admin/system-status` → ver pendientes propios
2. Revisar `/aprobaciones` → firmar lo que requiera firma
3. Revisar `/inbox` → procesar emails entrantes (cobros, facturas)
4. Si hay alerta roja en sistema → escalar inmediatamente

### 3.2. Semanal (lunes 1 hora)

1. Abrir `/admin/sii` por cada empresa con DTEs emitidos esa semana
   → conciliar nuevos DTE contra vouchers
2. Revisar `/admin/cartolas-runs` → cartolas no procesadas
3. Revisar deadlines próximos en `/calendar` (F29, contratos vencidos,
   renovaciones)
4. Revisar `/admin/bitacora` → cambios anómalos
5. Backup integrity check: ver último `verify_backup_cron` en `/health/perf`

### 3.3. Mensual (cierre, 2-3 días entre día 1 y día 10 del siguiente)

**Día 1-3**: Sincronización data externa
- [ ] Sync RCV SII por cada empresa
- [ ] Import CSV manual si auto-sync falla
- [ ] Conciliar SII ↔ vouchers (botón "Conciliar")
- [ ] Bajar Libro de Remuneraciones de Nubox (Round 123)
- [ ] Sync Nubox API REST si las credenciales están activas (Round 124)

**Día 4-7**: Cuadrar y completar
- [ ] Por cada "DTE SII sin voucher": crear voucher DRAFT desde la UI
      (botón "Crear voucher")
- [ ] Editar las cuentas placeholder (`1-0-0-0`, `2-0-0-0`) con códigos
      reales del plan
- [ ] Submit → aprobar las firmas requeridas
- [ ] Ejecutar transferencias del mes
- [ ] Marcar `EXECUTED` post-pago

**Día 8-10**: Cierre y declaración
- [ ] Ver F29 estimado en `/admin/sii`
- [ ] Cuadrar con MCG Consultores (export Nubox CSV)
- [ ] Presentar F29 oficial en SII
- [ ] Pagar F29 con `EXECUTED` voucher
- [ ] Pagar Previred (día 10 hábil)
- [ ] Marcar período como `CLOSED` en `core.periodo_cierre`

### 3.4. Trimestral

- **Marzo / Junio / Sept / Dic**: comité de inversiones FIP CEHTA ESG
  → genera **acta** que va a `02-Fondo/FIP_CEHTA/actas-comite/`
- **Reporte trimestral a LPs**: PDF generado vía `/informes-lp` con KPIs
  por empresa + uso del subsidio CORFO
- **Revisión de subsidios CORFO**: ejecución vs plan en
  `/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI`
- **Pruebas DR**: restaurar backup DB en ambiente staging, verificar
  integridad

### 3.5. Anual

**Enero**:
- [ ] Cierre del ejercicio anterior (`core.periodo_cierre.year=YYYY` → CLOSED)
- [ ] Inventario físico de activos fijos
- [ ] Provisión de vacaciones de cada trabajador

**Febrero-marzo**:
- [ ] DJ 1879 (honorarios pagados) - vence 22 marzo
- [ ] DJ 1887 (sueldos pagados) - vence 22 marzo
- [ ] DJ 1929 (operaciones exterior) - vence 22 marzo
- [ ] DJ 1948 (rendición CORFO) - vence 31 mayo

**Abril**:
- [ ] F22 (renta anual) - vence 30 abril
- [ ] PPM trimestral 4to trim del año anterior

**Mayo**:
- [ ] Pago impuesto a la renta (si corresponde)
- [ ] Rendición CORFO anual

**Diciembre**:
- [ ] Provisiones de fin de año (gratificación, bonos)
- [ ] Plan financiero año siguiente
- [ ] Renovación de licencias/seguros

---

## 4. Aprovechamiento de activos

### 4.1. Tributarios (no perder oportunidades)

- **IVA crédito acumulado**: si una empresa tiene IVA crédito > IVA
  débito de forma recurrente, se acumula como "remanente CF". El sistema
  debe **alertar** cuando el remanente supera 6 meses para evaluar
  estrategias (devolución por exportación, cambio de actividad, etc.).
- **PPM voluntario**: si la empresa tiene utilidades altas, hacer PPM
  voluntario mensual evita el shock del F22.
- **Depreciación acelerada** (Art. 31 N°5 LIR): activos fijos nuevos
  se deprecian en 1/3 de la vida útil normal. Dashboard debe mostrar
  activos elegibles.
- **Régimen Pro PyME** (Art. 14D LIR): si la empresa califica
  (ingresos < 75.000 UF), beneficios tributarios significativos.
- **CORFO**: el subsidio NO es ingreso tributable, NO genera IVA débito,
  pero los gastos rendidos SÍ tienen IVA crédito recuperable.

### 4.2. Financieros

- **Caja ociosa**: si una empresa tiene saldo bancario > 6 meses de
  gastos operativos, evaluar fondos mutuos / depósitos a plazo.
- **Capital de trabajo**: el sistema calcula
  `(cuentas por cobrar + caja - cuentas por pagar)` por empresa
  diariamente. Si baja del umbral → alerta.
- **Días de cobro (DSO)** y **días de pago (DPO)**: KPI mensual.
  Si DSO > 90 días → política de cobranza más estricta.

### 4.3. Operacionales

- **Sinergias entre empresas del portfolio**: si REVTECH compra un
  servicio que CSL también necesita, evaluar contrato consolidado.
- **Inventario activos fijos**: cross-empresa para evitar duplicación.
- **Recursos humanos compartidos**: contadores, abogados, IT pueden
  servir múltiples empresas con cobro vía transfer pricing
  (`HONORARIOS` entre empresas del portfolio).

---

## 5. Mejora continua sin romper

### 5.1. Disciplina de cambios

**Regla de oro**: ningún cambio entra a producción sin:
1. **Tests** que cubran el cambio (al menos unit + smoke)
2. **TS strict + lint** sin errores
3. **Migración SQL** aplicada en Supabase Studio (no en código, por
   chain break histórico de alembic)
4. **Deploy via `fly deploy --remote-only`** (rolling, sin downtime)
5. **Verificación post-deploy**: `/health` 200 + 0 errores 5xx en logs

### 5.2. Rounds técnicos

Cada cambio significativo se entrega como un **Round** con:
- Número incremental
- Commit message en formato `feat/fix/chore(qa-roundNNN): titulo`
- Co-author trailer `Claude Opus 4.7`
- Si requiere acción del operador (migración, secret, seed) →
  archivo `scripts/sql/roundNNN_INSTRUCCIONES.md`

### 5.3. Histórico de rounds (al 2026-05-19)

```
105    SSE JWT expirado client-side
106    Filtro proyecto en /vouchers
107    Banner resumen por proyecto
108    CSV con proyecto + back-link
109 🔴 HOTFIX EMAXCONNSESSION (pool 5→3, workers 2→1)
110    Cap SSE 5 conexiones por user
111    /health/perf valores reales
112    Proyecto en /aprobaciones
113    Proyecto en /transferencias
114    docs/RUNBOOK_INCIDENTES.md
115    Cifrado Fernet + tablas credenciales/directorio/inversionistas
116    Seed Excel Data (4).xlsx
117    SII httpx + UI /admin/sii
118    SII CSV manual + conciliación
119    F29 estimado con notas crédito
120    /admin/data vista única del fondo
121    Crear voucher desde DTE SII
122    Sidebar discoverable
123    Nubox scraping libro remuneraciones
124    Nubox API REST oficial (Factura y Administración)
```

### 5.4. Cuándo pedir cambios al sistema

✅ Pedir si:
- Aparece error en producción no documentado
- Una operación toma >5 min y debería ser <30s
- Un dato existe en Excel/Drive/Notion pero no en la plataforma
- La regulación cambió (nueva tasa SII, nueva DJ, nuevo formato bancario)

❌ NO pedir si:
- Es preferencia personal de color/tipografía sin impacto operativo
- Es para "facilitar" saltarse una validación de control interno
- Es porque un usuario "no entiende" un flujo (mejor capacitación)

---

## 6. Auditoría continua

### 6.1. Checks automáticos (cron en Fly)

| Check | Frecuencia | Falla → |
|---|---|---|
| `/health/db` | cada 30s | Restart machine |
| Backup DB diario | 03:00 GMT | Alerta + reintenta |
| Verify backup integrity | semanal | Alerta a admin |
| Audit retention cleanup | semanal | Logueado |
| ETL Dropbox sync | hourly | Reintenta con backoff |
| Inbox poll (correo) | cada 15min | Skip si IMAP down |

### 6.2. Métricas que el admin debe revisar semanalmente

1. **Vouchers en DRAFT > 7 días**: deben cerrarse o eliminarse
2. **Vouchers en PENDING > 5 días**: el firmante está bloqueando
3. **DTE SII sin voucher local > 30 días**: gap real, podría ser
   fiscalización
4. **Movimientos bancarios huérfanos** (cartolas con monto sin
   voucher `EXECUTED`)
5. **Trabajadores activos sin liquidación del mes** (cierre incompleto)
6. **Cap pool DB usado > 80%** (riesgo EMAXCONNSESSION)
7. **Conexiones SSE por user > 5** (cliente con bug, ya cap-eado pero
   loguear)
8. **Tokens API Nubox/SII con validación fallida** (clave caducó)

### 6.3. Logs estructurados (`structlog`)

Cada evento clave tiene `event=<nombre>` parseable:
- `voucher_approved` / `voucher_rejected` / `voucher_void`
- `sii_subscribe` / `sse_subscribe_evicted_oldest`
- `nubox_api_emit_ok` / `nubox_api_emit_failed`
- `credential_decrypt_failed`
- `scope.cross_tenant_attempt` (¡SECURITY!)

Patrones a alertar (futuro Sentry):
- `scope.cross_tenant_attempt` → notificar inmediato
- `credential_decrypt_failed` 3 veces en 1 min → posible compromiso de
  Fernet key
- `nubox_api_emit_failed` consecutivo → API Nubox caída o credenciales mal

---

## 7. Cumplimiento regulatorio

### 7.1. SII (Servicio de Impuestos Internos)

- Documentos electrónicos con firma digital (timbre SII)
- Folios autorizados por SII vía CAF
- Libros de compras y ventas (RCV) presentados mensualmente
- F29 / F22 según calendario
- Fiscalizaciones: el sistema mantiene PDF + XML de cada DTE por
  6 años (Art. 17 CT)

### 7.2. CMF (Comisión para el Mercado Financiero)

- FIP CEHTA ESG si supera umbrales: registro CMF + envío de información
  trimestral
- AGF (Cehta Capital): si maneja >UF 100.000 → CMF supervisa
- Reportes obligatorios: NCG 235 (norma carácter general)
- Política de inversiones aprobada por comité

### 7.3. Dirección del Trabajo

- Libros: asistencia, remuneraciones, vacaciones
- Contratos firmados en 15 días desde inicio (Art. 9 CT)
- Liquidación de sueldo entregada al pago (Art. 54 CT)
- Finiquito ratificado ante notario o IPS (Art. 177 CT)

### 7.4. SBIF / CMF Bancarios

- Transferencias > UF 10.000 informadas a UAF (lavado de activos)
- KYC de proveedores nuevos antes del primer pago
- Origen de fondos documentado (en LPs aportantes)

### 7.5. Ley 19.628 (Protección de Datos Personales)

- Información de trabajadores cifrada en reposo
- Acceso a RUTs y direcciones solo a roles con scope
- Eliminación de datos de trabajadores 5 años post-egreso

### 7.6. Ley 19.886 (Compras Públicas)

- Si una empresa del portfolio vende al Estado: portal Mercado Público
- Registro Único de Proveedores (ChileProveedores) al día
- Garantía de fiel cumplimiento (boleta o póliza)

---

## 8. Plantilla de auditoría de la propia plataforma

Cualquier agente IA que abra este sistema debe verificar ANTES de
modificar nada:

```
[ ] /health responde 200
[ ] /health/perf db_pool_mode == 'session (QueuePool)' o
    'transaction (NullPool)' explícito
[ ] db_pool_size <= 3 (anti-EMAXCONNSESSION)
[ ] WEB_CONCURRENCY (workers) == 1
[ ] CREDENTIALS_FERNET_KEY presente en env
[ ] /admin/system-status sin proyectos incompletos
[ ] Backups recientes (< 36h)
[ ] 0 errores 5xx en últimos 100 logs Fly
[ ] 0 EMAXCONNSESSION en últimos 100 logs Fly
[ ] 0 credential_decrypt_failed en últimos 100 logs Fly
[ ] tests/ → 1100+ pass
[ ] alembic chain no roto (o documentado workaround)
[ ] frontend build → 0 TS errors
[ ] frontend build → 0 ESLint errors críticos (warnings OK)
```

Si alguna falla → **STOP, escalar, no modificar más**.

---

## 9. Cómo invocar este prompt

### 9.1. Briefing a un nuevo agente IA

```
Antes de hacer ningún cambio en Ram-Cehta, leer y absorber:
1. docs/SUPER_PROMPT_MAESTRO.md (este documento) — invariantes y reglas
2. docs/RUNBOOK_INCIDENTES.md — qué hacer si algo falla
3. docs/bloque_e_corfo_revtech_trongkai.md — contexto operativo CORFO
4. Round más reciente en backend/scripts/sql/roundNNN_INSTRUCCIONES.md

Sólo después, proponer el cambio. Si el cambio toca un invariante de la
sección 1, RECHAZAR el pedido y proponer alternativa.

Cada round nuevo es ≤ 1 commit, con tests, lint pass, deploy verificado.
```

### 9.2. Checklist pre-decisión técnica

Antes de aceptar cualquier "vamos a hacer X":

1. ¿X viola alguno de los 22 invariantes de §1? → **NO**, ofrecer alternativa
2. ¿X requiere migración SQL? → preparar archivo
   `scripts/sql/roundNNN_*.sql` + instrucciones MD
3. ¿X toca credenciales sensibles? → usar `credentials_service.encrypt_*`,
   nunca plaintext
4. ¿X depende de una API externa (SII/Nubox/Previred)? → tener fallback
   manual (upload CSV/Excel)
5. ¿X reemplaza algo existente? → preservar la vieja vía hasta que la
   nueva esté verificada en producción 2 semanas
6. ¿X mejora algún KPI medible? → declarar el KPI y cómo se mide

### 9.3. Frase de cierre operativo

Siempre que se cierre una operación importante (cierre mes, deploy
crítico, pago grande), el operador escribe en el log:

> **"Todo cuadrado, todo trazable, todo respaldado."**

Si en algún punto esa frase no es verdadera → **no avanzar**, llamar
soporte/dev/Claude.

---

## 10. Anexo · Contactos críticos

| Función | Contacto | Cuándo escalar |
|---|---|---|
| Soporte plataforma técnica | Nicolás Rietta + Claude | Cualquier 500 / dato faltante |
| Contabilidad oficial | MCG Consultores | Discrepancia voucher vs Nubox |
| Asesoría tributaria | (definir) | Antes de cualquier estructura nueva |
| Legal corporativo | (definir) | Antes de modificar estatutos |
| Banco Santander | Ejecutivo cuenta | Problemas con transferencias |
| Soporte SII | sii.cl 600-525-5050 | Rechazo de DTE / fiscalización |
| Soporte Nubox | soporte@nubox.com | Credenciales API / errores |
| Soporte Previred | 600-600-3000 | Rechazo de cotizaciones |

---

## Cierre

Este documento es **vivo**. Cada vez que:
- Cambia una regla del SII → actualizar §1.2 y §2.2
- Cambia un proceso → actualizar §3
- Cambia el stack → actualizar §0.3
- Aparece un patrón nuevo de riesgo → actualizar §1 (invariantes)

**El éxito de Ram-Cehta no es "no tener bugs hoy" — es "que el sistema
nunca pueda generar contingencia mañana"**. Cada decisión técnica se
evalúa contra ese estándar.

*Cehta Capital · FIP CEHTA ESG · 2026 — Ram-Cehta v124*
