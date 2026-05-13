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
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { VoucherLineSection } from "@/components/vouchers/VoucherLineSection";

interface EmpresaMetadata {
  codigo: string;
  razon_social: string;
}

interface FormMetadata {
  formas_pago: string[];
  tipos_documento: string[];
  tipo_documento_labels: Record<string, string>;
  tipos_documento_afectos_iva: string[];
  empresas: EmpresaMetadata[];
}

interface ExtractedLine {
  comentario: string;
  cuenta_codigo: string;
  total: string;
}

interface VoucherSuggestion {
  empresa_codigo: string;
  empresa_auto_detectada?: boolean;
  empresa_receptor_rut_detectado?: string | null;
  proveedor_rut: string;
  proveedor_nombre: string;
  rut_es_valido: boolean;
  tipo_documento: string;
  numero_documento: string;
  forma_pago: string;
  fecha_documento: string;
  fecha_vencimiento: string;
  glosa: string;
  moneda?: string;
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
  dropbox_path: string | null;
  dropbox_warning: string | null;
}

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.webp,.tif,.tiff,.gif,.bmp,.docx,.pptx,.ppt,.xlsx,.xlsm,.txt,.md,.csv,.eml,.html,.htm,.msg,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,message/rfc822,text/html,text/plain,text/csv";

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
  // V5++ ola CE — Cola de archivos para flujo bulk. Si el user dropea varios
  // archivos a la vez, los demas quedan aqui esperando turno mientras el
  // primero se revisa y confirma. Despues del submit del actual, el efecto
  // de useEffect dispara handleUpload del siguiente.
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  // V5++ ola CF — Paste desde clipboard. Cuando el user copia una imagen
  // (WhatsApp Web, screenshot, etc.) y pega en esta pagina con Ctrl+V,
  // la procesamos como un upload. Util para no tener que descargar a archivo
  // antes de subir.
  useEffect(() => {
    if (step !== "pick") return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFilesSelected({
              0: file,
              length: 1,
              item: () => file,
            } as unknown as FileList);
            toast.info("Imagen pegada desde el clipboard.");
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, empresaCodigo]);
  // Prefetch del siguiente archivo en background. Cuando el user esta
  // revisando el archivo N, en paralelo arrancamos el extract de N+1.
  // Al confirmar N, advanceQueue chequea este cache y omite el re-fetch.
  const [prefetched, setPrefetched] = useState<Record<number, ExtractResponse>>({});

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

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    const first = arr[0];
    if (!first) return;
    if (arr.length === 1) {
      // Modo simple: 1 archivo, mismo flujo de siempre.
      setFileQueue([]);
      setQueueIndex(0);
      handleUpload(first);
      return;
    }
    // Modo bulk: cola para procesar uno por uno.
    setFileQueue(arr);
    setQueueIndex(0);
    handleUpload(first);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleFilesSelected(e.target.files);
    e.target.value = ""; // permite re-subir el mismo archivo
  }

  function advanceQueue() {
    if (fileQueue.length === 0) return false;
    const nextIdx = queueIndex + 1;
    const next = fileQueue[nextIdx];
    if (!next) {
      setFileQueue([]);
      setQueueIndex(0);
      setPrefetched({});
      return false;
    }
    setQueueIndex(nextIdx);
    // Si ya prefetcheamos este archivo, saltamos el extract y vamos directo
    // al step review con los datos cacheados — UX instantanea entre archivos.
    const cached = prefetched[nextIdx];
    if (cached) {
      setExtraction(cached);
      applySuggestion(cached);
      setStep("review");
      if (cached.warnings.length > 0) {
        toast.info(`Archivo ${nextIdx + 1}: ${cached.warnings.length} avisos.`);
      }
    } else {
      handleUpload(next);
    }
    return true;
  }

  // Prefetch del siguiente archivo en background cuando el user entra a
  // "review". Si el bulk tiene varios pendientes, el N+1 se procesa en
  // paralelo mientras revisas el N. Asi al confirmar el actual, el siguiente
  // ya esta listo y no esperas la latencia del backend (5-20s por archivo).
  useEffect(() => {
    if (step !== "review") return;
    if (!session) return;
    if (fileQueue.length === 0) return;
    const nextIdx = queueIndex + 1;
    const nextFile = fileQueue[nextIdx];
    if (!nextFile) return;
    if (prefetched[nextIdx]) return; // ya cacheado
    if (!empresaCodigo) return;
    let cancelled = false;
    const formData = new FormData();
    formData.append("file", nextFile);
    formData.append("empresa_codigo", empresaCodigo);
    apiClient
      .postForm<ExtractResponse>(
        "/vouchers/extract-from-upload",
        formData,
        session,
      )
      .then((data) => {
        if (cancelled) return;
        setPrefetched((prev) => ({ ...prev, [nextIdx]: data }));
      })
      .catch(() => {
        // soft-fail: si el prefetch falla, advanceQueue va a hacer extract
        // normal cuando el user confirme.
      });
    return () => {
      cancelled = true;
    };
  }, [step, queueIndex, fileQueue, empresaCodigo, session, prefetched]);

  const totalContable = useMemo(
    () => contable.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [contable],
  );
  const totalFinanciera = useMemo(
    () => financiera.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [financiera],
  );
  // V5++ ola CJ — comparar con tolerancia 0.01 (bug floats fix).
  const cuadrado =
    totalContable > 0 &&
    Math.abs(totalContable - totalFinanciera) < 0.01;

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

  // V5++ ola CE — Warning + shortcuts. No autosave porque los datos vienen
  // del archivo subido (la IA los precarga); restaurar un draft viejo
  // pisaria la extraccion fresca, lo que es confuso.
  const isDirty = step === "review" || step === "creating";
  useUnsavedChangesWarning(isDirty && step !== "creating");

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
        // V5++ ola CE — marca como creado desde el flujo de IA para que el
        // badge "IA" aparezca en la lista y se publique webhook voucher.imported.
        source: "ai_import",
        // Si el extract subio el archivo a Dropbox, lo persistimos en el
        // voucher como evidencia (queda accesible via el detalle).
        documento_dropbox_path: extraction?.dropbox_path ?? null,
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
      // Bulk: si quedan archivos en cola, procesar el siguiente.
      const hasMore = advanceQueue();
      if (!hasMore) {
        router.push(`/vouchers/${resp.voucher_id}`);
      }
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

  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (step === "review" && cuadrado) {
        const form = document.querySelector(
          "form",
        ) as HTMLFormElement | null;
        form?.requestSubmit();
      }
    },
  });

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
              multiple
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
              PDF, imagen (JPG/PNG/HEIC/WebP/TIFF/GIF), Office (DOCX/PPTX/XLSX),
              email (EML), HTML, TXT, CSV. Hasta 15MB. Podés arrastrar{" "}
              <span className="font-medium">varios a la vez</span> o pegar{" "}
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px]">⌘V</kbd>{" "}
              una imagen del portapapeles.
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
            {fileQueue.length > 1 && (
              <div className="mb-3 flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 text-xs text-cehta-green">
                <Sparkles className="size-3.5" />
                Procesando archivo {queueIndex + 1} de {fileQueue.length} ·
                {" "}{fileQueue.length - queueIndex - 1} pendientes en cola
                {prefetched[queueIndex + 1] && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-cehta-green/20 px-2 py-0.5 text-[10px] font-medium">
                    ⚡ Siguiente precargado
                  </span>
                )}
              </div>
            )}
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
              {extraction.suggestion.empresa_auto_detectada && (
                <span
                  title={`Detectado por RUT receptor ${extraction.suggestion.empresa_receptor_rut_detectado}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs text-cehta-green"
                >
                  🎯 Empresa auto-detectada: {extraction.suggestion.empresa_codigo}
                </span>
              )}
              {extraction.dropbox_path && (
                <span
                  title={`Archivo guardado en ${extraction.dropbox_path}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-sf-blue/10 px-2.5 py-0.5 text-xs text-sf-blue"
                >
                  📎 Archivado en Dropbox
                </span>
              )}
              {extraction.dropbox_warning && !extraction.dropbox_path && (
                <span
                  title={extraction.dropbox_warning}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700"
                >
                  ⚠ Dropbox no disponible
                </span>
              )}
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
            {/* V5++ ola CF — Quick summary: proveedor + items detectados */}
            {extraction.suggestion && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-ink-50 dark:bg-ink-900 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">
                    Proveedor detectado
                  </p>
                  <p className="mt-1 font-medium text-ink-900 dark:text-ink-100 break-words">
                    {extraction.suggestion.proveedor_nombre || "(no detectado)"}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-600">
                    {extraction.suggestion.proveedor_rut || "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-ink-50 dark:bg-ink-900 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-ink-500">
                    Documento
                  </p>
                  <p className="mt-1 text-ink-900 dark:text-ink-100">
                    <span className="font-medium">
                      {extraction.suggestion.tipo_documento}
                    </span>{" "}
                    folio{" "}
                    <span className="font-mono">
                      {extraction.suggestion.numero_documento || "—"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-600">
                    {extraction.suggestion.fecha_documento} ·{" "}
                    {extraction.suggestion.forma_pago}
                  </p>
                </div>
                {extraction.suggestion.informacion_contable.length > 0 && (
                  <div className="md:col-span-2 rounded-lg bg-ink-50 dark:bg-ink-900 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
                      Líneas detectadas ({extraction.suggestion.informacion_contable.length})
                    </p>
                    <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                      {extraction.suggestion.informacion_contable.slice(0, 8).map((l, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-ink-700 truncate">
                            {l.comentario || "(sin descripción)"}
                          </span>
                          <span className="font-mono text-ink-900 dark:text-ink-100 shrink-0">
                            $
                            {Number(l.total || 0).toLocaleString("es-CL")}
                          </span>
                        </li>
                      ))}
                      {extraction.suggestion.informacion_contable.length > 8 && (
                        <li className="text-ink-500">
                          +{extraction.suggestion.informacion_contable.length - 8} más…
                        </li>
                      )}
                    </ul>
                  </div>
                )}
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
                  {(meta?.tipos_documento ?? [])
                    .filter((t) => !["BOLETA", "HONORARIOS", "NA"].includes(t))
                    .sort((a, b) => {
                      const la =
                        meta?.tipo_documento_labels?.[a] ??
                        TIPO_DOC_LABELS[a] ??
                        a;
                      const lb =
                        meta?.tipo_documento_labels?.[b] ??
                        TIPO_DOC_LABELS[b] ??
                        b;
                      return la.localeCompare(lb, "es");
                    })
                    .map((t) => (
                      <option key={t} value={t}>
                        {meta?.tipo_documento_labels?.[t] ??
                          TIPO_DOC_LABELS[t] ??
                          t}
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

          {/* V5++ ola CH fase 2: LineSection compartido con Total Bruto auto */}
          <VoucherLineSection
            title="Información Contable"
            tone="contable"
            lines={contable}
            tipoDocumento={tipoDocumento}
            tiposAfectosIva={meta?.tipos_documento_afectos_iva ?? []}
            onAdd={() => addLine("contable")}
            onRemove={(i) => removeLine("contable", i)}
            onUpdate={(i, f, v) => updateLine("contable", i, f, v)}
          />
          <VoucherLineSection
            title="Información Financiera"
            tone="financiera"
            lines={financiera}
            tipoDocumento={tipoDocumento}
            tiposAfectosIva={meta?.tipos_documento_afectos_iva ?? []}
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

// V5++ ola CH fase 2: LineSection local removido — ahora vive en
// `components/vouchers/VoucherLineSection.tsx` y se comparte con las
// 3 pantallas de creacion de vouchers.
