"use client";

import { useCallback, useState } from "react";
import { useSession } from "./use-session";

/**
 * Hook reusable para POST /documents/analyze (V3 fase 7).
 *
 * Uso típico:
 *
 *   const { analyze, analyzing, result, error, reset } = useDocumentAnalysis();
 *   ...
 *   await analyze(file, "contrato");  // o "auto"
 *   if (result?.fields.contraparte) setForm({ ...form, contraparte: result.fields.contraparte });
 *
 * El hook NO toca el form: devuelve el `AnalysisResult` para que cada dialog
 * decida cómo mapear `fields` (cada tipo tiene un schema distinto).
 *
 * Errores: el endpoint puede devolver:
 *  - 413 (archivo > 10 MB) → mensaje claro
 *  - 422 (no se pudo extraer texto)
 *  - 503 (ANTHROPIC_API_KEY no configurada)
 *  - 502 (LLM error)
 *  - 401/403 (auth/scope)
 * Cada uno se mapea a `error` para que el caller muestre toast/banner.
 */

export type AnalysisTipo =
  | "contrato"
  | "f29"
  | "trabajador_contrato"
  | "factura"
  | "liquidacion"
  | "auto";

/**
 * Método con que se extrajo el texto del archivo (V4 fase 1).
 * - `pypdf`: PDF digital, lectura directa.
 * - `ocr`: PDF escaneado pasado por tesseract.
 * - `hybrid`: PDF mixto (pypdf + OCR).
 * - `image_ocr`: imagen jpg/png pasada directo por OCR.
 * - `docx`: documento Word.
 * - `text`: txt/md/csv decodificado.
 * - `failed`: OCR intentado pero tesseract/poppler no instalado en el host
 *   (soft-fail: el backend devuelve 200 con warning, no 500).
 */
export type ExtractionMethod =
  | "pypdf"
  | "ocr"
  | "hybrid"
  | "image_ocr"
  | "docx"
  | "text"
  | "failed";

export interface AnalysisResult {
  tipo_detectado: string;
  confidence: number;
  fields: Record<string, unknown>;
  raw_text_preview: string;
  warnings: string[];
  /** Cómo se extrajo el texto (V4 fase 1). null si el endpoint es viejo. */
  extraction_method?: ExtractionMethod | string | null;
  /** Cantidad de páginas que pasaron por OCR (V4 fase 1). null si no aplicó. */
  ocr_pages?: number | null;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function useDocumentAnalysis() {
  const { session } = useSession();
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setAnalyzing(false);
  }, []);

  const analyze = useCallback(
    async (file: File, tipo: AnalysisTipo): Promise<AnalysisResult | null> => {
      if (!file) {
        setError("Seleccioná un archivo primero.");
        return null;
      }
      setAnalyzing(true);
      setError(null);
      setResult(null);

      const formData = new FormData();
      formData.append("tipo", tipo);
      formData.append("file", file);

      try {
        const resp = await fetch(`${API_BASE}/documents/analyze`, {
          method: "POST",
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
          body: formData,
        });

        if (!resp.ok) {
          let detail = `HTTP ${resp.status}`;
          try {
            const body = await resp.json();
            detail = body?.detail ?? detail;
          } catch {
            // non-JSON response
          }
          throw new Error(detail);
        }

        const data = (await resp.json()) as AnalysisResult;
        setResult(data);
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        setError(msg);
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [session?.access_token],
  );

  return { analyze, analyzing, result, error, reset } as const;
}
