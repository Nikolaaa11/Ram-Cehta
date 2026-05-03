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
      {children}
    </div>
  );
}
