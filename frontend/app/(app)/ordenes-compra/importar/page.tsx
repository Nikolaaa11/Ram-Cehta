"use client";

/**
 * /ordenes-compra/importar — V5++ ola CG
 *
 * Sube una cotización (PDF, imagen, DOCX, PPTX, XLSX, EML, HTML, TXT) o
 * pegá un texto. La IA extrae proveedor + items + totales y precarga el
 * form de OC para que confirmes.
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
  MessageSquare,
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
import { ProveedorTypeaheadCached } from "@/components/proveedores/ProveedorTypeaheadCached";

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
  extraction_method: string | null;
  filename: string;
  file_size_bytes: number;
  dropbox_path: string | null;
}

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.webp,.tif,.tiff,.gif,.bmp,.docx,.pptx,.ppt,.xlsx,.xlsm,.txt,.md,.csv,.eml,.html,.htm,image/*,application/pdf";

type Step = "pick" | "analyzing" | "review" | "creating";

export default function ImportarOcPage() {
  const { session } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("pick");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [dragOver, setDragOver] = useState(false);
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
      .catch(() => toast.error("No pude cargar empresas"));
  }, [session]);

  const applySuggestion = useCallback((data: ExtractResponse) => {
    const s = data.suggestion;
    setEmpresaCodigo(s.empresa_codigo);
    setNumeroOc(s.numero_oc);
    setProveedorRut(s.proveedor_rut);
    setProveedorNombre(s.proveedor_nombre);
    setFechaEmision(s.fecha_emision || new Date().toISOString().slice(0, 10));
    setMoneda(s.moneda);
    setValidezDias(String(s.validez_dias));
    setFormaPago(s.forma_pago);
    setPlazoPago(s.plazo_pago);
    setObservaciones(s.observaciones);
    setItems(
      s.items.length > 0
        ? s.items
        : [{ descripcion: "", cantidad: "1", precio_unitario: "0", total: "0" }],
    );
  }, []);

  async function handleUpload(file: File) {
    if (!session || !empresaCodigo) {
      toast.error("Elige empresa antes de subir.");
      return;
    }
    setStep("analyzing");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("empresa_codigo", empresaCodigo);
      const data = await apiClient.postForm<ExtractResponse>(
        "/ordenes-compra/extract-from-upload",
        fd,
        session,
      );
      setExtraction(data);
      applySuggestion(data);
      setStep("review");
      toast.success(
        `Datos extraídos (confianza ${(data.confidence * 100).toFixed(0)}%)`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al analizar el archivo",
      );
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
    e.target.value = "";
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

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/ordenes-compra" className="text-ink-500 hover:text-ink-900">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="size-6 text-cehta-green" />
            Importar OC con IA
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Sube una cotización del proveedor (PDF, imagen, Excel, email, etc.)
            y la IA precarga el form.
          </p>
        </div>
      </div>

      {step === "pick" && (
        <>
          <Surface className="p-6">
            <label className="block text-xs font-medium text-ink-700 mb-1">
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
                : "border-ink-200 hover:border-cehta-green/50 hover:bg-ink-50/40"
            }`}
            role="button"
            tabIndex={0}
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
            <p className="mt-4 text-lg font-medium">
              Arrastrá la cotización o hacé click
            </p>
            <p className="mt-2 text-sm text-ink-500">
              PDF, imagen, DOCX, PPTX, XLSX, EML, HTML — hasta 15MB
            </p>
            <div className="mt-6 flex justify-center gap-3 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1">
                <ImageIcon className="size-3.5" /> Foto cotización
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1">
                <FileText className="size-3.5" /> PDF / Excel
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-3 py-1">
                <MessageSquare className="size-3.5" /> Email del proveedor
              </span>
            </div>
          </div>
        </>
      )}

      {step === "analyzing" && (
        <Surface className="p-12 text-center">
          <Loader2 className="mx-auto size-12 animate-spin text-cehta-green" />
          <p className="mt-4 text-lg font-medium">Analizando con IA…</p>
          <p className="mt-2 text-sm text-ink-500">5–20 segundos</p>
        </Surface>
      )}

      {(step === "review" || step === "creating") && extraction && (
        <form onSubmit={handleConfirm} className="space-y-6">
          <Surface className="p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-3 py-1 text-cehta-green">
                <Sparkles className="size-3.5" />
                Confianza {(extraction.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-ink-500">
                {extraction.filename} · {extraction.extraction_method}
              </span>
              {extraction.suggestion.empresa_auto_detectada && (
                <span className="rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs text-cehta-green">
                  🎯 Empresa auto-detectada
                </span>
              )}
              {extraction.dropbox_path && (
                <span className="rounded-full bg-sf-blue/10 px-2.5 py-0.5 text-xs text-sf-blue">
                  📎 Archivado en Dropbox
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
                Subir otro
              </button>
            </div>
            {extraction.warnings.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-amber-700">
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
            <h2 className="text-lg font-medium mb-4">Cabecera</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Empresa *</Label>
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
                  className="form-input"
                  placeholder="OC-2026-001"
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
                {/* Round 61 — typeahead cacheado. */}
                <ProveedorTypeaheadCached
                  value={proveedorNombre}
                  rutValue={proveedorRut}
                  onSelect={(hit) => {
                    setProveedorNombre(hit.razon_social);
                    if (hit.rut) setProveedorRut(hit.rut);
                  }}
                  onClear={() => setProveedorNombre("")}
                  inputClassName="form-input"
                  idPrefix="ocimp-prov"
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
                <Label>Moneda *</Label>
                <select
                  required
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
                <Label>Forma pago</Label>
                <input
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value)}
                  className="form-input"
                  placeholder="Transferencia"
                />
              </div>
              <div>
                <Label>Plazo</Label>
                <input
                  value={plazoPago}
                  onChange={(e) => setPlazoPago(e.target.value)}
                  className="form-input"
                  placeholder="30 días"
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
              <h2 className="text-lg font-medium">Ítems</h2>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="size-4 mr-1" /> Agregar ítem
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-ink-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-2 py-1.5">Descripción *</th>
                  <th className="text-right px-2 py-1.5 w-24">Cant.</th>
                  <th className="text-right px-2 py-1.5 w-36">P. unitario</th>
                  <th className="text-right px-2 py-1.5 w-36">Total</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {items.map((it, idx) => {
                  const total =
                    (parseFloat(it.cantidad) || 0) *
                    (parseFloat(it.precio_unitario) || 0);
                  return (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        <input
                          required
                          value={it.descripcion}
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
                          min="0.01"
                          value={it.cantidad}
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
                          value={it.precio_unitario}
                          onChange={(e) =>
                            updateItem(idx, "precio_unitario", e.target.value)
                          }
                          className="form-input text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink-700">
                        {total.toLocaleString("es-CL")}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                          className="text-ink-400 hover:text-red-500 disabled:opacity-30"
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Stat label="Neto" value={`${moneda} ${totalNeto.toLocaleString("es-CL")}`} />
              <Stat label="IVA" value={`${moneda} ${ivaCalculado.toLocaleString("es-CL")}`} />
              <Stat
                label="Total"
                value={`${moneda} ${totalConIva.toLocaleString("es-CL")}`}
                tone="success"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={step === "creating" || totalNeto <= 0}
                className="px-6"
              >
                {step === "creating" ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" /> Creando…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4 mr-2" /> Confirmar y crear OC
                  </>
                )}
              </Button>
            </div>
          </Surface>
        </form>
      )}

      <style jsx>{`
        :global(.form-input) {
          @apply mt-1 block w-full px-3 py-2 rounded-lg border border-hairline
                 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-cehta-green focus:border-cehta-green;
        }
      `}</style>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-ink-700 mb-1">
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
  tone?: "neutral" | "success";
}) {
  const color =
    tone === "success"
      ? "text-cehta-green"
      : "text-ink-900";
  return (
    <div className="rounded border border-ink-200 p-3 bg-white">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  );
}
