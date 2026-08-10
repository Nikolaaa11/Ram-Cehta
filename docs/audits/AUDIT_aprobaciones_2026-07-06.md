# Audit: `/aprobaciones` · 2026-07-06

> Auditor: `ram-cehta-weekly-ux-audit` (run automático semanal).
> Archivo revisado: `frontend/app/(app)/aprobaciones/page.tsx` (1218 líneas, client component).
> **Solo diagnóstico** — no se modificó código. Nicolás decide qué implementar.

## Resumen

La cola de aprobaciones ("Esperando tu firma") es una de las pantallas más maduras
de la plataforma: agrupación por empresa, chips de urgencia (7d/3d), badge de regla
reforzada, firma individual **y** bulk, optimistic updates con rollback, pull-to-refresh
mobile, skeleton que matchea el layout, `ErrorState` con retry, empty-state contextual
que apunta al siguiente paso del flow, focus-trap + ESC en los modales, y `React.memo`
con comparador custom en las cards (hot path: gerentes la abren 10x/día).

Los hallazgos son de **borde**, no de arquitectura. El más relevante es un riesgo de
control interno: el diálogo bulk suma montos de distinta moneda en un solo número.

---

## Findings

### F1 · El diálogo bulk suma montos de distinta moneda en una sola cifra · P2
**Tipo**: bug
**Esfuerzo**: S (1h)
**Severidad**: P2 (importante — cifra financiera engañosa mostrada a un firmante)

`BulkSignDialog` (`page.tsx:812-858`): `totalGeneral` hace
`items.reduce((sum, it) => sum + parseFloat(it.total))` **sin discriminar moneda**.
Cuando hay CLP + USD + UF en la selección, muestra "`1.050.000 (mixto)`" — un número
que suma pesos + dólares + UF, financieramente sin sentido. La etiqueta "(mixto)" no
alcanza: el firmante ve una cifra grande y firma.

En una pantalla de control interno (invariantes §1.3 del MAESTRO), un agregado
monetario incorrecto justo antes de la firma es un riesgo real.

Sugerencia: cuando `monedas.size > 1`, **no** mostrar una suma única — desglosar por
moneda:

```tsx
const porMoneda = items.reduce<Record<string, number>>((acc, it) => {
  acc[it.moneda] = (acc[it.moneda] ?? 0) + parseFloat(it.total || "0");
  return acc;
}, {});
// Render: "$3.200.000 CLP · US$4.500 · UF 120" en vez de un total sumado.
```

---

### F2 · La barra flotante de bulk se desborda y tapa contenido en mobile · P2
**Tipo**: bug (mobile)
**Esfuerzo**: M (4h)
**Severidad**: P2

La barra de acción bulk (`page.tsx:478-520`) es
`fixed bottom-4 left-1/2 -translate-x-1/2` con un `flex items-center gap-3` **sin
`flex-wrap` ni `max-width`**. Problemas en pantalla chica (375px):

1. **Overflow horizontal**: con mezcla de roles muestra
   "`… · Mezcla de roles (GG, DIRECTOR) — no se puede bulk`" en una sola fila; el
   contenido excede el viewport y se corta / genera scroll lateral.
2. **Tapa el último card**: la lista tiene `py-8` fijo; al aparecer la barra flotante
   no se agrega padding inferior, así que la barra + el `MobileBottomNav` (≥48px)
   ocultan el último voucher seleccionable.

Sugerencia: `max-w-[calc(100vw-2rem)]`, `flex-wrap`, y un spacer inferior
(`pb-28` condicional) en el contenedor cuando `selectedIds.size > 0`.

---

### F3 · Los 3 diálogos no tienen nombre accesible (`aria-labelledby`) · P2
**Tipo**: accessibility
**Esfuerzo**: S (1h)
**Severidad**: P2

`BulkSignDialog` (`:819`), `SignDialog` (`:986`), `RejectDialog` (`:1155`): el
`role="dialog"` + `aria-modal="true"` está en el **backdrop** (el div externo que
además tiene `onClick={onClose}`), y no hay `aria-labelledby`/`aria-label`. Un lector
de pantalla anuncia "diálogo" **sin nombre**. El focus-trap (`useModalA11y`) funciona,
pero el usuario SR no sabe qué diálogo abrió.

Sugerencia: poner `id="dlg-title"` en el título de cada modal y `aria-labelledby="dlg-title"`
en el contenedor con `role="dialog"`. Idealmente mover `role="dialog"`/`aria-modal`
al panel interno (el `<form>`/`<div>` de contenido), no al backdrop.

---

### F4 · Chips de urgencia/reforzado usan colores crudos de Tailwind, no tokens del sistema · P3
**Tipo**: nice-to-have (consistencia / theming)
**Esfuerzo**: S (1h)
**Severidad**: P3

`urgencyChip` (`:109-127`) y el badge "Reforzado" (`:637-641`) usan
`bg-red-100/text-red-700`, `bg-amber-100/text-amber-700`, `bg-yellow-100/text-yellow-800`
— paleta cruda de Tailwind. El resto de la app usa tokens del design system
(`cehta-green`, `ink-*`, `negative`, `hairline`). Riesgo: si se ajusta el tema o se
agrega dark mode, estos chips quedan fuera de sistema.

Sugerencia: definir tokens `warning`/`danger` en el theme y reemplazar. Bajo impacto,
mejora la consistencia.

---

### F5 · Botones de selección (toggle) sin `aria-pressed`/`aria-checked` · P3
**Tipo**: accessibility
**Esfuerzo**: S (1h)
**Severidad**: P3

El botón "seleccionar todos del grupo" (`:429`) y el checkbox por card (`:606`) tienen
`aria-label` pero **no comunican estado** (seleccionado/no) a un lector de pantalla —
solo cambia el ícono visual (`CheckSquare`/`Square`). Un usuario SR no distingue
marcado de desmarcado.

Sugerencia: `role="checkbox"` + `aria-checked={selected}` (o `aria-pressed`) en ambos.

---

### F6 · Markup muerto en el header · P3
**Tipo**: nice-to-have (limpieza)
**Esfuerzo**: S (15m)
**Severidad**: P3

`page.tsx:306`: `<header className="… justify-end …"><div className="hidden"></div>`
— hay un `<div className="hidden">` vacío sobrante (probablemente un título removido en
un refactor). El `justify-end` empuja todo a la derecha; el `<div className="hidden">`
no aporta nada. Eliminar.

---

### F7 · El estado "indeterminado" del select-all es cosmético · P3
**Tipo**: nice-to-have / accessibility
**Esfuerzo**: S (30m)
**Severidad**: P3

`:436-442`: cuando hay selección parcial en un grupo se muestra un `CheckSquare` con
`opacity-50` en vez de un checkbox realmente `indeterminate`. Visualmente ambiguo
(parece "medio marcado") y sin equivalente para SR. Menor.

---

## Veredicto

Pantalla muy pulida. Prioridad de fixes: **F1** (suma multi-moneda engañosa, riesgo de
control interno) y **F2** (barra bulk rota en mobile) primero; **F3** (nombre accesible
de diálogos) después. F4–F7 son limpieza incremental.
