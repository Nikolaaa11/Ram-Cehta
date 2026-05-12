"use client";

/**
 * /vouchers/importar — V5++ ola CE
 *
 * Carga una imagen, PDF, DOCX o PPTX. El backend lo lee con IA (Claude +
 * OCR fallback para escaneos) y devuelve los campos extraidos. El usuario
 * los revisa en un form editable y confirma para crear el voucher.
 *
 * Flow:
 *   step="pick"     -> empresa selector + drag&drop
 *   step="analyzing"-> spinner mientras backend procesa
 *   step="review"   -> form editable precargado con la sugerencia
 *   step="creating" -> creando voucher con POST /vouchers/nubox-form
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface EmpresaMetadata {
  codigo: string;
  razon_social: string;
}

interface FormMetadata {
  formas_pago: string[];
  tipos_documento: string[];
  empresas: EmpresaMetadata[];
}

interface ExtractedLine {
  comentario: string;
  cuenta_codigo: string;
  total: string;
}

interface VoucherSuggestion {
  empresa_codigo: string;
  proveedor_rut: string;
  proveedor_nombre: string;
  rut_es_valido: boolean;
  tipo_documento: string;
  numero_documento: string;
  forma_pago: string;
  fecha_documento: string;
  fecha_vencimiento: string;
  glosa: string;
  informacion_contable: ExtractedLine[];
  informacion_financiera: ExtractedLine[];
}

interface ExtractResponse {
  suggestion: VoucherSuggestion;
  raw_fields: Record<string, unknown>;
  warnings: string[];
  tipo_detectado: string;
  confidence: number;
  extraction_method: string | null;
  ocr_pages: number | null;
  filename: string;
  file_size_bytes: number;
}

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.webp,.tif,.tiff,.docx,.pptx,.ppt,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation";

const FORMA_PAGO_LABELS: Record<string, string> = {
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  CONTADO: "Contado",
  EFECTIVO: "Efectivo",
  CREDITO_30D: "Crédito 30 días",
  CREDITO_60D: "Crédito 60 días",
  CREDITO_90D: "Crédito 90 días",
  TARJETA_CREDITO: "Tarjeta crédito",
  TARJETA_DEBITO: "Tarjeta débito",
  OTRO: "Otro",
};

const TIPO_DOC_LABELS: Record<string, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  NOTA_CREDITO: "Nota de crédito",
  NOTA_DEBITO: "Nota de débito",
  HONORARIOS: "Boleta honorarios",
  NA: "No aplica",
};

type Step = "pick" | "analyzing" | "review" | "creating";

export default function ImportarVoucherPage() {
  const { session } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("pick");
  const [meta, setMeta] = useState<FormMetadata | null>(null);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [extraction, setExtraction] = useState<ExtractResponse | null>(null);

  // Form state (precargado desde extraction.suggestion en el step "review")
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("FACTURA");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [formaPago, setFormaPago] = useState("TRANSFERENCIA");
  const [fechaDocumento, setFechaDocumento] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [glosa, setGlosa] = useState("");
  const [contable, setContable] = useState<ExtractedLine[]>([]);
  const [financiera, setFinanciera] = useState<ExtractedLine[]>([]);

  useEffect(() => {
    if (!session) return;
    apiClient
      .get<FormMetadata>("/vouchers/form-metadata", session)
      .then((m) => {
        setMeta(m);
        if (m.empresas[0]) setEmpresaCodigo(m.empresas[0].codigo);
      })
      .catch(() => {
        toast.error("No pude cargar las empresas. Refrescá la página.");
      });
  }, [session]);

  const applySuggestion = useCallback((data: ExtractResponse) => {
    const s = data.suggestion;
    setEmpresaCodigo(s.empresa_codigo);
    setProveedorRut(s.proveedor_rut);
    setProveedorNombre(s.proveedor_nombre);
    setTipoDocumento(s.tipo_documento || "FACTURA");
    setNumeroDocumento(s.numero_documento);
    setFormaPago(s.forma_pago || "TRANSFERENCIA");
    setFechaDocumento(
      s.fecha_documento || new Date().toISOString().slice(0, 10),
    );
    setFechaVencimiento(s.fecha_vencimiento);
    setGlosa(s.glosa);
    setContable(
      s.informacion_contable.length > 0
        ? s.informacion_contable
        : [{ comentario: "", cuenta_codigo: "", total: "" }],
    );
    setFinanciera(
      s.informacion_financiera.length > 0
        ? s.informacion_financiera
        : [{ comentario: "", cuenta_codigo: "", total: "" }],
    );
  }, []);

  async function handleUpload(file: File) {
    if (!session) return;
    if (!empresaCodigo) {
      toast.error("Elegí primero la empresa receptora.");
      return;
    }
    setStep("analyzing");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("empresa_codigo", empresaCodigo);
      const data = await apiClient.postForm<ExtractResponse>(
        "/vouchers/extract-from-upload",
        formData,
        session,
      );
      setExtraction(data);
      applySuggestion(data);
      setStep("review");
      if (data.warnings.length > 0) {
        toast.info(
          `Análisis con avisos (${data.warnings.length}). Revisá los campos.`,
        );
      } else {
        toast.success(
          `Datos extraídos (confianza ${(data.confidence * 100).toFixed(0)}%). Revisá y confirmá.`,
        );
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al analizar el archivo";
      toast.error(msg);
      setStep("pick");
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = ""; // permite re-subir el mismo archivo
  }

  const totalContable = useMemo(
    () => contable.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [contable],
  );
  const totalFinanciera = useMemo(
    () => financiera.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [financiera],
  );
  const cuadrado = totalContable === totalFinanciera && totalContable > 0;

  function updateLine(
    which: "contable" | "financiera",
    idx: number,
    field: keyof ExtractedLine,
    value: string,
  ) {
    const list = which === "contable" ? contable : financiera;
    const setter = which === "contable" ? setContable : setFinanciera;
    setter(
      list.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );
  }
  function addLine(which: "contable" | "financiera") {
    const row: ExtractedLine = { comentario: "", cuenta_codigo: "", total: "" };
    if (which === "contable") setContable([...contable, row]);
    else setFinanciera([...financiera, row]);
  }
  function removeLine(which: "contable" | "financiera", idx: number) {
    if (which === "contable") {
      if (contable.length === 1) return;
      setContable(contable.filter((_, i) => i !== idx));
    } else {
      if (financiera.length === 1) return;
      setFinanciera(financiera.filter((_, i) => i !== idx));
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!cuadrado) {
      toast.error("Σ Contable debe ser igual a Σ Financiera.");
      return;
    }
    setStep("creating");
    try {
      const payload = {
        empresa_codigo: empresaCodigo,
        proveedor_rut: proveedorRut,
        proveedor_nombre: proveedorNombre,
        tipo_documento: tipoDocumento,
        numero_documento: numeroDocumento,
        forma_pago: formaPago,
        fecha_documento: fechaDocumento,
        fecha_vencimiento: fechaVencimiento || null,
        glosa: glosa || null,
        informacion_contable: contable.map((l) => ({
          comentario: l.comentario,
          cuenta_codigo: l.cuenta_codigo,
          total: parseFloat(l.total),
        })),
        informacion_financiera: financiera.map((l) => ({
          comentario: l.comentario,
          cuenta_codigo: l.cuenta_codigo,
          total: parseFloat(l.total),
        })),
      };
      const resp = await apiClient.post<{
        voucher_id: number;
        codigo: string;
        proveedor_creado_automatico: boolean;
      }>("/vouchers/nubox-form", payload, session);
      toast.success(
        resp.proveedor_creado_automatico
          ? `Voucher ${resp.codigo} creado · Proveedor agregado al catálogo`
          : `Voucher ${resp.codigo} creado en DRAFT`,
      );
      router.push(`/vouchers/${resp.voucher_id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al crear el voucher",
      );
      setStep("review");
    }
  }

  function resetToPick() {
    setStep("pick");
    setExtraction(null);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/vouchers"
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
          aria-label="Volver a vouchers"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100 flex items-center gap-2">
            <Sparkles className="size-6 text-cehta-green" />
            Importar voucher desde archivo
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Subí una imagen, foto de factura, PDF, DOCX o PPTX. La IA lee los
            datos y los precarga en un form editable. Revisás y confirmás.
          </p>
        </div>
      </div>

      {step === "pick" && meta && (
        <>
          <Surface className="p-6">
            <label className="block text-xs font-medium text-ink-700 dark:text-ink-300 mb-1">
              Empresa receptora *
            </label>
            <select
              value={empresaCodigo}
              onChange={(e) => setEmpresaCodigo(e.target.value)}
              className="form-input"
            >
              {meta.empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo} — {e.razon_social}
                </option>
              ))}
            </select>
          </Surface>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
              dragOver
                ? "border-cehta-green bg-cehta-green/5"
                : "border-ink-200 hover:border-cehta-green/50 hover:bg-ink-50/40 dark:border-ink-700 dark:hover:bg-ink-900/40"
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              onChange={handleFileInput}
              className="hidden"
            />
            <UploadCloud
              className="mx-auto size-12 text-cehta-green/70"
              strokeWidth={1.3}
            />
            <p className="mt-4 text-lg font-medium text-ink-900 dark:text-ink-100">
              Arrastrá tu archivo aquí o hacé click para elegir
            </p>
            <p className="mt-2 text-sm text-ink-500">
              Soportados: PDF, JPG, PNG, HEIC, WebP, DOCX, PPTX (máx 15MB)
            </p>
            <div className="mt-6 flex justify-center gap-3 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1 dark:bg-ink-800/60">
                <ImageIcon className="size-3.5" /> Foto de factura
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1 dark:bg-ink-800/60">
                <FileText className="size-3.5" /> PDF / DOCX
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1 dark:bg-ink-800/60">
                <Sparkles className="size-3.5" /> Presentación PPTX
              </span>
            </div>
          </div>
        </>
      )}

      {step === "analyzing" && (
        <Surface className="p-12 text-center">
          <Loader2 className="mx-auto size-12 animate-spin text-cehta-green" />
          <p className="mt-4 text-lg font-medium text-ink-900 dark:text-ink-100">
            Leyendo el archivo con IA…
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Puede tardar 5–20 segundos según el tamaño. Si es un escaneo o
            imagen, además aplico OCR antes del análisis.
          </p>
        </Surface>
      )}

      {(step === "review" || step === "creating") && extraction && (
        <form onSubmit={handleConfirm} className="space-y-6">
          {/* Banner de confianza + warnings */}
          <Surface className="p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-3 py-1 text-cehta-green">
                <Sparkles className="size-3.5" />
                Confianza: {(extraction.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-ink-500">
                {extraction.filename} · {(extraction.file_size_bytes / 1024).toFixed(0)} KB ·{" "}
                {extraction.extraction_method ?? "extracción directa"}
                {extraction.ocr_pages
                  ? ` · OCR ${extraction.ocr_pages} págs`
                  : ""}
              </span>
              <button
                type="button"
                onClick={resetToPick}
                className="ml-auto text-xs text-cehta-green hover:underline"
              >
                Subir otro archivo
              </button>
            </div>
            {extraction.warnings.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-400">
                {extraction.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          {/* Header */}
          <Surface className="p-6">
            <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100 mb-4">
              Datos del documento
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Empresa receptora *</Label>
                <select
                  required
                  value={empresaCodigo}
                  onChange={(e) => setEmpresaCodigo(e.target.value)}
                  className="form-input"
                >
                  {meta?.empresas.map((e) => (
                    <option key={e.codigo} value={e.codigo}>
                      {e.codigo} — {e.razon_social}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Tipo documento *</Label>
                <select
                  required
                  value={tipoDocumento}
                  onChange={(e) => setTipoDocumento(e.target.value)}
                  className="form-input"
                >
                  {meta?.tipos_documento.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_DOC_LABELS[t] || t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Proveedor RUT *</Label>
                <input
                  required
                  value={proveedorRut}
                  onChange={(e) => setProveedorRut(e.target.value)}
                  className="form-input"
                  placeholder="76.123.456-7"
                />
                {!extraction.suggestion.rut_es_valido && proveedorRut && (
                  <p className="mt-1 text-xs text-amber-600">
                    Revisá el RUT — la IA no logró validarlo.
                  </p>
                )}
              </div>
              <div>
                <Label>Proveedor razón social *</Label>
                <input
                  required
                  value={proveedorNombre}
                  onChange={(e) => setProveedorNombre(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Folio *</Label>
                <input
                  required
                  value={numeroDocumento}
                  onChange={(e) => setNumeroDocumento(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Forma de pago *</Label>
                <select
                  required
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value)}
                  className="form-input"
                >
                  {meta?.formas_pago.map((f) => (
                    <option key={f} value={f}>
                      {FORMA_PAGO_LABELS[f] || f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Fecha documento *</Label>
                <input
                  required
                  type="date"
                  value={fechaDocumento}
                  onChange={(e) => setFechaDocumento(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Fecha vencimiento</Label>
                <input
                  type="date"
                  value={fechaVencimiento}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="md:col-span-2">
                <Label>Glosa</Label>
                <input
                  value={glosa}
                  onChange={(e) => setGlosa(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          </Surface>

          <LineSection
            title="Información Contable (DEBE)"
            subtitle="Líneas de gasto. Cuentas tipo 5-* — completá el código según tu plan."
            lines={contable}
            onAdd={() => addLine("contable")}
            onRemove={(i) => removeLine("contable", i)}
            onUpdate={(i, f, v) => updateLine("contable", i, f, v)}
          />
          <LineSection
            title="Información Financiera (HABER)"
            subtitle="Banco o cuenta por pagar. Cuentas tipo 1-01-* o 2-02-*."
            lines={financiera}
            onAdd={() => addLine("financiera")}
            onRemove={(i) => removeLine("financiera", i)}
            onUpdate={(i, f, v) => updateLine("financiera", i, f, v)}
          />

          <Surface className="p-6">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Stat
                label="Σ Contable"
                value={`$${totalContable.toLocaleString("es-CL")}`}
              />
              <Stat
                label="Σ Financiera"
                value={`$${totalFinanciera.toLocaleString("es-CL")}`}
              />
              <Stat
                label="Diferencia"
                value={`$${(totalContable - totalFinanciera).toLocaleString("es-CL")}`}
                tone={cuadrado ? "success" : "danger"}
              />
            </div>
            <div className="flex items-center justify-between">
              <div
                className={`flex items-center gap-2 text-sm ${
                  cuadrado ? "text-cehta-green" : "text-red-500"
                }`}
              >
                {cuadrado ? (
                  <>
                    <CheckCircle2 className="size-5" />
                    Partida doble cuadrada
                  </>
                ) : (
                  <>
                    <AlertCircle className="size-5" />
                    Asigná cuentas y ajustá montos si hace falta
                  </>
                )}
              </div>
              <Button
                type="submit"
                disabled={!cuadrado || step === "creating"}
                className="px-6"
              >
                {step === "creating" ? "Creando…" : "Confirmar y crear voucher"}
              </Button>
            </div>
          </Surface>
        </form>
      )}

      <style jsx>{`
        :global(.form-input) {
          @apply mt-1 block w-full px-3 py-2 rounded-lg border border-hairline
                 text-sm bg-white dark:bg-ink-900 dark:text-ink-100
                 focus:outline-none focus:ring-2 focus:ring-cehta-green focus:border-cehta-green;
        }
      `}</style>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-ink-700 dark:text-ink-300 mb-1">
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-cehta-green"
      : tone === "danger"
        ? "text-red-500"
        : "text-ink-900 dark:text-ink-100";
  return (
    <div className="rounded border border-ink-200 dark:border-ink-800 p-3 bg-white dark:bg-ink-900">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function LineSection({
  title,
  subtitle,
  lines,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  subtitle: string;
  lines: ExtractedLine[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof ExtractedLine, value: string) => void;
}) {
  return (
    <Surface className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
            {title}
          </h2>
          <p className="text-xs text-ink-500">{subtitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="size-4 mr-1" />
          Agregar línea
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-ink-500 text-xs uppercase">
          <tr>
            <th className="text-left px-2 py-1.5 w-12">#</th>
            <th className="text-left px-2 py-1.5">Comentario *</th>
            <th className="text-left px-2 py-1.5 w-44">Cuenta *</th>
            <th className="text-right px-2 py-1.5 w-40">Total línea *</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {lines.map((line, idx) => (
            <tr key={idx}>
              <td className="px-2 py-1.5 text-ink-500">{idx + 1}</td>
              <td className="px-2 py-1.5">
                <input
                  required
                  value={line.comentario}
                  onChange={(e) => onUpdate(idx, "comentario", e.target.value)}
                  className="form-input"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  required
                  value={line.cuenta_codigo}
                  onChange={(e) =>
                    onUpdate(idx, "cuenta_codigo", e.target.value)
                  }
                  placeholder="5-01-01-001"
                  className="form-input font-mono"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.total}
                  onChange={(e) => onUpdate(idx, "total", e.target.value)}
                  className="form-input text-right"
                />
              </td>
              <td className="px-2 py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  disabled={lines.length === 1}
                  className="text-ink-400 hover:text-red-500 disabled:opacity-30"
                  aria-label="Quitar línea"
                >
                  <Trash2 className="size-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}
