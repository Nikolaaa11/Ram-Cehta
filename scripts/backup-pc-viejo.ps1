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

# ─── Detectar servicio de cloud (Dropbox, Drive, OneDrive) ──────────────────
$candidates = @(
    @{ Path = "$env:USERPROFILE\Dropbox"; Name = "Dropbox" },
    @{ Path = "$env:USERPROFILE\Google Drive"; Name = "Google Drive (clásico)" },
    @{ Path = "$env:USERPROFILE\My Drive"; Name = "Google Drive (Mi unidad)" },
    @{ Path = "G:\Mi unidad"; Name = "Google Drive for Desktop (G:)" },
    @{ Path = "G:\My Drive"; Name = "Google Drive for Desktop (G:)" },
    @{ Path = "H:\Mi unidad"; Name = "Google Drive for Desktop (H:)" },
    @{ Path = "H:\My Drive"; Name = "Google Drive for Desktop (H:)" },
    @{ Path = "$env:USERPROFILE\OneDrive"; Name = "OneDrive" }
)

$detected = @()
foreach ($c in $candidates) {
    if (Test-Path $c.Path) {
        $detected += $c
    }
}

if ($detected.Count -eq 0) {
    Write-Host "No detecté ningún servicio de cloud (Dropbox, Drive, OneDrive)." -ForegroundColor Yellow
    $cloudPath = Read-Host "Pegá la ruta donde guardar el backup (o ENTER para Documents\backup-pc-viejo)"
    if (-not $cloudPath) {
        $cloudPath = "$env:USERPROFILE\Documents\backup-pc-viejo"
        New-Item -ItemType Directory -Path $cloudPath -Force | Out-Null
    }
} elseif ($detected.Count -eq 1) {
    $cloudPath = $detected[0].Path
    Write-Host "✅ Detecté: $($detected[0].Name) en $cloudPath" -ForegroundColor Green
} else {
    Write-Host "Servicios detectados:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $detected.Count; $i++) {
        Write-Host ("  [{0}] {1,-30} {2}" -f ($i + 1), $detected[$i].Name, $detected[$i].Path)
    }
    do {
        $choice = Read-Host "Elegí cuál usar (1-$($detected.Count))"
    } while ($choice -notmatch "^\d+$" -or [int]$choice -lt 1 -or [int]$choice -gt $detected.Count)
    $cloudPath = $detected[[int]$choice - 1].Path
}

$backupRoot = "$cloudPath\cehta-backup-pc-viejo"
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
Write-Host "  1. Verificar que el cloud sincronizó (drive.google.com / dropbox.com / onedrive.live.com)"
Write-Host "     Puede tardar 5-15 min en subir todo a la nube."
Write-Host "  2. En el PC nuevo: instalar el mismo servicio de cloud, login con tu cuenta."
Write-Host "  3. Esperar que sincronice y la carpeta cehta-backup-pc-viejo aparezca."
Write-Host "  4. En el PC nuevo, restaurar (ajustá la ruta según el cloud que uses):"
Write-Host ""
Write-Host "     # Si es Google Drive for Desktop:" -ForegroundColor Gray
Write-Host '     robocopy "G:\Mi unidad\cehta-backup-pc-viejo\.claude" "$env:USERPROFILE\.claude" /E /Z' -ForegroundColor White
Write-Host '     robocopy "G:\Mi unidad\cehta-backup-pc-viejo\nikolaya" "$env:USERPROFILE\Documents\nikolaya" /E /Z' -ForegroundColor White
Write-Host ""
Write-Host "     # Si es Dropbox:" -ForegroundColor Gray
Write-Host '     robocopy "$env:USERPROFILE\Dropbox\cehta-backup-pc-viejo\.claude" "$env:USERPROFILE\.claude" /E /Z' -ForegroundColor White
Write-Host '     robocopy "$env:USERPROFILE\Dropbox\cehta-backup-pc-viejo\nikolaya" "$env:USERPROFILE\Documents\nikolaya" /E /Z' -ForegroundColor White
Write-Host ""
