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
  Cloud,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
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
  // V5++ ola CH — backend provee labels y subset afecto a IVA para que
  // el FE no hardcodee reglas de negocio (disciplina 1).
  tipo_documento_labels: Record<string, string>;
  tipos_documento_afectos_iva: string[];
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
  total: string; // monto neto (lo que tipea el usuario)
}

interface ProveedorSearchHit {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
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

interface DuplicateVoucherHit {
  voucher_id: number;
  codigo: string;
  status: string;
  fecha_documento: string | null;
  total: string | null;
  glosa: string | null;
}

interface CheckDuplicateResponse {
  duplicates: DuplicateVoucherHit[];
  rut_canonical: string | null;
}

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

// V5++ ola CH — Los labels viven en backend (FormMetadata.tipo_documento_labels)
// para evitar duplicacion. Este fallback solo se usa si la metadata no
// cargo (loading state). NO agregar valores nuevos aca — agregarlos en
// vouchers_nubox_form.py TIPO_DOCUMENTO_LABELS.
const TIPO_DOC_FALLBACK_LABELS: Record<string, string> = {
  FACTURA: "Factura",
  FACTURA_ELECTRONICA: "Factura electrónica",
  FACTURA_EXENTA: "Factura exenta",
  NOTA_CREDITO: "Nota de crédito",
  NOTA_DEBITO: "Nota de débito",
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

  // V5++ ola CE — Check de voucher duplicado (mismo empresa+RUT+folio+tipo).
  // Se dispara cuando los 4 campos minimos estan llenos (debounce 500ms).
  // Avisa al user si ya existe un voucher con esa firma — no bloquea.
  const [duplicates, setDuplicates] = useState<DuplicateVoucherHit[]>([]);
  useEffect(() => {
    if (!session) return;
    const rutOk = proveedorRut.trim().length >= 8;
    const folioOk = numeroDocumento.trim().length > 0;
    if (!empresaCodigo || !rutOk || !folioOk || !tipoDocumento) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({
        empresa_codigo: empresaCodigo,
        proveedor_rut: proveedorRut.trim(),
        numero_documento: numeroDocumento.trim(),
        tipo_documento: tipoDocumento,
      }).toString();
      apiClient
        .get<CheckDuplicateResponse>(`/vouchers/check-duplicate?${qs}`, session)
        .then((resp) => {
          if (!cancelled) setDuplicates(resp.duplicates ?? []);
        })
        .catch(() => {
          if (!cancelled) setDuplicates([]);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [empresaCodigo, proveedorRut, numeroDocumento, tipoDocumento, session]);

  // Auto-save de borrador en localStorage. Persiste todo el state del form
  // para que si el user cierra el browser, al volver encuentre lo tipeado.
  const draftState = useMemo(
    () => ({
      empresaCodigo,
      proveedorRut,
      proveedorNombre,
      tipoDocumento,
      numeroDocumento,
      formaPago,
      fechaDocumento,
      fechaVencimiento,
      glosa,
      documentoDropboxPath,
      contable,
      financiera,
    }),
    [
      empresaCodigo,
      proveedorRut,
      proveedorNombre,
      tipoDocumento,
      numeroDocumento,
      formaPago,
      fechaDocumento,
      fechaVencimiento,
      glosa,
      documentoDropboxPath,
      contable,
      financiera,
    ],
  );
  const { clear: clearDraft, hasSaved } = useFormAutosave(
    "voucher-nubox-v1",
    draftState,
    {
      onRestore: (saved) => {
        if (saved.empresaCodigo) setEmpresaCodigo(saved.empresaCodigo);
        if (saved.proveedorRut) setProveedorRut(saved.proveedorRut);
        if (saved.proveedorNombre) setProveedorNombre(saved.proveedorNombre);
        if (saved.tipoDocumento) setTipoDocumento(saved.tipoDocumento);
        if (saved.numeroDocumento) setNumeroDocumento(saved.numeroDocumento);
        if (saved.formaPago) setFormaPago(saved.formaPago);
        if (saved.fechaDocumento) setFechaDocumento(saved.fechaDocumento);
        if (saved.fechaVencimiento) setFechaVencimiento(saved.fechaVencimiento);
        if (saved.glosa) setGlosa(saved.glosa);
        if (saved.documentoDropboxPath)
          setDocumentoDropboxPath(saved.documentoDropboxPath);
        if (saved.contable?.length) setContable(saved.contable);
        if (saved.financiera?.length) setFinanciera(saved.financiera);
        toast.info("Restauré tu borrador del último intento.");
      },
    },
  );

  // Dirty = al menos un campo no esta vacio (proxy simple).
  const isDirty =
    proveedorRut.trim().length > 0 ||
    proveedorNombre.trim().length > 0 ||
    numeroDocumento.trim().length > 0 ||
    glosa.trim().length > 0 ||
    contable.some((l) => l.comentario || l.cuenta_codigo || l.total) ||
    financiera.some((l) => l.comentario || l.cuenta_codigo || l.total);

  useUnsavedChangesWarning(isDirty && !submitting);

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
      clearDraft();
      window.location.href = `/vouchers/${resp.voucher_id}`;
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al crear voucher",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Atajos de teclado: Ctrl/Cmd+S para submit, Ctrl/Cmd+Enter para agregar
  // linea contable (la mas usada). El hook ignora el handler si el form
  // todavia esta cargando metadata o ya esta enviando.
  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (!submitting && cuadrado) {
        handleSubmit(new Event("submit") as unknown as React.FormEvent);
      }
    },
    "mod+enter": (e) => {
      e.preventDefault();
      if (!submitting) addLine("contable");
    },
  });

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
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
              Nuevo voucher — Form Nubox
            </h1>
            {hasSaved && isDirty && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs text-cehta-green">
                <Cloud className="h-3 w-3" />
                Borrador guardado
              </span>
            )}
          </div>
          <p className="text-sm text-ink-500 mt-1">
            Compra con factura proveedor. Σ Contable = Σ Financiera (partida
            doble). Inicia en DRAFT y requiere aprobación de Líder + Director.
            <span className="ml-2 hidden text-xs text-ink-400 sm:inline">
              · Atajos: <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">⌘S</kbd> guardar ·{" "}
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">⌘↵</kbd> agregar línea
            </span>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* V5++ ola CE — Warning si el backend detecta vouchers con la
            misma firma (empresa+RUT+folio+tipo). NO bloquea — solo avisa. */}
        {duplicates.length > 0 && (
          <Surface className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Ya existe {duplicates.length === 1 ? "un voucher" : `${duplicates.length} vouchers`} con esta combinación de empresa + RUT + folio + tipo.
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  Revisá antes de crear uno nuevo. Si es legítimo (ej. nota de crédito que referencia la factura), seguí adelante.
                </p>
                <ul className="mt-2 space-y-1">
                  {duplicates.map((d) => (
                    <li key={d.voucher_id} className="text-xs">
                      <Link
                        href={`/vouchers/${d.voucher_id}`}
                        target="_blank"
                        className="font-mono text-cehta-green hover:underline"
                      >
                        {d.codigo}
                      </Link>
                      <span className="ml-2 text-amber-800 dark:text-amber-300">
                        · {d.status}
                        {d.fecha_documento ? ` · ${d.fecha_documento}` : ""}
                        {d.total ? ` · $${Number(d.total).toLocaleString("es-CL")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Surface>
        )}
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

            {/* Tipo Documento — V5++ ola CH: 15 tipos SII, labels desde backend */}
            <div>
              <Label>Tipo de documento *</Label>
              <select
                required
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value)}
                className="form-input"
              >
                {meta.tipos_documento
                  // Solo mostramos los del catalogo nuevo en orden alfabetico
                  // del label. Los antiguos (BOLETA/HONORARIOS/NA) quedan
                  // disponibles si llegan en payload pero no en el dropdown.
                  .filter((t) =>
                    !["BOLETA", "HONORARIOS", "NA"].includes(t),
                  )
                  .sort((a, b) => {
                    const la =
                      meta.tipo_documento_labels[a] ??
                      TIPO_DOC_FALLBACK_LABELS[a] ??
                      a;
                    const lb =
                      meta.tipo_documento_labels[b] ??
                      TIPO_DOC_FALLBACK_LABELS[b] ??
                      b;
                    return la.localeCompare(lb, "es");
                  })
                  .map((t) => (
                    <option key={t} value={t}>
                      {meta.tipo_documento_labels[t] ??
                        TIPO_DOC_FALLBACK_LABELS[t] ??
                        t}
                    </option>
                  ))}
              </select>
            </div>

            {/* Proveedor combobox (typeahead) + RUT auto-completed read-only.
                V5++ ola CH B.2/B.3: el usuario tipea y elige del maestro;
                el RUT se llena solo y queda bloqueado. */}
            <div className="md:col-span-2">
              <Label>Proveedor *</Label>
              <ProveedorTypeahead
                value={proveedorNombre}
                rutValue={proveedorRut}
                onSelect={(hit) => {
                  setProveedorNombre(hit.razon_social);
                  setProveedorRut(hit.rut ?? "");
                }}
                onClear={() => {
                  setProveedorNombre("");
                  setProveedorRut("");
                }}
                placeholder="Escribí razón social o RUT…"
              />
              <p className="mt-1 min-h-[1rem] text-xs text-ink-500">
                {proveedorLookup.status === "searching" &&
                  "Buscando proveedor…"}
                {proveedorLookup.status === "invalid" && (
                  <span className="text-red-600">
                    RUT inválido — revisá el dígito verificador.
                  </span>
                )}
                {proveedorLookup.status === "existing" && (
                  <span className="text-cehta-green">
                    ✓ Proveedor existente
                  </span>
                )}
                {proveedorLookup.status === "new" &&
                  proveedorNombre.trim() && (
                    <span className="text-amber-600">
                      Nuevo — se creará en el catálogo al guardar.
                    </span>
                  )}
              </p>
            </div>

            {/* RUT proveedor — solo display, read-only, viene del select. */}
            <div className="md:col-span-2">
              <Label>RUT proveedor</Label>
              <input
                value={proveedorRut}
                readOnly
                placeholder="Se completa al seleccionar el proveedor"
                className="form-input bg-ink-50 dark:bg-ink-900/60 text-ink-700 dark:text-ink-300 cursor-not-allowed"
                aria-readonly="true"
                tabIndex={-1}
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

            {/* Comentario (glosa) — V5++ ola CH B.4: 2 lineas visibles, capacidad
                full del modelo (500 chars), scroll interno si se excede. */}
            <div className="md:col-span-2">
              <Label>Comentario (opcional — se autogenera si está vacío)</Label>
              <textarea
                value={glosa}
                onChange={(e) => setGlosa(e.target.value)}
                placeholder="Compra a {proveedor} folio {n}"
                rows={2}
                maxLength={500}
                className="form-input resize-none"
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

        {/* INFORMACIÓN CONTABLE — V5++ ola CH C.1: sin label "DEBE", sin
            subtitle hardcoded, con Total Bruto calculado a partir del tipo
            de documento. */}
        <LineSection
          title="Información Contable"
          tone="contable"
          lines={contable}
          tipoDocumento={tipoDocumento}
          tiposAfectosIva={meta.tipos_documento_afectos_iva}
          onAdd={() => addLine("contable")}
          onRemove={(i) => removeLine("contable", i)}
          onUpdate={(i, f, v) => updateLine("contable", i, f, v)}
        />

        {/* INFORMACIÓN FINANCIERA — V5++ ola CH C.2: idem. */}
        <LineSection
          title="Información Financiera"
          tone="financiera"
          lines={financiera}
          tipoDocumento={tipoDocumento}
          tiposAfectosIva={meta.tipos_documento_afectos_iva}
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
  tone,
  lines,
  tipoDocumento,
  tiposAfectosIva,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  tone: "contable" | "financiera";
  lines: LineRow[];
  tipoDocumento: string;
  tiposAfectosIva: string[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof LineRow, value: string) => void;
}) {
  const Icon = tone === "contable" ? Receipt : CreditCard;
  // V5++ ola CH C.1.5/C.2.5: Total Bruto = Neto si exento, Neto*1.19 si
  // afecto. Backend marca qué tipos llevan IVA en tiposAfectosIva (FE no
  // hardcodea el set — disciplina 1).
  const aplicaIva = tiposAfectosIva.includes(tipoDocumento);

  const formatBruto = (neto: number): string => {
    if (!neto || neto === 0) return "—";
    const bruto = aplicaIva ? neto * 1.19 : neto;
    return `$${Math.round(bruto).toLocaleString("es-CL")}`;
  };

  return (
    <Surface className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon
            className={`size-5 ${tone === "contable" ? "text-amber-500" : "text-blue-500"}`}
          />
          <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
            {title}
          </h2>
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
            <th className="text-left px-2 py-1.5 w-44">Plan de Cuenta *</th>
            <th className="text-right px-2 py-1.5 w-36">Total Neto *</th>
            <th
              className="text-right px-2 py-1.5 w-36"
              title={
                aplicaIva
                  ? "Total Neto × 1.19 (IVA 19%). Read-only — se recalcula automáticamente."
                  : "Tipo de documento exento o sin IVA aplicable. Bruto = Neto."
              }
            >
              Total Bruto
            </th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
          {lines.map((line, idx) => {
            const neto = parseFloat(line.total) || 0;
            return (
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
                <td
                  className="px-2 py-1.5 text-right font-mono text-ink-600 dark:text-ink-400 tabular-nums"
                  aria-readonly="true"
                >
                  {formatBruto(neto)}
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
            );
          })}
        </tbody>
      </table>
      {/* Hint sutil sobre el calculo IVA */}
      <p className="mt-2 text-[11px] text-ink-400">
        {aplicaIva
          ? `Total Bruto = Total Neto × 1.19 (IVA 19%) — recalculado en vivo desde el tipo de documento.`
          : `Tipo de documento sin IVA aplicable (exento / DI / SRF). Bruto = Neto.`}
      </p>
    </Surface>
  );
}

// ---------------------------------------------------------------------
// Typeahead Proveedor — V5++ ola CH B.2/B.3
// ---------------------------------------------------------------------
// Input controlado que pega a `/proveedores/search?q=` con debounce 300ms.
// Al seleccionar un hit dispara `onSelect`, que el padre usa para llenar
// razon social + RUT (read-only). Si el usuario escribe pero no selecciona
// ninguno, el padre asume que va a crear un proveedor nuevo (queda en modo
// libre — el backend autocrea al guardar).

function ProveedorTypeahead({
  value,
  rutValue,
  onSelect,
  onClear,
  placeholder,
}: {
  value: string;
  rutValue: string;
  onSelect: (hit: ProveedorSearchHit) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const { session } = useSession();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<ProveedorSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  // Sync exterior -> interior cuando el padre setea el nombre programaticamente.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!session) return;
    const q = query.trim();
    // Solo buscamos si el query NO es exactamente el nombre del proveedor
    // ya seleccionado — eso evita re-buscar despues de un select.
    if (q.length < 2 || q === value) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      apiClient
        .get<ProveedorSearchHit[]>(
          `/proveedores/search?q=${encodeURIComponent(q)}&limit=8`,
          session,
        )
        .then((hits) => {
          if (!cancelled) {
            setResults(hits);
            setOpen(hits.length > 0);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, session, value]);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Si el usuario edita el nombre despues de seleccionar, limpiamos
          // el RUT para forzar nueva seleccion. Si vacía, limpia todo.
          if (e.target.value.trim() === "") {
            onClear();
          } else if (rutValue && e.target.value !== value) {
            onClear();
          }
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // delay para permitir click en el dropdown
          setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder ?? "Buscar proveedor…"}
        className="form-input"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-white dark:bg-ink-900 shadow-lg"
          role="listbox"
        >
          {results.map((hit) => (
            <li
              key={hit.proveedor_id}
              role="option"
              aria-selected={hit.razon_social === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(hit);
                setQuery(hit.razon_social);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-cehta-green/10"
            >
              <div className="font-medium text-ink-900 dark:text-ink-100">
                {hit.razon_social}
              </div>
              {hit.rut && (
                <div className="text-xs text-ink-500 font-mono">{hit.rut}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {searching && query.trim().length >= 2 && !open && (
        <p className="absolute -bottom-4 left-0 text-[10px] text-ink-400">
          Buscando…
        </p>
      )}
    </div>
  );
}
