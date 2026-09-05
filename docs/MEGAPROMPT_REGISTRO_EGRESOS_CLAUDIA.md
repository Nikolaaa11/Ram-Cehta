# PROMPT MAESTRO SUPREMO · Registro de egresos CORFO (la sección de Claudia)

> Pedido de Nicolás (2026-09-02), literal: *"necesito agregarle estos datos a
> la sección de Claudia y crees alguna manera de ingresar los datos como si
> fuera un excel pero al hacerle click sale toda la información del monto,
> que es la misma información que pide CORFO y tiene la facultad de separar
> por porcentaje qué paga Cehta y qué paga el P-tec, hazlo que quede con un
> diseño estilo Apple y que se pueda ver bien, que sea fácil de utilizar y
> amigable, que se puedan almacenar datos mes a mes y que queden todos
> registrados, que sea una sección especial y única para Claudia."*
>
> Adjuntos: `CC Bancos_Revtech.xlsx` y `Cuenta Bancos_trongkai.xlsx`.

Este documento es a la vez la **especificación** (lo que se construye y por
qué), el **contrato** (nombres de tablas, endpoints, campos y funciones que
backend, importador y frontend comparten) y el **plan de ejecución** con
agentes en paralelo. Quien construya una parte lee este archivo primero.

---

## 0. Lectura honesta del pedido

| Lo que pidió | Lo que significa en la plataforma |
|---|---|
| "estos datos" | La hoja **Registro de Egresos** de cada Excel: 273 filas de REVTECH y 426 de TRONGKAI, nov-2025 → ago-2026. Es el registro real de Claudia, no un ejemplo. |
| "ingresar como si fuera un Excel" | Una grilla editable con teclado, pegado masivo desde Excel y una fila vacía siempre lista al final. Sin formularios de 20 campos para cada gasto. |
| "al hacer click sale toda la información del monto" | Click en la fila → panel lateral con la **ficha completa** del gasto: documento, pagos, reparto por fuente, historial de cambios y las columnas oficiales de CORFO. |
| "la misma información que pide CORFO" | Las **21 columnas de `Carga_Gastos`** (planilla oficial del folio 2024-265638, ya codificada en `corfo_rendiciones.py`) y sus catálogos (`core.corfo_catalogos`: cuenta, ítem, etapa, tipo de documento). |
| "separar por porcentaje qué paga Cehta y qué paga el P-tec" | La **SEPARACIÓN VALORES** del Excel: Subsidio CORFO / Cehta-Ptec / Cehta (+ Trewaox en TRONGKAI). Se edita por % o por monto, y la suma cierra exacto contra el total. |
| "almacenar mes a mes" | Cada gasto pertenece a un `periodo` (YYYY-MM) derivado de su fecha. La pantalla navega por meses con contadores y totales. |
| "que queden todos registrados" | Historial inmutable: cada alta, edición y borrado deja un snapshot completo con quién y cuándo. Borrado lógico con motivo; nada se pierde. |
| "sección especial y única para Claudia" | Nueva entrada **Registro de egresos** dentro del grupo `ClaudIA · CORFO 2026` del sidebar, con el mismo gate de acceso (Claudia, equipo REVTECH/TRONGKAI, admins) **también en el backend** — hoy ese grupo se protege solo en el sidebar. |

### Lo que NO se promete

- **Cuadrar el Excel solo.** El Excel trae filas sin clasificar (115 en REVTECH,
  66 en TRONGKAI) y repartos que no suman el total (2 y 17). Se importan
  **tal cual** y la pantalla las marca en ámbar para que Claudia las
  resuelva. Inventar el reparto sería mentirle a CORFO.
- **El vocabulario exacto de "Fuente Financiamiento" de CORFO.** No está en
  los catálogos cargados. Se ofrecen valores sugeridos (`SUBSIDIO`,
  `APORTE PECUNIARIO`, `APORTE VALORIZADO`) y el campo queda libre hasta que
  Claudia confirme con su ejecutivo.
- **Las hojas bancarias (`CC_Santander`, `CC_BancoChile`, `CC_BCI`) ni la hoja
  `Flujo`.** Son cartolas y flujo de caja: otro dominio (`core.movimientos`,
  hoy vacío tras la marcha blanca). Quedan como pendiente explícito.

---

## 1. Reconocimiento (lo que hay, medido)

### 1.1 La sección de Claudia hoy

- Claudia González, `claudia@trongkai.com` — roles `REVTECH:GG`,
  `TRONGKAI:GG`, `TRONGKAI:CONTADOR`; último ingreso 2026-08-18.
- Sidebar, grupo `ClaudIA · CORFO 2026` (whitelist `claudia@trongkai.com` +
  dominios `@trongkai.com`, `@revtech.cl`, `@revtech.com` + admins):
  `/claudia` (home), `/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI`,
  `/vouchers/corfo`, `/admin/rendiciones-corfo`, `/admin/rendiciones-corfo/mapping`,
  `/sugerencias`.
- Subsidio `CORFO-2026-REVTECH-TRONGKAI` ($3.000MM), proyectos
  `PRJ-REVTECH-COR-001` / `PRJ-TRONGKAI-COR-001` con reparto default
  50% CORFO / 20% P-tec / 30% empresa.
- Vouchers CORFO reales en producción: **1 DRAFT** en TRONGKAI. O sea: el
  flujo de vouchers existe pero Claudia lleva la operación real en Excel.
  Este registro es donde está su verdad.
- `core.corfo_catalogos` (58 valores oficiales): `cuenta_gastos` (22),
  `item_gastos` (14), `etapa` (3), `tipo_doc_gastos` (7), `cuenta_rrhh` (7),
  `tipo_doc_rrhh` (5).
- Empresas: REVTECH = Ingeniería e Innovación SpA (77.018.739-7);
  TRONGKAI = Agrotecnologías e Ingeniería SpA (77.221.203-8). *(El dashboard
  del Excel "Revtech" dice "Agrotecnologías": es un título heredado de la
  plantilla, los datos —Camilo Salazar, Nicolás Rietta— son de REVTECH.)*

### 1.2 Los Excel, medidos

Hoja `Registro de Egresos`, encabezados en la fila 3:

| | REVTECH | TRONGKAI |
|---|---|---|
| Filas con datos | 273 | 426 |
| Rango | 2025-11-03 → 2026-08-27 | 2025-11-01 → 2026-08-24 |
| Total | $291.145.758 | $360.226.830 |
| Columnas de reparto | Subsidio · Cehta-Ptec · Cehta | **Trewaox** · Subsidio · Cehta-Ptec · Cehta |
| Reparto | 137,1M / 55,6M / 41,0M | 21,6M / 146,0M / 27,7M / 137,0M |
| Sin clasificar (4 vacías) | 115 | 66 |
| Reparto que no suma el total | 2 | 17 |
| Reparto mixto (>1 fuente) | 35 | 155 |
| `neto + impuesto ≠ total` | 0 | 46 |
| Estados | 245 pagado · 28 pendiente | 360 pagado · 1 parcial · 65 pendiente |
| Filas con fecha inválida | 2 | 0 |
| Tipos de documento | Factura 88 · Boletas 67 · Boleta Honorario 45 · Factura Exenta 34 · liquidación 25 · Co-Ejecutor 14 | Factura 190 · Boleta 103 · Boleta Honorario 75 · Liquidación 28 · Factura Exenta 20 · Co-Ejecutor 10 |
| Columna extra | `Fuente` | `Tipo Financiamiento` (Corfo/Cehta/InnovaRegion) |

Columnas (REVTECH): `Fecha, Descripción, RUT Emisor, Tipo de Documento, Folio,
Monto Neto/Pagado, Impuesto/Patronal, Total, Tipo de Egreso, Fuente, Proyecto,
Subsidio, Cehta-Ptec, Cehta, Estado, Fecha de Pago`.
TRONGKAI: igual, pero `Tipo Financiamiento, Tipo de Egreso, Proyecto, Trewaox,
Subsidio, Cehta-Ptec, Cehta, Estado, Fecha de Pago`.

Detalles sucios reales (el importador los trata todos): nombres con `\xa0`
al final, estados con símbolo (`✓ Pagado`, `◑ Pagado Parcial`, `✗ Pendiente`),
folios numéricos, totales con 4 decimales (conversiones desde UF), "Boletas"
y "Boleta" para lo mismo, "liquidación" en minúscula.

### 1.3 Proveedores

De los RUT del Excel, algunos existen en `core.proveedores` (PROGARANTIA,
MCG) y muchos no (personas con boleta de honorarios). El registro guarda
`rut_emisor` + `descripcion` tal cual: **no** crea proveedores ni exige que
existan. Vincularlos es un paso posterior, opcional.

---

## 2. Decisiones de diseño

1. **Una tabla propia, no vouchers.** `core.corfo_registro_egresos`. Un
   voucher es un asiento contable con doble partida y dos firmas; el registro
   de Claudia es un libro operativo de rendición. Mezclarlos habría obligado a
   Claudia a contabilizar para poder rendir. Más adelante un gasto podrá
   "convertirse en voucher" (pendiente).
2. **Los montos mandan, los porcentajes se derivan.** El Excel guarda pesos por
   fuente; la plataforma también. El % es una forma de editar: `50/20/30` se
   convierte a pesos enteros (HALF_UP) y el residuo va a la fuente mayor, así
   la suma es exactamente el total. Motor puro en
   `backend/app/domain/value_objects/reparto_corfo.py` (ya escrito y testeado).
3. **Sin clasificar ≠ descuadrado.** Tres estados del reparto:
   `SIN_CLASIFICAR` (las 4 fuentes NULL), `OK` (suma exacta),
   `DESCUADRADO`. La BD exige todo-o-nada (CHECK); el cuadre lo exige la API
   en lo que se crea/edita desde la pantalla, **no** la BD, para poder
   importar el Excel fielmente y mostrar los descuadres.
4. **Mes = fecha del documento.** `periodo` lo deriva un trigger BEFORE desde
   `fecha`. No hay forma de guardar un gasto en un mes que no es el suyo.
5. **Historial inmutable por trigger.** `core.corfo_registro_egresos_hist`
   guarda snapshot JSONB + versión + quién + cuándo en cada INSERT/UPDATE/DELETE;
   un trigger bloquea UPDATE/DELETE sobre el historial. La ficha muestra el
   diff campo a campo entre versiones.
6. **Borrado lógico con motivo.** `deleted_at + deleted_by + delete_motivo`
   (CHECK: sin motivo no hay borrado). La API nunca hace DELETE físico.
7. **Import idempotente.** Cada fila del Excel recibe `import_natural_key`
   (huella de empresa + RUT + tipo + folio + fecha + total + descripción +
   ordinal de aparición dentro del archivo, porque las filas idénticas son
   pagos reales: cuotas a co-ejecutores, peajes); índice único parcial.
   Re-importar el mismo archivo no duplica nada y el resumen dice cuántas ya
   existían.
8. **Trewaox es una fuente más, no una excepción.** Las 4 fuentes existen en
   ambas empresas; en la pantalla Trewaox se muestra sólo si la empresa tiene
   montos ahí o si Claudia lo activa ("+ fuente"). Así no aparecen columnas
   vacías en REVTECH ni se esconde nada en TRONGKAI.
9. **Las columnas CORFO viven en la misma fila.** `corfo_cuenta`, `corfo_item`,
   `corfo_etapa`, `corfo_fuente_financiamiento`, `corfo_fecha_recepcion`,
   `corfo_monto_rendir`, `corfo_monto_cancelado`, `corfo_forma_pago`,
   `corfo_glosa`, `corfo_receptor_rut`, `corfo_receptor_nombre`. El export
   `Carga_Gastos` (21 columnas oficiales) sale directo de acá, con defaults
   honestos: *Monto Rendir* = `monto_subsidio` si no se cargó otro; *Monto
   Cancelado* = total si está PAGADO.
10. **Gate en el backend.** `_check_claudia_access`: admin, o email en la
    whitelist/dominios del grupo ClaudIA, o rol activo en REVTECH/TRONGKAI.
    Más `assert_empresa_access` por empresa y `empresa ∈ {REVTECH, TRONGKAI}`.
11. **Plata como string.** Todos los montos viajan como string decimal en la
    API (regla de la plataforma: es plata, no float). El frontend calcula en
    centavos enteros y tiene test de paridad contra el motor Python.

---

## 3. Contrato

### 3.1 Base de datos — `backend/scripts/sql/corfo_registro_egresos.sql` (APLICADO en prod 2026-09-02)

`core.corfo_registro_egresos` (columnas exactas):

```
egreso_id BIGSERIAL PK · empresa_codigo FK core.empresas · periodo 'YYYY-MM' (trigger)
fecha DATE · descripcion TEXT (no vacía) · rut_emisor TEXT (trigger: sin puntos, K mayúscula)
tipo_documento IN (FACTURA, FACTURA_EXENTA, BOLETA, BOLETA_HONORARIO, LIQUIDACION, CO_EJECUTOR, INVOICE, OTRO)
folio TEXT · monto_neto NUMERIC(18,2) · impuesto NUMERIC(18,2) · total NUMERIC(18,2) >= 0
tipo_egreso TEXT · fuente TEXT · proyecto TEXT      (texto libre, con autocompletar)
estado_pago IN (PAGADO, PARCIAL, PENDIENTE) · fecha_pago DATE
monto_subsidio · monto_cehta_ptec · monto_cehta · monto_trewaox   NUMERIC(18,2)  (todo-o-nada)
corfo_cuenta · corfo_item · corfo_fuente_financiamiento · corfo_etapa TEXT
corfo_fecha_recepcion DATE · corfo_monto_rendir · corfo_monto_cancelado NUMERIC(18,2)
corfo_forma_pago · corfo_glosa · corfo_receptor_rut · corfo_receptor_nombre TEXT
observaciones TEXT · adjunto_dropbox_path TEXT
origen IN (UI, PASTE, IMPORT_EXCEL) · import_natural_key TEXT (único parcial)
created_by/created_at · updated_by/updated_at · deleted_at/deleted_by/delete_motivo
```

`core.corfo_registro_egresos_hist(hist_id, egreso_id, version, accion, snapshot JSONB, changed_by, changed_at)` — inmutable.
`changed_by` = `updated_by` (o `created_by`, o `deleted_by` en DELETE): **la API
siempre escribe `updated_by = email del usuario`** en cada UPDATE.

### 3.2 Motor de reparto — `app/domain/value_objects/reparto_corfo.py` (LISTO, 21 tests)

```python
FUENTES = ("subsidio", "cehta_ptec", "cehta", "trewaox")
ETIQUETAS = {"subsidio": "Subsidio CORFO", "cehta_ptec": "Cehta · aporte P-tec",
             "cehta": "Cehta (fuera del subsidio)", "trewaox": "Trewaox · Innova Región"}
ESTADO_SIN_CLASIFICAR | ESTADO_OK | ESTADO_DESCUADRADO
normalizar_montos(montos) -> dict[fuente, Decimal|None]      # todo-o-nada, 2 decimales
repartir_por_pct(total, pcts) -> dict[fuente, Decimal]        # suma == total exacto; RepartoInvalidoError
estado_reparto(total, montos) -> str
pct_desde_montos(total, montos) -> dict[fuente, Decimal] | None   # cierra 100.00 si OK; crudo si DESCUADRADO
```

Reglas fijadas por test: pesos enteros HALF_UP; residuo (incluidos los
centavos del total) a la fuente con mayor %; empate → primera en `FUENTES`;
% fuera de 0..100 o suma ≠ 100 (±0,01) → error con mensaje en español.

### 3.3 API — `backend/app/api/v1/claudia_egresos.py`, prefijo `/claudia/egresos`, tag `claudia-egresos`

Registrar en `app/api/v1/__init__.py` junto a `corfo_rendiciones`. Schemas en
`backend/app/schemas/claudia_egresos.py`. `CORFO_EMPRESAS` se importa de
`corfo_rendiciones`. Toda ruta: `_check_claudia_access(user, db)` +
`assert_empresa_access(user, db, empresa)` + empresa ∈ CORFO_EMPRESAS (400).
Ruta estáticas (`/periodos`, `/resumen`, `/catalogos`, `/batch`, `/importar`,
`/exportar.xlsx`) declaradas ANTES de `/{egreso_id}`.

**`EgresoRead`** (montos como string, fechas ISO):
```json
{"egreso_id": 1, "empresa_codigo": "REVTECH", "periodo": "2026-08", "fecha": "2026-08-27",
 "descripcion": "MCG AUDITORES CONSULTORES SPA", "rut_emisor": "76642280-2",
 "tipo_documento": "FACTURA", "folio": "10540",
 "monto_neto": "79287.00", "impuesto": "15065.00", "total": "94352.00",
 "tipo_egreso": "Cehta", "fuente": "Cehta", "proyecto": "Cehta",
 "estado_pago": "PAGADO", "fecha_pago": "2026-01-08",
 "reparto": {"subsidio": "0.00", "cehta_ptec": "0.00", "cehta": "94352.00", "trewaox": "0.00"},
 "reparto_pct": {"subsidio": "0.00", "cehta_ptec": "0.00", "cehta": "100.00", "trewaox": "0.00"},
 "reparto_estado": "OK",
 "corfo": {"cuenta": null, "item": null, "fuente_financiamiento": null, "etapa": null,
           "fecha_recepcion": null, "monto_rendir": null, "monto_cancelado": null,
           "forma_pago": null, "glosa": null, "receptor_rut": null, "receptor_nombre": null},
 "observaciones": null, "adjunto_dropbox_path": null, "origen": "IMPORT_EXCEL",
 "neto_mas_impuesto_cuadra": true,
 "created_at": "…", "created_by": "…", "updated_at": "…", "updated_by": "…", "version": 2}
```
`reparto` y `reparto_pct` son `null` cuando SIN_CLASIFICAR. `version` = último
número de versión del historial.

**`EgresoCreate`**: `empresa_codigo, fecha, descripcion, rut_emisor?, tipo_documento,
folio?, monto_neto?, impuesto?, total, tipo_egreso?, fuente?, proyecto?,
estado_pago='PENDIENTE', fecha_pago?, reparto?` (montos) **o** `reparto_pct?`
(la API convierte con `repartir_por_pct`), `corfo?` (sub-objeto parcial),
`observaciones?, adjunto_dropbox_path?, origen='UI'|'PASTE'`.
Reglas (422 con mensaje en español): `total >= 0`; `reparto` y `reparto_pct`
a la vez → 422; `reparto` debe sumar exactamente `total`; si vienen
`monto_neto` e `impuesto` deben sumar `total`; si viene uno solo, el otro es
la diferencia (nunca negativa → 422); si no viene ninguno,
`monto_neto = total, impuesto = 0`; `estado_pago = PAGADO` sin `fecha_pago`
se acepta (el Excel tiene 5 así) pero `neto_mas_impuesto_cuadra` y la
pantalla lo señalan; RUT se valida con `app.domain.value_objects.rut` si
viene (RUT inválido → 422).
Topes de texto libre (S1, 422 `campo: máximo N caracteres`): `descripcion`
≤ 500, `folio` ≤ 50, `tipo_egreso`/`fuente`/`proyecto` ≤ 120,
`observaciones` ≤ 2000, `adjunto_dropbox_path` ≤ 500, los 8 textos de
`corfo` (`cuenta, item, fuente_financiamiento, etapa, forma_pago, glosa,
receptor_rut, receptor_nombre`) ≤ 200. Valen igual en Create, batch y Update.

**`EgresoUpdate`**: todos opcionales (PATCH-like vía PUT); `empresa_codigo`
no editable (422); `fecha, descripcion, tipo_documento, total, estado_pago`
no aceptan `null` explícito (422). Escribe `updated_by`. Reglas de plata
sobre lo que el PUT toca (`model_fields_set`), implementadas en
`fusionar_update`:
- Toca `monto_neto` y/o `impuesto` → lo que vino manda y lo que falta **o
  vino en `null` explícito** se resuelve como en Create: los dos en `null`
  → `neto = total, impuesto = 0`; uno solo → el otro es la diferencia.
- Toca **sólo** `total` → se conserva el impuesto y el neto absorbe (si el
  impuesto ya no cabe en el total nuevo, se recalcula desde cero). Es la
  única situación en que se conserva el impuesto.
- Toca `reparto` / `reparto_pct` → cuadre exacto contra el total (nuevo o
  vigente) o 422; `reparto: null` deja SIN_CLASIFICAR.
- Toca `total` **sin** tocar el reparto → si el reparto vigente está `OK`
  contra el total viejo se reescala con `escalar_reparto(total_viejo,
  total_nuevo, montos)` (proporción exacta por fuente, HALF_UP a peso,
  residuo a la fuente mayor; **sin** pasar por %: PROYECTA 590.777 →
  496.451 da 417.185 / 79.266); si está `DESCUADRADO` se deja tal cual
  (sigue en ámbar, **no** 422); SIN_CLASIFICAR sigue sin clasificar.
  Nunca se rechaza un PUT por un reparto que el cliente no tocó.

| Método y ruta | Devuelve |
|---|---|
| `GET /claudia/egresos?empresa=&periodo=&q=&estado_pago=&reparto_estado=` | `{empresa_codigo, periodo, items: [EgresoRead], n, truncado}` — `periodo` opcional (omitido = todos), orden `fecha DESC, egreso_id DESC`, tope 2000, excluye borrados. `q` busca ilike en descripción/RUT/folio. |
| `GET /claudia/egresos/periodos?empresa=` | `{items: [{periodo, n, total, pendiente, sin_clasificar, descuadrados}], n_total, total_general}` orden periodo DESC. |
| `GET /claudia/egresos/resumen?empresa=&periodo=` | `{empresa_codigo, periodo, n, total, por_fuente: {subsidio, cehta_ptec, cehta, trewaox, sin_clasificar}, por_estado: {PAGADO: {n, monto}, PARCIAL: {…}, PENDIENTE: {…}}, pct_pagado, por_tipo_documento: [{tipo_documento, n, monto}], descuadrados, sin_clasificar}` |
| `GET /claudia/egresos/catalogos?empresa=` | Schema **`ClaudiaCatalogosResponse`** (con prefijo: `schemas/catalogo.py` ya tiene `CatalogosResponse` y dos homónimas rompen `gen:types`): `{tipos_documento: [{codigo, label}], estados_pago: [{codigo, label}], fuentes: [{codigo, label}], formas_pago: [...], corfo: {cuenta_gastos, item_gastos, etapa, tipo_doc_gastos, fuente_financiamiento_sugeridas}, sugerencias: {tipo_egreso: [...], fuente: [...], proyecto: [...]}}` (sugerencias = valores distintos ya usados por esa empresa). |
| `GET /claudia/egresos/{id}` | `EgresoRead` + `historial: [{version, accion, changed_at, changed_by, cambios: [{campo, antes, despues}]}]` (diff entre snapshots consecutivos; v1 = INSERT sin cambios). |
| `POST /claudia/egresos` | 201 `EgresoRead` |
| `PUT /claudia/egresos/{id}` | `EgresoRead` |
| `POST /claudia/egresos/batch` `{empresa_codigo, filas: [EgresoCreate sin empresa_codigo]}` | `{creados: [EgresoRead], n}` — todo o nada; máx 500; errores 422 `detail: [{fila, error}]` con `error` en español (`_mensaje_validacion` traduce los genéricos de pydantic: `descripcion: máximo 500 caracteres`, `total: falta este campo`, `fecha: fecha inválida (usá AAAA-MM-DD)`, `tipo_documento: valor no válido (esperado: …)`). `origen='PASTE'`. |
| `DELETE /claudia/egresos/{id}` body `{motivo}` (5 a 500 chars) | `{egreso_id, deleted_at}` (lógico) |
| `POST /claudia/egresos/importar` multipart `archivo` (.xlsx), `empresa_codigo`, `dry_run` | `{empresa_codigo, dry_run, leidas, creadas, omitidas_existentes, duplicadas_en_excel, saltadas: [{fila_excel, motivo}], descuadradas, sin_clasificar}`. `leidas` = filas con datos del Excel (cargables + saltadas). `duplicadas_en_excel` = filas idénticas a otra del mismo Excel que **se cargaron igual** (son pagos distintos) con huella propia y observación `Idéntica a la fila N del Excel (aparición n): verificar que sea un gasto distinto`. 415 si no es `.xlsx`; **413** si supera 15 MB (se corta con el `size` declarado antes de leer y, si no viene, leyendo de a 1 MiB apenas se pasa: nunca se materializa un upload gigante); 422 si está vacío o no tiene la hoja. |

Rutas por id (`GET`/`PUT`/`DELETE /{id}`), en orden: gate del grupo ClaudIA
(403 con detalle, **antes** de leer la fila) → la fila existe y no está
borrada → la empresa de la fila está en el scope del usuario
(`get_allowed_empresa_codes`, sin pasar por `assert_empresa_access`). Una
fila que existe pero es de una empresa fuera del scope responde **el mismo
404** `No existe el gasto #N (o fue borrado)` que una inexistente, sin
registrar violación de scope: así no se pueden enumerar ids de la otra
empresa.
| `GET /claudia/egresos/exportar.xlsx?empresa=&periodo=` | XLSX con 2 hojas: **Registro de Egresos** (las 17 columnas de Claudia, incluida Trewaox) y **Carga_Gastos** (21 columnas oficiales, mismo orden que `corfo_rendiciones.py`). Sanitizar con el patrón `_XML_ILEGAL` de `exports.py`; `Content-Disposition` con nombre `registro_egresos_{empresa}_{periodo}.xlsx`. |

Mapeo `tipo_documento` → vocabulario CORFO (`tipo_doc_gastos`) para
`Carga_Gastos`: FACTURA→FACTURA · FACTURA_EXENTA→FACTURA · BOLETA→BOLETA ·
BOLETA_HONORARIO→BOLETA HONORARIOS · LIQUIDACION→LIQ. SUELDO · INVOICE→INVOICE ·
CO_EJECUTOR→OTRO · OTRO→OTRO. `Periodo` CORFO con `_periodo_to_corfo`
("Ago de 2026").

### 3.4 Importador — `backend/app/services/corfo_egresos_import_service.py`

```python
@dataclass FilaEgreso: fecha, descripcion, rut_emisor, tipo_documento, folio, monto_neto,
    impuesto, total, tipo_egreso, fuente, proyecto, estado_pago, fecha_pago,
    monto_subsidio, monto_cehta_ptec, monto_cehta, monto_trewaox,
    observaciones, import_natural_key, fila_excel
@dataclass ResultadoParseo: filas: list[FilaEgreso]; saltadas: list[FilaSaltada(fila_excel, motivo)];
    repetidas_en_excel: list[int]     # n-ésimas apariciones que SE CARGAN (están también en `filas`)
    duplicadas_en_excel: list[int]    # n-ésimas apariciones colapsadas (sólo con conservar_repetidas=False)
    columnas: list[str]
    leidas (property) = len(filas) + len(saltadas) + len(duplicadas_en_excel)   # filas con datos del Excel
def parsear_registro_egresos(contenido: bytes, empresa_codigo: str, *,
                             conservar_repetidas: bool = True) -> ResultadoParseo   # puro, openpyxl
async def cargar_filas(db, empresa_codigo, filas, usuario_email, dry_run=False) -> ResumenCarga
```
Reglas del parser: hoja `Registro de Egresos` (o la primera que tenga esos
encabezados); encabezados detectados **por nombre** (fila 3, tolerante a
mayúsculas/acentos) — funciona con las dos variantes de columnas; `\xa0` y
espacios recortados; tipo de documento normalizado (`Boletas`/`Boleta` →
BOLETA, `liquidación` → LIQUIDACION, `Co-Ejecutor` → CO_EJECUTOR, desconocido →
OTRO y el original va a `observaciones`); estado por símbolo/palabra
(`✓`/`Pagado` → PAGADO, `◑`/`Parcial` → PARCIAL, `✗`/`Pendiente` → PENDIENTE,
vacío → PENDIENTE); fecha no-date → fila saltada con motivo; folio int → str;
montos a Decimal 2 decimales; las 4 fuentes vacías → NULL, si alguna trae
valor las demás → 0; RUT normalizado.
**Neto e impuesto** (D2, mismo default que la API): los dos vacíos →
`monto_neto = total, impuesto = 0` + observación `Neto e impuesto vacíos en
el Excel`; viene uno solo → el otro es la diferencia (`total − el que vino`);
si diera negativo no se inventa nada: quedan como vinieron (el vacío en 0) y
la observación lo dice; los dos con valor → tal cual, sumen o no. Así
`neto + impuesto ≠ total` queda sólo en las filas con diferencia real
(16 en TRONGKAI, 0 en REVTECH). Lo ilegible queda en 0 con observación y no
deriva nada.
**Huella e idénticas** (D1): `import_natural_key =
sha1("{empresa}|{rut}|{tipo}|{folio}|{fecha}|{total:.2f}|{descripcion.lower()}")`
para la primera aparición y `sha1(base + "|#n")` para la n-ésima fila
idéntica del mismo archivo (estable entre corridas). Las idénticas son pagos
reales (8 en REVTECH, 23 en TRONGKAI: cuotas a co-ejecutores, peajes) y
**entran todas**: la n-ésima con observación `Idéntica a la fila N del Excel
(aparición n): verificar que sea un gasto distinto` y su número en
`repetidas_en_excel`. Con `conservar_repetidas=False` sólo entra la primera
y las demás van a `duplicadas_en_excel` sin cargarse. Re-importar el mismo
archivo crea 0 filas en los dos modos.
`cargar_filas`: `INSERT … ON CONFLICT (import_natural_key) WHERE
import_natural_key IS NOT NULL DO NOTHING`, `origen='IMPORT_EXCEL'`,
`created_by=usuario_email`; `dry_run` no escribe; devuelve conteos reales.
`POST /importar` usa el default del parser (entran todas) y responde
`leidas = ResultadoParseo.leidas`, `duplicadas_en_excel =
len(repetidas_en_excel)`.

Medido sobre los Excel reales con `--dry-run`: REVTECH 273 leídas = 271 a
cargar + 2 saltadas (fecha inválida), 8 repetidas, $285.195.758; TRONGKAI
426 leídas = 426 a cargar, 23 repetidas, $360.226.830, 16 con
`neto + impuesto ≠ total`.

CLI `backend/scripts/importar_registro_egresos_excel.py`:
`--empresa REVTECH --archivo ruta.xlsx [--dry-run] [--json-out ruta]
[--colapsar-repetidas]` (parsea local y muestra resumen; `--json-out`
escribe las filas como JSON —con `repetidas_en_excel` y
`duplicadas_en_excel`— para cargarlas en Fly con `--json-in` sin necesidad
de subir el .xlsx). `--colapsar-repetidas` es el opt-in al comportamiento
viejo (sólo entra la primera idéntica); `--conservar-repetidas` se sigue
aceptando como no-op porque ya es el default.

### 3.5 Frontend — ruta `/claudia/egresos`

Archivos: `frontend/app/(app)/claudia/egresos/page.tsx`;
`frontend/components/claudia/{EgresosGrid,EgresoSheet,RepartoEditor,EgresosKpis,PeriodoChips,ImportarExcelDialog}.tsx`;
`frontend/lib/claudia/reparto.ts` (espejo TS del motor: `FUENTES`, `ETIQUETAS`,
`repartirPorPct`, `pctDesdeMontos`, `estadoReparto` en centavos enteros);
`frontend/lib/claudia/pegar-egresos.ts` (pegado TSV desde Excel con el orden
de columnas de Claudia, con o sin fila de encabezados).

Pantalla (estilo Apple = los tokens que ya tiene la plataforma: `surface-muted
#f5f5f7`, `ink-900/700/500/300`, `hairline`, `rounded-2xl/3xl`, `shadow-card`,
`font-display`, `cehta-green`, `tabular-nums`; mucho aire, jerarquía por
peso tipográfico, sin bordes gruesos, transiciones de 150–200 ms):

1. **Header**: eyebrow "ClaudIA · CORFO 2026", título "Registro de egresos",
   control segmentado **REVTECH | TRONGKAI** (recuerda la última en
   `localStorage`), botones "Importar Excel", "Exportar" (Registro +
   Carga_Gastos) y "+ Nuevo gasto".
2. **Meses**: chips horizontales (`Ago 2026 · 30 · $12,4M`), "Todos" al
   inicio; chip con punto ámbar si el mes tiene descuadrados/sin clasificar.
3. **KPIs** del mes: Total egresos · Subsidio CORFO · Cehta-Ptec · Cehta ·
   (Trewaox si aplica) · % pagado, con `AnimatedNumber` y una barra apilada
   por fuente (colores: subsidio `cehta-green`, cehta_ptec `sf-blue`, cehta
   `ink-500`, trewaox `sf-teal`, sin clasificar `warning` rayado).
4. **Grilla** (la parte "como Excel"): columnas Fecha · Descripción · RUT ·
   Tipo doc · Folio · Neto · Impuesto · **Total** · Reparto (mini barra +
   badge OK/ámbar) · Estado · Fecha pago. Header sticky, filas `hairline`,
   números `tabular-nums` alineados a la derecha, sin decimales de relleno
   (`toCLP`). **Edición inline** (doble click o Enter en la celda; Tab/Shift+Tab
   avanza; ↑↓ cambia de fila; Esc cancela; blur guarda con `PUT`; la fila
   parpadea suave al guardar). **Fila nueva** siempre al final ("+ Nuevo
   gasto": al completar Total y salir, hace `POST`). **Pegar** desde Excel
   (Ctrl+V sobre la grilla) → parsea → muestra "Vas a agregar N gastos por
   $X" → `POST /batch`. Filas borradas no aparecen; hay un toggle "ver
   borrados" opcional (no bloqueante).
5. **Ficha lateral** (click en la fila, especialmente en el monto): panel que
   se desliza desde la derecha (`DialogContent` con clase lateral, 560 px,
   `sm:` full-screen en móvil), con tabs **Gasto** · **CORFO** · **Historial**.
   - *Gasto*: todos los campos del documento y pago, editables, guardan al
     blur; RUT con formato; autocompletar `tipo_egreso/fuente/proyecto` con
     las sugerencias del catálogo.
   - *Reparto* (dentro de Gasto, arriba): `RepartoEditor` con una fila por
     fuente (punto de color, etiqueta, **input %**, **input $**, barra),
     presets "100% Subsidio", "50 / 20 / 30 (default proyecto)", "100% Cehta",
     "Sin clasificar". Editar % recalcula $ (residuo a la mayor); editar $
     recalcula %. Indicador "Suma $X de $Y · cuadra ✓" en verde, o "faltan
     $Z" en ámbar; el guardado sólo se habilita cuadrado o sin clasificar.
   - *CORFO*: los 11 campos oficiales con los dropdowns de `core.corfo_catalogos`,
     defaults visibles en gris (*Monto rendir = Subsidio*, *Monto cancelado =
     Total si pagado*) y una vista previa de cómo saldrá la fila en
     `Carga_Gastos`.
   - *Historial*: lista de versiones (`v3 · hoy 14:02 · claudia@trongkai.com ·
     cambió Reparto: Subsidio $0 → $496.451`), sin botones: es sólo lectura.
   - Pie: "Eliminar" (pide motivo, borrado lógico) y "Duplicar" (copia la
     fila con fecha de hoy).
6. **Importar Excel**: diálogo con drop-zone, empresa, "Probar primero" (dry
   run) que muestra el resumen (leídas/creadas/existentes/saltadas con motivo)
   antes de "Importar de verdad".
7. **Accesibilidad**: todo operable con teclado, `aria-label` en celdas
   editables, foco visible, contraste AA.

Sidebar: nuevo item en el grupo `claudia`, justo después de "Mi workspace":
`{ href: "/claudia/egresos", label: "Registro de egresos", icon: Table2, isNew: true, title: "La planilla de gastos de Claudia dentro de la plataforma: grilla editable como Excel, ficha completa por gasto con las columnas oficiales CORFO, reparto por fuente y historial." }`.
Home `/claudia`: `QuickAction` "Registro de egresos" como primera acción
(grid `lg:grid-cols-5`) y paso 1 del flujo apuntando a `/claudia/egresos`.

### 3.6 Acceso

```python
CLAUDIA_EMAILS = {"claudia@trongkai.com"}
CLAUDIA_DOMAINS = ("@trongkai.com", "@revtech.cl", "@revtech.com")
async def _check_claudia_access(user, db) -> None:
    admin → ok; email en CLAUDIA_EMAILS o termina en CLAUDIA_DOMAINS → ok;
    rol activo en core.user_company_roles para REVTECH/TRONGKAI → ok;
    si no → 403 "Sección reservada a la coordinación CORFO (Claudia) y admins."
```
Espejo de `canSeeClaudiaGroup` del sidebar, que hoy es la única barrera.

---

## 4. Tests y paridad

- `backend/tests/unit/test_reparto_corfo.py` — 21 tests (LISTO).
- `backend/tests/unit/test_corfo_egresos_import.py` — parser sobre workbooks
  construidos en el test con openpyxl que reproducen **las dos** variantes
  de columnas y todos los detalles sucios de §1.2 (símbolos de estado, `\xa0`,
  folio int, fecha inválida, "Boletas", duplicado exacto, 4 fuentes vacías vs
  una con valor, total con 4 decimales). Verifica `import_natural_key`
  estable entre corridas.
- `backend/tests/unit/test_claudia_egresos_schemas.py` — reglas de
  `EgresoCreate/Update` (reparto vs reparto_pct, cuadre, neto+impuesto,
  RUT inválido, empresa no editable) y `_check_claudia_access` con usuarios
  falsos (admin / claudia / dominio / rol / ajeno → 403) usando un `db` falso
  con `execute` async.
- `backend/tests/unit/test_claudia_egresos_export.py` — la hoja `Carga_Gastos`
  tiene exactamente los 21 encabezados de `corfo_rendiciones.py`, en ese
  orden, y el mapeo de tipos de documento.
- `backend/scripts/gen_snapshot_reparto_corfo.py` → genera
  `backend/tests/fixtures/reparto_corfo_esperado.json` (casos: 50/20/30 con
  residuo, 33.33×3, centavos, 100% una fuente, empate, descuadre, sin
  clasificar). `test_reparto_corfo.py::test_snapshot_paridad` lo verifica en
  Python; `frontend/lib/__tests__/reparto-corfo.test.ts` lo verifica en TS.
- `frontend/lib/__tests__/pegar-egresos.test.ts` — pegado con y sin
  encabezados, montos con puntos de miles, fechas `dd-mm-yyyy` y
  `yyyy-mm-dd`, estados con símbolo.
- Suites completas verdes: `pytest -q` (backend) y `npm test` (frontend) +
  `tsc --noEmit` + `next lint`.
- E2E contra producción (lo corre Nicolás/Claude al final): import real de los
  dos Excel, `GET /periodos` y `/resumen` cuadran con la tabla de §1.2, y
  Playwright abre `/claudia/egresos` como admin y verifica grilla, ficha y
  reparto (la lección de la memoria: **verificar la UI, no sólo la API**).

---

## 5. Plan de ejecución (Ultracode)

Fase **Construir** — 3 agentes en paralelo, archivos disjuntos:

| Agente | Entrega |
|---|---|
| A · Importador | `corfo_egresos_import_service.py`, CLI, `test_corfo_egresos_import.py`, `gen_snapshot_reparto_corfo.py` + fixture + `test_snapshot_paridad`. |
| B · API | `claudia_egresos.py`, `schemas/claudia_egresos.py`, registro en `__init__.py`, export xlsx, gate, `test_claudia_egresos_schemas.py`, `test_claudia_egresos_export.py`. |
| C · Frontend | página, 6 componentes, 2 libs, 2 tests vitest, sidebar, home. |

Fase **Verificar** — 4 lentes independientes sobre lo construido (dinero y
redondeo · seguridad/tenant/SQL · contrato back↔front campo por campo ·
UX/accesibilidad/estilo + build), cada hallazgo pasa por 2 refutadores; los
confirmados se corrigen por área.

Cierre (a mano): `openapi.json` + `gen:types`, suites completas, commit, `fly
deploy` + `vercel deploy --prod`, import de los dos Excel a producción,
verificación E2E (API + Playwright), memoria.

---

## 6. Criterios de aceptación

- [ ] `/claudia/egresos` visible sólo para el grupo ClaudIA; la API responde
      403 a un usuario ajeno aunque conozca la URL.
- [ ] Los 273 + 426 gastos del Excel están en producción, con sus meses,
      estados y repartos tal cual; el resumen por empresa cuadra con §1.2.
- [ ] Re-importar el mismo Excel crea 0 filas nuevas.
- [ ] Click en un monto abre la ficha con documento, reparto, CORFO e
      historial; editar el reparto por % deja montos que suman el total al
      centavo; editar un monto recalcula los %.
- [ ] Pegar 3 filas desde Excel crea 3 gastos con `origen=PASTE`.
- [ ] Cada edición genera una versión en el historial con el diff legible.
- [ ] Borrar pide motivo y la fila desaparece de la grilla pero sigue en la
      BD y en el historial.
- [ ] El export trae la hoja `Carga_Gastos` con los 21 encabezados oficiales.
- [ ] Un mes sin gastos muestra un vacío honesto ("todavía no hay gastos en
      Sep 2026"), no ceros en verde.
- [ ] Todo con teclado; contraste AA; se ve bien en 1280 px y en móvil.

---

## 7. Fuera de alcance y decisiones pendientes

- Vocabulario oficial de *Fuente Financiamiento* en CORFO (confirmar con el
  ejecutivo; hoy texto libre con sugerencias).
- Cartolas bancarias y hoja `Flujo` de los Excel (`core.movimientos`, vacío).
- "Convertir gasto en voucher" y vincular `rut_emisor` con `core.proveedores`.
- Bloquear la edición de un gasto ya rendido a CORFO (necesita el concepto
  de "rendición enviada" que hoy no existe en la BD).
- Hoja `Carga_RRHH` (17 columnas): los 25 + 28 "liquidación" del Excel
  podrían salir de `/remuneraciones`, no de este registro.
