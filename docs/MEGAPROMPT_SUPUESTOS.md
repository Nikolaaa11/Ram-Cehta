# SUPUESTOS — Megaprompt OC/Voucher/Usuarios (2026-07-09)

Decisiones tomadas de forma autónoma ante ambigüedad (una línea por decisión).

- **Benjamín no existe** en la base de datos (solo se lo menciona en un gate de RRHH del sidebar por substring "benja"). Por eso, para "clonar los permisos de Victoria y Benjamín" se usa el set de **Victoria** (el único real): `app_role=finance` + rol **GG en las 10 empresas**. Es el modelo de "acceso total operativo" del grupo.
- **"Acceso TOTAL" de Caterin = operativo, no admin.** Victoria es `finance` (no admin), así que Caterin también es `finance`. Admin (borrar proveedores/F29, gestionar usuarios, auditoría) queda reservado a Cehta Capital interno. Si se requiere admin real, se eleva manualmente.
- **Email de Caterin normalizado a minúsculas** (`cescobar@cenergy.cl`) — Supabase Auth es case-insensitive en el login pero guarda lower.
- **Activación de Caterin**: se crea la cuenta con clave temporal determinística (fórmula del grupo) y se entrega la credencial a Nicolás para que la comparta, en vez de disparar un correo automático (mismo criterio que con Erick; evita mails salientes no supervisados en marcha blanca).
- **Borrado de usuario = soft-delete + revoke real**, NO hard-delete. Se preservan los documentos históricos (vouchers/OC creados, firmas) porque son evidencia contable/legal; se corta el acceso (ban en Supabase Auth + `user_company_roles.active=false` + baja del rol global).
- Los tipos de documento nuevos de voucher (Excel transferencia, BH propia/tercero, boleta) se agregan como valores del enum existente `doc_tributario_tipo` / `tipo_documento`, sin romper los actuales.

## Megaprompt PREVOUCHER (2026-07-13)
- **Pre-voucher = voucher DRAFT** (no tabla nueva): preserva código, adjuntos, auditoría y evita migrar datos. La "cola de pre-vouchers" muestra TODOS los DRAFTs del scope (incluye borradores propios de contadores — distinguibles por la columna creador y el badge source).
- **Categoría "Otro gasto" → 4201-08 GASTOS GENERALES + área ADM**: el operador no inventa cuentas (invariante); el especialista reclasifica con el editor de líneas.
- **La edición de líneas solo aplica a DRAFT** — un voucher en firmas o aprobado es inmutable (para corregir: reject → reopen → editar).
- **Sistema de carpetas**: se documenta y asegura la estructura que el CÓDIGO ya usa (no se renombran carpetas existentes — p.ej. quedan dos prefijos "06-" y "02-Fondo (FIP CEHTA)" hardcodeados; cambiarlos requeriría migrar código+archivos, fuera de alcance).
- **ensure_dropbox_folders corre en Fly** (las credenciales de app Dropbox no existen localmente).
