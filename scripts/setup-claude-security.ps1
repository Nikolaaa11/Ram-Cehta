# =============================================================================
# CLAUDE CODE - SECURITY HARDENING SETUP (PowerShell port)
# Autor: Nicolas Rietta - CEHTA Capital / AFIS S.A.
# Fecha: Mayo 2026
# =============================================================================
# Port directo del setup-claude-security.sh original a PowerShell para Windows.
# Aplica EXACTAMENTE las mismas reglas. Cambios solo en sintaxis (PS vs bash) y
# el hook block-dangerous queda en .ps1 (nativo Windows, no requiere WSL/jq).
#
# Uso:
#   pwsh -ExecutionPolicy Bypass -File scripts\setup-claude-security.ps1
# o:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-claude-security.ps1
#
# Para revertir:
#   Remove-Item -Recurse "$env:USERPROFILE\.claude\hooks", "$env:USERPROFILE\.claude\settings.json"
#   Remove-Item -Recurse ".claude\"
# =============================================================================

$ErrorActionPreference = "Stop"

# ---------- Colores ----------
function Write-Ok   { param($Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn { param($Msg) Write-Host "[!]  $Msg" -ForegroundColor Yellow }
function Write-Err  { param($Msg) Write-Host "[X]  $Msg" -ForegroundColor Red }

# ---------- 0. Pre-flight ----------
Write-Host "============================================================"
Write-Host "  CLAUDE CODE SECURITY HARDENING"
Write-Host "============================================================"

$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCmd) {
    Write-Warn "Claude Code CLI no detectado en PATH (claude). Continuando igual — los settings.json se aplicaran cuando lo instales."
} else {
    $version = try { & claude --version 2>$null } catch { "unknown" }
    Write-Ok "Claude Code detectado: $version"
}

# ---------- 1. Estructura de directorios ----------
$UserDir    = Join-Path $env:USERPROFILE ".claude"
$ProjectDir = Join-Path (Get-Location) ".claude"

foreach ($d in @(
    "$UserDir\hooks",
    "$UserDir\commands",
    "$ProjectDir\hooks",
    "$ProjectDir\commands",
    "$ProjectDir\agents"
)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
Write-Ok "Estructura .claude/ creada (user + proyecto)"

# ---------- 2. settings.json a nivel USER ----------
$userSettings = @'
{
  "$schema": "https://claude.ai/schemas/settings.json",
  "defaultMode": "default",
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(rm -rf /)",
      "Bash(rm -rf ~)",
      "Bash(rm -rf $HOME*)",
      "Bash(sudo *)",
      "Bash(chmod 777 *)",
      "Bash(curl * | sh)",
      "Bash(curl * | bash)",
      "Bash(wget * | sh)",
      "Bash(wget * | bash)",
      "Bash(eval *)",
      "Bash(:(){ :|:& };:)",
      "Bash(dd if=* of=/dev/*)",
      "Bash(mkfs.*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git reset --hard origin/main)",
      "Bash(git reset --hard origin/master)",
      "Bash(psql * production*)",
      "Bash(psql * prod*)",
      "Bash(mysql * production*)",
      "Bash(npm publish*)",
      "Bash(pip install --break-system-packages*)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/id_rsa)",
      "Read(**/id_ed25519)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Read(~/.gnupg/**)",
      "Read(~/.config/gcloud/**)",
      "Read(**/secrets.json)",
      "Read(**/credentials.json)",
      "Read(**/.netrc)",
      "Edit(.env)",
      "Edit(**/.env)",
      "Edit(~/.ssh/**)",
      "WebFetch(domain:bit.ly)",
      "WebFetch(domain:tinyurl.com)"
    ],
    "ask": [
      "Bash(git push*)",
      "Bash(git commit*)",
      "Bash(git rebase*)",
      "Bash(npm install*)",
      "Bash(pnpm add*)",
      "Bash(pip install*)",
      "Bash(brew install*)",
      "Bash(docker *)",
      "Bash(kubectl *)",
      "Bash(terraform apply*)",
      "Bash(terraform destroy*)",
      "WebFetch(*)",
      "Write(*)"
    ],
    "allow": [
      "Bash(ls*)",
      "Bash(pwd)",
      "Bash(cat *.md)",
      "Bash(cat *.json)",
      "Bash(cat *.txt)",
      "Bash(grep *)",
      "Bash(find * -type f)",
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log*)",
      "Bash(git branch*)",
      "Read(*)"
    ]
  },
  "transcriptRetentionDays": 7,
  "telemetry": {
    "enabled": false
  },
  "autoUpdater": {
    "enabled": true
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.claude\\hooks\\block-dangerous.ps1\""
          }
        ]
      }
    ]
  }
}
'@
$userSettingsPath = Join-Path $UserDir "settings.json"
Set-Content -Path $userSettingsPath -Value $userSettings -Encoding UTF8
Write-Ok "User settings.json instalado en $userSettingsPath"

# ---------- 3. Hook defensivo: block-dangerous.ps1 ----------
$hookContent = @'
# block-dangerous.ps1 - Hook PreToolUse para Bash en Claude Code
# Equivalente al block-dangerous.sh original, pero nativo PowerShell (no requiere jq).
# Bloquea patrones peligrosos que las deny rules de string-matching no capturan.

$input = [Console]::In.ReadToEnd()
try {
    $payload = $input | ConvertFrom-Json -ErrorAction Stop
} catch {
    exit 0
}

$cmd = $null
if ($payload.tool_input -and $payload.tool_input.command) {
    $cmd = [string]$payload.tool_input.command
}

if ([string]::IsNullOrEmpty($cmd)) { exit 0 }

$reason = $null

# Curl/wget pipeado a shell
if ($cmd -match '(curl|wget)[^|]*\|\s*(sh|bash|zsh)') {
    $reason = "Patron peligroso: curl/wget pipeado a shell ejecuta codigo remoto sin revisar."
}

# Comandos encadenados (mas de 1 accion por tool call) — con excepciones seguras
if (-not $reason -and $cmd -match '(&&|;|\|\|)') {
    $safePrefix = '^(cd [^;]+ && (ls|pwd|cat|git status))'
    if ($cmd -notmatch $safePrefix) {
        $reason = "Comandos encadenados detectados (&&, ;, ||). Usa una accion por tool call."
    }
}

# Sustitucion de comandos
if (-not $reason -and ($cmd -match '\$\([^)]+\)' -or $cmd -match '`[^`]+`')) {
    $reason = "Sustitucion de comandos (`$(...) o backticks) bloqueada. Ejecuta el comando interno primero."
}

# Operaciones contra /dev/
if (-not $reason -and $cmd -match 'of=/dev/(sd[a-z]|nvme|hd[a-z])') {
    $reason = "Escritura directa a dispositivo de bloque bloqueada."
}

# Fork bomb
if (-not $reason -and $cmd -match ':\(\)\s*\{.*\}\s*;\s*:') {
    $reason = "Fork bomb detectada."
}

if ($reason) {
    @{
        hookSpecificOutput = @{
            hookEventName            = "PreToolUse"
            permissionDecision       = "deny"
            permissionDecisionReason = $reason
        }
    } | ConvertTo-Json -Depth 5 -Compress
}

exit 0
'@
$hookPath = Join-Path $UserDir "hooks\block-dangerous.ps1"
Set-Content -Path $hookPath -Value $hookContent -Encoding UTF8
Write-Ok "Hook block-dangerous.ps1 instalado en $hookPath"

# ---------- 4. CLAUDE.md a nivel USER ----------
$userClaudeMd = @'
# Instrucciones globales para Claude Code

## Reglas de seguridad inviolables
- **NUNCA** leas archivos `.env`, `.env.*`, `secrets.json`, `credentials.json`, ni nada en `~/.ssh/`, `~/.aws/`, `~/.gnupg/`.
- **NUNCA** ejecutes `rm -rf` sobre rutas con wildcards o variables (`$HOME`, `*`, `~`).
- **NUNCA** uses `curl | sh` ni `wget | bash`. Descarga el script, muestralo, espera confirmacion.
- **NUNCA** uses `sudo` salvo que el usuario lo pida explicitamente en la misma sesion.
- **NUNCA** hagas `git push --force` ni `git reset --hard` contra ramas remotas.

## Bash safety
- Una accion por tool call. No encadenes con `&&`, `;`, o `||`.
- No uses sustitucion de comandos (`$()` o backticks). Ejecuta el comando interno primero, usa el resultado en la siguiente llamada.
- Si necesitas hacer `cd`, hazlo en el mismo tool call que el comando que sigue solo si es lectura segura (ls, pwd, cat, git status).

## Datos sensibles
- Antes de tocar cualquier archivo que pueda contener PII, credenciales financieras, RUTs, o data regulada CMF/SII: **pregunta primero**.
- Nunca pegues contenido de `.env` o credenciales en logs, transcripts, o respuestas.
- Si encuentras una credencial expuesta en el codigo, **detente** y alertalo, no la uses.

## Confirmaciones obligatorias
Pide confirmacion explicita antes de:
- Instalar dependencias (`npm install`, `pip install`, `brew install`, etc.)
- Tocar infraestructura (`docker`, `kubectl`, `terraform apply`).
- Hacer commits o push a Git.
- Conectar a bases de datos de produccion.
- Modificar archivos fuera del directorio del proyecto actual.

## Estilo
- Respuestas concisas. Sin preambulos ni resumenes innecesarios.
- En espanol chileno cuando el usuario escriba en espanol.
- Comentarios de codigo en espanol si el resto del codigo ya esta en espanol.
'@
$userClaudeMdPath = Join-Path $UserDir "CLAUDE.md"
Set-Content -Path $userClaudeMdPath -Value $userClaudeMd -Encoding UTF8
Write-Ok "CLAUDE.md global instalado en $userClaudeMdPath"

# ---------- 5. settings.json a nivel PROYECTO ----------
$projectSettings = @'
{
  "$schema": "https://claude.ai/schemas/settings.json",
  "defaultMode": "default",
  "permissions": {
    "deny": [
      "$defaults",
      "Read(./private/**)",
      "Read(./confidential/**)",
      "Read(./*.xlsx)",
      "Write(./CLAUDE.md)",
      "Write(./.claude/settings.json)"
    ],
    "ask": [
      "$defaults"
    ],
    "allow": [
      "$defaults",
      "Read(./src/**)",
      "Read(./tests/**)",
      "Read(./docs/**)",
      "Read(./README.md)",
      "Read(./package.json)",
      "Read(./tsconfig.json)"
    ]
  },
  "transcriptRetentionDays": 7,
  "model": "opus-4-7"
}
'@
$projectSettingsPath = Join-Path $ProjectDir "settings.json"
Set-Content -Path $projectSettingsPath -Value $projectSettings -Encoding UTF8
Write-Ok "Project settings.json instalado en $projectSettingsPath"

# ---------- 6. CLAUDE.md del proyecto (TEMPLATE) ----------
$projectClaudeMdPath = Join-Path (Get-Location) "CLAUDE.md"
if (-not (Test-Path $projectClaudeMdPath)) {
    $projectClaudeMd = @'
# CLAUDE.md - Contexto del proyecto

## Sobre el proyecto
[EDITA: describe que hace este proyecto, su arquitectura, decisiones de diseno.]

## Stack
[EDITA: lenguaje, framework, runtime, base de datos.]

## Convenciones de codigo
- [EDITA: naming patterns, organizacion de archivos, formato.]

## Comandos comunes del proyecto
```bash
# build:
# test:
# lint:
# deploy:
```

## Reglas especificas del proyecto
- No tocar archivos en `/private/` ni `/confidential/`.
- Los archivos `.xlsx` contienen data sensible — no leerlos sin permiso explicito.
- Tests deben pasar antes de cualquier commit.

## Contexto adicional
[EDITA: cualquier cosa que Claude deba saber permanentemente sobre el proyecto.]
'@
    Set-Content -Path $projectClaudeMdPath -Value $projectClaudeMd -Encoding UTF8
    Write-Ok "CLAUDE.md del proyecto creado (editalo con contexto especifico)"
} else {
    Write-Warn "CLAUDE.md ya existe en el proyecto, no se sobrescribio."
}

# ---------- 7. .gitignore ----------
$gitignorePath = Join-Path (Get-Location) ".gitignore"
if (Test-Path $gitignorePath) {
    $gi = Get-Content $gitignorePath -Raw -ErrorAction SilentlyContinue
    $entries = @('.claude/settings.local.json', '.env', '.env.*')
    foreach ($e in $entries) {
        if ($gi -notmatch [regex]::Escape($e)) {
            Add-Content -Path $gitignorePath -Value $e
        }
    }
    Write-Ok ".gitignore actualizado"
} else {
    Write-Warn "No hay .gitignore en el directorio actual — crealo si es un repo Git"
}

# ---------- 8. Validacion final ----------
Write-Host ""
Write-Host "============================================================"
Write-Host "  VALIDACION"
Write-Host "============================================================"

try {
    $null = & claude plugin validate 2>$null
    Write-Ok "Plugins validados"
} catch {
    Write-Warn "claude plugin validate no disponible o sin plugins"
}

if (Test-Path $hookPath) {
    Write-Ok "Hook verificado: $hookPath"
} else {
    Write-Err "Hook NO se creo. Revisar permisos en $UserDir"
}

# PowerShell tiene ConvertFrom-Json nativo — no necesita jq
Write-Ok "PowerShell ConvertFrom-Json disponible (no requiere jq)"

Write-Host ""
Write-Host "============================================================"
Write-Host "  SIGUIENTES PASOS MANUALES"
Write-Host "============================================================"
Write-Host "1. Edita CLAUDE.md del proyecto con contexto real."
Write-Host "2. Activa sandbox cada sesion:           /sandbox"
Write-Host "3. Verifica permisos cargados:           /permissions"
Write-Host "4. Verifica estado general:              /status"
Write-Host "5. Para repos no confiables, usa:        claude --sandbox=strict"
Write-Host ""
Write-Host "Auditoria sugerida (mensual):"
Write-Host "   - Revisar $userSettingsPath por drift"
Write-Host "   - Rotar API keys de Anthropic"
Write-Host "   - Actualizar Claude Code:             claude --update"
Write-Host ""
Write-Ok "Setup completo."
