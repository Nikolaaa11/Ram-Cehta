# Video tutorial: Firmar aprobaciones en bulk

**Duración objetivo**: 105 segundos (1:45)
**Audiencia**: Gerentes Generales, Directores, COO, Contador, Tesorería
**Tono**: Profesional, eficiente, directo
**Voiceover**: Español neutro, 145 palabras/min
**Branding**: Logo CEHTA fade-in apertura · cierre con CTA a `/aprender`

---

## Estructura

### Escena 1 — Hook (0:00 – 0:08)

- **Visual**: Logo CEHTA fade-in 1s. Corte a un counter animado que sube de "0 vouchers" a "12 vouchers pendientes" en 1.5s sobre fondo negro suave. Música: arranque limpio, percusión sutil ~-22dB.
- **Voiceover**: "Tu firma es el paso que destraba el pago. Acá te mostramos cómo firmar varios vouchers a la vez sin perder control."

### Escena 2 — Llegada a /aprobaciones (0:08 – 0:20)

- **Visual**: Sidebar resaltado en el ítem "Aprobaciones" con badge rojo "12". Click. Hero verde de "Esperando tu firma" aparece con su gradient. Lista de vouchers se carga con stagger animation (cada fila aparece con 80ms de delay).
- **Voiceover**: "En el sidebar, el número rojo te dice cuántos vouchers están esperando exactamente tu firma. Click en Aprobaciones."

### Escena 3 — Anatomía de un voucher (0:20 – 0:42)

- **Visual**: Zoom a una fila individual. Resaltar visualmente:
  - **Código** AFIS-0042 (chip morado)
  - **Proveedor** + folio
  - **Total** $4.250.000 (grande, gradient verde)
  - **Días pendiente** 3d (chip amarillo)
  - **Firma X/Y** 2/4 (progreso visual)
  - **Adjunto PDF** (ícono → preview hover)
- **Voiceover**: "Cada fila tiene todo lo que necesitás para decidir: código, proveedor, folio, monto, cuántos días lleva pendiente, qué firma sos vos en la cadena, y un click directo al PDF respaldo."

### Escena 4 — Selección bulk (0:42 – 1:05)

- **Visual**: Mouse selecciona 5 checkboxes consecutivos. Cuando hay selección, aparece desde abajo una bandeja sticky verde con "5 seleccionados · Firmar bulk como Gerente General". Si los roles fueran inconsistentes, el botón se deshabilitaría — mostrar este caso 1s.
- **Voiceover**: "Si tenés varios vouchers que requieren tu firma con el mismo rol, seleccionalos. Aparece una bandeja flotante con el botón de firma masiva. Si mezclás roles, el sistema te bloquea para evitar errores."

### Escena 5 — Confirmar firma (1:05 – 1:30)

- **Visual**: Click en "Firmar 5 como Gerente General". Modal sale con animación scale-in:
  - Título: "Confirmar firma en bulk"
  - Resumen de los 5 vouchers
  - Botón verde "Confirmar 5 firmas"
- Click. Loader 600ms. Toast verde sale: "✓ Firmados 5 vouchers como Gerente General". Lista se actualiza, los firmados desaparecen.
- En la esquina inferior derecha aparece el FeedbackPrompt 😞 😐 😊.
- **Voiceover**: "El modal te da una última oportunidad para revisar. Confirmás y listo: la auditoría queda registrada con tu usuario, timestamp y rol. Después de la operación, te preguntamos qué tan fácil resultó."

### Escena 6 — Qué pasa después (1:30 – 1:45)

- **Visual**: Transición a `/transferencias` donde los vouchers recién firmados ahora aparecen como "APPROVED · listos para pagar". Logo CEHTA + CTA "Más tutoriales en ram-cehta.vercel.app/aprender". Fade-out 1s.
- **Voiceover**: "Si fuiste la última firma, el voucher pasa automáticamente a Transferencias listo para Tesorería. La cadena se mueve sola. Más en ram-cehta punto vercel punto app, slash, aprender."

---

## Voiceover completo

> Tu firma es el paso que destraba el pago. Acá te mostramos cómo firmar varios vouchers a la vez sin perder control.
>
> En el sidebar, el número rojo te dice cuántos vouchers están esperando exactamente tu firma. Click en Aprobaciones.
>
> Cada fila tiene todo lo que necesitás para decidir: código, proveedor, folio, monto, cuántos días lleva pendiente, qué firma sos vos en la cadena, y un click directo al PDF respaldo.
>
> Si tenés varios vouchers que requieren tu firma con el mismo rol, seleccionalos. Aparece una bandeja flotante con el botón de firma masiva. Si mezclás roles, el sistema te bloquea para evitar errores.
>
> El modal te da una última oportunidad para revisar. Confirmás y listo: la auditoría queda registrada con tu usuario, timestamp y rol. Después de la operación, te preguntamos qué tan fácil resultó.
>
> Si fuiste la última firma, el voucher pasa automáticamente a Transferencias listo para Tesorería. La cadena se mueve sola. Más en ram-cehta punto vercel punto app, slash, aprender.

---

## Assets necesarios

| # | Asset | Path |
|---|---|---|
| 1 | Logo CEHTA | `frontend/public/cehta.svg` |
| 2 | Screenshot /aprobaciones con 10+ items | grabar con cuenta admin |
| 3 | Screenshot /transferencias post-firma | grabar |
| 4 | Datos demo coherentes con varios roles | usar usuarios real-test creados |
| 5 | Música de fondo | Uppbeat — "Sleek Corporate" |

## Tooling

- **Grabación**: Loom o OBS — 1080p60 mínimo
- **TTS**: ElevenLabs "Adriana" — tono más asertivo que "Bella" para esta audiencia (gerencial)
- **Edición**: DaVinci Resolve — usar zoom sutil al hero, no recortar el toast real
- **Export**: MP4 H.264 1080p

## Notas de producción

- El counter animado de la escena 1 lo podés hacer en DaVinci con Text+ + keyframes, no necesita motion graphic complejo.
- Mostrar la bandeja sticky aparecer DESDE ABAJO es importante — captura la intención del diseño.
- NO inventes nombres de proveedores — usar nombres genéricos o blur sobre PII real.
- Si grabás con la cuenta admin de Nicolás, asegurate de NO mostrar email completo.
