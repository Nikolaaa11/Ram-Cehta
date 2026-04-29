"use client";

import { Sparkles, Loader2, AlertTriangle, Check } from "lucide-react";
import type { AnalysisResult } from "@/hooks/use-document-analysis";

/**
 * Card de preview del resultado del AI Document Analyzer (V3 fase 7).
 *
 * Tres estados visuales:
 * - `analyzing`: spinner gradient + texto "Analizando con IA…".
 * - `error`: banner rojo con el detalle.
 * - `result`: card con tipo detectado, confidence, lista compacta de fields y warnings.
 *
 * Usa transitions ease-apple y animación fade-in (definida en globals.css o
 * tailwind.config — el class `animate-fade-in` ya existe en el design system).
 */

interface Props {
  analyzing: boolean;
  error: string | null;
  result: AnalysisResult | null;
  /** Texto opcional al lado del spinner (override del default). */
  loadingText?: string;
  /** Si se setea, se muestra "Aplicar al formulario" como CTA. */
  onApply?: () => void;
  /** Texto opcional del CTA. */
  applyLabel?: string;
}

const HUMAN_LABELS: Record<string, string> = {
  contrato: "Contrato",
  f29: "F29",
  trabajador_contrato: "Contrato laboral",
  factura: "Factura",
  liquidacion: "Liquidación",
  desconocido: "No identificado",
};

const FIELD_LABELS: Record<string, string> = {
  contraparte: "Contraparte",
  rut_contraparte: "RUT contraparte",
  fecha_inicio: "Fecha inicio",
  fecha_fin: "Fecha fin",
  monto: "Monto",
  moneda: "Moneda",
  descripcion: "Descripción",
  partes: "Partes",
  empresa: "Empresa",
  rut_empresa: "RUT empresa",
  periodo_tributario: "Período",
  fecha_vencimiento: "Vencimiento",
  monto_a_pagar: "Monto a pagar",
  estado: "Estado",
  nombre_completo: "Nombre",
  rut: "RUT",
  cargo: "Cargo",
  fecha_ingreso: "Fecha ingreso",
  sueldo_bruto: "Sueldo bruto",
  tipo_contrato: "Tipo contrato",
  email: "Email",
  telefono: "Teléfono",
  proveedor_rut: "RUT proveedor",
  proveedor_nombre: "Proveedor",
  numero_factura: "Nº factura",
  fecha: "Fecha",
  monto_neto: "Neto",
  iva: "IVA",
  total: "Total",
  trabajador_nombre: "Trabajador",
  periodo: "Período",
  descuentos: "Descuentos",
  liquido_pagar: "Líquido a pagar",
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("es-CL");
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function AiAnalysisPreview({
  analyzing,
  error,
  result,
  loadingText = "Analizando documento con IA…",
  onApply,
  applyLabel = "Aplicar al formulario",
}: Props) {
  if (analyzing) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-cehta-green/20 bg-gradient-to-br from-cehta-green/5 via-white to-cehta-green/10 px-4 py-3 transition-all duration-300 ease-apple">
        <div className="relative">
          <Sparkles
            className="h-5 w-5 text-cehta-green"
            strokeWidth={1.5}
          />
          <Loader2
            className="absolute -right-1 -bottom-1 h-3 w-3 animate-spin text-cehta-green"
            strokeWidth={2}
          />
        </div>
        <p className="text-sm font-medium text-ink-700">{loadingText}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-negative/20 bg-negative/5 px-4 py-3 transition-all duration-200 ease-apple">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-negative"
          strokeWidth={1.5}
        />
        <div className="text-xs text-negative">
          <p className="font-medium">No pude analizar el documento</p>
          <p className="mt-0.5 opacity-80">{error}</p>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const tipoLabel =
    HUMAN_LABELS[result.tipo_detectado] ?? result.tipo_detectado;
  const confidencePct = Math.round(result.confidence * 100);
  const confidenceTone =
    result.confidence >= 0.8
      ? "text-positive"
      : result.confidence >= 0.5
        ? "text-warning"
        : "text-negative";

  const populatedFields = Object.entries(result.fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  return (
    <div className="space-y-2 rounded-xl border border-cehta-green/20 bg-gradient-to-br from-cehta-green/5 via-white to-cehta-green/10 px-4 py-3 transition-all duration-300 ease-apple">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles
            className="h-4 w-4 text-cehta-green"
            strokeWidth={1.5}
          />
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Detectado:
          </span>
          <span className="text-sm font-semibold text-ink-900">
            {tipoLabel}
          </span>
          <span className={`text-xs font-medium ${confidenceTone}`}>
            {confidencePct}% confianza
          </span>
        </div>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="inline-flex items-center gap-1 rounded-lg bg-cehta-green px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700"
          >
            <Check className="h-3 w-3" strokeWidth={2} />
            {applyLabel}
          </button>
        )}
      </div>

      {populatedFields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {populatedFields.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <dt className="text-ink-500">
                {FIELD_LABELS[k] ?? k}:
              </dt>
              <dd className="truncate font-medium text-ink-900 tabular-nums">
                {formatValue(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {result.warnings.length > 0 && (
        <ul className="space-y-0.5 border-t border-cehta-green/10 pt-2 text-xs text-warning">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle
                className="mt-0.5 h-3 w-3 shrink-0"
                strokeWidth={1.5}
              />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
