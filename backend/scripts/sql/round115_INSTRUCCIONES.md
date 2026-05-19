# Round 115/116 — Instrucciones para Nicolas

> **Objetivo**: subir a producción la data del Excel `Data (4).xlsx`:
> 9 empresas con webs/giro/dirección SII, **claves SII** y **Previred**
> cifradas, directorio (5 personas) e inversionistas (5 personas).
>
> Tres pasos. ~10 min en total.

---

## Paso 1 — Migración SQL en Supabase (2 min)

1. Abrí https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip
2. Menú izquierdo → **SQL Editor**
3. **New query**
4. Abrí el archivo `backend/scripts/sql/round115_migration.sql` y **copiá TODO el contenido**
5. Pegalo en el editor y dale **RUN** (botón verde abajo a la derecha)
6. Tenés que ver al final una tabla con 4 filas, todas con `existe = TRUE`:

   ```
   core.empresa_credenciales         | true
   core.directorio_miembros          | true
   core.inversionistas_aportantes    | true
   core.empresas.pagina_web          | true
   ```

   Si alguna es `false`, mandame screenshot y lo veo.

---

## Paso 2 — Configurar Fernet key (3 min)

La clave SII y Previred del Excel se cifran antes de guardarse en DB.
Necesitás generar la clave maestra y guardarla como secret en Fly.

### 2a. Usar esta key generada acá (o generar la tuya)

He generado esta key para vos:

```
iKTVRo8oBh_1Q-HTYLg8_Hk22wLn-NZUXkM-N-jB7JM=
```

> ⚠️ **Esta key es la única forma de descifrar las claves SII en
> producción. Si la perdés, hay que volver a cargar el Excel.**
>
> Guardá una copia en tu 1Password de Cehta como
> `CREDENTIALS_FERNET_KEY` antes de seguir.

### 2b. Setearla como Fly secret

En PowerShell:

```powershell
fly secrets set CREDENTIALS_FERNET_KEY="iKTVRo8oBh_1Q-HTYLg8_Hk22wLn-NZUXkM-N-jB7JM=" -a cehta-backend
```

Fly va a contestar:
```
Secrets are staged for the next deployment
```

Y va a redeployar solo (~2 min).

### 2c. Setearla también en tu .env local

Editá `backend/.env` y agregá la línea:

```
CREDENTIALS_FERNET_KEY=iKTVRo8oBh_1Q-HTYLg8_Hk22wLn-NZUXkM-N-jB7JM=
```

(Es necesaria para correr el seed script del paso 3 desde tu máquina.)

---

## Paso 3 — Correr el seed script (3 min)

Una vez confirmado el paso 1 (tablas creadas) y paso 2c (env local con la key),
corré desde PowerShell, dentro de la carpeta backend:

```powershell
Set-Location C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
python scripts/seed_empresas_excel_round116.py "C:\Users\DELL\Downloads\Data (4).xlsx"
```

Salida esperada (más o menos):

```
Round 116 — seed desde: C:\Users\DELL\Downloads\Data (4).xlsx

✓ credentials_service OK ({'configured': True, 'round_trip_ok': True})

Leído del Excel: 11 empresas, 5 inversionistas, 5 directorio, 6 previred

  ✓ 9 empresas actualizadas, 9 credenciales SII
  ✓ 6 credenciales Previred
  ✓ 5 miembros directorio (insertados)
  ✓ 5 inversionistas/aportantes (insertados)

=== Seed completado OK ===
```

### Si algo falla

| Error | Qué significa | Cómo arreglarlo |
|---|---|---|
| `CredentialsKeyMissing` | Falta el env var | Verificá que `backend/.env` tiene la línea `CREDENTIALS_FERNET_KEY=...` |
| `DATABASE_URL no configurada` | Falta DATABASE_URL en .env | Mismo archivo, debería ya estar (lo usás para otros scripts) |
| `Empresa REVTECH no existe en core.empresas` | El código no matchea | Mostrame el listado de empresas de tu sistema: `SELECT codigo FROM core.empresas` en Supabase Studio |

---

## Verificación final (1 min)

En Supabase Studio → SQL Editor, corré:

```sql
SELECT empresa_codigo, sistema, rut_usuario,
       LEFT(password_encrypted, 30) || '...' AS pwd_preview,
       created_at
FROM core.empresa_credenciales
ORDER BY empresa_codigo, sistema;
```

Tenés que ver 9 filas de SII + 6 de Previred = 15 filas total. Las
passwords aparecen como `gAAAAAB...` (base64 de Fernet) — eso confirma
que están cifradas y no en plaintext.

También:

```sql
SELECT COUNT(*) FROM core.directorio_miembros;            -- 5
SELECT COUNT(*) FROM core.inversionistas_aportantes;      -- 5
```

---

## Round 117 (próximo, no requerido ahora)

Con las credenciales SII cifradas en DB, podemos:

1. Endpoint `POST /api/v1/sii/test-login/{empresa_codigo}` — valida que la clave abre sesión OK
2. Endpoint `POST /api/v1/sii/sync-rcv/{empresa_codigo}` — baja el Registro de Compras y Ventas del mes y lo importa como vouchers
3. UI en `/admin/sii` para gatillar todo manualmente

Eso necesita librería de scraping del SII (Playwright o `python-cl-sii`).
Lo dejo para cuando termines de validar 115/116.

---

## Histórico

| Fecha | Round | Cambio |
|---|---|---|
| 2026-05-19 | 115 | Migración tablas + servicio Fernet |
| 2026-05-19 | 116 | Seed Excel (este script) |
