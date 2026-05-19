# Round 124 — Nubox API REST · Activación

> **Para Nicolas**: 3 pasos para activar la API REST OFICIAL de Nubox
> "Factura y Administración" — el path real para integración (no scraping).

---

## ⚠️ Lo que esta API hace y NO hace

| ✅ SÍ | ❌ NO |
|---|---|
| Emitir facturas/boletas/NC/ND desde Cehta | Bajar remuneraciones/sueldos |
| Listar ventas emitidas | Bajar contabilidad/asientos |
| Descargar PDF firmado + XML SII | Bajar compras de proveedores |
| Anular documentos | Liquidaciones de personal |

Para remuneraciones, el flujo del **Round 123** (upload xlsx) sigue siendo el path. Para compras, el **Round 117 SII** sigue siendo el path.

---

## Paso 1 — Solicitar credenciales API a Nubox (1 vez, asíncrono)

Esto es **acción de Cehta como organización**. La documentación dice:

> Envía un correo a **soporte@nubox.com** indicando que necesitás
> credenciales de la API de Integraciones para el ambiente de pruebas (UAT).
> Indicar nombre de la empresa y un contacto principal.

Vas a recibir 3 cosas:
- **Partner Token** (Bearer) → único para Cehta como integrador
- **API Key** (X-Api-Key) → única **por cada empresa** del fondo (vas a recibir 1 por empresa)
- **Base URL** del ambiente UAT

Para producción se piden por separado tras certificar en UAT.

> Tiempo estimado de Nubox: 1-3 días hábiles.

## Paso 2 — Aplicar la migración SQL (2 min)

1. Supabase Studio → SQL Editor → **New query**
2. Pegá todo el contenido de `backend/scripts/sql/round124_nubox_api_migration.sql`
3. RUN
4. Vas a ver 3 filas, todas con `existe = true`.

## Paso 3 — Cargar credenciales en la plataforma (5 min)

Cuando Nubox te mande las claves, hacé un **POST** desde PowerShell (o usá la UI cuando exista botón):

```powershell
$jwt = "<tu JWT de admin de ram-cehta>"
$empresa = "REVTECH"

Invoke-WebRequest `
  -Uri "https://cehta-backend.fly.dev/api/v1/admin/nubox-api/credentials/$empresa" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $jwt"
    "Content-Type" = "application/json"
  } `
  -Body (@{
    partner_token = "NP_SECRET_UAT_GfMTkOLEVq..."   # de Nubox
    api_key = "NP_KEY_UAT_86d01536.044-5..."         # de Nubox
    environment = "uat"
    base_url = "https://api.test-nubox.com/..."      # de Nubox
  } | ConvertTo-Json)
```

Repetí por cada empresa (cambiás `$empresa` y el `api_key`; el `partner_token` es el mismo siempre).

## Paso 4 — Probar (10 min)

### 4.1 Probar credenciales
```powershell
Invoke-WebRequest `
  -Uri "https://cehta-backend.fly.dev/api/v1/admin/nubox-api/test/REVTECH" `
  -Method POST `
  -Headers @{"Authorization" = "Bearer $jwt"}
```

Esperás: `{"ok": true, "message": "API Nubox responde OK..."}`

### 4.2 Bajar ventas del mes
```powershell
Invoke-WebRequest `
  -Uri "https://cehta-backend.fly.dev/api/v1/admin/nubox-api/sync-sales/REVTECH?periodo=2026-04" `
  -Method POST `
  -Headers @{"Authorization" = "Bearer $jwt"}
```

### 4.3 Emitir un DTE de prueba desde un voucher local
Necesitás un voucher en estado DRAFT con `doc_tributario_tipo`=FACTURA/BOLETA, contraparte_rut + nombre, monto.

```powershell
$voucherId = 123
Invoke-WebRequest `
  -Uri "https://cehta-backend.fly.dev/api/v1/admin/nubox-api/emit-from-voucher/$voucherId" `
  -Method POST `
  -Headers @{"Authorization" = "Bearer $jwt"}
```

Si todo OK, vas a ver respuesta con `nubox_document_id` + `folio`. El voucher local se marca con `nubox_folio` y `nubox_status='EMITTED'`.

### 4.4 Descargar PDF firmado
```powershell
$docId = 1282876  # del paso 4.3
Invoke-WebRequest `
  -Uri "https://cehta-backend.fly.dev/api/v1/admin/nubox-api/sales/REVTECH/$docId/pdf?template=TEMPLATE_A4" `
  -Method GET `
  -Headers @{"Authorization" = "Bearer $jwt"} `
  -OutFile "factura.pdf"
```

---

## Endpoints disponibles (resumen)

| Verb | Path | Función |
|---|---|---|
| GET | `/admin/nubox-api/empresas` | Listar empresas con status credencial |
| POST | `/admin/nubox-api/credentials/{empresa}` | Setear credenciales |
| POST | `/admin/nubox-api/test/{empresa}` | Validar credenciales |
| POST | `/admin/nubox-api/emit-from-voucher/{voucher_id}` | Emitir DTE oficial |
| POST | `/admin/nubox-api/sync-sales/{empresa}?periodo=YYYY-MM` | Bajar ventas |
| GET | `/admin/nubox-api/sales/{empresa}` | Listar ventas almacenadas |
| GET | `/admin/nubox-api/sales/{empresa}/{nubox_doc_id}/pdf` | Descargar PDF |
| GET | `/admin/nubox-api/sales/{empresa}/{nubox_doc_id}/xml` | Descargar XML |

---

## Histórico Round 124

| Fecha | Cambio |
|---|---|
| 2026-05-19 | Migración + cliente API REST + 8 endpoints + mapper voucher→DTE + tests (10 pass) |
