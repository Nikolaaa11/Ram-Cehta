#!/usr/bin/env bash
# =============================================================================
# Smoke test pre-marcha blanca — Cehta Capital
# =============================================================================
# Corre desde cualquier máquina con curl + python.
# No requiere autenticación — solo testea endpoints públicos y la salud
# general del sistema.
#
# Uso:
#   bash scripts/smoke_test_prod.sh
#
# Si todo pasa, el sistema está listo para mañana.
# =============================================================================
set -e

API="https://cehta-backend.fly.dev"
FE="https://cehta-capital.vercel.app"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=1; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

FAILED=0

echo "============================================================="
echo "Smoke test producción — Cehta Capital"
echo "============================================================="
echo ""

# 1. Health backend
echo "[1] Backend health..."
STATUS=$(curl -sS -o /tmp/health.json -w "%{http_code}" --max-time 10 "$API/api/v1/health" || echo "TIMEOUT")
if [ "$STATUS" = "200" ]; then
    DB_STATUS=$(python -c "import json; print(json.load(open('/tmp/health.json'))['database'])" 2>/dev/null || echo "?")
    if [ "$DB_STATUS" = "ok" ]; then
        ok "Backend HTTP 200 · DB: $DB_STATUS"
    else
        fail "Backend HTTP 200 pero DB en estado: $DB_STATUS"
    fi
else
    fail "Backend health falló: $STATUS"
fi

# 2. Health detailed
echo ""
echo "[2] Backend health detailed..."
DETAIL=$(curl -sS --max-time 15 "$API/api/v1/health/detailed" 2>/dev/null)
if [ -n "$DETAIL" ]; then
    ALEMBIC=$(echo "$DETAIL" | python -c "import json,sys; print(json.load(sys.stdin)['alembic_head'])" 2>/dev/null || echo "?")
    EMPRESAS=$(echo "$DETAIL" | python -c "import json,sys; print(json.load(sys.stdin)['counts'].get('empresas_activas', '?'))" 2>/dev/null || echo "?")
    if [ "$ALEMBIC" = "0057" ]; then
        ok "Alembic head: $ALEMBIC (al día)"
    else
        warn "Alembic head: $ALEMBIC (esperado 0057)"
    fi
    if [ "$EMPRESAS" = "10" ]; then
        ok "Empresas activas: $EMPRESAS"
    else
        warn "Empresas activas: $EMPRESAS (esperado 10)"
    fi

    # Services
    echo "$DETAIL" | python -c "
import json, sys
d = json.load(sys.stdin)
for k, v in d.get('services', {}).items():
    print(f'  service {k}: {v}')
" 2>/dev/null
else
    fail "Health detailed no respondió"
fi

# 3. Frontend deploy reachable
echo ""
echo "[3] Frontend Vercel reachable..."
FE_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 -L "$FE/login" || echo "TIMEOUT")
if [ "$FE_STATUS" = "200" ]; then
    ok "Frontend /login HTTP 200"
else
    fail "Frontend HTTP: $FE_STATUS"
fi

# 4. OpenAPI accesible (no requiere auth)
echo ""
echo "[4] OpenAPI spec..."
OPENAPI_STATUS=$(curl -sS -o /tmp/openapi.json -w "%{http_code}" --max-time 15 "$API/openapi.json")
if [ "$OPENAPI_STATUS" = "200" ]; then
    NUM_PATHS=$(python -c "import json; print(len(json.load(open('/tmp/openapi.json'))['paths']))" 2>/dev/null)
    ok "OpenAPI cargó: $NUM_PATHS endpoints"
else
    fail "OpenAPI HTTP: $OPENAPI_STATUS"
fi

# 5. Endpoints clave que deben existir (sanity check)
echo ""
echo "[5] Endpoints clave..."
ENDPOINTS=(
    "/api/v1/vouchers/mis-pendientes"
    "/api/v1/vouchers/bulk-approve"
    "/api/v1/vouchers/form-metadata"
    "/api/v1/empresa"
    "/api/v1/proveedores/search"
    "/api/v1/ordenes-compra"
    "/api/v1/plan-cuentas"
)
for ep in "${ENDPOINTS[@]}"; do
    if grep -q "\"$ep\"" /tmp/openapi.json 2>/dev/null; then
        ok "endpoint registrado: $ep"
    else
        fail "endpoint NO registrado: $ep"
    fi
done

# 6. Endpoints sin auth NO deben exponer datos sensibles
echo ""
echo "[6] Endpoints sin auth — no leak de datos..."
NO_AUTH=$(curl -sS --max-time 5 "$API/api/v1/vouchers" 2>/dev/null)
if echo "$NO_AUTH" | grep -q "Not authenticated\|Unauthorized\|401\|403"; then
    ok "/vouchers requiere auth (correcto)"
else
    fail "/vouchers expuesto sin auth (CRÍTICO si devuelve data)"
fi

# 7. Latencia
echo ""
echo "[7] Latencia health..."
TIME=$(curl -sS -o /dev/null -w "%{time_total}" --max-time 10 "$API/api/v1/health")
TIME_MS=$(echo "$TIME * 1000" | bc | cut -d. -f1)
if [ "$TIME_MS" -lt 2000 ]; then
    ok "Health responde en ${TIME_MS}ms (< 2s objetivo)"
else
    warn "Health responde lento: ${TIME_MS}ms"
fi

# Summary
echo ""
echo "============================================================="
if [ "$FAILED" = "0" ]; then
    echo -e "${GREEN}✓ Smoke test PASSED — listo para marcha blanca${NC}"
    exit 0
else
    echo -e "${RED}✗ Smoke test FAILED — revisar fallas arriba${NC}"
    exit 1
fi
