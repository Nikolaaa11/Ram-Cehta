# R152QQQQQ - Smoke tests post-deploy
#
# Uso:
#   cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend
#   .\scripts\smoke_test.ps1
#
# Lo que hace:
#   1. Pide tu JWT admin (o lo toma de $env:SMOKE_ADMIN_JWT)
#   2. Corre pytest contra https://cehta-backend.fly.dev
#   3. Reporta pass/fail
#
# Cuando lo correr:
#   - Despues de cada `fly deploy`
#   - 1 vez por dia para confirmar que prod sigue OK
#   - Antes de avisar a usuarios que hubo cambios

$ErrorActionPreference = "Stop"

Write-Host "==> Smoke tests Ram-Cehta backend" -ForegroundColor Cyan

# 1. Verificar que estamos en backend/
if (-not (Test-Path "pyproject.toml")) {
    Write-Host "ERROR: corre este script desde la carpeta backend/" -ForegroundColor Red
    Write-Host "  cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta\backend" -ForegroundColor Yellow
    exit 1
}

# 2. Verificar JWT (env var o pedirlo)
if (-not $env:SMOKE_ADMIN_JWT) {
    Write-Host ""
    Write-Host "SMOKE_ADMIN_JWT no esta seteado." -ForegroundColor Yellow
    Write-Host "Pegar JWT admin (o ENTER para correr solo tests no-auth):"
    $jwt = Read-Host
    if ($jwt) {
        $env:SMOKE_ADMIN_JWT = $jwt
    }
}

# 3. URL del backend
if (-not $env:SMOKE_BASE_URL) {
    $env:SMOKE_BASE_URL = "https://cehta-backend.fly.dev"
}

Write-Host ""
Write-Host "Backend URL : $env:SMOKE_BASE_URL"
if ($env:SMOKE_ADMIN_JWT) {
    $jwtPreview = $env:SMOKE_ADMIN_JWT.Substring(0, [Math]::Min(20, $env:SMOKE_ADMIN_JWT.Length))
    Write-Host "Admin JWT   : $jwtPreview..."
} else {
    Write-Host "Admin JWT   : NO seteado (tests autenticados se saltean)" -ForegroundColor Yellow
}
Write-Host ""

# 4. Correr pytest
Write-Host "==> Corriendo pytest..." -ForegroundColor Cyan
& python -m pytest tests/e2e/ -v --tb=short

# 5. Reporte final
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==> Todos los smoke tests pasaron" -ForegroundColor Green
    Write-Host "    Backend en produccion OK." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "==> Smoke tests FALLARON" -ForegroundColor Red
    Write-Host "    Revisa el output arriba." -ForegroundColor Red
    Write-Host "    Si es bug grave, considera rollback:" -ForegroundColor Yellow
    Write-Host "      fly releases list -a cehta-backend" -ForegroundColor Yellow
    Write-Host "      fly releases rollback <version> -a cehta-backend" -ForegroundColor Yellow
    exit 1
}
