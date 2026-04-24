from __future__ import annotations

import os

# Fija variables mínimas para que `app.core.config` cargue incluso sin .env.
# Tests de integración que tocan DB usan testcontainers y sobrescriben DATABASE_URL.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost:5432/test")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
