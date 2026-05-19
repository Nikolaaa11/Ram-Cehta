# Round 123 — Nubox Remuneraciones · Activación

> **Para Nicolas**: 3 pasos para activar la nueva pantalla `/admin/nubox`
> que baja el Libro de Remuneraciones mensual de Nubox al sistema.

---

## Paso 1 — Migración SQL (2 min)

1. Supabase Studio → SQL Editor → **New query**
2. Pegá todo el contenido de `backend/scripts/sql/round123_nubox_migration.sql`
3. RUN
4. Verificación final muestra 3 filas, todas con `existe = true`:
   ```
   core.nubox_sync_runs           | true
   core.nubox_remuneraciones      | true
   sistema=nubox permitido        | true
   ```

## Paso 2 — Cargar credenciales Nubox (5 min · una vez)

A diferencia del SII, las claves Nubox **no vinieron** en el Excel
`Data (4).xlsx`. Las tenés que cargar manualmente.

Para cada empresa que tenga cuenta Nubox, abrí Supabase Studio → Table
Editor → `core.empresa_credenciales` → **Insert row**:

| Columna | Valor ejemplo |
|---|---|
| empresa_codigo | `REVTECH` |
| sistema | `nubox` |
| rut_usuario | `77018739-7` (RUT con guion) |
| password_encrypted | **(ver abajo)** |
| notas | `Cargado manual el 19/05/2026` |

Para llenar `password_encrypted` necesitás cifrar la clave con la
misma Fernet key que setearon en Round 115. Hay 2 maneras:

### Opción A — Vía Python local (recomendada)
```powershell
Set-Location C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
python -c "from app.services.credentials_service import encrypt_credential; print(encrypt_credential('TU_CLAVE_NUBOX'))"
```
Te imprime el ciphertext. Copialo y pegá en la columna `password_encrypted`.

### Opción B — Endpoint privado (si están los pasos del Round 117 OK)
Vía PowerShell + tu JWT:
```powershell
# TODO Round 124: agregar un endpoint /admin/credentials/encrypt
# Por ahora usar Opción A.
```

Repetí para cada empresa con cuenta Nubox.

## Paso 3 — Probar la integración (10 min)

1. Abrí `https://ram-cehta.vercel.app/admin/nubox` (link nuevo en el sidebar)
2. Vas a ver la tabla de empresas. Las que cargaste en el paso 2 aparecen
   con badge **"Configurada"** en verde.
3. Click "Test" en una → si la clave funciona, "✓ Login Nubox exitoso".
   Si falla, podés todavía usar Excel manual (paso 4).
4. Seleccioná el período (por default mes anterior).
5. **Plan A**: click "Auto-sync" en la fila de la empresa.
   - Si funciona: ves resumen con totales + tabla detallada.
   - Si falla: pasá al Plan B.
6. **Plan B** (siempre funciona): en Nubox web, andá a:
   - Remuneraciones → Reportes → **Libro de Remuneraciones**
   - Seleccionar período → **Descargar Excel**
   - Volvé a `/admin/nubox`, clic en la empresa, sección verde "Subir
     Libro de Remuneraciones" → seleccionar archivo → Subir.
7. Tras un sync exitoso vas a ver:
   - **Resumen**: trabajadores, total haberes, líquido a pagar, AFP, salud, etc.
   - **Tabla**: detalle por trabajador con sueldo base, descuentos, líquido.

## Estructura del Excel esperado

El parser detecta automáticamente los headers. Acepta variaciones de
nombre (con/sin tildes, mayúsculas/minúsculas). Columnas mínimas que
debe tener el Excel:
- **RUT** (o "Rut Trabajador")
- **Nombre** (o "Nombre Completo", "Trabajador", "Empleado")
- **Sueldo Base** (o "Sueldo Bruto")
- **Sueldo Líquido** (o "Líquido a Pagar", "Neto a Pagar")

Si tu Excel tiene columnas con nombres muy distintos, mandame screenshot
y agrego los aliases al parser.

## Si el auto-sync falla constantemente

Es esperable. Nubox no tiene API pública y su portal usa autenticación
ASP.NET con tokens dinámicos que un cliente httpx puede no manejar bien.

Mientras tanto, el **Plan B (upload Excel manual)** funciona al 100% y
te da exactamente la misma data. Round 124 puede portear el cliente a
Playwright (browser real) si te queres ir 100% auto.

---

## Histórico de rounds Nubox

| Round | Fecha | Cambio |
|---|---|---|
| 123 | 2026-05-19 | Infraestructura completa + parser xlsx + upload manual + auto-sync best-effort |
