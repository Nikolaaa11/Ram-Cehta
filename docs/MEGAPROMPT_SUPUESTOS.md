# SUPUESTOS — Megaprompt OC/Voucher/Usuarios (2026-07-09)

Decisiones tomadas de forma autónoma ante ambigüedad (una línea por decisión).

- **Benjamín no existe** en la base de datos (solo se lo menciona en un gate de RRHH del sidebar por substring "benja"). Por eso, para "clonar los permisos de Victoria y Benjamín" se usa el set de **Victoria** (el único real): `app_role=finance` + rol **GG en las 10 empresas**. Es el modelo de "acceso total operativo" del grupo.
- **"Acceso TOTAL" de Caterin = operativo, no admin.** Victoria es `finance` (no admin), así que Caterin también es `finance`. Admin (borrar proveedores/F29, gestionar usuarios, auditoría) queda reservado a Cehta Capital interno. Si se requiere admin real, se eleva manualmente.
- **Email de Caterin normalizado a minúsculas** (`cescobar@cenergy.cl`) — Supabase Auth es case-insensitive en el login pero guarda lower.
- **Activación de Caterin**: se crea la cuenta con clave temporal determinística (fórmula del grupo) y se entrega la credencial a Nicolás para que la comparta, en vez de disparar un correo automático (mismo criterio que con Erick; evita mails salientes no supervisados en marcha blanca).
- **Borrado de usuario = soft-delete + revoke real**, NO hard-delete. Se preservan los documentos históricos (vouchers/OC creados, firmas) porque son evidencia contable/legal; se corta el acceso (ban en Supabase Auth + `user_company_roles.active=false` + baja del rol global).
- Los tipos de documento nuevos de voucher (Excel transferencia, BH propia/tercero, boleta) se agregan como valores del enum existente `doc_tributario_tipo` / `tipo_documento`, sin romper los actuales.
