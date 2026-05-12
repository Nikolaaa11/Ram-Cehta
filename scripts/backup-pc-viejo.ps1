# scripts/backup-pc-viejo.ps1
#
# Backup completo del PC viejo para migrar al PC nuevo.
#
# Qué copia (a Dropbox):
#   1. C:\Users\DELL\.claude\                    (historial Claude Code)
#   2. C:\Users\DELL\Documents\nikolaya\         (docs privados + credenciales)
#
# Qué NO copia (porque ya está en cloud):
#   - El repo Ram-Cehta (está en GitHub)
#   - node_modules, .venv, .next (se regeneran)
#
# Uso (PowerShell normal, NO admin):
#   powershell -ExecutionPolicy Bypass -File scripts\backup-pc-viejo.ps1

$ErrorActionPreference = "Continue"

# Detectar Dropbox
$dropbox = "$env:USERPROFILE\Dropbox"
if (-not (Test-Path $dropbox)) {
    Write-Host "Dropbox no detectado en $dropbox" -ForegroundColor Yellow
    $dropbox = Read-Host "Pegá la ruta de tu Dropbox (o presiona ENTER para usar Documents\backup-pc-viejo)"
    if (-not $dropbox) {
        $dropbox = "$env:USERPROFILE\Documents\backup-pc-viejo"
        New-Item -ItemType Directory -Path $dropbox -Force | Out-Null
    }
}

$backupRoot = "$dropbox\cehta-backup-pc-viejo"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Backup PC viejo → $backupRoot" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
Write-Host "[1/2] Copiando .claude (historial conversaciones)..." -ForegroundColor Yellow
Write-Host "      Esto incluye TODAS las conversaciones con Claude Code." -ForegroundColor Gray

$claudeSrc = "$env:USERPROFILE\.claude"
$claudeDest = "$backupRoot\.claude"

if (Test-Path $claudeSrc) {
    # /XF excluye archivos volátiles (locks, sockets)
    robocopy $claudeSrc $claudeDest /E /Z /R:1 /W:1 `
        /XF "*.lock" "*.sock" "*.pid" `
        /XD "tmp" "cache" "node_modules" `
        | Out-Null
    $size = (Get-ChildItem $claudeDest -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("      OK - {0:N1} MB copiados" -f $size) -ForegroundColor Green
} else {
    Write-Host "      WARN - no existe $claudeSrc (no usaste Claude Code todavía?)" -ForegroundColor Yellow
}

# ============================================================================
Write-Host ""
Write-Host "[2/2] Copiando nikolaya (docs + credenciales)..." -ForegroundColor Yellow
Write-Host "      Excluye archivos temporales de Office." -ForegroundColor Gray

$nikoSrc = "$env:USERPROFILE\Documents\nikolaya"
$nikoDest = "$backupRoot\nikolaya"

if (Test-Path $nikoSrc) {
    robocopy $nikoSrc $nikoDest /E /Z /R:1 /W:1 `
        /XF "~*" "*.tmp" `
        | Out-Null
    $size = (Get-ChildItem $nikoDest -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("      OK - {0:N1} MB copiados" -f $size) -ForegroundColor Green
} else {
    Write-Host "      WARN - no existe $nikoSrc" -ForegroundColor Yellow
}

# ============================================================================
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  BACKUP COMPLETO" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Ubicación: $backupRoot" -ForegroundColor White
Write-Host ""
Write-Host "Contenido:" -ForegroundColor Cyan
Get-ChildItem $backupRoot -Directory | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("  {0,-20} {1,8:N1} MB" -f $_.Name, $size) -ForegroundColor Gray
}

Write-Host ""
Write-Host "Próximos pasos:" -ForegroundColor Cyan
Write-Host "  1. Verificar que Dropbox sincronizó (puede tardar unos minutos)"
Write-Host "  2. En el PC nuevo, abrir Dropbox y verificar que se vea $backupRoot"
Write-Host "  3. En el PC nuevo, restaurar con:"
Write-Host ""
Write-Host '     robocopy "$env:USERPROFILE\Dropbox\cehta-backup-pc-viejo\.claude" "$env:USERPROFILE\.claude" /E /Z' -ForegroundColor White
Write-Host '     robocopy "$env:USERPROFILE\Dropbox\cehta-backup-pc-viejo\nikolaya" "$env:USERPROFILE\Documents\nikolaya" /E /Z' -ForegroundColor White
Write-Host ""
