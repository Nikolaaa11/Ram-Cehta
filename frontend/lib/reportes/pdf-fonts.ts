/**
 * PDF font registration — Inter como sustituto libre de SF Pro.
 *
 * Llamar `registerPdfFonts()` una sola vez en el módulo client antes de
 * renderizar PDFs. Idempotente.
 */
import { Font } from "@react-pdf/renderer";

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Inter",
    fonts: [
      { src: "https://rsms.me/inter/font-files/Inter-Regular.woff", fontWeight: 400 },
      { src: "https://rsms.me/inter/font-files/Inter-Medium.woff", fontWeight: 500 },
      { src: "https://rsms.me/inter/font-files/Inter-SemiBold.woff", fontWeight: 600 },
      { src: "https://rsms.me/inter/font-files/Inter-Bold.woff", fontWeight: 700 },
    ],
  });

  // Disable hyphenation — apple-style typography prefiere wrap entero.
  Font.registerHyphenationCallback((word) => [word]);
}
