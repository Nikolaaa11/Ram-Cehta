"use client";

/**
 * /vouchers/nubox — V5++ ola AM
 *
 * Form Nubox-style con:
 *  - Header: empresa, proveedor, tipo doc, folio, forma pago, fechas
 *  - Información Contable (N líneas DEBE)
 *  - Información Financiera (N líneas HABER)
 *  - Σ Contable debe igualar Σ Financiera (partida doble)
 *
 * Matchea el form del Excel "documento para claude boucher.xlsx".
 *
 * Al submit: POST /vouchers/nubox-form → crea voucher COMPRA DRAFT.
 * Después se aprueba con el flujo estándar (Líder + Director).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Receipt,
  AlertCircle,
  CheckCircle2,
  CreditCard,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface EmpresaMetadata {
  codigo: string;
  razon_social: string;
  rut: string;
  direccion: string;
  comuna: string;
  aprobadores: Array<{ role: string; emails: string[] }>;
}

interface FormMetadata {
  formas_pago: string[];
  tipos_documento: string[];
  cuentas_contables_sample: Array<{
    codigo: string;
    nombre: string;
    nivel: number;
    activa: boolean;
    imputable: boolean;
  }>;
  empresas: EmpresaMetadata[];
}

interface LineRow {
  comentario: string;
  cuenta_codigo: string;
  total: string;
}

interface ProveedorSearchResult {
  rut_valid: boolean;
  rut_canonical: string | null;
  exists: boolean;
  proveedor: {
    proveedor_id: number;
    razon_social: string;
    rut: string | null;
    activo: boolean;
  } | null;
}

type ProveedorLookupState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "invalid" }
  | { status: "existing"; razonSocial: string; rutCanonical: string }
  | { status: "new"; rutCanonical: string };

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

export default function NuboxFormPage() {
  const { session } = useSession();
  const [meta, setMeta] = useState<FormMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Header state
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("FACTURA");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [formaPago, setFormaPago] = useState("TRANSFERENCIA");
  const [fechaDocumento, setFechaDocumento] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [glosa, setGlosa] = useState("");
  const [documentoDropboxPath, setDocumentoDropboxPath] = useState("");

  // Lines
  const [contable, setContable] = useState<LineRow[]>([
    { comentario: "", cuenta_codigo: "", total: "" },
  ]);
  const [financiera, setFinanciera] = useState<LineRow[]>([
    { comentario: "", cuenta_codigo: "", total: "" },
  ]);

  // Lookup en vivo del proveedor por RUT (debounced 400ms).
  // Avisa al usuario si el proveedor ya existe (precarga nombre), si es nuevo
  // (se va a crear automaticamente al guardar) o si el RUT es invalido.
  const [proveedorLookup, setProveedorLookup] = useState<ProveedorLookupState>({
    status: "idle",
  });

  useEffect(() => {
    if (!session) return;
    const trimmed = proveedorRut.trim();
    if (trimmed.length < 4) {
      setProveedorLookup({ status: "idle" });
      return;
    }
    let cancelled = false;
    setProveedorLookup({ status: "searching" });
    const timer = setTimeout(() => {
      apiClient
        .get<ProveedorSearchResult>(
          `/proveedores/search-by-rut?rut=${encodeURIComponent(trimmed)}`,
          session,
        )
        .then((result) => {
          if (cancelled) return;
          if (!result.rut_valid) {
            setProveedorLookup({ status: "invalid" });
            return;
          }
          if (result.exists && result.proveedor) {
            setProveedorLookup({
              status: "existing",
              razonSocial: result.proveedor.razon_social,
              rutCanonical: result.rut_canonical ?? trimmed,
            });
            // Precargar solo si el usuario aun no escribio nada en nombre,
            // para no pisarle ediciones manuales.
            setProveedorNombre((current) =>
              current.trim() === "" ? result.proveedor!.razon_social : current,
            );
          } else {
            setProveedorLookup({
              status: "new",
              rutCanonical: result.rut_canonical ?? trimmed,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setProveedorLookup({ status: "idle" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [proveedorRut, session]);

  useEffect(() => {
    if (!session) return;
    apiClient
      .get<FormMetadata>("/vouchers/form-metadata", session)
      .then((m) => {
        setMeta(m);
        const first = m.empresas[0];
        if (first) {
          setEmpresaCodigo(first.codigo);
        }
      })
      .catch((err) => {
        toast.error(
          err instanceof ApiError ? err.detail : "No se pudo cargar metadata",
        );
      })
      .finally(() => setLoading(false));
  }, [session]);

  const selectedEmpresa = useMemo(
    () => meta?.empresas.find((e) => e.codigo === empresaCodigo),
    [meta, empresaCodigo],
  );

  const totalContable = useMemo(
    () => contable.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [contable],
  );
  const totalFinanciera = useMemo(
    () => financiera.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [financiera],
  );
  const cuadrado = totalContable === totalFinanciera && totalContable > 0;

  const addLine = (which: "contable" | "financiera") => {
    const row: LineRow = { comentario: "", cuenta_codigo: "", total: "" };
    if (which === "contable") setContable([...contable, row]);
    else setFinanciera([...financiera, row]);
  };

  const removeLine = (which: "contable" | "financiera", idx: number) => {
    if (which === "contable") {
      if (contable.length === 1) return;
      setContable(contable.filter((_, i) => i !== idx));
    } else {
      if (financiera.length === 1) return;
      setFinanciera(financiera.filter((_, i) => i !== idx));
    }
  };

  const updateLine = (
    which: "contable" | "financiera",
    idx: number,
    field: keyof LineRow,
    value: string,
  ) => {
    const list = which === "contable" ? contable : financiera;
    const setter = which === "contable" ? setContable : setFinanciera;
    const next = list.map((row, i) =>
      i === idx ? { ...row, [field]: value } : row,
    );
    setter(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cuadrado) {
      toast.error("Σ Contable debe ser igual a Σ Financiera");
      return;
    }
    setSubmitting(true);
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
        documento_dropbox_path: documentoDropboxPath || null,
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
        proveedor_rut_canonical: string;
      }>("/vouchers/nubox-form", payload, session);
      toast.success(
        resp.proveedor_creado_automatico
          ? `Voucher ${resp.codigo} creado · Proveedor "${proveedorNombre.trim()}" agregado al catálogo`
          : `Voucher ${resp.codigo} creado en DRAFT`,
      );
      window.location.href = `/vouchers/${resp.voucher_id}`;
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al crear voucher",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-ink-500">Cargando metadata…</div>
    );
  }

  if (!meta) {
    return (
      <div className="p-6 text-red-500">No se pudo cargar el formulario.</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/vouchers"
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
            Nuevo voucher — Form Nubox
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Compra con factura proveedor. Σ Contable = Σ Financiera (partida
            doble). Inicia en DRAFT y requiere aprobación de Líder + Director.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* HEADER */}
        <Surface className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="size-5 text-cehta-green" />
            <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
              Información solicitada por Nubox
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Empresa */}
            <div>
              <Label>Empresa origen *</Label>
              <select
                required
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
            </div>

            {/* Tipo Documento */}
            <div>
              <Label>Tipo de documento *</Label>
              <select
                required
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value)}
                className="form-input"
              >
                {meta.tipos_documento.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_DOC_LABELS[t] || t}
                  </option>
                ))}
              </select>
            </div>

            {/* Proveedor RUT + Nombre */}
            <div>
              <Label>Proveedor RUT *</Label>
              <input
                required
                value={proveedorRut}
                onChange={(e) => setProveedorRut(e.target.value)}
                placeholder="76.123.456-7"
                className="form-input"
                aria-describedby="proveedor-rut-status"
              />
              <div id="proveedor-rut-status" className="mt-1 min-h-[1rem] text-xs">
                {proveedorLookup.status === "searching" && (
                  <span className="text-ink-500">Buscando proveedor…</span>
                )}
                {proveedorLookup.status === "invalid" && (
                  <span className="text-red-600">
                    RUT inválido — revisá el dígito verificador.
                  </span>
                )}
                {proveedorLookup.status === "existing" && (
                  <span className="text-cehta-green">
                    ✓ Proveedor existente:{" "}
                    <span className="font-medium">
                      {proveedorLookup.razonSocial}
                    </span>
                  </span>
                )}
                {proveedorLookup.status === "new" && (
                  <span className="text-amber-600">
                    Nuevo — se creará en el catálogo al guardar el voucher.
                  </span>
                )}
              </div>
            </div>
            <div>
              <Label>Proveedor razón social *</Label>
              <input
                required
                value={proveedorNombre}
                onChange={(e) => setProveedorNombre(e.target.value)}
                placeholder="Ej: Office Depot SpA"
                className="form-input"
              />
            </div>

            {/* Número documento */}
            <div>
              <Label>Número documento (folio) *</Label>
              <input
                required
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value)}
                placeholder="12345"
                className="form-input"
              />
            </div>

            {/* Forma de pago */}
            <div>
              <Label>Forma de pago *</Label>
              <select
                required
                value={formaPago}
                onChange={(e) => setFormaPago(e.target.value)}
                className="form-input"
              >
                {meta.formas_pago.map((f) => (
                  <option key={f} value={f}>
                    {FORMA_PAGO_LABELS[f] || f}
                  </option>
                ))}
              </select>
            </div>

            {/* Fechas */}
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
              <Label>Fecha vencimiento (opcional)</Label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                className="form-input"
              />
            </div>

            {/* Documento Dropbox path */}
            <div className="md:col-span-2">
              <Label>Documento — link Dropbox (opcional por ahora)</Label>
              <input
                value={documentoDropboxPath}
                onChange={(e) => setDocumentoDropboxPath(e.target.value)}
                placeholder="/Cehta Capital/Adjuntos-Vouchers/.../factura.pdf"
                className="form-input"
              />
            </div>

            {/* Glosa */}
            <div className="md:col-span-2">
              <Label>Glosa (opcional — se autogenera si está vacía)</Label>
              <input
                value={glosa}
                onChange={(e) => setGlosa(e.target.value)}
                placeholder="Compra a {proveedor} folio {n}"
                className="form-input"
              />
            </div>
          </div>

          {/* Empresa info bloqueada */}
          {selectedEmpresa && (
            <div className="mt-4 p-3 rounded bg-ink-50 dark:bg-ink-900 text-sm">
              <div className="font-medium text-ink-700 dark:text-ink-300 mb-1">
                Datos del receptor (bloqueados):
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-ink-600 dark:text-ink-400">
                <div>
                  <strong>Razón:</strong> {selectedEmpresa.razon_social}
                </div>
                <div>
                  <strong>RUT:</strong> {selectedEmpresa.rut}
                </div>
                <div>
                  <strong>Dirección:</strong>{" "}
                  {selectedEmpresa.direccion || "—"}
                </div>
                <div>
                  <strong>Comuna:</strong> {selectedEmpresa.comuna || "—"}
                </div>
                <div className="md:col-span-2">
                  <strong>Aprobadores:</strong>{" "}
                  {selectedEmpresa.aprobadores.length === 0
                    ? "Sin aprobadores configurados — ir a /admin/users"
                    : selectedEmpresa.aprobadores
                        .map(
                          (a) => `${a.role}: ${a.emails.join(", ")}`,
                        )
                        .join(" · ")}
                </div>
              </div>
            </div>
          )}
        </Surface>

        {/* INFORMACIÓN CONTABLE */}
        <LineSection
          title="Información Contable (DEBE)"
          subtitle="Líneas que afectan el resultado contable. Cuentas tipo 5-* gasto."
          tone="contable"
          lines={contable}
          onAdd={() => addLine("contable")}
          onRemove={(i) => removeLine("contable", i)}
          onUpdate={(i, f, v) => updateLine("contable", i, f, v)}
        />

        {/* INFORMACIÓN FINANCIERA */}
        <LineSection
          title="Información Financiera (HABER)"
          subtitle="Líneas que afectan el flujo de pago. Cuentas tipo 1-01-* banco o 2-02-* CxP."
          tone="financiera"
          lines={financiera}
          onAdd={() => addLine("financiera")}
          onRemove={(i) => removeLine("financiera", i)}
          onUpdate={(i, f, v) => updateLine("financiera", i, f, v)}
        />

        {/* FOOTER: totales + submit */}
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
              value={`$${(totalContable - totalFinanciera).toLocaleString(
                "es-CL",
              )}`}
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
                  Descuadrado — corregí líneas antes de enviar
                </>
              )}
            </div>
            <Button
              type="submit"
              disabled={!cuadrado || submitting}
              className="px-6"
            >
              <Save className="size-4 mr-2" />
              {submitting ? "Creando…" : "Crear voucher DRAFT"}
            </Button>
          </div>
        </Surface>
      </form>

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
  tone,
  lines,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  subtitle: string;
  tone: "contable" | "financiera";
  lines: LineRow[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof LineRow, value: string) => void;
}) {
  const Icon = tone === "contable" ? Receipt : CreditCard;
  return (
    <Surface className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon
            className={`size-5 ${tone === "contable" ? "text-amber-500" : "text-blue-500"}`}
          />
          <div>
            <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
              {title}
            </h2>
            <p className="text-xs text-ink-500">{subtitle}</p>
          </div>
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
                  onChange={(e) =>
                    onUpdate(idx, "comentario", e.target.value)
                  }
                  placeholder="Descripción"
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
