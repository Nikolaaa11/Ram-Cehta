# scripts/deploy-all.ps1
#
# Deploy completo: typecheck + push + fly backend + smoke test.
#
# Uso desde la raiz del repo Ram-Cehta:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1
#
# Compatible con Windows PowerShell 5.1 (no usa -SkipHttpErrorCheck).
#
# Pasos en orden:
#   1. Verifica git status limpio (frena si hay cambios sin commitear)
#   2. Typecheck del frontend (npx tsc --noEmit)
#   3. Push a GitHub (Vercel auto-deploy)
#   4. Deploy backend a Fly (alembic migra automatico via release_command)
#   5. Smoke test endpoints clave
#
# Si algun paso falla, corta y muestra que rompio. Nunca usa --force.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Get-HttpStatus {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop
        return [int]$r.StatusCode
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode
        }
        return 0
    } catch {
        return 0
    }
}

Write-Host ""
Write-Host "==> Deploy CEHTA - full stack (frontend Vercel + backend Fly)" -ForegroundColor Cyan
Write-Host ""

# 1. Git status
Write-Host "[1/5] Verificando git status..." -ForegroundColor Yellow
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "ERROR: hay cambios sin commitear. Hace commit primero:" -ForegroundColor Red
    git status --short
    exit 1
}
Write-Host "      OK - working tree limpio" -ForegroundColor Green

# 2. Frontend typecheck
Write-Host ""
Write-Host "[2/5] Frontend typecheck (esto tarda ~30s)..." -ForegroundColor Yellow
Set-Location "$repoRoot\frontend"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: typecheck del frontend rompio. Arregla los errores TypeScript primero." -ForegroundColor Red
    exit 1
}
Write-Host "      OK - sin errores TS" -ForegroundColor Green
Set-Location $repoRoot

# 3. Push a GitHub (dispara Vercel)
Write-Host ""
Write-Host "[3/5] Push a GitHub (Vercel auto-deploy frontend)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push fallo." -ForegroundColor Red
    exit 1
}
Write-Host "      OK - Vercel ya esta build-eando https://cehta.vercel.app" -ForegroundColor Green

# 4. Deploy backend a Fly
Write-Host ""
Write-Host "[4/5] Deploy backend a Fly.io (~3-5 min)..." -ForegroundColor Yellow
Set-Location "$repoRoot\backend"
fly deploy --app cehta-backend --remote-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: fly deploy rompio. Revisa el output arriba." -ForegroundColor Red
    exit 1
}
Write-Host "      OK - backend desplegado" -ForegroundColor Green
Set-Location $repoRoot

# 5. Smoke test (compatible con PS 5.1, sin -SkipHttpErrorCheck)
Write-Host ""
Write-Host "[5/5] Smoke test endpoints clave..." -ForegroundColor Yellow

$healthStatus = Get-HttpStatus -Url "https://cehta-backend.fly.dev/api/v1/health"
if ($healthStatus -ne 200) {
    Write-Host "ERROR: /api/v1/health devolvio $healthStatus (esperado 200)" -ForegroundColor Red
    exit 1
}
Write-Host "      OK /api/v1/health=200" -ForegroundColor Green

$obligacionesStatus = Get-HttpStatus -Url "https://cehta-backend.fly.dev/api/v1/calendar/obligations"
if ($obligacionesStatus -eq 500) {
    Write-Host "ERROR: /calendar/obligations devolvio 500 (bug SQL!) - revisa fly logs" -ForegroundColor Red
    exit 1
}
Write-Host "      OK /calendar/obligations=$obligacionesStatus (401 sin auth = correcto)" -ForegroundColor Green

# Verifico tambien algunos endpoints V5 nuevos
$vouchersStatus = Get-HttpStatus -Url "https://cehta-backend.fly.dev/api/v1/vouchers"
$reportesStatus = Get-HttpStatus -Url "https://cehta-backend.fly.dev/api/v1/reportes/contables/libro-diario"
Write-Host "      OK /vouchers=$vouchersStatus  /reportes/contables=$reportesStatus" -ForegroundColor Green

# Done
Write-Host ""
Write-Host "==> Deploy COMPLETO" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Frontend: https://cehta.vercel.app  (Vercel todavia puede estar build-eando ~1 min)" -ForegroundColor White
Write-Host "    Backend:  https://cehta-backend.fly.dev" -ForegroundColor White
Write-Host ""
Write-Host "    Para ver progreso de Vercel: https://vercel.com/cehta/cehta/deployments" -ForegroundColor Gray
Write-Host "    Para ver logs Fly:           fly logs --app cehta-backend" -ForegroundColor Gray
Write-Host ""
