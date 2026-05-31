"use client";

/**
 * /vouchers/import — V5++ ola Y
 *
 * Bulk-import de vouchers desde CSV (Excel chileno).
 *
 * Flujo:
 *   1. User arrastra .csv o lo selecciona
 *   2. Click "Validar (dry-run)" → backend parsea + valida, devuelve report
 *   3. Si todo OK, click "Importar" → backend inserta en DB en DRAFT
 *   4. Si hay errores, se muestran agrupados por voucher_ref con fila + mensaje
 *
 * Formato esperado (descargable como template):
 *   - separador `;`, encoding UTF-8 (BOM opcional)
 *   - una fila por LÍNEA del voucher; mismo voucher_ref agrupa filas
 *   - columnas obligatorias: voucher_ref, empresa_codigo, tipo,
 *     fecha_documento, fecha_contable, glosa, line_number, cuenta_codigo
 *   - opcionales: contraparte_rut, contraparte_nombre,
 *     doc_tributario_tipo, doc_tributario_folio, proyecto_codigo,
 *     area_codigo, debit, credit, descripcion
 *
 * Todos los vouchers se crean en DRAFT (descuadre permitido). El user
 * los revisa y submit manualmente, o usa /vouchers/bulk-approve después.
 */
import { useState, useRef, type DragEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

interface ImportError {
  voucher_ref: string | null;
  row: number;
  field: string | null;
  message: string;
}

interface ImportResponse {
  total_rows: number;
  total_vouchers_intended: number;
  vouchers_created_count: number;
  errors_count: number;
  vouchers_created: Array<{
    voucher_id: number;
    codigo: string;
    empresa_codigo: string;
    total_debit: string;
    total_credit: string;
    lines: number;
  }>;
  errors: ImportError[];
}

const TEMPLATE_CSV = [
  "voucher_ref;empresa_codigo;tipo;fecha_documento;fecha_contable;glosa;contraparte_rut;contraparte_nombre;doc_tributario_tipo;doc_tributario_folio;line_number;cuenta_codigo;proyecto_codigo;area_codigo;debit;credit;descripcion",
  "V001;FONDO;COMPRA;2025-01-15;2025-01-15;Compra insumos oficina;76.123.456-7;Office Depot SpA;FACTURA;12345;1;5-01-01-001;;ADM;100000;0;Insumos enero",
  "V001;FONDO;COMPRA;2025-01-15;2025-01-15;Compra insumos oficina;76.123.456-7;Office Depot SpA;FACTURA;12345;2;1-01-02-001;;;19000;0;IVA crédito",
  "V001;FONDO;COMPRA;2025-01-15;2025-01-15;Compra insumos oficina;76.123.456-7;Office Depot SpA;FACTURA;12345;3;2-02-01-001;;;0;119000;Cuenta por pagar",
].join("\n");

export default function ImportVouchersPage() {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"idle" | "validated">("idle");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Solo archivos .csv");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Archivo excede 10 MB");
      return;
    }
    setFile(f);
    setReport(null);
    setMode("idle");
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleSelect(f);
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return;
    setIsLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dry_run", String(dryRun));
      const data = await apiClient.postForm<ImportResponse>(
        "/vouchers/import-csv",
        fd,
        session,
      );
      setReport(data);
      if (dryRun) {
        setMode("validated");
        if (data.errors_count === 0) {
          toast.success(
            `Validación OK — ${data.total_vouchers_intended} vouchers listos para importar`,
          );
        } else {
          toast.error(
            `${data.errors_count} errores de validación. Revisar y corregir antes de importar.`,
          );
        }
      } else {
        toast.success(
          `Import completo — ${data.vouchers_created_count} vouchers creados en DRAFT`,
        );
        setMode("idle");
        setFile(null);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Error";
      toast.error(`Error: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + TEMPLATE_CSV], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-vouchers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorsByRef: Record<string, ImportError[]> = {};
  for (const e of report?.errors ?? []) {
    const k = e.voucher_ref ?? "(sin ref)";
    errorsByRef[k] = errorsByRef[k] || [];
    errorsByRef[k].push(e);
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link
          href="/vouchers"
          className="text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">
            Importar vouchers desde CSV
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Bulk-import. Todos los vouchers se crean en DRAFT — los revisás y enviás a aprobación
            después.
          </p>
        </div>
      </div>

      <Surface className="p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-medium text-ink-900">
            1. Descargar plantilla
          </h2>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="size-4 mr-2" />
            template-vouchers.csv
          </Button>
        </div>
        <p className="text-sm text-ink-500">
          Descargá el template para ver las columnas esperadas. Una fila = una línea del voucher.
          Filas con el mismo <code className="px-1.5 py-0.5 bg-ink-100 rounded">voucher_ref</code> se
          agrupan en un solo voucher.
        </p>
      </Surface>

      <Surface className="p-6">
        <h2 className="text-lg font-medium text-ink-900 mb-4">
          2. Subir archivo
        </h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-cehta-green bg-cehta-green/5"
              : "border-ink-300 hover:border-ink-400"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSelect(f);
            }}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className="size-8 text-cehta-green" />
              <div className="text-left">
                <p className="font-medium text-ink-900">{file.name}</p>
                <p className="text-xs text-ink-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setReport(null);
                  setMode("idle");
                }}
                className="ml-4 text-ink-500 hover:text-red-500"
                aria-label="Quitar archivo"
              >
                <X className="size-5" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="size-8 text-ink-400 mx-auto mb-2" />
              <p className="text-sm text-ink-700 font-medium">
                Arrastrá el .csv acá o click para seleccionar
              </p>
              <p className="text-xs text-ink-500 mt-1">Hasta 10 MB · Excel chileno (separador ;)</p>
            </>
          )}
        </div>

        {file && (
          <div className="flex gap-2 mt-4">
            <Button onClick={() => upload(true)} disabled={isLoading} variant="outline">
              {isLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Validar (dry-run)
            </Button>
            <Button
              onClick={() => upload(false)}
              disabled={
                isLoading || mode !== "validated" || (report?.errors_count ?? 1) > 0
              }
            >
              {isLoading ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Importar
            </Button>
          </div>
        )}
      </Surface>

      {report && (
        <Surface className="p-6">
          <h2 className="text-lg font-medium text-ink-900 mb-4">
            3. Reporte
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <Stat label="Filas" value={report.total_rows} />
            <Stat label="Vouchers detectados" value={report.total_vouchers_intended} />
            <Stat
              label="Creados"
              value={report.vouchers_created_count}
              tone={report.vouchers_created_count > 0 ? "success" : "neutral"}
            />
            <Stat
              label="Errores"
              value={report.errors_count}
              tone={report.errors_count > 0 ? "danger" : "success"}
            />
          </div>

          {report.vouchers_created.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="size-4 text-cehta-green" />
                <h3 className="text-sm font-medium text-ink-900">
                  Vouchers procesados
                </h3>
              </div>
              <div className="rounded border border-ink-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-ink-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Código</th>
                      <th className="text-left px-3 py-2 font-medium">Empresa</th>
                      <th className="text-right px-3 py-2 font-medium">Debe</th>
                      <th className="text-right px-3 py-2 font-medium">Haber</th>
                      <th className="text-right px-3 py-2 font-medium">Líneas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {report.vouchers_created.map((v) => (
                      <tr key={v.voucher_id}>
                        <td className="px-3 py-2 font-mono">{v.codigo}</td>
                        <td className="px-3 py-2">{v.empresa_codigo}</td>
                        <td className="px-3 py-2 text-right">
                          {Number(v.total_debit).toLocaleString("es-CL")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {Number(v.total_credit).toLocaleString("es-CL")}
                        </td>
                        <td className="px-3 py-2 text-right">{v.lines}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Object.keys(errorsByRef).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="size-4 text-red-500" />
                <h3 className="text-sm font-medium text-ink-900">
                  Errores ({report.errors_count})
                </h3>
              </div>
              <div className="space-y-2">
                {Object.entries(errorsByRef).map(([ref, errs]) => (
                  <div
                    key={ref}
                    className="rounded border border-red-200 bg-red-50/50 p-3"
                  >
                    <div className="font-mono text-xs font-medium text-ink-900 mb-1">
                      {ref}
                    </div>
                    <ul className="text-sm text-red-700 space-y-0.5">
                      {errs.map((e, i) => (
                        <li key={i}>
                          {e.row > 0 && <span className="text-ink-500">fila {e.row}: </span>}
                          {e.field && (
                            <span className="font-mono text-xs">[{e.field}] </span>
                          )}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "danger";
}) {
  const colorClass =
    tone === "success"
      ? "text-cehta-green"
      : tone === "danger"
      ? "text-red-500"
      : "text-ink-900";
  return (
    <div className="rounded border border-ink-200 p-3 bg-white">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${colorClass}`}>
        {value.toLocaleString("es-CL")}
      </div>
    </div>
  );
}
