"use client";

/**
 * ReportHeader — header consistente para reportes imprimibles (R152kk).
 *
 * Usado en cualquier vista que tenga un `window.print()` o export a PDF.
 * Aparece SOLO en impresión (`hidden print:block`) y replica branding
 * CEHTA: logo, nombre del fondo, fecha de generación, hash de auditoría.
 *
 * Uso:
 *   <ReportHeader
 *     title="Calendario Mensual"
 *     subtitle="Mayo 2026"
 *     empresaCodigo="REVTECH"
 *   />
 */
import { useEffect, useState } from "react";

interface Props {
  title: string;
  subtitle?: string;
  /** Para reportes empresa-específicos */
  empresaCodigo?: string | null;
  /** Hash determinístico opcional (para auditoría) */
  auditHash?: string;
}

export function ReportHeader({ title, subtitle, empresaCodigo, auditHash }: Props) {
  const [stamp, setStamp] = useState<string>("");

  useEffect(() => {
    // Sólo se calcula en client para evitar mismatch SSR
    const now = new Date();
    setStamp(
      now.toLocaleString("es-CL", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }, []);

  return (
    <div className="hidden print:block">
      <div className="border-b border-ink-900 pb-3 mb-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-700">
              FIP CEHTA ESG · AFIS S.A.
            </p>
            <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink-900">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-xs text-ink-700">{subtitle}</p>
            )}
            {empresaCodigo && (
              <p className="mt-0.5 text-[10px] font-mono uppercase text-ink-600">
                Empresa · {empresaCodigo}
              </p>
            )}
          </div>
          <div className="text-right text-[10px] text-ink-600">
            <p>Generado: {stamp}</p>
            <p>ram-cehta.vercel.app</p>
            {auditHash && (
              <p className="mt-0.5 font-mono text-[9px]">
                hash · {auditHash.slice(0, 12)}…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ReportFooter — pie de página para reportes imprimibles.
 *
 * Usar al final del contenido. Solo aparece en impresión.
 */
export function ReportFooter({ note }: { note?: string }) {
  return (
    <div className="hidden print:block mt-8 pt-3 border-t border-ink-300">
      <p className="text-[9px] text-ink-500 leading-snug">
        Documento generado automáticamente desde la plataforma Ram-Cehta para
        AFIS S.A. · Administradora de FIP CEHTA ESG. Los datos reflejan el
        estado del sistema al momento de impresión.
        {note && ` ${note}`}
      </p>
      <p className="mt-1 text-[9px] text-ink-400">
        Confidencial · Uso interno · No distribuir sin autorización.
      </p>
    </div>
  );
}
