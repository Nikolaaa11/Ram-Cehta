# Audit imágenes (next/image) — 2026-05-31

## TL;DR

✅ **Ya está optimizado**. Solo 1 `<img>` directo en toda la app y es justificado.

## Búsqueda exhaustiva

```bash
grep -rE '<img[ /]' app/ components/ --include="*.tsx"
```

Resultado: **1 match** en `app/(app)/2fa/setup/page.tsx:246`

```tsx
{/* eslint-disable-next-line @next/next/no-img-element */}
<img
  src={enrollment.qr_url}
  alt="QR para escanear con tu app autenticadora"
  width={240}
  height={240}
  className="block"
/>
```

### ¿Por qué este sí puede ser `<img>` directo?

- `qr_url` es generado dinámicamente en el backend para el flujo TOTP
- No es un asset estático que Next.js pueda optimizar al build
- El comentario `eslint-disable-next-line @next/next/no-img-element` indica
  que el dev consciente decidió saltarse la regla por esta razón

## Uso correcto de `next/image` en 4 archivos

```bash
grep -rln "next/image" app/ components/ --include="*.tsx"
```

| Archivo | Imagen |
|---|---|
| `app/(auth)/login/page.tsx` | Logo Cehta en login |
| `components/BrandSwitcher.tsx` | Logo Cehta en sidebar |
| `components/empresa/EmpresaLogo.tsx` | Logos de empresas portfolio |
| `components/app-sidebar.tsx` | Logo Cehta en header sidebar |

## Beneficios que ya tenemos

- Lazy loading automático (imágenes below-the-fold no descargan hasta scroll)
- Optimización automática a WebP/AVIF según browser
- Responsive `srcset` automático para diferentes densidades
- Placeholder blur si se pide
- Cumple Core Web Vitals (LCP score alto)

## Conclusión

Sin cambios necesarios. La app ya sigue best practices de imágenes.
