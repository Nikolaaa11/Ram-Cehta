# scripts/migrate-supabase-to-sao-paulo.ps1
#
# Plan de migracion Supabase us-east-2 (Ohio) -> sa-east-1 (Sao Paulo).
#
# IMPORTANTE: este script NO ejecuta nada automatico. Te guia paso a paso
# para que VOS ejecutes cada comando despues de leerlo. La migracion
# es delicada (toca DB de produccion) y queremos cero perdida de datos.
#
# Tiempo total estimado: 30-45 minutos.
# Downtime esperado: 10-15 minutos (durante el dump+restore).

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  MIGRACION SUPABASE Ohio -> Sao Paulo" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Antes de empezar leer cada paso y EJECUTAR uno por uno." -ForegroundColor Yellow
Write-Host "Si algo sale mal, parar y avisar." -ForegroundColor Yellow
Write-Host ""

# ============================================================================
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 1: Crear proyecto Supabase nuevo en Sao Paulo" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1.1. Abrir https://supabase.com/dashboard"
Write-Host "1.2. Click en 'New project'"
Write-Host "1.3. Datos:"
Write-Host "     - Name:           cehta-capital-sp"
Write-Host "     - Database Pass:  GENERAR UNA NUEVA (guardala en 1Password)"
Write-Host "     - Region:         South America (Sao Paulo) [sa-east-1]"
Write-Host "     - Plan:           Free (mismo que tenes ahora)"
Write-Host "1.4. Click 'Create new project'"
Write-Host "1.5. Esperar ~2 min mientras se inicializa"
Write-Host ""
Write-Host "1.6. Una vez creado, ANOTAR estos valores (Settings -> API):"
Write-Host "     - Project URL:           https://XXXXX.supabase.co"
Write-Host "     - anon public key:       eyJ..."
Write-Host "     - service_role key:      eyJ..."
Write-Host "     - JWT Secret (Settings->API->JWT Settings)"
Write-Host ""
Write-Host "1.7. Settings -> Database -> Connection string:"
Write-Host "     Copiar 'Connection string' modo Session pooler (port 5432)"
Write-Host "     Va a ser algo asi:"
Write-Host "     postgresql://postgres.XXXXX:[YOUR-PASSWORD]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
Write-Host ""
Read-Host "Presiona ENTER cuando completaste el PASO 1"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 2: Hacer backup completo del proyecto actual (Ohio)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Vamos a usar pg_dump corriendo en el contenedor Fly (que tiene la DB"
Write-Host "URL configurada como secret). Asi no necesitamos descargar las"
Write-Host "credenciales localmente."
Write-Host ""
Write-Host "2.1. Anunciar al equipo que en 10 min hay downtime corto (en Slack/WhatsApp)."
Write-Host ""
Write-Host "2.2. SSH al backend de Fly:"
Write-Host '     flyctl ssh console -a cehta-backend' -ForegroundColor White
Write-Host ""
Write-Host "2.3. Adentro del container ejecutar (dentro de la SSH):"
Write-Host ""
Write-Host '     # Backup completo (schema + data + auth users)' -ForegroundColor White
Write-Host '     pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public --schema=core --schema=audit --schema=app --schema=auth -f /tmp/cehta-backup.sql' -ForegroundColor White
Write-Host ""
Write-Host "     # Verificar tamano"
Write-Host '     ls -lh /tmp/cehta-backup.sql' -ForegroundColor White
Write-Host "     # Esperado: ~5-50MB segun datos. Si <1MB algo salio mal."
Write-Host ""
Write-Host "2.4. Descargar el backup a tu PC:"
Write-Host '     # En otra terminal (no en SSH):' -ForegroundColor White
Write-Host '     flyctl ssh sftp shell -a cehta-backend' -ForegroundColor White
Write-Host '     get /tmp/cehta-backup.sql' -ForegroundColor White
Write-Host '     exit' -ForegroundColor White
Write-Host ""
Write-Host "2.5. Guardar el backup en lugar seguro (no commitear a git!):"
Write-Host '     mv cehta-backup.sql C:\Users\DELL\Backups\' -ForegroundColor White
Write-Host ""
Read-Host "Presiona ENTER cuando tengas el backup descargado"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 3: Restore al proyecto nuevo (Sao Paulo)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "3.1. Setear la conexion string del NUEVO proyecto (pegar la del paso 1.7):"
Write-Host ""
$newDbUrl = Read-Host "    Pegar aqui la connection string del proyecto NUEVO (sa-east-1)"
Write-Host ""
Write-Host "3.2. Restore con psql:"
Write-Host ""
Write-Host "     psql `"$newDbUrl`" -f C:\Users\DELL\Backups\cehta-backup.sql" -ForegroundColor White
Write-Host ""
Write-Host "     # Esto va a tardar 5-15 min segun datos."
Write-Host "     # Va a haber warnings sobre schemas que ya existen - normal."
Write-Host "     # Lo importante es que NO haya errores rojos al final."
Write-Host ""
Read-Host "Presiona ENTER cuando termino el restore sin errores"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 4: Verificar restore" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "4.1. Verificar conteos en la DB nueva:"
Write-Host ""
Write-Host "     psql `"$newDbUrl`" -c `"SELECT 'empresas' AS t, COUNT(*) FROM core.empresas UNION ALL SELECT 'users', COUNT(*) FROM auth.users UNION ALL SELECT 'vouchers', COUNT(*) FROM core.vouchers UNION ALL SELECT 'roles', COUNT(*) FROM core.user_company_roles;`"" -ForegroundColor White
Write-Host ""
Write-Host "4.2. Comparar con los conteos viejos. Deberian ser identicos."
Write-Host ""
Read-Host "Presiona ENTER cuando los counts coincidan"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 5: Actualizar secrets en Fly Backend" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Necesitamos cambiar 5 secrets:"
Write-Host "  - DATABASE_URL"
Write-Host "  - ALEMBIC_DATABASE_URL  (mismo valor que DATABASE_URL)"
Write-Host "  - SUPABASE_URL"
Write-Host "  - SUPABASE_ANON_KEY"
Write-Host "  - SUPABASE_JWT_SECRET"
Write-Host "  - SUPABASE_SERVICE_ROLE_KEY"
Write-Host ""
Write-Host "5.1. Convertir la connection string a formato asyncpg:"
Write-Host ""
$asyncpgUrl = $newDbUrl -replace "^postgresql:", "postgresql+asyncpg:"
Write-Host "     DATABASE_URL (asyncpg):" -ForegroundColor Yellow
Write-Host "     $asyncpgUrl" -ForegroundColor White
Write-Host ""
Write-Host "5.2. Setear todos los secrets de una vez (te va a pedir cada valor):"
Write-Host ""
$projectUrl = Read-Host "    Project URL (https://XXXXX.supabase.co)"
$anonKey = Read-Host "    anon public key"
$serviceKey = Read-Host "    service_role key"
$jwtSecret = Read-Host "    JWT Secret"

Write-Host ""
Write-Host "5.3. Ejecutar este comando:"
Write-Host ""
$cmd = @"
flyctl secrets set ``
  DATABASE_URL=`"$asyncpgUrl`" ``
  ALEMBIC_DATABASE_URL=`"$asyncpgUrl`" ``
  SUPABASE_URL=`"$projectUrl`" ``
  SUPABASE_ANON_KEY=`"$anonKey`" ``
  SUPABASE_SERVICE_ROLE_KEY=`"$serviceKey`" ``
  SUPABASE_JWT_SECRET=`"$jwtSecret`" ``
  -a cehta-backend
"@
Write-Host $cmd -ForegroundColor White
Write-Host ""
Write-Host "Fly va a re-deployear automaticamente. ~2 min."
Write-Host ""
Read-Host "Presiona ENTER cuando termino el re-deploy"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 6: Actualizar Frontend (Vercel)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "El frontend usa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY"
Write-Host "para login. Hay que actualizarlos."
Write-Host ""
Write-Host "6.1. Abrir https://vercel.com/<tu-team>/cehta-frontend/settings/environment-variables"
Write-Host ""
Write-Host "6.2. Editar (o crear si no existen):"
Write-Host "     NEXT_PUBLIC_SUPABASE_URL = $projectUrl"
Write-Host "     NEXT_PUBLIC_SUPABASE_ANON_KEY = $anonKey"
Write-Host ""
Write-Host "6.3. Click Save"
Write-Host ""
Write-Host "6.4. Trigger redeploy: Deployments -> ... menu -> Redeploy"
Write-Host ""
Read-Host "Presiona ENTER cuando termino el redeploy de Vercel (~2 min)"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 7: Verificar todo funciona" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "7.1. Health check backend:"
Write-Host '     Invoke-WebRequest https://cehta-backend.fly.dev/api/v1/health' -ForegroundColor White
Write-Host "     Esperado: status=ok, database=ok"
Write-Host ""
Write-Host "7.2. Health detailed (debe mostrar alembic head=0054 y 10 empresas):"
Write-Host '     Invoke-WebRequest https://cehta-backend.fly.dev/api/v1/health/detailed | ConvertFrom-Json' -ForegroundColor White
Write-Host ""
Write-Host "7.3. Login en la plataforma:"
Write-Host "     - Abrir https://cehta-capital.vercel.app"
Write-Host "     - Login con contactocehta@gmail.com + tu password"
Write-Host "     - Verificar que entras al dashboard sin errores"
Write-Host ""
Write-Host "7.4. Medir latencia (deberia ser ~10x mejor):"
Write-Host ""
Write-Host '     Measure-Command { Invoke-WebRequest https://cehta-backend.fly.dev/api/v1/health }' -ForegroundColor White
Write-Host "     Esperado: TotalMilliseconds <200"
Write-Host ""
Write-Host "7.5. Correr verify-health:"
Write-Host '     powershell -ExecutionPolicy Bypass -File scripts\verify-health.ps1' -ForegroundColor White
Write-Host ""
Read-Host "Presiona ENTER cuando todo este verificado"

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  PASO 8: Decommission proyecto viejo (us-east-2)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANTE: NO borres el proyecto viejo hoy. Mantenelo 1 SEMANA"
Write-Host "como fallback por si descubrimos un dato que se perdio."
Write-Host ""
Write-Host "Despues de 7 dias sin issues, podes pausarlo:"
Write-Host "  https://supabase.com/dashboard -> proyecto viejo -> Settings -> Pause"
Write-Host ""
Write-Host "Si todo bien despues de 30 dias, podes borrarlo:"
Write-Host "  Settings -> General -> Delete Project"
Write-Host ""

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  MIGRACION COMPLETADA" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Latencia esperada: 100-200ms en endpoints reales (antes ~1-3s)." -ForegroundColor Green
Write-Host "La plataforma se siente 10-30x mas rapida." -ForegroundColor Green
Write-Host ""
