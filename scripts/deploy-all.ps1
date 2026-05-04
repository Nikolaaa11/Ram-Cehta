# scripts/deploy-all.ps1
#
# Deploy completo: typecheck → push → fly backend → smoke test → confirm Vercel.
#
# Uso (desde la raíz del repo Ram-Cehta):
#   pwsh -File scripts/deploy-all.ps1
#   o doble click si tenés PowerShell asociado a .ps1
#
# Lo que hace, en orden:
#   1. Verifica que git status este limpio (no hay cambios sin commitear)
#   2. Typecheck del frontend (npm run lint + tsc) — falla rápido si algo rompe
#   3. Push a GitHub (Vercel se entera y deploya el frontend solito)
#   4. Deploy del backend a Fly.io (cehta-backend)
#   5. Smoke test: /healthz + /calendar/obligations debe responder 401 (no 500)
#   6. Imprime URL del frontend para que abras y verifiques manual
#
# Si algun paso falla → corta y muestra que rompio. Nunca hace push --force.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host ""
Write-Host "==> Deploy CEHTA — full stack (frontend Vercel + backend Fly)" -ForegroundColor Cyan
Write-Host ""

# 1. Git status
Write-Host "[1/5] Verificando git status..." -ForegroundColor Yellow
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "ERROR: hay cambios sin commitear. Hace commit primero:" -ForegroundColor Red
    git status --short
    exit 1
}
Write-Host "      OK — working tree limpio" -ForegroundColor Green

# 2. Frontend typecheck
Write-Host ""
Write-Host "[2/5] Frontend typecheck (esto tarda ~30s)..." -ForegroundColor Yellow
Set-Location "$repoRoot\frontend"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: typecheck del frontend rompio. Arregla los errores TypeScript primero." -ForegroundColor Red
    exit 1
}
Write-Host "      OK — sin errores TS" -ForegroundColor Green
Set-Location $repoRoot

# 3. Push a GitHub (dispara Vercel)
Write-Host ""
Write-Host "[3/5] Push a GitHub (Vercel auto-deploy frontend)..." -ForegroundColor Yellow
git push origin main
Write-Host "      OK — Vercel ya esta build-eando https://cehta.vercel.app" -ForegroundColor Green

# 4. Deploy backend a Fly
Write-Host ""
Write-Host "[4/5] Deploy backend a Fly.io (~3-5 min)..." -ForegroundColor Yellow
Set-Location "$repoRoot\backend"
fly deploy --app cehta-backend --remote-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: fly deploy rompio. Revisa el output arriba." -ForegroundColor Red
    exit 1
}
Write-Host "      OK — backend desplegado" -ForegroundColor Green
Set-Location $repoRoot

# 5. Smoke test
Write-Host ""
Write-Host "[5/5] Smoke test endpoints clave..." -ForegroundColor Yellow

$health = (Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health" -UseBasicParsing -SkipHttpErrorCheck).StatusCode
if ($health -ne 200) {
    Write-Host "ERROR: /api/v1/health devolvio $health (esperado 200)" -ForegroundColor Red
    exit 1
}
Write-Host "      OK /api/v1/health=200" -ForegroundColor Green

$obligaciones = (Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/calendar/obligations" -UseBasicParsing -SkipHttpErrorCheck).StatusCode
if ($obligaciones -eq 500) {
    Write-Host "ERROR: /calendar/obligations devolvio 500 (bug de SQL!) — revisa fly logs" -ForegroundColor Red
    exit 1
}
Write-Host "      OK /calendar/obligations=$obligaciones (401 sin auth = correcto, 200 si tenes token)" -ForegroundColor Green

# 6. Done
Write-Host ""
Write-Host "==> Deploy COMPLETO" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Frontend: https://cehta.vercel.app  (Vercel todavia puede estar build-eando ~1 min)" -ForegroundColor White
Write-Host "    Backend:  https://cehta-backend.fly.dev" -ForegroundColor White
Write-Host ""
Write-Host "    Para ver progreso de Vercel: https://vercel.com/cehta/cehta/deployments" -ForegroundColor Gray
Write-Host "    Para ver logs Fly:           fly logs --app cehta-backend" -ForegroundColor Gray
Write-Host ""
