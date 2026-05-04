/**
 * Layout PÚBLICO de /informe/[token].
 *
 * Sin sidebar. Sin auth. El token de la URL es la auth.
 * Tipografía editorial (Inter para body, agregar DM Serif para hero
 * en una fase posterior si queremos diferenciar más).
 *
 * Importante: este layout vive en `/app/informe/` (sin grupo `(app)`)
 * para que NO herede el AuthGate del app principal.
 */
import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Cehta Capital — FIP CEHTA ESG",
  description:
    "Reporte trimestral del portafolio. Acceso privado por invitación.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function InformeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-ink-900 antialiased">
      {/* Print-mode CSS — optimiza para A4 cuando el LP descarga PDF.
          - Margen 1.2cm
          - Fondos: forzamos `print-color-adjust: exact` para que los gradientes
            del hero + ESG se mantengan
          - Animations off (prefers-reduced-motion en print)
          - Page-break-inside avoid en cards/sections para no cortar a mitad */}
      <style>
        {`
        @media print {
          @page { size: A4; margin: 1.2cm; }
          html, body { background: white !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .print\\:hidden { display: none !important; }
          section, article {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          /* Compactar hero — ocupa pantalla en web pero solo encabezado en print */
          section:first-of-type {
            min-height: 0 !important;
            padding-top: 1.5rem !important;
            padding-bottom: 1.5rem !important;
          }
          /* Mantener tipografía editorial */
          h1, h2, h3 { page-break-after: avoid; }
          /* Sin animations */
          *, *::before, *::after {
            animation-duration: 0s !important;
            transition-duration: 0s !important;
          }
        }
        `}
      </style>
      {children}
    </div>
  );
}
