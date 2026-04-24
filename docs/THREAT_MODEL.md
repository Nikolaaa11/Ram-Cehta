# Threat Model — Ram-Cehta

Versión inicial (Fase 0). Se itera con cada fase del plan.

## Activos protegidos

1. **Datos financieros del portfolio** (`core.movimientos`, `core.ordenes_compra`, `core.f29_obligaciones`) — sensibilidad alta, impacto financiero directo si se filtran.
2. **Credenciales bancarias de proveedores** (`core.proveedores`) — sensibilidad alta, vector para fraude.
3. **Credenciales de usuarios** (Supabase Auth) — sensibilidad alta.
4. **PDFs firmados de OCs** (Supabase Storage) — integridad crítica (fuente legal).
5. **Secretos de integraciones** (Dropbox, Anthropic, Gmail) — acceso a sistemas externos del negocio.

## Actores

- **Internos autorizados**: Nikola (admin), Benja (asistente), Egon (finanzas), CEOs del portfolio (viewer).
- **Internos no autorizados**: ex-empleados con accesos no revocados, compromiso de cuenta de colaborador.
- **Externos**: atacantes oportunistas (scans automáticos), phishing dirigido al equipo Cehta.
- **Proveedores SaaS**: Supabase, Fly.io, Vercel, GitHub — trust-but-verify.

## Vectores considerados

| # | Amenaza | Mitigación actual | Pendiente |
|---|---------|-------------------|-----------|
| T1 | SQL Injection | SQLAlchemy parametrizado; validación Pydantic en boundary | Tests fuzz (Fase 4) |
| T2 | XSS / CSRF | Next.js escapa JSX; cookies httpOnly + SameSite=Lax | CSP header estricto (Fase 4) |
| T3 | Cuenta comprometida (phishing) | Password hash argon2 (cuando haya auth propia); Supabase Auth con rate limiting | MFA obligatorio para admin (Fase 5) |
| T4 | Lectura no autorizada de `core.*` | RLS activo desde commit inicial | Tests E2E que verifiquen RLS con distintos app_role (Fase 2.2) |
| T5 | Secretos filtrados en repo | `.env` en `.gitignore`, gitleaks en CI (workflows listos) | Pre-commit hook local (Fase 4) |
| T6 | Token de GitHub robado permite mergear | Branch protection en main, 2 aprobaciones para cambios críticos | Protected branches (tras Fase 4) |
| T7 | Supabase downtime bloquea operación | Backend maneja 5xx de DB con retry + circuit breaker | Modo degradado (Fase 5) |
| T8 | ETL importa datos maliciosos | Validadores mod-11, rejected_rows en audit | Alertas si `rejected/total > 5%` (Fase 4) |
| T9 | PDFs OC alterados post-firma | PDF en Supabase Storage con URL firmada 1h; hash en DB | Firma digital con Signs (Fase 6) |
| T10 | Exposición de RUT en logs | structlog con scrubbers (pendiente impl) | Tests que fallan si detectan RUT en output (Fase 2.6) |

## Fuera de alcance (riesgos aceptados)

- **Ataque físico al notebook de Nikola**: mitigado por cifrado de disco de Windows + uso de gestor de contraseñas.
- **Compromiso del OS de Supabase**: responsabilidad del proveedor (SOC 2 Tipo II).

## Próxima revisión

Después de cerrar Fase 2.2 (auth real) y Fase 4 (deploy productivo), actualizar este documento con lo aprendido.
