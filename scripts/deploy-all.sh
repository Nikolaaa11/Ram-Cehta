#!/usr/bin/env bash
# scripts/deploy-all.sh — equivalente del .ps1 para git bash / WSL / Mac.
#
# Uso desde la raíz del repo:
#   bash scripts/deploy-all.sh
#
# Hace en orden: git clean check → frontend typecheck → push GitHub →
# fly deploy backend → smoke /healthz + /calendar/obligations.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

echo
echo "==> Deploy CEHTA — full stack (frontend Vercel + backend Fly)"
echo

# 1. Git limpio
echo "[1/5] Verificando git status..."
if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: hay cambios sin commitear. Commit primero:"
    git status --short
    exit 1
fi
echo "      OK — working tree limpio"

# 2. Frontend typecheck
echo
echo "[2/5] Frontend typecheck..."
cd "$REPO_ROOT/frontend"
npx tsc --noEmit
echo "      OK — sin errores TS"
cd "$REPO_ROOT"

# 3. Push (dispara Vercel)
echo
echo "[3/5] Push a GitHub (Vercel auto-deploy frontend)..."
git push origin main
echo "      OK — Vercel build-eando"

# 4. Backend a Fly
echo
echo "[4/5] Deploy backend a Fly.io..."
cd "$REPO_ROOT/backend"
fly deploy --app cehta-backend --remote-only
echo "      OK — backend desplegado"
cd "$REPO_ROOT"

# 5. Smoke test
echo
echo "[5/5] Smoke test..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" https://cehta-backend.fly.dev/api/v1/health)
if [[ "$HEALTH" != "200" ]]; then
    echo "ERROR: /api/v1/health devolvio $HEALTH (esperado 200)"
    exit 1
fi
echo "      OK /api/v1/health=200"

OBLIG=$(curl -s -o /dev/null -w "%{http_code}" https://cehta-backend.fly.dev/api/v1/calendar/obligations)
if [[ "$OBLIG" == "500" ]]; then
    echo "ERROR: /calendar/obligations=500 (bug SQL! revisa fly logs)"
    exit 1
fi
echo "      OK /calendar/obligations=$OBLIG (401 sin auth = correcto)"

echo
echo "==> Deploy COMPLETO"
echo
echo "    Frontend: https://cehta.vercel.app"
echo "    Backend:  https://cehta-backend.fly.dev"
echo
