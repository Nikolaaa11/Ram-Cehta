"use client";

/**
 * /vouchers/desde-mensaje — V5++ ola CF
 *
 * El usuario pega un texto crudo (email, WhatsApp, nota, lo que sea) y la
 * IA arma un voucher DRAFT pre-llenado con los datos extraidos. Después
 * revisa en el form Nubox-style y confirma.
 *
 * Diferencia con /vouchers/importar:
 *   - importar = subis un archivo (PDF/imagen/PPT/etc.)
 *   - desde-mensaje = pegas un texto plano (mas rapido para pegar emails
 *     copiados o mensajes de WhatsApp donde no tenes el archivo aparte)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
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
  warnings: string[];
  tipo_detectado: string;
  confidence: number;
  filename: string;
}

type SourceHint = "email" | "whatsapp" | "manual";
type Step = "pick" | "analyzing" | "review" | "creating";

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

const PRESETS: Array<{ hint: SourceHint; label: string; placeholder: string; icon: typeof MessageSquare }> = [
  {
    hint: "email",
    label: "Email forwarded",
    placeholder:
      "Pegá el email completo del proveedor con la factura. Incluí remitente, asunto y body — Claude lo lee y arma el voucher.",
    icon: ClipboardCopy,
  },
  {
    hint: "whatsapp",
    label: "WhatsApp",
    placeholder:
      "Pegá el mensaje de WhatsApp del proveedor (con monto, folio, fecha, lo que tengas). Claude arma el voucher con los datos que aparezcan.",
    icon: MessageSquare,
  },
  {
    hint: "manual",
    label: "Texto libre",
    placeholder:
      "Pegá cualquier texto que tenga datos de una compra (anotación, transcripción, captura OCR, etc.).",
    icon: Sparkles,
  },
];

export default function DesdeMensajePage() {
  const { session } = useSession();
  const router = useRouter();

  const [step, setStep] = useState<Step>("pick");
  const [meta, setMeta] = useState<FormMetadata | null>(null);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [hint, setHint] = useState<SourceHint>("email");
  const [text, setText] = useState("");
  const [extraction, setExtraction] = useState<ExtractResponse | null>(null);

  // Form state pre-llenado
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
      .catch(() => toast.error("No pude cargar las empresas."));
  }, [session]);

  // V5++ ola CF — Prefill desde sessionStorage cuando venimos de /admin/mailbox
  // ("Crear voucher desde este email"). El otro lado deja un JSON con
  // {empresa_codigo, text, source_hint, inbox_id}.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("voucher-desde-mensaje:prefill");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        empresa_codigo?: string;
        text?: string;
        source_hint?: SourceHint;
      };
      if (parsed.empresa_codigo) setEmpresaCodigo(parsed.empresa_codigo);
      if (parsed.text) setText(parsed.text);
      if (parsed.source_hint) setHint(parsed.source_hint);
      window.sessionStorage.removeItem("voucher-desde-mensaje:prefill");
      toast.info("Email del inbox precargado. Click 'Analizar con IA' cuando quieras.");
    } catch {
      // ignore parse errors
    }
  }, []);

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

  async function handleExtract() {
    if (!session || !empresaCodigo) {
      toast.error("Elegí empresa y pegá un texto antes de analizar.");
      return;
    }
    if (text.trim().length < 30) {
      toast.error("El texto es demasiado corto (mínimo 30 caracteres).");
      return;
    }
    setStep("analyzing");
    try {
      const data = await apiClient.post<ExtractResponse>(
        "/vouchers/extract-from-text",
        {
          empresa_codigo: empresaCodigo,
          text: text.trim(),
          source_hint: hint,
        },
        session,
      );
      setExtraction(data);
      applySuggestion(data);
      setStep("review");
      if (data.warnings.length > 0) {
        toast.info(`Análisis con ${data.warnings.length} aviso(s).`);
      } else {
        toast.success(
          `Datos extraídos (confianza ${(data.confidence * 100).toFixed(0)}%).`,
        );
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al analizar el texto",
      );
      setStep("pick");
    }
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
    setter(list.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
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
        source: "ai_import",
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
      }>("/vouchers/nubox-form", payload, session);
      toast.success(`Voucher ${resp.codigo} creado en DRAFT`);
      router.push(`/vouchers/${resp.voucher_id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al crear el voucher",
      );
      setStep("review");
    }
  }

  const currentPreset =
    PRESETS.find((p) => p.hint === hint) ?? PRESETS[0]!;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/vouchers"
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
          aria-label="Volver"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100 flex items-center gap-2">
            <MessageSquare className="size-6 text-cehta-green" />
            Voucher desde mensaje
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Pegá el texto de un email, WhatsApp, nota o transcripción. La IA
            extrae los datos del proveedor + factura y precarga el form.
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

          <Surface className="p-6">
            <div className="mb-3 flex items-center gap-2">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                const active = p.hint === hint;
                return (
                  <button
                    key={p.hint}
                    type="button"
                    onClick={() => setHint(p.hint)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
                      active
                        ? "bg-cehta-green/15 text-cehta-green ring-cehta-green/30"
                        : "bg-ink-50 text-ink-600 ring-hairline hover:bg-ink-100"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {p.label}
                  </button>
                );
              })}
            </div>
            <label className="block text-xs font-medium text-ink-700 dark:text-ink-300 mb-1">
              Texto a analizar *
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              placeholder={currentPreset.placeholder}
              className="form-input resize-y font-mono text-[13px] leading-relaxed"
            />
            <p className="mt-2 text-xs text-ink-500">
              {text.length} caracteres · mínimo 30, máximo 60.000
            </p>
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={handleExtract}
                disabled={!empresaCodigo || text.trim().length < 30}
                className="px-5"
              >
                <Sparkles className="size-4 mr-2" />
                Analizar con IA
              </Button>
            </div>
          </Surface>
        </>
      )}

      {step === "analyzing" && (
        <Surface className="p-12 text-center">
          <Loader2 className="mx-auto size-12 animate-spin text-cehta-green" />
          <p className="mt-4 text-lg font-medium text-ink-900 dark:text-ink-100">
            Leyendo el mensaje con IA…
          </p>
          <p className="mt-2 text-sm text-ink-500">
            5–15 segundos típicamente.
          </p>
        </Surface>
      )}

      {(step === "review" || step === "creating") && extraction && (
        <form onSubmit={handleConfirm} className="space-y-6">
          <Surface className="p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-3 py-1 text-cehta-green">
                <Sparkles className="size-3.5" />
                Confianza: {(extraction.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-ink-500">
                Origen: {hint} · {text.length} caracteres analizados
              </span>
              {extraction.suggestion.empresa_auto_detectada && (
                <span
                  title={`Detectado por RUT receptor ${extraction.suggestion.empresa_receptor_rut_detectado}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs text-cehta-green"
                >
                  🎯 Empresa auto-detectada: {extraction.suggestion.empresa_codigo}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setStep("pick");
                  setExtraction(null);
                }}
                className="ml-auto text-xs text-cehta-green hover:underline"
              >
                Editar texto
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

          <Surface className="p-6">
            <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100 mb-4">
              Datos del voucher
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
                    <CheckCircle2 className="size-5" /> Partida doble cuadrada
                  </>
                ) : (
                  <>
                    <AlertCircle className="size-5" /> Asigná cuentas y ajustá
                    montos
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
