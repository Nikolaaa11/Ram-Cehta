# Cuentas que validan vouchers — quién firma qué

Consulta directa a la DB de producción (Supabase) — `core.approval_rules` activas y `core.user_company_roles` activos. Refrescá este archivo si cambian roles.

## Regla general

Las **10 empresas** del portafolio tienen la misma regla:

```
required_roles = ['GG', 'DIRECTOR']   →   2 firmas SIEMPRE
```

- **1ra firma**: `GG` (Gerente General de la empresa)
- **2da firma**: `DIRECTOR` (Guido Rietta o backup)

Sin las 2 firmas el voucher no pasa de **PENDING** a **APPROVED** y por lo tanto no entra a la pestaña *Validación · Pagos*.

## Directores (2da firma) — cubren TODAS las empresas

Ambos están activos como `DIRECTOR` en las 10 empresas. Cualquiera de los dos sirve como 2da firma.

| Email | Rol funcional |
|---|---|
| `grietta@cehtacapital.com` | Guido Rietta — DIRECTOR titular |
| `contactocehta@gmail.com` | Backup operativo Cehta (redundancia) |

## GG (1ra firma) por empresa

| Empresa | GG titular | GG backup |
|---|---|---|
| AFIS | `btoro@cenergy.cl` | — |
| CEHTA | `btoro@cenergy.cl` | — |
| CENERGY | `btoro@cenergy.cl` | — |
| CSL | `jgonzalez@climatesmartleasing.com` | `btoro@cenergy.cl` |
| DTE | `czuniga@dteconsulting.cl` | `btoro@cenergy.cl` |
| EVOQUE | `jiprieto@evoquenergy.com` | `btoro@cenergy.cl` |
| FIP_CEHTA | `btoro@cenergy.cl` | — |
| REVTECH | `camilo@revtech.cl` | `btoro@cenergy.cl` |
| RHO | `j.alvarez@rhoingenieria.cl` | `btoro@cenergy.cl` |
| TRONGKAI | `jocuevas@trongkai.com` | `btoro@cenergy.cl` |

> `btoro@cenergy.cl` está cargado como `GG` en las 10 empresas → actúa como fallback global de primera firma cuando el GG titular no está disponible.

## Qué tiene que pasar para que aparezca en *Validación · Pagos*

1. Un voucher en `PENDING` (alguien hizo "enviar a aprobación" desde DRAFT).
2. Firma del **GG titular** (o backup `btoro@cenergy.cl`).
3. Firma del **DIRECTOR** (Guido o backup `contactocehta@gmail.com`).
4. Status pasa a `APPROVED` → aparece en el badge verde de *Validación · Pagos* (`/transferencias`).
5. Operador descarga el Excel de transferencia masiva, lo sube al banco, marca el voucher `EXECUTED`.

## Empresas que dependen del fallback (`btoro@cenergy.cl`) como único GG

Estas 4 hoy NO tienen un GG titular específico cargado — solo el global:

- **AFIS**
- **CEHTA**
- **CENERGY**
- **FIP_CEHTA**

Si querés un GG titular distinto para alguna de ellas, hay que agregarlo en `core.user_company_roles` con `role='GG'` y `active=TRUE`.

---

*Última verificación: consulta directa a Supabase, 16/05/2026.*
