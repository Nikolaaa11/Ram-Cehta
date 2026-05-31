# Video tutorial: Crear un voucher en 90 segundos

**Duración objetivo**: 130 segundos (2:10)
**Audiencia**: Operarios y Gerentes Generales que registran gastos
**Tono**: Profesional, cercano, ritmo apple-keynote
**Voiceover**: Español neutro, género indistinto, 145 palabras/min
**Branding**: Logo CEHTA fade-in apertura · cierre con CTA a `ram-cehta.vercel.app/aprender`

---

## Estructura

### Escena 1 — Hook (0:00 – 0:08)

- **Visual**: Pantalla negra. Logo CEHTA Capital aparece con fade-in (1s). Corte a screenshot del dashboard de Ram-Cehta con overlay de un voucher con código `AFIS-0042` saliendo del centro hacia el sidebar. Música: arranca suave instrumental, ~-22dB.
- **Voiceover**: "Cada gasto de tu empresa es una decisión. Esta es la forma más rápida de registrarlo, aprobarlo y pagarlo en Ram-Cehta."
- **B-roll**: ninguno.

### Escena 2 — Entrada al flujo (0:08 – 0:22)

- **Visual**: Mouse navega del sidebar al menú "Vouchers" → click "Nuevo voucher". Resaltar el botón verde con un círculo verde que pulsa 1.5s antes del click. Transición de página suave.
- **Voiceover**: "Desde el sidebar, abrí Vouchers y hacé click en Nuevo. La pantalla se divide en tres bloques: Datos de cabecera, Líneas contables, y Adjuntos."

### Escena 3 — Datos de cabecera (0:22 – 0:48)

- **Visual**: Zoom progresivo a la sección de cabecera. El operador escribe en cada campo (typewriter effect ~30ms/char):
  - **Empresa**: REVTECH (combobox abierto, scroll, click)
  - **Tipo**: Compra
  - **Proveedor (RUT)**: 76.234.567-8 — autocompletar muestra "PROVEEDOR DEMO SPA" en dropdown
  - **Folio factura**: 1024
  - **Fecha contable**: hoy
  - **Moneda**: CLP
- **Voiceover**: "Primero, cargá el contexto: empresa pagadora, tipo de operación, contraparte por RUT — el sistema busca el proveedor automáticamente. Folio, fecha contable y moneda completan la cabecera."

### Escena 4 — Líneas contables (0:48 – 1:18)

- **Visual**: Scroll a la sección de líneas. Click "Agregar línea". Aparece una fila con campos:
  - **Cuenta contable**: combobox abierto → click "5.1.1.001 Mercaderías"
  - **Centro de costo**: PROY-001
  - **Glosa**: "Compra papelería oficina"
  - **Monto neto**: 100.000
  - **IVA**: se calcula auto a 19.000
  - **Total**: 119.000 con animación de aparición
- **Voiceover**: "Cada línea contable lleva su cuenta del plan, un centro de costo, glosa y monto neto. El IVA se calcula solo según la cuenta. Podés agregar tantas líneas como necesite tu factura."

### Escena 5 — Adjuntos (1:18 – 1:38)

- **Visual**: Drag-and-drop animado de un PDF "factura-1024.pdf" sobre la zona drop. Barra de progreso 0% → 100% en 1s. El archivo aparece en la lista con ícono PDF.
- **Voiceover**: "Arrastrá la factura PDF, boleta o respaldo. Va directo a Dropbox cifrado. Sin adjunto no se puede enviar a aprobación."

### Escena 6 — Decisión final (1:38 – 1:58)

- **Visual**: Highlights de los 2 botones: "Guardar borrador" (gris) vs "Enviar a aprobación" (verde, glow sutil). Cursor pasa por el verde, click. Toast verde sale de la esquina inferior: "Voucher REVTECH-0042 enviado a aprobación". Pantalla transiciona a /vouchers/42 con el voucher en estado PENDING.
- **Voiceover**: "Dos opciones: guardar borrador y volver más tarde, o enviar a aprobación. Al enviar, el sistema notifica al primer aprobador según la regla que matchea: Gerente General si supera UF 50, Director si pasa UF 200."

### Escena 7 — CTA (1:58 – 2:10)

- **Visual**: Pantalla muestra el voucher creado. Aparece un pop-up sutil 😞 😐 😊 abajo-derecha (es el FeedbackPrompt real). Logo cierre + texto: "Más tutoriales en ram-cehta.vercel.app/aprender". Fade-out 1s.
- **Voiceover**: "Después de cada paso, podés contarnos qué tan fácil te resultó con un solo click. Ese feedback se transforma en mejoras del sistema. Más tutoriales en ram-cehta punto vercel punto app, slash, aprender."

---

## Voiceover completo (para tu TTS)

> Cada gasto de tu empresa es una decisión. Esta es la forma más rápida de registrarlo, aprobarlo y pagarlo en Ram-Cehta.
>
> Desde el sidebar, abrí Vouchers y hacé click en Nuevo. La pantalla se divide en tres bloques: Datos de cabecera, Líneas contables, y Adjuntos.
>
> Primero, cargá el contexto: empresa pagadora, tipo de operación, contraparte por RUT — el sistema busca el proveedor automáticamente. Folio, fecha contable y moneda completan la cabecera.
>
> Cada línea contable lleva su cuenta del plan, un centro de costo, glosa y monto neto. El IVA se calcula solo según la cuenta. Podés agregar tantas líneas como necesite tu factura.
>
> Arrastrá la factura PDF, boleta o respaldo. Va directo a Dropbox cifrado. Sin adjunto no se puede enviar a aprobación.
>
> Dos opciones: guardar borrador y volver más tarde, o enviar a aprobación. Al enviar, el sistema notifica al primer aprobador según la regla que matchea: Gerente General si supera UF 50, Director si pasa UF 200.
>
> Después de cada paso, podés contarnos qué tan fácil te resultó con un solo click. Ese feedback se transforma en mejoras del sistema. Más tutoriales en ram-cehta punto vercel punto app, slash, aprender.

---

## Assets necesarios

| # | Asset | Path / fuente |
|---|---|---|
| 1 | Logo CEHTA | `frontend/public/cehta.svg` (ya existe) |
| 2 | Screenshot dashboard | grabar live de `ram-cehta.vercel.app/dashboard` |
| 3 | Screenshot /vouchers/nuevo limpio | grabar live |
| 4 | Datos demo coherentes (empresa REVTECH, proveedor demo) | usar la cuenta `nrietta@cehtacapital.com` y un voucher real |
| 5 | Música de fondo | Uppbeat — buscar "Soft Corporate" o "Minimal Tech" |
| 6 | Cursor visible | configurar en OBS/Loom: cursor amplificado + click effect |
| 7 | Fuente para overlays | SF Pro Display o Inter |

## Tooling

- **Grabación**: Loom Pro (4K) o OBS con preset "Screen 1080p60"
- **Edición**: DaVinci Resolve — clip principal + overlays de texto + zoom suave (key-frames)
- **TTS**: ElevenLabs voz "Bella" (modelo `eleven_multilingual_v2`) — exportar como WAV 48kHz
- **Subtítulos**: importar el VO en Descript → exportar .srt → revisar
- **Export final**: MP4 H.264 1080p, audio AAC 192kbps

## Notas de producción

- El typewriter en la escena 3 NO debe ser literal — grabá tipeo rápido y acelerá 2× en post.
- Subrayar visualmente el monto total con un underline animado verde.
- El toast del paso 6 es el toast real de la plataforma (`sonner`), no lo recrees.
- Probar la grabación en silencio primero para chequear que no hay PII visible (proveedores reales, RUTs reales).
