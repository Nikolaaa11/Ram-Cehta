# scripts/setup-new-pc.ps1
#
# Setup automático de la plataforma Cehta Capital en un PC nuevo.
#
# Uso (desde una PowerShell elevada como Administrador):
#   powershell -ExecutionPolicy Bypass -File setup-new-pc.ps1
#
# Qué hace:
#   1. Instala dependencias (Git, Node 20, Python 3.13, flyctl) via winget.
#   2. Clona el repo Ram-Cehta a C:\Users\<TuUser>\Documents\0.11.Nikolaya\
#   3. npm install en frontend/
#   4. pip install -r requirements.txt en backend/
#   5. Te guía para hacer login en Fly + GitHub + Vercel.
#
# Tiempo: ~15 minutos (depende de tu internet).

$ErrorActionPreference = "Stop"

function Write-Step($title) {
    Write-Host ""
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "===========================================================" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  Setup Cehta Capital en PC nuevo" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Este script va a:" -ForegroundColor Yellow
Write-Host "  1. Instalar Git, Node.js 20, Python 3.13, flyctl"
Write-Host "  2. Clonar el repo desde GitHub"
Write-Host "  3. Instalar dependencias del frontend y backend"
Write-Host "  4. Configurar git con tu identidad"
Write-Host ""
Write-Host "Necesitás:" -ForegroundColor Yellow
Write-Host "  - PowerShell como administrador (para instalar paquetes)"
Write-Host "  - Internet"
Write-Host "  - Tu password de GitHub (para acceso al repo privado)"
Write-Host ""
Read-Host "Presiona ENTER para arrancar"

# ============================================================================
Write-Step "PASO 1/7: Verificar winget"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget NO está instalado." -ForegroundColor Red
    Write-Host "Instalalo desde: https://aka.ms/getwinget" -ForegroundColor Red
    Write-Host "Es 1 click. Después corré este script de nuevo." -ForegroundColor Red
    exit 1
}
Write-Host "  OK - winget disponible" -ForegroundColor Green

# ============================================================================
Write-Step "PASO 2/7: Instalar Git"
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "  OK - Git ya instalado: $(git --version)" -ForegroundColor Green
} else {
    Write-Host "  Instalando Git..." -ForegroundColor Yellow
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    Write-Host "  OK - Git instalado" -ForegroundColor Green
    Write-Host "  IMPORTANTE: cerrá esta terminal y abrí una nueva, después seguí." -ForegroundColor Red
    Read-Host "Presiona ENTER cuando hayas reabierto la terminal"
}

# ============================================================================
Write-Step "PASO 3/7: Instalar Node.js 20 LTS"
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = node --version
    Write-Host "  OK - Node.js ya instalado: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "  Instalando Node.js 20 LTS..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Write-Host "  OK - Node.js instalado" -ForegroundColor Green
}

# ============================================================================
Write-Step "PASO 4/7: Instalar Python 3.13"
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pyVer = python --version
    Write-Host "  OK - Python ya instalado: $pyVer" -ForegroundColor Green
} else {
    Write-Host "  Instalando Python 3.13..." -ForegroundColor Yellow
    winget install --id Python.Python.3.13 -e --accept-source-agreements --accept-package-agreements
    Write-Host "  OK - Python instalado" -ForegroundColor Green
}

# ============================================================================
Write-Step "PASO 5/7: Instalar flyctl (CLI de Fly.io)"
$flyExe = "$env:USERPROFILE\.fly\bin\flyctl.exe"
if (Test-Path $flyExe) {
    Write-Host "  OK - flyctl ya instalado" -ForegroundColor Green
} else {
    Write-Host "  Instalando flyctl..." -ForegroundColor Yellow
    iwr https://fly.io/install.ps1 -useb | iex
    Write-Host "  OK - flyctl instalado en $env:USERPROFILE\.fly\bin\" -ForegroundColor Green
    Write-Host "  Agregando al PATH..." -ForegroundColor Yellow
    $env:Path = "$env:USERPROFILE\.fly\bin;$env:Path"
}

# ============================================================================
Write-Step "PASO 6/7: Configurar Git"

$gitName = Read-Host "  Tu nombre completo para git commits"
$gitEmail = Read-Host "  Tu email de GitHub (Nikolaaa11)"

git config --global user.name "$gitName"
git config --global user.email "$gitEmail"
Write-Host "  OK - Git configurado" -ForegroundColor Green

# ============================================================================
Write-Step "PASO 7/7: Clonar el repo"

$targetDir = "$env:USERPROFILE\Documents\0.11.Nikolaya"
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}
Set-Location $targetDir

if (Test-Path "$targetDir\Ram-Cehta\.git") {
    Write-Host "  OK - Repo ya clonado en $targetDir\Ram-Cehta" -ForegroundColor Green
    Set-Location "$targetDir\Ram-Cehta"
    Write-Host "  Pulling últimos cambios..." -ForegroundColor Yellow
    git pull origin main
} else {
    Write-Host "  Clonando https://github.com/Nikolaaa11/Ram-Cehta.git..." -ForegroundColor Yellow
    Write-Host "  Te va a pedir login de GitHub (browser se abre solo)." -ForegroundColor Yellow
    git clone https://github.com/Nikolaaa11/Ram-Cehta.git
    Set-Location "$targetDir\Ram-Cehta"
}
Write-Host "  OK - Repo clonado en $((Get-Location).Path)" -ForegroundColor Green

# ============================================================================
Write-Step "BONUS 1/3: Instalar dependencias frontend (npm install)"

Set-Location "$targetDir\Ram-Cehta\frontend"
Write-Host "  Esto tarda ~3-5 min..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK - Frontend dependencies instaladas" -ForegroundColor Green
} else {
    Write-Host "  ERROR en npm install. Revisar manualmente." -ForegroundColor Red
}

# ============================================================================
Write-Step "BONUS 2/3: Crear venv + instalar dependencias backend"

Set-Location "$targetDir\Ram-Cehta\backend"
if (-not (Test-Path ".venv")) {
    Write-Host "  Creando virtual env Python..." -ForegroundColor Yellow
    python -m venv .venv
}
Write-Host "  Activando venv..." -ForegroundColor Yellow
& ".\.venv\Scripts\Activate.ps1"
Write-Host "  Instalando dependencias (esto tarda ~2 min)..." -ForegroundColor Yellow
pip install --upgrade pip
pip install -r requirements.txt
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK - Backend dependencies instaladas" -ForegroundColor Green
} else {
    Write-Host "  ERROR en pip install. Revisar manualmente." -ForegroundColor Red
}

# ============================================================================
Write-Step "BONUS 3/3: Login en Fly.io"

Write-Host "  El browser se va a abrir para que loguees..." -ForegroundColor Yellow
& $flyExe auth login
Write-Host "  OK - flyctl autenticado" -ForegroundColor Green

# ============================================================================
Write-Step "✅ SETUP COMPLETO"

Write-Host ""
Write-Host "Carpeta del repo: $targetDir\Ram-Cehta" -ForegroundColor Green
Write-Host ""
Write-Host "Verifica que todo funciona:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Health check del sistema producción:" -ForegroundColor White
Write-Host '     cd $env:USERPROFILE\Documents\0.11.Nikolaya\Ram-Cehta' -ForegroundColor Gray
Write-Host '     powershell -ExecutionPolicy Bypass -File scripts\verify-health.ps1' -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Frontend dev local (opcional):" -ForegroundColor White
Write-Host '     cd frontend' -ForegroundColor Gray
Write-Host '     npm run dev' -ForegroundColor Gray
Write-Host '     # Abrir http://localhost:3000' -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Backend (NO recomendado correr local, mejor usar Fly):" -ForegroundColor White
Write-Host '     # Solo si necesitás debug local con DB local' -ForegroundColor Gray
Write-Host ""
Write-Host "TODO LISTO. Hablemos del próximo paso." -ForegroundColor Green
Write-Host ""
