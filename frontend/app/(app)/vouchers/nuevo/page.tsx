"use client";

import type { Route } from "next";

/**
 * /vouchers/nuevo
 *
 * Form Apple-tier para crear un voucher. La pieza más compleja del módulo.
 *
 * Layout:
 *   1. Header del voucher (tipo, empresa, fechas, glosa, contraparte,
 *      doc tributario si COMPRA/VENTA)
 *   2. Tabla de líneas dinámicas (add/remove) con imputación triple
 *      por línea (cuenta + proyecto + área) y debit/credit
 *   3. Footer con Σ debit / Σ credit live + delta + indicador de
 *      cuadre + 2 botones (Guardar borrador / Enviar a aprobación)
 *
 * Validaciones live:
 *   - debit XOR credit por línea
 *   - Σ debit == Σ credit (badge rojo si descuadra)
 *   - Solo cuentas imputables (filtradas en el selector)
 *   - Solo proyectos de la empresa elegida
 *   - Solo áreas que aplican a la empresa
 *   - COMPRA/VENTA exigen doc_tributario_tipo + folio
 *
 * Si guardás como DRAFT, el descuadre es OK (terminás después).
 * Si enviás directamente a PENDING, el backend rechaza con error legible.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { extractMontoFromText, extractRutFromText } from "@/lib/extract";
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import { toast } from "@/components/ui/toast";
import { Currency } from "@/components/shared/Currency";
import type {
  Area,
  ContraparteTipo,
  DocTributarioTipo,
  PlanCuenta,
  ProyectoContable,
  VoucherTipo,
} from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

interface LineDraft {
  // ID local solo para react keys — no es line_id real
  localId: string;
  cuenta_codigo: string;
  proyecto_codigo: string;
  area_codigo: string;
  debit: string;
  credit: string;
  descripcion: string;
}

const TIPOS: { value: VoucherTipo; label: string; needsCounterparty: boolean; needsTaxDoc: boolean; needsBank: boolean }[] = [
  { value: "INGRESO", label: "Ingreso (cobro)", needsCounterparty: true, needsTaxDoc: false, needsBank: true },
  { value: "EGRESO", label: "Egreso (pago)", needsCounterparty: true, needsTaxDoc: false, needsBank: true },
  { value: "TRASPASO", label: "Traspaso (interno)", needsCounterparty: false, needsTaxDoc: false, needsBank: false },
  { value: "COMPRA", label: "Compra (factura recibida)", needsCounterparty: true, needsTaxDoc: true, needsBank: false },
  { value: "VENTA", label: "Venta (factura emitida)", needsCounterparty: true, needsTaxDoc: true, needsBank: false },
  { value: "APERTURA", label: "Apertura (saldo inicial)", needsCounterparty: false, needsTaxDoc: false, needsBank: false },
  { value: "CIERRE", label: "Cierre (resultados)", needsCounterparty: false, needsTaxDoc: false, needsBank: false },
];

const newLine = (): LineDraft => ({
  localId: crypto.randomUUID(),
  cuenta_codigo: "",
  proyecto_codigo: "",
  area_codigo: "",
  debit: "",
  credit: "",
  descripcion: "",
});

export default function NuevoVoucherPage() {
  const { session } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  // Pre-fill desde URL params (caso típico: deeplink desde /admin/mailbox)
  const initialTipo = (params.get("tipo") as VoucherTipo) ?? "EGRESO";
  const initialGlosa = params.get("glosa") ?? "";
  const fromEmailId = params.get("from_email");

  // Header state
  const [tipo, setTipo] = useState<VoucherTipo>(initialTipo);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [fechaDocumento, setFechaDocumento] = useState(today);
  const [fechaContable, setFechaContable] = useState(today);
  const [glosa, setGlosa] = useState(initialGlosa);
  const [contraparteRut, setContraparteRut] = useState("");
  const [contraparteNombre, setContraparteNombre] = useState("");
  const [contraparteTipo, setContraparteTipo] = useState<ContraparteTipo>("PROVEEDOR");
  const [docTributarioTipo, setDocTributarioTipo] = useState<DocTributarioTipo>("FACTURA");
  const [docTributarioFolio, setDocTributarioFolio] = useState("");
  const [banco, setBanco] = useState("");
  const [bancoCuentaAlias, setBancoCuentaAlias] = useState("");

  // Lines state
  const [lines, setLines] = useState<LineDraft[]>([
    { ...newLine() },
    { ...newLine() },
  ]);

  // V5+ AI auto-fill: si vino con `?from_email=ID`, fetcheamos el email
  // y pre-llenamos contraparte (RUT/nombre), monto sugerido, glosa.
  // El user revisa y confirma — nunca enviamos a aprobación automático.
  const { data: emailData } = useQuery<{
    from_email: string;
    from_name: string | null;
    subject: string;
    body_text: string | null;
    ai_summary: string | null;
    ai_suggested_action: string | null;
  }>({
    queryKey: ["mailbox-detail-for-voucher", fromEmailId],
    queryFn: () =>
      apiClient.get(`/admin/mailbox/${fromEmailId}`, session),
    enabled: !!session && !!fromEmailId,
    staleTime: 5 * 60_000,
  });

  // Cuando llegan los datos del email, auto-llenar campos vacíos.
  // Solo llenamos si el campo está vacío para no pisar lo que el user editó.
  useEffect(() => {
    if (!emailData) return;

    const haystack = [
      emailData.subject,
      emailData.body_text ?? "",
      emailData.ai_summary ?? "",
    ].join("\n");

    // Glosa: usar resumen AI si existe, sino subject
    if (!glosa) {
      setGlosa(emailData.ai_summary?.slice(0, 200) ?? emailData.subject);
    }

    // Contraparte: nombre del remitente
    if (!contraparteNombre && emailData.from_name) {
      setContraparteNombre(emailData.from_name);
    }

    // RUT detectado en el cuerpo
    if (!contraparteRut) {
      const rutFound = extractRutFromText(haystack);
      if (rutFound) setContraparteRut(rutFound);
    }

    // Monto detectado → pre-llenar como CRÉDITO en la primera línea
    // (porque tipo COMPRA/EGRESO típicamente debita gastos y acredita
    // proveedor). El user ajusta si no aplica.
    const montoFound = extractMontoFromText(haystack);
    if (montoFound && lines.length >= 1 && !lines[0]!.credit && !lines[0]!.debit) {
      setLines((prev) => {
        const next = [...prev];
        next[0] = { ...next[0]!, credit: String(montoFound) };
        return next;
      });
    }
    // intencional: solo corre cuando llega emailData; no incluir lines/etc
    // porque queremos que el user pueda editar sin que se sobrescriba.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailData?.subject]);

  const [submitting, setSubmitting] = useState(false);

  // V5++ ola CE — Warning + shortcuts UX. No autosave aqui porque el state
  // tiene N lineas con FKs (cuenta+proyecto+area) que requieren re-fetch al
  // restaurar; preferimos no-restore que restore-incorrecto.
  const isDirty =
    glosa.trim().length > 0 ||
    contraparteRut.trim().length > 0 ||
    contraparteNombre.trim().length > 0 ||
    docTributarioFolio.trim().length > 0 ||
    lines.some(
      (l) =>
        l.cuenta_codigo ||
        l.debit ||
        l.credit ||
        (l.descripcion ?? "").trim(),
    );
  useUnsavedChangesWarning(isDirty && !submitting);

  // Cmd/Ctrl+S guarda como DRAFT (menos arriesgado que enviar a PENDING
  // sin querer). El user usa el boton azul para enviar.
  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (!submitting) submit("DRAFT");
    },
  });

  const tipoMeta = TIPOS.find((t) => t.value === tipo)!;

  // Empresas — SCOPE FIX (Observaciones 13/05/2026 #1): un contador no debe
  // ver empresas que no le corresponden en el dropdown. Antes usaba /empresa
  // (lista plana sin filtro). Ahora usa /me/empresas que ya filtra por
  // core.user_company_roles + agrega admin global override.
  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["me", "empresas", "for-voucher-form"],
    queryFn: async () => {
      const resp = await apiClient.get<{
        empresas: Array<{ codigo: string; razon_social: string }>;
      }>("/me/empresas", session);
      return resp.empresas.map((e) => ({
        codigo: e.codigo,
        razon_social: e.razon_social,
      }));
    },
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  // Set default empresa al cargar
  useEffect(() => {
    if (!empresaCodigo && empresas && empresas.length > 0) {
      const first = empresas[0];
      if (first) setEmpresaCodigo(first.codigo);
    }
  }, [empresas, empresaCodigo]);

  // Cuentas imputables filtradas por empresa
  const { data: cuentas } = useQuery<PlanCuenta[]>({
    queryKey: ["plan-cuentas-imputables", empresaCodigo],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("imputable", "true");
      qs.set("activa", "true");
      if (empresaCodigo) qs.set("empresa_codigo", empresaCodigo);
      return apiClient.get<PlanCuenta[]>(
        `/plan-cuentas?${qs}`,
        session,
      );
    },
    enabled: !!session && !!empresaCodigo,
  });

  // Proyectos de la empresa
  const { data: proyectos } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-empresa", empresaCodigo],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("empresa_codigo", empresaCodigo);
      qs.set("estado", "ACTIVE");
      return apiClient.get<ProyectoContable[]>(
        `/proyectos-contables?${qs}`,
        session,
      );
    },
    enabled: !!session && !!empresaCodigo,
  });

  // Áreas que aplican a la empresa
  const { data: areas } = useQuery<Area[]>({
    queryKey: ["areas-empresa", empresaCodigo],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("empresa_codigo", empresaCodigo);
      qs.set("only_active", "true");
      return apiClient.get<Area[]>(`/areas?${qs}`, session);
    },
    enabled: !!session && !!empresaCodigo,
  });

  // Sumas live
  const totalDebit = useMemo(
    () =>
      lines.reduce(
        (acc, l) => acc + (Number(l.debit) || 0),
        0,
      ),
    [lines],
  );
  const totalCredit = useMemo(
    () =>
      lines.reduce(
        (acc, l) => acc + (Number(l.credit) || 0),
        0,
      ),
    [lines],
  );
  const delta = totalDebit - totalCredit;
  const isBalanced = Math.abs(delta) < 0.01 && totalDebit > 0;

  const updateLine = (localId: string, patch: Partial<LineDraft>) => {
    setLines((prev) =>
      prev.map((l) =>
        l.localId === localId
          ? {
              ...l,
              ...patch,
              // mutex debit/credit: tipear en uno limpia el otro
              ...(patch.debit !== undefined && Number(patch.debit) > 0
                ? { credit: "" }
                : {}),
              ...(patch.credit !== undefined && Number(patch.credit) > 0
                ? { debit: "" }
                : {}),
            }
          : l,
      ),
    );
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (localId: string) =>
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.localId !== localId),
    );

  const submit = async (
    targetStatus: "DRAFT" | "PENDING",
    e?: React.FormEvent,
  ) => {
    e?.preventDefault();
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    if (!empresaCodigo) {
      toast.error("Elegí una empresa");
      return;
    }
    if (glosa.trim().length < 5) {
      toast.error("La glosa debe tener al menos 5 caracteres");
      return;
    }
    if (lines.length === 0) {
      toast.error("Agregá al menos una línea");
      return;
    }

    // Validar líneas: cuenta + debit XOR credit
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (!l.cuenta_codigo) {
        toast.error(`Línea ${i + 1}: elegí una cuenta`);
        return;
      }
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      if (d > 0 && c > 0) {
        toast.error(`Línea ${i + 1}: debe O haber, no ambos`);
        return;
      }
      if (d === 0 && c === 0) {
        toast.error(`Línea ${i + 1}: ingresá un monto en debe o haber`);
        return;
      }
    }

    if (targetStatus === "PENDING" && !isBalanced) {
      toast.error(
        `Partida doble descuadrada · debe=${totalDebit.toLocaleString("es-CL")} ` +
          `vs haber=${totalCredit.toLocaleString("es-CL")}. ` +
          `Guardá como borrador o cuadrá las líneas antes de enviar.`,
      );
      return;
    }

    if (tipoMeta.needsTaxDoc && !docTributarioFolio.trim()) {
      toast.error(`${tipoMeta.label}: ingresá el folio del documento tributario`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        empresa_codigo: empresaCodigo,
        tipo,
        status: targetStatus,
        fecha_documento: fechaDocumento,
        fecha_contable: fechaContable,
        glosa: glosa.trim(),
        moneda: "CLP",
        contraparte_rut: contraparteRut.trim() || null,
        contraparte_nombre: contraparteNombre.trim() || null,
        contraparte_tipo: tipoMeta.needsCounterparty ? contraparteTipo : null,
        doc_tributario_tipo: tipoMeta.needsTaxDoc ? docTributarioTipo : null,
        doc_tributario_folio: tipoMeta.needsTaxDoc ? docTributarioFolio.trim() : null,
        banco: tipoMeta.needsBank ? banco.trim() || null : null,
        banco_cuenta_alias: tipoMeta.needsBank ? bancoCuentaAlias.trim() || null : null,
        threshold_aplicado: false, // backend lo recalcula en Fase 2
        lines: lines.map((l, i) => ({
          line_number: i + 1,
          cuenta_codigo: l.cuenta_codigo,
          proyecto_codigo: l.proyecto_codigo || null,
          area_codigo: l.area_codigo || null,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          descripcion: l.descripcion.trim() || null,
          balance_treatment: "NA",
        })),
      };

      const result = await apiClient.post<{ voucher_id: number; codigo: string }>(
        "/vouchers",
        payload,
        session,
      );

      toast.success(
        `Voucher ${result.codigo} ${targetStatus === "DRAFT" ? "guardado en borrador" : "enviado a aprobación"}`,
      );
      router.push(`/vouchers/${result.voucher_id}` as Route);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Error desconocido";
      toast.error(msg, { duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-8 pb-32 space-y-6">
        {/* Breadcrumb + header */}
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="group inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-400 hover:text-cehta-green"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" strokeWidth={2} />
            Volver
          </button>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[36px]">
            Nuevo voucher
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Encabezado + N líneas con imputación triple. La partida doble se
            valida en vivo — no podés enviar a aprobación con descuadre.
          </p>
          {fromEmailId && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cehta-green/30 bg-cehta-green/5 px-3 py-2 text-xs text-cehta-green">
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>
                Pre-llenado desde inbox · email #{fromEmailId} · al guardar
                queda DRAFT. Linkealo desde el inbox cuando termines.
              </span>
            </div>
          )}
        </div>

        <form onSubmit={(e) => submit("PENDING", e)} className="space-y-6">
          {/* Header del voucher */}
          <div className="rounded-3xl border border-hairline bg-white p-6 shadow-card">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Encabezado
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Tipo de voucher" required>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as VoucherTipo)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Empresa" required>
                <select
                  value={empresaCodigo}
                  onChange={(e) => {
                    setEmpresaCodigo(e.target.value);
                    // limpiar líneas cuando cambia empresa (FKs cambian)
                    setLines((prev) =>
                      prev.map((l) => ({
                        ...l,
                        cuenta_codigo: "",
                        proyecto_codigo: "",
                        area_codigo: "",
                      })),
                    );
                  }}
                  required
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  <option value="">— Elegir —</option>
                  {(empresas ?? []).map((e) => (
                    <option key={e.codigo} value={e.codigo}>
                      {e.codigo} — {e.razon_social}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Moneda">
                <input
                  type="text"
                  value="CLP"
                  disabled
                  className="w-full rounded-xl border-0 bg-ink-100 px-3 py-2 text-sm text-ink-500 ring-1 ring-hairline"
                />
              </Field>

              <Field label="Fecha documento" required>
                <input
                  type="date"
                  required
                  value={fechaDocumento}
                  onChange={(e) => setFechaDocumento(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              <Field label="Fecha contable" required>
                <input
                  type="date"
                  required
                  value={fechaContable}
                  onChange={(e) => setFechaContable(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Glosa (descripción del asiento)" required>
                  {/* Prompt maestro B.4: campo de 2 lineas visibles con scroll
                      interno si se excede, capacidad full (no truncar dato). */}
                  <textarea
                    required
                    minLength={5}
                    value={glosa}
                    onChange={(e) => setGlosa(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Ej: Pago factura 12345 — Servicios consultoría enero RHO"
                    className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green resize-none overflow-y-auto"
                  />
                </Field>
              </div>
            </div>

            {/* Contraparte (si aplica) — Observaciones 13/05/2026 #3,#4:
                cuando es PROVEEDOR + COMPRA, usamos typeahead contra el
                catálogo de proveedores con auto-completado de RUT. Para
                otros tipos (CLIENTE/BANCO/INTERNO/OTRO) mantenemos input
                libre. */}
            {tipoMeta.needsCounterparty && (
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-2xl bg-ink-50/40 p-4">
                <p className="sm:col-span-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  Contraparte
                </p>
                <Field label="Tipo">
                  <select
                    value={contraparteTipo}
                    onChange={(e) => setContraparteTipo(e.target.value as ContraparteTipo)}
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  >
                    <option value="PROVEEDOR">Proveedor</option>
                    <option value="CLIENTE">Cliente</option>
                    <option value="EMPLEADO">Empleado</option>
                    <option value="BANCO">Banco</option>
                    <option value="INTERNO">Interno</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </Field>
                {contraparteTipo === "PROVEEDOR" ? (
                  <>
                    <Field label="Nombre (buscar en catálogo)">
                      <ProveedorTypeaheadNuevo
                        value={contraparteNombre}
                        rutValue={contraparteRut}
                        onSelect={(hit) => {
                          setContraparteNombre(hit.razon_social);
                          setContraparteRut(hit.rut ?? "");
                        }}
                        onClear={() => {
                          setContraparteNombre("");
                          setContraparteRut("");
                        }}
                      />
                    </Field>
                    <Field label="RUT (auto-completa)">
                      <input
                        type="text"
                        value={contraparteRut}
                        readOnly={!!contraparteNombre && !!contraparteRut}
                        onChange={(e) => setContraparteRut(e.target.value)}
                        placeholder="Se completa al seleccionar"
                        className="w-full rounded-xl border-0 bg-ink-100 px-3 py-2 text-sm ring-1 ring-hairline read-only:cursor-not-allowed read-only:text-ink-600 focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                <Field label="RUT">
                  <input
                    type="text"
                    value={contraparteRut}
                    onChange={(e) => setContraparteRut(e.target.value)}
                    placeholder="76.123.456-7"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </Field>
                <Field label="Nombre">
                  <input
                    type="text"
                    value={contraparteNombre}
                    onChange={(e) => setContraparteNombre(e.target.value)}
                    placeholder="Razón social"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </Field>
                  </>
                )}
              </div>
            )}

            {/* Doc tributario (si COMPRA/VENTA) */}
            {tipoMeta.needsTaxDoc && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-2xl bg-amber-50/50 p-4 ring-1 ring-amber-200">
                <p className="sm:col-span-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">
                  Documento tributario · obligatorio
                </p>
                <Field label="Tipo">
                  <select
                    value={docTributarioTipo}
                    onChange={(e) => setDocTributarioTipo(e.target.value as DocTributarioTipo)}
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  >
                    <option value="FACTURA">FACTURA</option>
                    <option value="BOLETA">BOLETA</option>
                    <option value="NOTA_CREDITO">NOTA DE CREDITO</option>
                    <option value="NOTA_DEBITO">NOTA DE DEBITO</option>
                    <option value="HONORARIOS">BOLETA HONORARIOS</option>
                  </select>
                </Field>
                <Field label="Folio" required>
                  <input
                    type="text"
                    required={tipoMeta.needsTaxDoc}
                    value={docTributarioFolio}
                    onChange={(e) => setDocTributarioFolio(e.target.value)}
                    placeholder="12345"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </Field>
                <p className="sm:col-span-3 text-right text-[11px] text-ink-500">
                  Para los 15 tipos SII completos (FACTURA DE COMPRA, FACTURA ELECTRONICA, etc.) usá el{" "}
                  <Link href="/vouchers/nubox" className="font-medium text-cehta-green hover:underline">
                    Form Nubox
                  </Link>
                  .
                </p>
              </div>
            )}

            {/* Banco (si INGRESO/EGRESO) */}
            {tipoMeta.needsBank && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-2xl bg-ink-50/40 p-4">
                <p className="sm:col-span-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  Cuenta bancaria
                </p>
                <Field label="Banco">
                  <input
                    type="text"
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                    placeholder="BCI · Santander · Banco Estado"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </Field>
                <Field label="Cuenta · alias">
                  <input
                    type="text"
                    value={bancoCuentaAlias}
                    onChange={(e) => setBancoCuentaAlias(e.target.value)}
                    placeholder="Operativa CSL"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Líneas */}
          <div className="rounded-3xl border border-hairline bg-white p-6 shadow-card">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Líneas del asiento · imputación triple
              </p>
              <p className="text-[11px] text-ink-500">
                Cada línea: cuenta · proyecto · área · cargo O abono
              </p>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  <tr>
                    <th className="w-8 pb-2">#</th>
                    <th className="pb-2">Plan de Cuenta</th>
                    <th className="pb-2">Proyecto</th>
                    <th className="pb-2">Área</th>
                    <th className="pb-2 text-right">Cargo</th>
                    <th className="pb-2 text-right">Abono</th>
                    <th className="w-8 pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.localId} className="border-t border-hairline/50">
                      <td className="py-2 text-xs text-ink-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={l.cuenta_codigo}
                          onChange={(e) =>
                            updateLine(l.localId, { cuenta_codigo: e.target.value })
                          }
                          className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                        >
                          <option value="">— Elegir cuenta —</option>
                          {(cuentas ?? []).map((c) => (
                            <option key={c.codigo} value={c.codigo}>
                              {c.codigo} · {c.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={l.proyecto_codigo}
                          onChange={(e) =>
                            updateLine(l.localId, { proyecto_codigo: e.target.value })
                          }
                          className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                        >
                          <option value="">—</option>
                          {(proyectos ?? []).map((p) => (
                            <option key={p.codigo} value={p.codigo}>
                              {p.codigo}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={l.area_codigo}
                          onChange={(e) =>
                            updateLine(l.localId, { area_codigo: e.target.value })
                          }
                          className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                        >
                          <option value="">—</option>
                          {(areas ?? []).map((a) => (
                            <option key={a.codigo} value={a.codigo}>
                              {a.codigo} · {a.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={l.debit}
                          onChange={(e) =>
                            updateLine(l.localId, { debit: e.target.value })
                          }
                          placeholder="0"
                          className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-right font-mono text-xs tabular-nums ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={l.credit}
                          onChange={(e) =>
                            updateLine(l.localId, { credit: e.target.value })
                          }
                          placeholder="0"
                          className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-right font-mono text-xs tabular-nums ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                        />
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => removeLine(l.localId)}
                          disabled={lines.length <= 1}
                          aria-label="Eliminar línea"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-negative transition-colors hover:bg-negative/10 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={addLine}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-cehta-green/40 bg-white px-3 py-1.5 text-xs font-medium text-cehta-green hover:bg-cehta-green/5"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
              Agregar línea
            </button>
          </div>
        </form>

        {/* Sticky footer con sumas + botones */}
        <div className="sticky bottom-4 z-30 rounded-3xl border border-hairline bg-white/85 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Sumas */}
            <div className="flex flex-wrap items-center gap-4" aria-live="polite">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  Σ Cargo
                </p>
                <Currency value={totalDebit} size="xl" />
              </div>
              <div className="text-ink-300">·</div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  Σ Abono
                </p>
                <Currency value={totalCredit} size="xl" />
              </div>
              <div className="text-ink-300">=</div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                  Diferencia
                </p>
                <Currency
                  value={delta}
                  size="xl"
                  tone={delta === 0 ? "success" : "danger"}
                />
              </div>
              {isBalanced && (
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-positive ring-1 ring-positive/20">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                  Cuadra
                </span>
              )}
              {!isBalanced && delta !== 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-negative/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-negative ring-1 ring-negative/20">
                  <XCircle className="h-3 w-3" strokeWidth={2.5} />
                  Descuadra
                </span>
              )}
            </div>

            {/* Botones */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit("DRAFT")}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
              >
                <Save className="h-4 w-4" strokeWidth={1.75} />
                Guardar borrador
              </button>
              <button
                type="button"
                onClick={() => submit("PENDING")}
                disabled={submitting || !isBalanced}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={!isBalanced ? "Cuadrá las líneas antes de enviar" : "Enviar a aprobación"}
              >
                <Send className="h-4 w-4" strokeWidth={1.75} />
                Enviar a aprobación
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      {children}
    </div>
  );
}

// Observaciones 13/05/2026 #3,#4 — Typeahead de proveedor con auto-RUT
// Replica el ProveedorTypeahead del form Nubox pero scoped al form /nuevo.
interface ProveedorSearchHit {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
}

function ProveedorTypeaheadNuevo({
  value,
  rutValue,
  onSelect,
  onClear,
}: {
  value: string;
  rutValue: string;
  onSelect: (hit: ProveedorSearchHit) => void;
  onClear: () => void;
}) {
  const { session } = useSession();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<ProveedorSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!session) return;
    const q = query.trim();
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
          setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Escribí razón social o RUT…"
        className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-white shadow-lg"
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
              <div className="font-medium text-ink-900">{hit.razon_social}</div>
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
