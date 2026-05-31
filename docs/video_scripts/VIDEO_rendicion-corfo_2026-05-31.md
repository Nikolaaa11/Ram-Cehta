# Video tutorial: Generar rendición CORFO oficial

**Duración objetivo**: 150 segundos (2:30)
**Audiencia**: Admins/Tesorería de REVTECH y TRONGKAI · responsables de rendir gastos CORFO
**Tono**: Profesional, técnico-amigable, ritmo pausado
**Voiceover**: Español neutro, 140 palabras/min (un poco más pausado por terminología)
**Branding**: Logo CEHTA fade-in apertura · cierre con CTA `/aprender`

---

## Estructura

### Escena 1 — Hook (0:00 – 0:12)

- **Visual**: Logo CEHTA fade-in 1.5s. Corte: dos sellos digitales animados aparecen — uno con "REVTECH" y otro con "TRONGKAI", ambos con sub-label "Proyecto CORFO 2024-265638". Sobre fondo blanco con grid sutil verde. Música: instrumental sobrio.
- **Voiceover**: "Si manejás un proyecto CORFO, sabés que rendir es tan importante como ejecutar. Esta es la forma más limpia de generar tus rendiciones oficiales de Gastos y de RRHH desde Ram-Cehta."

### Escena 2 — Entrada al módulo (0:12 – 0:30)

- **Visual**: Sidebar resaltado en el grupo "Admin" → "Rendiciones CORFO · REVTECH/TRONGKAI". Click. Pantalla muestra el header con selector de empresa (REVTECH / TRONGKAI) y month picker. Animar el toggle de empresa pasando de "Elegir…" a "REVTECH".
- **Voiceover**: "Desde el sidebar de Admin entrás a Rendiciones CORFO. La pantalla espera dos cosas: qué empresa estás rindiendo y qué mes."

### Escena 3 — Preview en pantalla (0:30 – 0:58)

- **Visual**: Después de elegir REVTECH + Abril 2026, la pantalla carga 4 KPI cards con stagger:
  - **47 documentos**
  - **Neto $52.350.000**
  - **IVA $9.946.500**
  - **3 sin mapeo** (chip ámbar)
- Abajo aparece una tabla preview con las primeras 8 filas, mostrando en la última columna el estado de mapeo CORFO: verde "OK" o ámbar "Sin mapeo".
- **Voiceover**: "La pantalla muestra lo que la plataforma armaría: cuántos documentos, monto neto, IVA, y cuántos están sin mapeo a las cuentas oficiales CORFO. Si hay tres sin mapeo, los identifica antes de exportar."

### Escena 4 — Mapeo auto-sugerido (0:58 – 1:30)

- **Visual**: Click en el banner ámbar "Mapeá 3 cuentas locales antes de continuar". Transición a `/admin/rendiciones-corfo/mapping`. Pantalla muestra tabla con dropdowns Cuenta CORFO + Ítem CORFO. Mouse va al botón "Auto-sugerir mapeo" (header), click. Las 3 filas amarillas se rellenan en 600ms con un pulso verde. Toast: "✓ Mapeo sugerido para 3 cuentas". Click "Guardar cambios". Toast verde.
- **Voiceover**: "Si hay cuentas sin mapeo, hacé click en el banner. Te lleva al editor masivo. El botón Auto-sugerir mira tus nombres de cuentas locales — Honorarios, Arriendo, Servicios Básicos, Viáticos — y propone el mapeo a las cuentas oficiales CORFO basándose en palabras clave. Revisás, ajustás si hace falta, y guardás."

### Escena 5 — Descargar el Excel (1:30 – 2:00)

- **Visual**: Volver a `/admin/rendiciones-corfo`. Ahora el banner es verde "Todo mapeado · listo para exportar". Los 2 botones grandes: "Descargar Gastos.xlsx" y "Descargar RRHH.xlsx". Click en Gastos. Loader 800ms. Archivo descargado animation (download tray del browser). Abre el archivo en Excel → mostrar las primeras filas con dropdowns oficiales CORFO funcionando (click en una celda con DataValidation muestra el dropdown nativo de Excel).
- **Voiceover**: "Cuando todo está mapeado, el banner cambia a verde. Descargás el Excel de Gastos o de RRHH. El archivo viene con la estructura oficial CORFO, las dropdowns funcionando, y los datos pre-llenados desde tus vouchers aprobados del mes."

### Escena 6 — Cierre operacional (2:00 – 2:30)

- **Visual**: Pantalla split: izquierda el Excel abierto con todas las celdas en verde (válidas), derecha el correo a CORFO con el adjunto. Logo CEHTA aparece con CTA: "Más tutoriales en ram-cehta.vercel.app/aprender". Fade-out 1.5s.
- **Voiceover**: "Lo único que queda es completar las celdas amarillas que la plataforma no puede saber por sí sola — comprobante físico, glosa CORFO específica — y adjuntarlo al portal o al correo oficial. Más tutoriales en ram-cehta punto vercel punto app, slash, aprender."

---

## Voiceover completo

> Si manejás un proyecto CORFO, sabés que rendir es tan importante como ejecutar. Esta es la forma más limpia de generar tus rendiciones oficiales de Gastos y de RRHH desde Ram-Cehta.
>
> Desde el sidebar de Admin entrás a Rendiciones CORFO. La pantalla espera dos cosas: qué empresa estás rindiendo y qué mes.
>
> La pantalla muestra lo que la plataforma armaría: cuántos documentos, monto neto, IVA, y cuántos están sin mapeo a las cuentas oficiales CORFO. Si hay tres sin mapeo, los identifica antes de exportar.
>
> Si hay cuentas sin mapeo, hacé click en el banner. Te lleva al editor masivo. El botón Auto-sugerir mira tus nombres de cuentas locales — Honorarios, Arriendo, Servicios Básicos, Viáticos — y propone el mapeo a las cuentas oficiales CORFO basándose en palabras clave. Revisás, ajustás si hace falta, y guardás.
>
> Cuando todo está mapeado, el banner cambia a verde. Descargás el Excel de Gastos o de RRHH. El archivo viene con la estructura oficial CORFO, las dropdowns funcionando, y los datos pre-llenados desde tus vouchers aprobados del mes.
>
> Lo único que queda es completar las celdas amarillas que la plataforma no puede saber por sí sola — comprobante físico, glosa CORFO específica — y adjuntarlo al portal o al correo oficial. Más tutoriales en ram-cehta punto vercel punto app, slash, aprender.

---

## Assets necesarios

| # | Asset | Path |
|---|---|---|
| 1 | Logo CEHTA | `frontend/public/cehta.svg` |
| 2 | Sello REVTECH (visual) | crear en Figma, exportar PNG transparente |
| 3 | Sello TRONGKAI (visual) | crear en Figma, exportar PNG transparente |
| 4 | Datos demo REVTECH Abril 2026 con 3 vouchers sin mapeo | preparar antes |
| 5 | Excel exportado real | grabar la abertura en Excel/LibreOffice |
| 6 | Música de fondo | Uppbeat — "Confident Corporate" o "Mellow Tech" |

## Tooling

- **Grabación**: OBS (necesitamos múltiples ventanas: browser + Excel)
- **TTS**: ElevenLabs voz "Bella" (modelo `eleven_multilingual_v2`)
- **Edición**: DaVinci Resolve — usar splits visuales sin recortar contenido
- **Export**: MP4 1080p60 H.264 + .srt

## Notas de producción

- Este video es más técnico que los otros dos — el ritmo del VO debe ser un toque más pausado (140 wpm).
- Los sellos REVTECH/TRONGKAI son visuales — créalos en Figma con: fondo blanco circular, borde verde 2px, tipografía SF Pro Display bold, sublabel monoespaciada.
- El Excel real abierto debe mostrar la dropdown funcionando (DataValidation). Eso es una prueba viva de que el archivo no es un PDF estático.
- NO grabar con folios o RUTs reales — usar mock data.
- Si la pantalla muestra el banner "Mapeá 3 cuentas locales", asegurate de tener exactamente 3 sin mapeo en la demo data, no más, no menos.
