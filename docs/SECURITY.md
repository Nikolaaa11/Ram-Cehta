# Seguridad — Ram-Cehta

Este documento se irá completando sesión por sesión. Placeholder por ahora.

## Referencia OWASP Top 10 (a documentar en Fase 2)

- A01 Broken Access Control — RBAC + RLS Supabase
- A02 Cryptographic Failures — argon2id, TLS 1.3, secretos en Supabase Vault
- A03 Injection — SQLAlchemy parametrizado
- A04 Insecure Design — threat model en `docs/THREAT_MODEL.md`
- A05 Misconfiguration — HSTS, CSP, X-Frame-Options (headers en backend y Vercel)
- A06 Vulnerable Components — pip-audit + npm audit + Dependabot
- A07 Auth Failures — rate limit en `/auth/*`, lockout 5 intentos
- A08 Integrity — JWT de Supabase, SRI en assets externos
- A09 Logging — structlog JSON, nunca loggear RUTs completos, tokens, passwords
- A10 SSRF — allowlist de URLs en integraciones (Gmail, Claude, SII)

## Específico chileno

- Ley 19.628 — datos personales
- Ley 19.799 — firma electrónica

## Secretos

- `.env` en `.gitignore` (verificar con `git check-ignore backend/.env frontend/.env.local`)
- Producción: Fly.io secrets (backend), Vercel env vars (frontend)
- Rotación: cada 90 días o ante sospecha de filtración
- `gitleaks` como pre-commit hook (pendiente Fase 4)
