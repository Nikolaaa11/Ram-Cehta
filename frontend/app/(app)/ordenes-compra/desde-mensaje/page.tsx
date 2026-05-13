"use client";

/**
 * /ordenes-compra/desde-mensaje — V5++ ola CG
 *
 * Pega un texto crudo (email, WhatsApp, mensaje, cotización transcripta) y
 * la IA arma una OC pre-llenada. Después confirma en el form.
 *
 * Diferencia con /ordenes-compra/importar:
 *   - importar = subis un archivo (PDF/imagen/PPT/etc.)
 *   - desde-mensaje = pegas texto plano (mas rapido para emails copiados
 *     o cotizaciones que llegaron por chat).
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

interface Empresa {
  codigo: string;
  razon_social: string;
}

interface ExtractedItem {
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  total: string;
}

interface OcSuggestion {
  empresa_codigo: string;
  empresa_auto_detectada?: boolean;
  empresa_receptor_rut_detectado?: string | null;
  proveedor_rut: string;
  proveedor_nombre: string;
  rut_es_valido: boolean;
  numero_oc: string;
  fecha_emision: string;
  validez_dias: number;
  moneda: string;
  neto: string;
  forma_pago: string;
  plazo_pago: string;
  observaciones: string;
  items: ExtractedItem[];
}

interface ExtractResponse {
  suggestion: OcSuggestion;
  warnings: string[];
  tipo_detectado: string;
  confidence: number;
  filename: string;
}

type SourceHint = "email" | "whatsapp" | "manual";
type Step = "pick" | "analyzing" | "review" | "creating";

const PRESETS: Array<{
  hint: SourceHint;
  label: string;
  placeholder: string;
  icon: typeof MessageSquare;
}> = [
  {
    hint: "email",
    label: "Email forwarded",
    placeholder:
      "Pegá el email del proveedor con la cotización completa. Incluí remitente, asunto y cuerpo — Claude lee y arma la OC con items, fechas y totales.",
    icon: ClipboardCopy,
  },
  {
    hint: "whatsapp",
    label: "WhatsApp",
    placeholder:
      "Pegá el mensaje de WhatsApp del proveedor (con descripción de items, cantidades y precios). Claude precarga la OC con lo que aparezca.",
    icon: MessageSquare,
  },
  {
    hint: "manual",
    label: "Texto libre",
    placeholder:
      "Pegá cualquier texto con datos de una cotización (anotación, transcripción, captura OCR, etc.). Mejor incluir cantidades y precios.",
    icon: Sparkles,
  },
];

export default function DesdeMensajeOcPage() {
  const { session } = useSession();
  const router = useRouter();

  const [step, setStep] = useState<Step>("pick");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [hint, setHint] = useState<SourceHint>("email");
  const [text, setText] = useState("");
  const [extraction, setExtraction] = useState<ExtractResponse | null>(null);

  // Form state
  const [numeroOc, setNumeroOc] = useState("");
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [moneda, setMoneda] = useState("CLP");
  const [validezDias, setValidezDias] = useState("30");
  const [formaPago, setFormaPago] = useState("");
  const [plazoPago, setPlazoPago] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ExtractedItem[]>([]);

  useEffect(() => {
    if (!session) return;
    apiClient
      .get<Empresa[]>("/empresa", session)
      .then((data) => {
        setEmpresas(data);
        if (data[0]) setEmpresaCodigo(data[0].codigo);
      })
      .catch(() => toast.error("No pude cargar las empresas."));
  }, [session]);

  // V5++ ola CG — Prefill desde sessionStorage cuando venimos de /admin/mailbox.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(
        "oc-desde-mensaje:prefill",
      );
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        empresa_codigo?: string;
        text?: string;
        source_hint?: SourceHint;
      };
      if (parsed.empresa_codigo) setEmpresaCodigo(parsed.empresa_codigo);
      if (parsed.text) setText(parsed.text);
      if (parsed.source_hint) setHint(parsed.source_hint);
      window.sessionStorage.removeItem("oc-desde-mensaje:prefill");
      toast.info("Mensaje precargado. Click 'Analizar con IA' cuando quieras.");
    } catch {
      // ignore parse errors
    }
  }, []);

  const applySuggestion = useCallback((data: ExtractResponse) => {
    const s = data.suggestion;
    setEmpresaCodigo(s.empresa_codigo);
    setNumeroOc(s.numero_oc);
    setProveedorRut(s.proveedor_rut);
    setProveedorNombre(s.proveedor_nombre);
    setFechaEmision(s.fecha_emision || new Date().toISOString().slice(0, 10));
    setMoneda(s.moneda || "CLP");
    setValidezDias(String(s.validez_dias || 30));
    setFormaPago(s.forma_pago);
    setPlazoPago(s.plazo_pago);
    setObservaciones(s.observaciones);
    setItems(
      s.items.length > 0
        ? s.items
        : [{ descripcion: "", cantidad: "1", precio_unitario: "0", total: "0" }],
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
        "/ordenes-compra/extract-from-text",
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

  const totalNeto = useMemo(
    () =>
      items.reduce(
        (sum, it) =>
          sum +
          (parseFloat(it.precio_unitario) || 0) *
            (parseFloat(it.cantidad) || 0),
        0,
      ),
    [items],
  );
  const ivaCalculado = moneda === "CLP" ? totalNeto * 0.19 : 0;
  const totalConIva = totalNeto + ivaCalculado;

  function updateItem(idx: number, field: keyof ExtractedItem, value: string) {
    setItems(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }
  function addItem() {
    setItems([
      ...items,
      { descripcion: "", cantidad: "1", precio_unitario: "0", total: "0" },
    ]);
  }
  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!numeroOc.trim()) {
      toast.error("Ingresá el número de OC");
      return;
    }
    if (totalNeto <= 0) {
      toast.error("El neto debe ser mayor a 0");
      return;
    }
    setStep("creating");
    try {
      const payload = {
        empresa_codigo: empresaCodigo,
        numero_oc: numeroOc,
        proveedor_rut: proveedorRut || null,
        proveedor_nombre: proveedorNombre || null,
        fecha_emision: fechaEmision,
        validez_dias: Number(validezDias) || 30,
        moneda,
        // Disciplina 2: backend recomputa el neto de los items. El FE solo
        // muestra preview con totalNeto pero NO lo envía.
        forma_pago: formaPago || null,
        plazo_pago: plazoPago || null,
        observaciones: observaciones || null,
        items: items.map((it, i) => ({
          item: i + 1,
          descripcion: it.descripcion,
          precio_unitario: Number(it.precio_unitario) || 0,
          cantidad: Number(it.cantidad) || 1,
        })),
      };
      const resp = await apiClient.post<{ oc_id: number; numero_oc: string }>(
        "/ordenes-compra",
        payload,
        session,
      );
      toast.success(`OC ${resp.numero_oc} creada`);
      router.push(`/ordenes-compra/${resp.oc_id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error al crear OC");
      setStep("review");
    }
  }

  const currentPreset = PRESETS.find((p) => p.hint === hint) ?? PRESETS[0]!;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/ordenes-compra"
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
          aria-label="Volver"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100 flex items-center gap-2">
            <MessageSquare className="size-6 text-cehta-green" />
            OC desde mensaje
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Pegá el texto de un email, WhatsApp, nota o transcripción. La IA
            extrae proveedor, items y totales — vos confirmas en el form.
          </p>
        </div>
      </div>

      {step === "pick" && (
        <>
          <Surface className="p-6">
            <label className="block text-xs font-medium text-ink-700 dark:text-ink-300 mb-1">
              Empresa emisora *
            </label>
            <select
              value={empresaCodigo}
              onChange={(e) => setEmpresaCodigo(e.target.value)}
              className="form-input"
            >
              {empresas.map((e) => (
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
              Datos de la OC
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Empresa emisora *</Label>
                <select
                  required
                  value={empresaCodigo}
                  onChange={(e) => setEmpresaCodigo(e.target.value)}
                  className="form-input"
                >
                  {empresas.map((e) => (
                    <option key={e.codigo} value={e.codigo}>
                      {e.codigo} — {e.razon_social}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Número OC *</Label>
                <input
                  required
                  value={numeroOc}
                  onChange={(e) => setNumeroOc(e.target.value)}
                  className="form-input font-mono"
                  placeholder="OC-2026-0001"
                />
              </div>
              <div>
                <Label>Proveedor RUT</Label>
                <input
                  value={proveedorRut}
                  onChange={(e) => setProveedorRut(e.target.value)}
                  className="form-input"
                  placeholder="76.123.456-7"
                />
              </div>
              <div>
                <Label>Proveedor razón social</Label>
                <input
                  value={proveedorNombre}
                  onChange={(e) => setProveedorNombre(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Fecha emisión *</Label>
                <input
                  required
                  type="date"
                  value={fechaEmision}
                  onChange={(e) => setFechaEmision(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Validez (días)</Label>
                <input
                  type="number"
                  min="1"
                  value={validezDias}
                  onChange={(e) => setValidezDias(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <Label>Moneda</Label>
                <select
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value)}
                  className="form-input"
                >
                  <option value="CLP">CLP</option>
                  <option value="USD">USD</option>
                  <option value="UF">UF</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <Label>Forma de pago</Label>
                <input
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value)}
                  className="form-input"
                  placeholder="Transferencia, 30 días, etc."
                />
              </div>
              <div className="md:col-span-2">
                <Label>Plazo de pago</Label>
                <input
                  value={plazoPago}
                  onChange={(e) => setPlazoPago(e.target.value)}
                  className="form-input"
                  placeholder="30 días desde recepción, etc."
                />
              </div>
              <div className="md:col-span-2">
                <Label>Observaciones</Label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  className="form-input"
                />
              </div>
            </div>
          </Surface>

          <Surface className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
                Items
              </h2>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="size-4 mr-1" /> Agregar item
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-2 py-1.5 w-12">#</th>
                  <th className="text-left px-2 py-1.5">Descripción *</th>
                  <th className="text-left px-2 py-1.5 w-24">Cantidad *</th>
                  <th className="text-right px-2 py-1.5 w-36">P. unitario *</th>
                  <th className="text-right px-2 py-1.5 w-36">Subtotal</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {items.map((line, idx) => {
                  const subtotal =
                    (parseFloat(line.precio_unitario) || 0) *
                    (parseFloat(line.cantidad) || 0);
                  return (
                    <tr key={idx}>
                      <td className="px-2 py-1.5 text-ink-500">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <input
                          required
                          value={line.descripcion}
                          onChange={(e) =>
                            updateItem(idx, "descripcion", e.target.value)
                          }
                          className="form-input"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.cantidad}
                          onChange={(e) =>
                            updateItem(idx, "cantidad", e.target.value)
                          }
                          className="form-input text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.precio_unitario}
                          onChange={(e) =>
                            updateItem(idx, "precio_unitario", e.target.value)
                          }
                          className="form-input text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-ink-600 dark:text-ink-400">
                        {moneda === "CLP" ? "$" : `${moneda} `}
                        {subtotal.toLocaleString("es-CL", {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                          className="text-ink-400 hover:text-red-500 disabled:opacity-30"
                          aria-label="Quitar item"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Surface>

          <Surface className="p-6">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Stat
                label="Neto"
                value={`${moneda === "CLP" ? "$" : moneda + " "}${totalNeto.toLocaleString("es-CL", { maximumFractionDigits: 0 })}`}
              />
              <Stat
                label={moneda === "CLP" ? "IVA (19%)" : "IVA (no aplica)"}
                value={`${moneda === "CLP" ? "$" : moneda + " "}${ivaCalculado.toLocaleString("es-CL", { maximumFractionDigits: 0 })}`}
              />
              <Stat
                label="Total"
                value={`${moneda === "CLP" ? "$" : moneda + " "}${totalConIva.toLocaleString("es-CL", { maximumFractionDigits: 0 })}`}
                tone="success"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-cehta-green">
                <CheckCircle2 className="size-5" /> Listo para crear la OC
              </div>
              <Button
                type="submit"
                disabled={
                  step === "creating" || totalNeto <= 0 || !numeroOc.trim()
                }
                className="px-6"
              >
                {step === "creating" ? "Creando…" : "Confirmar y crear OC"}
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
