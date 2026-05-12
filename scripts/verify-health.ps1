# scripts/verify-health.ps1
#
# Diagnostico rapido del sistema completo.
# Para correr CUALQUIER MOMENTO si la plataforma "se ve rara" o lenta.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\verify-health.ps1
#
# No requiere git status limpio. No deploya nada. Solo lee.
#
# Output: tabla con cada componente + estado verde/amarillo/rojo + recomendacion.

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  CEHTA Platform - Health Check ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$results = @()
$hasError = $false

function Add-Result {
    param($Component, $Status, $Detail, $Action)
    $script:results += [PSCustomObject]@{
        Component = $Component
        Status = $Status
        Detail = $Detail
        Action = $Action
    }
    if ($Status -eq "FAIL") { $script:hasError = $true }
}

# 1. Backend health
Write-Host "[1/8] Checking backend /health..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health" -UseBasicParsing -TimeoutSec 15
    $j = $r.Content | ConvertFrom-Json
    if ($j.status -eq "ok" -and $j.database -eq "ok") {
        Add-Result "Backend API" "OK" "status=ok db=ok" "Nada que hacer"
    } else {
        Add-Result "Backend API" "WARN" "status=$($j.status) db=$($j.database)" "Revisar logs: flyctl logs -a cehta-backend"
    }
} catch {
    Add-Result "Backend API" "FAIL" "No responde ($($_.Exception.Message))" "1) flyctl status -a cehta-backend  2) flyctl machine restart -a cehta-backend"
}

# 2. Backend detailed (servicios)
Write-Host "[2/8] Checking backend services config..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health/detailed" -UseBasicParsing -TimeoutSec 15
    $j = $r.Content | ConvertFrom-Json
    $svcs = $j.services
    foreach ($prop in $svcs.PSObject.Properties) {
        $svc = $prop.Name
        $val = $prop.Value
        if ($val -eq "configured") {
            Add-Result "Service: $svc" "OK" "configured" ""
        } else {
            $action = switch ($svc) {
                "imap_inbox" { "flyctl secrets set INBOX_IMAP_USER=... INBOX_IMAP_PASSWORD=... -a cehta-backend" }
                "anthropic" { "flyctl secrets set ANTHROPIC_API_KEY=sk-ant-... -a cehta-backend" }
                "dropbox" { "flyctl secrets set DROPBOX_REFRESH_TOKEN=... -a cehta-backend" }
                "resend" { "flyctl secrets set RESEND_API_KEY=re_... -a cehta-backend" }
                "openai_embeddings" { "flyctl secrets set OPENAI_API_KEY=sk-... -a cehta-backend" }
                default { "" }
            }
            Add-Result "Service: $svc" "WARN" "not configured" $action
        }
    }
    Add-Result "Alembic migrations" "OK" "head=$($j.alembic_head)" ""
    Add-Result "Empresas activas" $(if ($j.counts.empresas_activas -gt 0) { "OK" } else { "WARN" }) "$($j.counts.empresas_activas) empresas" ""
} catch {
    Add-Result "Backend detailed" "FAIL" "$($_.Exception.Message)" ""
}

# 3. Frontend
Write-Host "[3/8] Checking frontend..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "https://cehta-capital.vercel.app/login" -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -eq 200 -and $r.Content.Length -gt 1000) {
        Add-Result "Frontend (Vercel)" "OK" "HTTP 200, $($r.Content.Length) bytes" ""
    } else {
        Add-Result "Frontend (Vercel)" "WARN" "HTTP $($r.StatusCode), $($r.Content.Length) bytes" "Verificar https://vercel.com/cehta-capital/cehta-frontend/deployments"
    }
} catch {
    Add-Result "Frontend (Vercel)" "FAIL" $_.Exception.Message "Verificar deploy en Vercel dashboard"
}

# 4. Frontend redirect root → /login
Write-Host "[4/8] Checking root redirect..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "https://cehta-capital.vercel.app" -UseBasicParsing -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($r.StatusCode -in @(301, 302, 307, 308)) {
        Add-Result "Root redirect" "OK" "HTTP $($r.StatusCode) -> /login" ""
    } else {
        Add-Result "Root redirect" "WARN" "HTTP $($r.StatusCode)" ""
    }
} catch {
    if ($_.Exception.Response.StatusCode.value__ -in @(301, 302, 307, 308)) {
        Add-Result "Root redirect" "OK" "redirect detectado" ""
    } else {
        Add-Result "Root redirect" "WARN" $_.Exception.Message ""
    }
}

# 5. Auth endpoint
Write-Host "[5/8] Checking auth endpoint..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/auth/me" -UseBasicParsing -ErrorAction SilentlyContinue
    Add-Result "Auth endpoint" "WARN" "HTTP $($r.StatusCode) (esperado 401 sin token)" ""
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
        Add-Result "Auth endpoint" "OK" "HTTP 401 sin token (correcto)" ""
    } else {
        Add-Result "Auth endpoint" "WARN" "HTTP $status" ""
    }
}

# 6. SSL cert
Write-Host "[6/8] Checking SSL certs..." -ForegroundColor Yellow
try {
    $req = [System.Net.WebRequest]::Create("https://cehta-backend.fly.dev")
    $req.GetResponse() | Out-Null
    Add-Result "SSL backend" "OK" "TLS handshake OK" ""
} catch {
    Add-Result "SSL backend" "WARN" "$($_.Exception.Message)" ""
}

# 7. CORS
Write-Host "[7/8] Checking CORS config..." -ForegroundColor Yellow
try {
    $headers = @{ "Origin" = "https://cehta-capital.vercel.app" }
    $r = Invoke-WebRequest -Uri "https://cehta-backend.fly.dev/api/v1/health" -UseBasicParsing -Headers $headers -TimeoutSec 10
    $cors = $r.Headers["Access-Control-Allow-Origin"]
    if ($cors) {
        Add-Result "CORS" "OK" "Allow-Origin set" ""
    } else {
        Add-Result "CORS" "WARN" "Allow-Origin header missing" "Revisar settings.cors_origins en backend config.py"
    }
} catch {
    Add-Result "CORS" "WARN" $_.Exception.Message ""
}

# 8. Git working tree
Write-Host "[8/8] Checking git working tree..." -ForegroundColor Yellow
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
$dirty = git status --porcelain
if ($dirty) {
    $count = ($dirty | Measure-Object).Count
    Add-Result "Git working tree" "WARN" "$count files con cambios sin commitear" "git status para revisar"
} else {
    Add-Result "Git working tree" "OK" "clean" ""
}
$lastCommit = git log -1 --pretty="%h %s"
Add-Result "Last commit" "INFO" "$lastCommit" ""

# Print summary
Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  RESULTADOS" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

foreach ($r in $results) {
    $color = switch ($r.Status) {
        "OK" { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        "INFO" { "Gray" }
        default { "White" }
    }
    $icon = switch ($r.Status) {
        "OK" { "[OK] " }
        "WARN" { "[!!] " }
        "FAIL" { "[XX] " }
        "INFO" { "[..] " }
        default { "[?] " }
    }
    Write-Host ("{0,-4}{1,-25} {2}" -f $icon, $r.Component, $r.Detail) -ForegroundColor $color
    if ($r.Action) {
        Write-Host ("       -> {0}" -f $r.Action) -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
if ($hasError) {
    Write-Host "  Hay FAILS - revisar arriba" -ForegroundColor Red
    exit 1
} else {
    $warns = ($results | Where-Object { $_.Status -eq "WARN" }).Count
    if ($warns -gt 0) {
        Write-Host "  Sistema OK con $warns warnings" -ForegroundColor Yellow
    } else {
        Write-Host "  Todo verde - sistema 100% operativo" -ForegroundColor Green
    }
}
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
