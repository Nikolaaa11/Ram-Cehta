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
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
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
  Paperclip,
  FileText,
  Image as ImageIcon,
  X as XIcon,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import {
  useProveedoresCache,
  useFilterProveedores,
} from "@/hooks/use-proveedores-cache";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field-hint";
import { Currency } from "@/components/shared/Currency";
import { CuentaTypeahead } from "@/components/vouchers/CuentaTypeahead";

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
  // Spec maestro AJUSTE 6/12: factor IVA viene del backend (no hardcoded
  // 1.19). Si el SII cambia la tasa, se actualiza en el backend.
  iva_porcentaje?: number;
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [meta, setMeta] = useState<FormMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Round 6 — limites razonables de fecha para evitar typos catastroficos
  // (ej. 1900-01-01 o 2099-12-31 por dedo gordo). 5 anos atras cubre el
  // ciclo contable, 7d adelante cubre documentos emitidos con fecha futura
  // proxima (raro pero legitimo). Si el user necesita salirse de estos
  // limites, lo hace cambiando la fecha en otro flujo.
  const today = new Date().toISOString().slice(0, 10);
  const minDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10);
  })();
  const maxDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  // Round 33 — config persistente entre sesiones (separada del draft, que
  // se borra al crear). Guarda empresa+tipo_doc+forma_pago para que al
  // volver al form mañana ya estén pre-seleccionadas como ayer.
  // Si el browser bloquea localStorage, fallback silencioso a defaults.
  const LAST_CONFIG_KEY = "voucher-nubox-last-config-v1";
  type LastConfig = {
    empresa_codigo?: string;
    tipo_documento?: string;
    forma_pago?: string;
  };
  const lastConfig: LastConfig = (() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(LAST_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  const saveLastConfig = (cfg: LastConfig) => {
    try {
      window.localStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(cfg));
    } catch {
      // ignore (quota / private mode)
    }
  };

  // Header state
  const [empresaCodigo, setEmpresaCodigo] = useState(
    lastConfig.empresa_codigo ?? "",
  );
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState(
    lastConfig.tipo_documento ?? "FACTURA",
  );
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [formaPago, setFormaPago] = useState(
    lastConfig.forma_pago ?? "TRANSFERENCIA",
  );
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

  // Observaciones 14/05/2026 — adjuntar archivos directamente al crear.
  // Los archivos quedan en memoria hasta que el voucher se crea con éxito,
  // y después se suben uno por uno via POST /vouchers/{id}/attachments.
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; tipo: string }>
  >([]);
  const filePickerRef = useRef<HTMLInputElement | null>(null);

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
        if (saved.tipoDocumento) {
          // Restore drafts may carry legacy tipos (BOLETA/HONORARIOS/NA).
          const LEGACY_TIPOS = new Set(["BOLETA", "HONORARIOS", "NA"]);
          setTipoDocumento(
            LEGACY_TIPOS.has(saved.tipoDocumento) ? "FACTURA" : saved.tipoDocumento,
          );
        }
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

  // AJUSTE 13 — Cuadratura sobre Total Bruto.
  // Spec AJUSTE 6/12: factor IVA viene del backend (meta.iva_porcentaje),
  // no hardcodeado. Si SII cambia tasa 19%→X%, se actualiza ahí.
  const aplicaIvaTotales = meta?.tipos_documento_afectos_iva.includes(
    tipoDocumento,
  ) ?? false;
  const ivaFactor = 1 + (meta?.iva_porcentaje ?? 0.19);
  const toBruto = (neto: number) =>
    aplicaIvaTotales ? neto * ivaFactor : neto;

  const totalContableNeto = useMemo(
    () => contable.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [contable],
  );
  const totalFinancieraNeto = useMemo(
    () => financiera.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0),
    [financiera],
  );
  const totalContableBruto = useMemo(
    () =>
      contable.reduce(
        (sum, l) => sum + toBruto(parseFloat(l.total) || 0),
        0,
      ),
    // toBruto depende de aplicaIvaTotales, que viene de tipoDocumento/meta
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contable, aplicaIvaTotales],
  );
  const totalFinancieraBruto = useMemo(
    () =>
      financiera.reduce(
        (sum, l) => sum + toBruto(parseFloat(l.total) || 0),
        0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [financiera, aplicaIvaTotales],
  );

  // V5++ ola CJ — comparar floats con tolerancia (0.01) para evitar
  // `0.1+0.2 === 0.3 // false`. En CLP los montos son enteros normalmente
  // pero en UF/USD pueden tener decimales y romper el cuadre por epsilon.
  // AJUSTE 13: el cuadre se mide en Bruto (no en Neto).
  const cuadrado =
    totalContableBruto > 0 &&
    Math.abs(totalContableBruto - totalFinancieraBruto) < 0.01;

  // Round 36 — auto-llenar el total de la línea financiera cuando el
  // voucher es "simple" (1 línea contable + 1 línea financiera) y la
  // financiera todavía no tiene total. Cubre el caso ~80% del operador
  // diario: 1 cuenta de gasto + 1 cuenta de banco.
  //
  // Reglas para evitar pisar trabajo manual:
  //  - Solo aplica si ambas listas tienen exactamente 1 línea.
  //  - Solo si la línea financiera tiene total vacío o "0".
  //  - El total contable que se copia es el NETO (la línea financiera
  //    se llena en bruto cuando aplica IVA — eso lo maneja el cálculo
  //    `toBruto`, acá solo replicamos lo que el user tipeó).
  const contableTotalRaw = contable[0]?.total ?? "";
  const contableComentRaw = contable[0]?.comentario ?? "";
  useEffect(() => {
    if (contable.length !== 1 || financiera.length !== 1) return;
    const finExistente = (financiera[0]?.total ?? "").trim();
    if (finExistente && finExistente !== "0") return;
    if (!contableTotalRaw.trim()) return;
    setFinanciera((prev) => {
      const first = prev[0];
      if (!first) return prev;
      return [{ ...first, total: contableTotalRaw }];
    });
    // Solo dispara cuando cambia el monto contable o cantidades de líneas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contableTotalRaw, contable.length, financiera.length]);

  // Round 37 — auto-sync del COMENTARIO en el caso 1-1: cuando el operador
  // tipea el comentario contable, también espejarlo a la financiera si
  // ésta no tiene comentario propio. El comentario suele ser el mismo
  // ("Internet abril", "Honorarios mayo", etc.). Si el operador quiere
  // distinguir, tipea diferente en financiera y dejamos de tocarlo.
  useEffect(() => {
    if (contable.length !== 1 || financiera.length !== 1) return;
    const finCom = (financiera[0]?.comentario ?? "").trim();
    if (finCom) return; // ya tiene comentario propio, no pisar
    if (!contableComentRaw.trim()) return;
    setFinanciera((prev) => {
      const first = prev[0];
      if (!first) return prev;
      return [{ ...first, comentario: contableComentRaw }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contableComentRaw, contable.length, financiera.length]);

  // Round 37 — cuenta financiera recordada por (empresa, forma_pago).
  // Cuando el operador tiene 1 sola línea financiera con cuenta vacía,
  // sugerimos la última cuenta usada para esa combinación. Reduce otro
  // tipeo por voucher (el típico: empresa X + transferencia → 1101001).
  // Key: voucher-nubox-last-cuenta-fin::{empresa}::{forma_pago}
  const lastCuentaFinKey =
    empresaCodigo && formaPago
      ? `voucher-nubox-last-cuenta-fin::${empresaCodigo}::${formaPago}`
      : null;
  useEffect(() => {
    if (!lastCuentaFinKey) return;
    if (financiera.length !== 1) return;
    if ((financiera[0]?.cuenta_codigo ?? "").trim()) return;
    try {
      const lastCuenta = window.localStorage.getItem(lastCuentaFinKey);
      if (!lastCuenta) return;
      setFinanciera((prev) => {
        const first = prev[0];
        if (!first) return prev;
        return [{ ...first, cuenta_codigo: lastCuenta }];
      });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCuentaFinKey, financiera.length]);

  // Round 38 — cuenta CONTABLE recordada por (empresa, proveedor_rut).
  // Cuando el operador selecciona un proveedor del typeahead, si la línea
  // contable está vacía y existe un registro previo de cuenta usada para
  // ese (empresa, proveedor), la pre-cargamos. Ej: "AGEINSA" + "internet"
  // → cuenta 5103004. Es estable porque el mismo proveedor suele ir a la
  // misma cuenta de gasto.
  // Key: voucher-nubox-last-cuenta-cont::{empresa}::{proveedor_rut}
  const lastCuentaContKey =
    empresaCodigo && proveedorRut.trim().length >= 8
      ? `voucher-nubox-last-cuenta-cont::${empresaCodigo}::${proveedorRut.trim()}`
      : null;
  useEffect(() => {
    if (!lastCuentaContKey) return;
    if (contable.length !== 1) return;
    if ((contable[0]?.cuenta_codigo ?? "").trim()) return;
    try {
      const lastCuenta = window.localStorage.getItem(lastCuentaContKey);
      if (!lastCuenta) return;
      setContable((prev) => {
        const first = prev[0];
        if (!first) return prev;
        return [{ ...first, cuenta_codigo: lastCuenta }];
      });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCuentaContKey, contable.length]);

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

  // Round 32 — generación veloz de vouchers: si `createAnother=true`,
  // después de crear no navegamos a /vouchers/[id] sino que limpiamos
  // campos volátiles (numero_documento, proveedor, líneas, fecha_venc,
  // glosa, archivos) y dejamos los de "config" (empresa, tipo_doc,
  // forma_pago, fecha_documento) para encadenar otra carga rápida.
  const resetForCreateAnother = (lastCodigo: string) => {
    setNumeroDocumento("");
    setProveedorRut("");
    setProveedorNombre("");
    setFechaVencimiento("");
    setGlosa("");
    setDocumentoDropboxPath("");
    setContable([{ comentario: "", cuenta_codigo: "", total: "" }]);
    setFinanciera([{ comentario: "", cuenta_codigo: "", total: "" }]);
    setPendingFiles([]);
    setDuplicates([]);
    setProveedorLookup({ status: "idle" });
    // Foco al campo más probable de tipear primero (numero_documento).
    // Hace setTimeout(0) para que React monte el DOM limpio antes.
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[name="numero_documento"]',
      );
      el?.focus();
      el?.select();
    }, 0);
    // Toast persistente con link al voucher recién creado por si lo querés revisar.
    toast.success(
      `Voucher ${lastCodigo} creado · listo para cargar el siguiente`,
      { duration: 5000 },
    );
  };

  const handleSubmit = async (
    e: React.FormEvent,
    opts: { createAnother?: boolean } = {},
  ) => {
    e.preventDefault();
    const createAnother = opts.createAnother === true;
    if (!cuadrado) {
      // AJUSTE 13: el cuadre es sobre Bruto, no Neto.
      toast.error(
        "Σ Contable (Bruto) debe ser igual a Σ Financiera (Bruto)",
      );
      return;
    }
    setSubmitting(true);
    // Round 33 — antes de mandar, guardamos la "config" en localStorage
    // para que la próxima sesión arranque pre-seleccionada.
    saveLastConfig({
      empresa_codigo: empresaCodigo,
      tipo_documento: tipoDocumento,
      forma_pago: formaPago,
    });
    // Round 37 — guardar la cuenta financiera usada para esa empresa +
    // forma_pago, así la próxima vez se sugiere automáticamente.
    try {
      const lastCuenta = financiera[0]?.cuenta_codigo?.trim();
      if (
        empresaCodigo &&
        formaPago &&
        lastCuenta &&
        financiera.length === 1
      ) {
        window.localStorage.setItem(
          `voucher-nubox-last-cuenta-fin::${empresaCodigo}::${formaPago}`,
          lastCuenta,
        );
      }
    } catch {
      // ignore
    }
    // Round 38 — guardar la cuenta CONTABLE usada para esa empresa +
    // proveedor_rut, así al volver a cargar al mismo proveedor se sugiere.
    try {
      const lastCuentaCont = contable[0]?.cuenta_codigo?.trim();
      const rutTrim = proveedorRut.trim();
      if (
        empresaCodigo &&
        rutTrim.length >= 8 &&
        lastCuentaCont &&
        contable.length === 1
      ) {
        window.localStorage.setItem(
          `voucher-nubox-last-cuenta-cont::${empresaCodigo}::${rutTrim}`,
          lastCuentaCont,
        );
      }
    } catch {
      // ignore
    }
    try {
      const payload = {
        empresa_codigo: empresaCodigo,
        // Round 31 — proveedor opcional. Si está vacío, mandamos null y
        // el backend crea el voucher sin contraparte.
        proveedor_rut: proveedorRut.trim() || null,
        proveedor_nombre: proveedorNombre.trim() || null,
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
        // Round 31 — proveedor opcional. Cuando no se ingresa, ambos
        // campos vienen como null/false.
        proveedor_creado_automatico: boolean;
        proveedor_rut_canonical: string | null;
      }>("/vouchers/nubox-form", payload, session);

      // Observaciones 14/05/2026 — subir adjuntos seleccionados ahora que
      // tenemos voucher_id. Se sube uno por uno, si falla alguno seguimos
      // con los demás y reportamos al final.
      let attachedOk = 0;
      let attachedFail = 0;
      if (pendingFiles.length > 0) {
        const API_BASE =
          process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
        for (const pf of pendingFiles) {
          try {
            const fd = new FormData();
            fd.append("file", pf.file);
            fd.append("tipo", pf.tipo);
            const r = await fetch(
              `${API_BASE}/vouchers/${resp.voucher_id}/attachments`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session?.access_token ?? ""}`,
                },
                body: fd,
                cache: "no-store",
              },
            );
            if (r.ok) attachedOk++;
            else attachedFail++;
          } catch {
            attachedFail++;
          }
        }
      }

      // Round 31 — proveedor opcional. Si vino vacío, no decimos
      // "Proveedor X agregado al catálogo" (no se creó nada).
      const baseMsg =
        resp.proveedor_creado_automatico && proveedorNombre.trim()
          ? `Voucher ${resp.codigo} creado · Proveedor "${proveedorNombre.trim()}" agregado al catálogo`
          : `Voucher ${resp.codigo} creado en DRAFT`;
      const attachMsg =
        pendingFiles.length === 0
          ? ""
          : attachedFail === 0
            ? ` · ${attachedOk} adjunto${attachedOk === 1 ? "" : "s"} subido${attachedOk === 1 ? "" : "s"}`
            : ` · ${attachedOk} adjuntos OK, ${attachedFail} fallaron (subirlos manualmente)`;

      clearDraft();
      // Round 7 — SPA navigation + cache invalidation.
      // Antes: window.location.href forzaba full reload (pierde TanStack
      // cache, ~800ms+ a TTI). Ahora invalidamos las queries afectadas y
      // navegamos via router.push (instantaneo, mantiene state).
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["vouchers-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-state"] });
      // Round 44 — si el backend creó un proveedor nuevo, invalidar el
      // cache para que el typeahead lo encuentre la próxima vez.
      if (resp.proveedor_creado_automatico) {
        queryClient.invalidateQueries({ queryKey: ["proveedores", "cache"] });
      }

      // Round 32 — branch: si createAnother, reseteamos el form y nos
      // quedamos acá. Si no, navegamos al detalle del voucher recién creado.
      if (createAnother) {
        toast.success(baseMsg + attachMsg);
        resetForCreateAnother(resp.codigo);
      } else {
        toast.success(baseMsg + attachMsg);
        router.push(`/vouchers/${resp.voucher_id}` as Route);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al crear voucher",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Atajos de teclado:
  //  - Ctrl/Cmd+S        → Guardar (navega al detalle del voucher)
  //  - Ctrl/Cmd+Shift+S  → Guardar y crear otro (Round 32, queda en form)
  //  - Ctrl/Cmd+Enter    → Agregar línea contable (la mas usada)
  // El hook ignora el handler si el form todavia esta cargando metadata
  // o ya esta enviando.
  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (!submitting && cuadrado) {
        handleSubmit(new Event("submit") as unknown as React.FormEvent);
      }
    },
    "mod+shift+s": (e) => {
      e.preventDefault();
      if (!submitting && cuadrado) {
        handleSubmit(
          new Event("submit") as unknown as React.FormEvent,
          { createAnother: true },
        );
      }
    },
    "mod+enter": (e) => {
      e.preventDefault();
      if (!submitting) addLine("contable");
    },
  });

  // Round 34 — autofocus inteligente al cargar el form. Si ya tenemos
  // empresa pre-seleccionada (config persistente de Round 33), enfocamos
  // numero_documento (el campo que sí cambia). Si no, foco al combo
  // empresa. Skip si hay draft restaurado para no robarle foco al user
  // que está viendo qué tiene cargado.
  useEffect(() => {
    if (loading || !meta) return;
    if (hasSaved) return; // draft restaurado → respetar lo que tiene
    const t = window.setTimeout(() => {
      if (empresaCodigo) {
        const el = document.querySelector<HTMLInputElement>(
          'input[name="numero_documento"]',
        );
        el?.focus();
      } else {
        const el = document.querySelector<HTMLSelectElement>(
          'select[name="empresa_codigo"]',
        );
        el?.focus();
      }
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, meta, hasSaved]);

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
              · Atajos:{" "}
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">⌘S</kbd>{" "}
              guardar ·{" "}
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">⌘⇧S</kbd>{" "}
              guardar y crear otro ·{" "}
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono dark:bg-ink-800">⌘↵</kbd>{" "}
              agregar línea
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
                /* Round 34 — name="empresa_codigo" para que el autofocus
                   al cargar pueda enfocar este combo cuando no hay
                   empresa pre-seleccionada. */
                name="empresa_codigo"
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
              {/* Round 31 — proveedor OPCIONAL. Sin asterisco. */}
              <Label hint="Opcional. Si no tenés el dato a mano o es un gasto genérico (caja chica, servicios sin RUT), dejalo vacío.">
                Proveedor
              </Label>
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
                /* Round 32 — name="numero_documento" para que el reset
                   tras "Guardar y crear otro" pueda enfocar este campo
                   con querySelector. */
                name="numero_documento"
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value)}
                placeholder="12345"
                className="form-input"
              />
            </div>

            {/* Forma de pago */}
            <div>
              <Label hint="Cómo vas a pagar este voucher: transferencia bancaria (lo más común), cheque, contado o crédito. La opción TRANSFERENCIA habilita exportar al Excel masivo desde /transferencias.">
                Forma de pago *
              </Label>
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

            {/* Fechas — Round 6: min/max para prevenir typos (1900/2099). */}
            <div>
              <Label hint="Fecha que figura impresa en la factura/documento tributario. NO la fecha de pago. Usá la fecha de emisión real del proveedor.">
                Fecha documento *
              </Label>
              <input
                required
                type="date"
                value={fechaDocumento}
                min={minDate}
                max={maxDate}
                onChange={(e) => setFechaDocumento(e.target.value)}
                className="form-input"
              />
              <p className="mt-1 text-[10px] text-ink-500">
                Hoy: {today}. Permitido entre {minDate} y {maxDate}.
              </p>
            </div>
            <div>
              <Label hint="Fecha en que vence el plazo de pago según el documento. Si el proveedor dice 'pago a 30 días', sumá 30 días a la fecha del documento. Útil para alertas de vencimiento.">
                Fecha vencimiento (opcional)
              </Label>
              <input
                type="date"
                value={fechaVencimiento}
                min={fechaDocumento || minDate}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                className="form-input"
              />
              {fechaDocumento && (
                <p className="mt-1 text-[10px] text-ink-500">
                  Debe ser igual o posterior a la fecha del documento.
                </p>
              )}
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

            {/* Comentario (glosa) — Prompt maestro B.4: campo de 2 lineas
                visibles con scroll interno si se excede, manteniendo
                capacidad full del modelo (500 chars). NO truncar el dato,
                solo el área visible. */}
            <div className="md:col-span-2">
              <Label>Comentario (opcional — se autogenera si está vacío)</Label>
              <textarea
                value={glosa}
                onChange={(e) => setGlosa(e.target.value)}
                placeholder="Compra a {proveedor} folio {n}"
                rows={2}
                maxLength={500}
                className="form-input resize-none overflow-y-auto"
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
          ivaFactor={ivaFactor}
          empresaCodigo={empresaCodigo}
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
          ivaFactor={ivaFactor}
          empresaCodigo={empresaCodigo}
          onAdd={() => addLine("financiera")}
          onRemove={(i) => removeLine("financiera", i)}
          onUpdate={(i, f, v) => updateLine("financiera", i, f, v)}
        />

        {/* ADJUNTOS — Observaciones 14/05/2026 — selección antes de crear.
            Se suben automáticamente apenas el voucher se crea con éxito. */}
        <Surface className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Paperclip className="size-5 text-cehta-green" />
            <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
              Adjuntar archivos
            </h2>
            <span className="ml-auto text-xs text-ink-500">
              {pendingFiles.length}{" "}
              {pendingFiles.length === 1 ? "archivo seleccionado" : "archivos seleccionados"}
            </span>
          </div>
          <p className="text-[11px] text-ink-500 mb-3">
            Adjuntá factura, boleta, contrato o cualquier respaldo. Los archivos
            se suben automáticamente al crear el voucher y se anexan en el PDF
            final (cuando lo descargues).
          </p>

          {/* Lista de archivos pendientes */}
          {pendingFiles.length > 0 && (
            <ul className="mb-3 space-y-2">
              {pendingFiles.map((pf, idx) => {
                const Icon = pf.file.type.startsWith("image/")
                  ? ImageIcon
                  : pf.file.type.includes("pdf")
                    ? FileText
                    : Paperclip;
                const sizeKb = (pf.file.size / 1024).toFixed(1);
                return (
                  <li
                    key={idx}
                    className="group flex items-center gap-3 rounded-xl border border-hairline bg-ink-50/30 px-3 py-2"
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-ink-400"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {pf.file.name}
                      </p>
                      <p className="text-[10px] text-ink-500">
                        <span className="rounded bg-cehta-green/10 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-cehta-green">
                          {pf.tipo}
                        </span>{" "}
                        · {sizeKb} KB
                      </p>
                    </div>
                    <select
                      value={pf.tipo}
                      onChange={(e) =>
                        setPendingFiles((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, tipo: e.target.value } : p,
                          ),
                        )
                      }
                      className="rounded-lg border-0 bg-white px-2 py-1 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                    >
                      <option value="FACTURA">Factura</option>
                      <option value="BOLETA">Boleta</option>
                      <option value="CONTRATO">Contrato</option>
                      <option value="COTIZACION">Cotización</option>
                      <option value="TRANSFERENCIA">Comprobante transferencia</option>
                      <option value="LIQUIDACION_SUELDO">Liquidación de sueldo</option>
                      <option value="ACTA">Acta</option>
                      <option value="RESPALDO_TECNICO">Respaldo técnico</option>
                      <option value="OTRO">Otro</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-negative hover:bg-negative/10"
                      aria-label="Quitar archivo"
                    >
                      <XIcon className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <input
            ref={filePickerRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length === 0) return;
              setPendingFiles((prev) => [
                ...prev,
                ...files.map((f) => ({
                  file: f,
                  tipo:
                    tipoDocumento.startsWith("FACTURA")
                      ? "FACTURA"
                      : tipoDocumento.startsWith("BOLETA")
                        ? "BOLETA"
                        : tipoDocumento.includes("NOTA_CREDITO")
                          ? "OTRO"
                          : "FACTURA",
                })),
              ]);
              if (filePickerRef.current) filePickerRef.current.value = "";
            }}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => filePickerRef.current?.click()}
          >
            <Paperclip className="size-4 mr-2" />
            Seleccionar archivos
          </Button>
          <p className="mt-2 text-[10px] italic text-ink-400">
            Max 50 MB cada uno · PDF, JPG, PNG, Excel, Word
          </p>
        </Surface>

        {/* FOOTER: totales + submit
            AJUSTE 13 — Mostramos Neto y Bruto en cada card. El cuadre se
            mide sobre Bruto (la columna de la derecha es la que tiene que
            empatar). El badge de cuadre y el botón de submit usan `cuadrado`
            calculado en Bruto. */}
        <Surface className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4" aria-live="polite">
            <div className="rounded border border-ink-200 dark:border-ink-800 p-3 bg-white dark:bg-ink-900">
              <div className="text-xs text-ink-500">Σ Contable</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Neto:</span>
                <Currency value={totalContableNeto} size="md" />
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Bruto:</span>
                <Currency value={totalContableBruto} size="lg" />
              </div>
            </div>
            <div className="rounded border border-ink-200 dark:border-ink-800 p-3 bg-white dark:bg-ink-900">
              <div className="text-xs text-ink-500">Σ Financiera</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Neto:</span>
                <Currency value={totalFinancieraNeto} size="md" />
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Bruto:</span>
                <Currency value={totalFinancieraBruto} size="lg" />
              </div>
            </div>
            <div className="rounded border border-ink-200 dark:border-ink-800 p-3 bg-white dark:bg-ink-900">
              <div className="text-xs text-ink-500">Diferencia</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Neto:</span>
                <Currency
                  value={totalContableNeto - totalFinancieraNeto}
                  size="md"
                />
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-500">Bruto:</span>
                <Currency
                  value={totalContableBruto - totalFinancieraBruto}
                  size="lg"
                  tone={cuadrado ? "success" : "danger"}
                />
              </div>
            </div>
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
                  Descuadrado en Bruto — corregí líneas antes de enviar
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Round 32 — generación veloz. "Guardar y crear otro"
                  preserva empresa+tipo_doc+forma_pago+fecha para encadenar
                  cargas rápidas sin navegar. Atajo: Ctrl/Cmd+Shift+S. */}
              <Button
                type="button"
                variant="ghost"
                disabled={!cuadrado || submitting}
                onClick={() =>
                  handleSubmit(
                    new Event("submit") as unknown as React.FormEvent,
                    { createAnother: true },
                  )
                }
                title="Guardar este voucher y limpiar el form para cargar el siguiente (Ctrl/Cmd+Shift+S)"
              >
                <Save className="size-4 mr-2" />
                {submitting ? "Creando…" : "Guardar y crear otro"}
                <kbd className="ml-2 hidden md:inline rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-mono text-ink-600">
                  ⌘⇧S
                </kbd>
              </Button>
              <Button
                type="submit"
                disabled={!cuadrado || submitting}
                className="px-6"
                title="Guardar el voucher y abrir su detalle (Ctrl/Cmd+S)"
              >
                <Save className="size-4 mr-2" />
                {submitting ? "Creando…" : "Crear voucher DRAFT"}
              </Button>
            </div>
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

function Label({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-xs font-medium text-ink-700 dark:text-ink-300 mb-1">
      <span className="inline-flex items-center gap-1.5">
        {children}
        {hint && <FieldHint text={hint} />}
      </span>
    </label>
  );
}

function LineSection({
  title,
  tone,
  lines,
  tipoDocumento,
  tiposAfectosIva,
  ivaFactor,
  empresaCodigo,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  tone: "contable" | "financiera";
  lines: LineRow[];
  tipoDocumento: string;
  tiposAfectosIva: string[];
  /** Spec maestro AJUSTE 6/12: factor IVA del backend, ej 1.19. */
  ivaFactor: number;
  /** AJUSTE 10: empresa para filtrar plan de cuentas en el typeahead. */
  empresaCodigo: string;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof LineRow, value: string) => void;
}) {
  const Icon = tone === "contable" ? Receipt : CreditCard;
  // V5++ ola CH C.1.5/C.2.5: Total Bruto = Neto si exento, Neto*factor si
  // afecto. Backend marca qué tipos llevan IVA en tiposAfectosIva, y el
  // factor IVA viene de meta.iva_porcentaje (no hardcoded — spec maestro).
  const aplicaIva = tiposAfectosIva.includes(tipoDocumento);

  const formatBruto = (neto: number): string => {
    if (!neto || neto === 0) return "—";
    const bruto = aplicaIva ? neto * ivaFactor : neto;
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

      {/* AJUSTE 1: en mobile la tabla scrollea horizontal (min-w 768px)
          en vez de romper layout. Columnas en %: # 4 / Coment 30 / Cuenta 35
          / Neto 13 / Bruto 13 / 🗑 ~5 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[768px]">
          <thead className="text-ink-500 text-xs uppercase">
            <tr>
              <th className="text-left px-2 py-1.5 w-12">#</th>
              <th className="text-left px-2 py-1.5 w-[30%]">Comentario *</th>
              <th className="text-left px-2 py-1.5 w-[35%]">Plan de Cuenta *</th>
              <th className="text-right px-2 py-1.5 w-[13%]">Total Neto *</th>
              <th
                className="text-right px-2 py-1.5 w-[13%]"
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
                    {/* Prompt maestro C.1.6/C.2.6: comentario de línea — 2 líneas
                        visibles con scroll interno, capacidad full (500). */}
                    <textarea
                      required
                      value={line.comentario}
                      onChange={(e) =>
                        onUpdate(idx, "comentario", e.target.value)
                      }
                      placeholder="Descripción"
                      rows={2}
                      maxLength={500}
                      className="form-input resize-none overflow-y-auto"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* AJUSTE 10: combobox typeahead reemplaza al input plano. */}
                    <CuentaTypeahead
                      required
                      value={line.cuenta_codigo}
                      onChange={(codigo) =>
                        onUpdate(idx, "cuenta_codigo", codigo)
                      }
                      empresaCodigo={empresaCodigo}
                      tone={tone}
                      placeholder="Código o nombre…"
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
      </div>
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
// Typeahead Proveedor — V5++ ola CH B.2/B.3 — Round 44 (client-side cache)
// ---------------------------------------------------------------------
// Antes: input con debounce 300ms + GET /proveedores/search?q=... por
//        cada keystroke. Lento si la red está saturada.
// Ahora: useProveedoresCache() trae los ~228 proveedores activos UNA vez
//        (cacheado 5min con TanStack Query) y la búsqueda es 100%
//        client-side — instantánea, 0 round-trips después de la carga.
//
// Beneficios:
//   · Búsqueda mientras tipea sin lag perceptible
//   · Focus en input sin texto → muestra primeros 8 alfabético (descubrimiento)
//   · Match en razón_social O RUT (sin necesidad de saber qué tipeas)
//   · RUT normaliza puntos/guiones — "12345678" matchea "12.345.678-9"
//
// Si el operador escribe un proveedor que no aparece en la lista, el
// padre asume nuevo y el backend autocrea al guardar (path original).

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
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  // Round 49 — índice del item resaltado para navegación con flechas.
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const { isLoading: cacheLoading } = useProveedoresCache();

  // Round 44 — search local sobre cache.
  // Si el query es exactamente el nombre ya seleccionado, no resultados
  // (evita mostrar dropdown vacío tras select).
  const searchQuery = query.trim() === value.trim() ? "" : query;
  const { results, cacheSize } = useFilterProveedores(searchQuery, 8);

  // Sync exterior -> interior cuando el padre setea el nombre programaticamente.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Round 49 — reset del highlight cuando cambian los resultados (nuevo query).
  useEffect(() => {
    setHighlightedIdx(0);
  }, [searchQuery, results.length]);

  // Round 49 — handler para teclas dentro del input. Navega el dropdown sin
  // tocar el mouse: ↓/↑ mueve highlight, Enter selecciona el resaltado,
  // Esc cierra el dropdown.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[highlightedIdx];
      if (hit) {
        onSelect({
          proveedor_id: hit.proveedor_id,
          razon_social: hit.razon_social,
          rut: hit.rut,
        });
        setQuery(hit.razon_social);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

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
          // Cuando empieza a tipear, abrir dropdown.
          if (e.target.value.trim()) setOpen(true);
        }}
        onFocus={() => {
          // Round 44 — abrir dropdown apenas hay foco. Si no hay query,
          // useFilterProveedores devuelve los primeros 8 = descubrimiento.
          setOpen(true);
        }}
        onBlur={() => {
          // delay para permitir click en el dropdown
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          placeholder ??
          (cacheLoading
            ? "Cargando catálogo…"
            : cacheSize > 0
              ? `Buscar entre ${cacheSize} proveedores…`
              : "Buscar proveedor…")
        }
        className="form-input"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-activedescendant={
          open && results[highlightedIdx]
            ? `prov-opt-${results[highlightedIdx]?.proveedor_id}`
            : undefined
        }
      />
      {open && results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-white dark:bg-ink-900 shadow-lg"
          role="listbox"
        >
          {results.map((hit, idx) => {
            const isHighlighted = idx === highlightedIdx;
            return (
              <li
                key={hit.proveedor_id}
                id={`prov-opt-${hit.proveedor_id}`}
                role="option"
                aria-selected={hit.razon_social === value}
                onMouseEnter={() => setHighlightedIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect({
                    proveedor_id: hit.proveedor_id,
                    razon_social: hit.razon_social,
                    rut: hit.rut,
                  });
                  setQuery(hit.razon_social);
                  setOpen(false);
                }}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  isHighlighted
                    ? "bg-cehta-green/15"
                    : "hover:bg-cehta-green/10"
                }`}
              >
                <div className="font-medium text-ink-900 dark:text-ink-100">
                  {hit.razon_social}
                </div>
                <div className="flex items-baseline gap-2 text-xs text-ink-500">
                  {hit.rut && (
                    <span className="font-mono">{hit.rut}</span>
                  )}
                  {/* Round 47 — direccion opcional para desambiguar */}
                  {hit.direccion && (
                    <span className="truncate text-ink-400">
                      · {hit.direccion}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
