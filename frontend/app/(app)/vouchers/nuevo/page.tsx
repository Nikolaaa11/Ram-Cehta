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
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractMontoFromText, extractRutFromText } from "@/lib/extract";
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  Plus,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { queueFeedback } from "@/components/feedback/PendingFeedbackPrompt";
import { useSession } from "@/hooks/use-session";
import { useApiQuery } from "@/hooks/use-api-query";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import { ProveedorTypeaheadCached } from "@/components/proveedores/ProveedorTypeaheadCached";
import { useProveedoresCache } from "@/hooks/use-proveedores-cache";
import { Combobox } from "@/components/ui/combobox";
import {
  AvisoPropuesta,
  HonorariosAsistente,
  OcTypeahead,
  TIPOS_DOCUMENTO_VOUCHER,
  usePropuestaVoucherOc,
  type AsientoHonorarios,
  type LineaPropuesta,
  type OcSeleccionada,
} from "@/components/vouchers/VoucherDesdeOc";
import { toast } from "@/components/ui/toast";
import { handleSessionExpired } from "@/lib/api/session-handling";
import { Currency } from "@/components/shared/Currency";
import type {
  Area,
  BalanceTreatment,
  ContraparteTipo,
  DocTributarioTipo,
  IvaTratamiento,
  OcListItem,
  OcRead,
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
  /**
   * Campos fiscales que la tabla NO muestra pero que viajan al backend. Mismo
   * criterio que VoucherLinesEditor, que los preserva sin pintarlos: si la
   * línea de honorarios va con `iva_tratamiento` en null, el exportador a
   * Nubox la trata como AFECTA a IVA.
   */
  iva_tratamiento: IvaTratamiento | null;
  balance_treatment: BalanceTreatment;
  /**
   * De dónde salió la línea. Sólo las que vienen de una propuesta bloquean el
   * guardado cuando les falta la cuenta — una línea en blanco que el operador
   * acaba de agregar a mano no es un error, es una línea a medio llenar.
   */
  origen: "manual" | "propuesta";
  /** La cuenta la tiene que elegir el operador (la OC no la trae). */
  requiereCuenta: boolean;
  /** Explicación corta que se muestra bajo el selector de cuenta. */
  nota: string | null;
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
  iva_tratamiento: null,
  balance_treatment: "NA",
  origen: "manual",
  requiereCuenta: false,
  nota: null,
});

/** Línea propuesta (por una OC o por el asistente de honorarios) → fila del
 *  form. Se pinta EDITABLE: el operador tiene que ver el asiento antes de
 *  guardar, porque es lo que después se firma. */
const lineaDesdePropuesta = (l: LineaPropuesta): LineDraft => ({
  localId: crypto.randomUUID(),
  cuenta_codigo: l.cuenta_codigo,
  proyecto_codigo: l.proyecto_codigo,
  area_codigo: l.area_codigo,
  debit: l.debit,
  credit: l.credit,
  descripcion: l.descripcion,
  iva_tratamiento: l.iva_tratamiento,
  balance_treatment: l.balance_treatment,
  origen: "propuesta",
  requiereCuenta: l.requiereCuenta,
  nota: l.nota,
});

export default function NuevoVoucherPage() {
  const { session } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Pre-fill desde URL params (caso típico: deeplink desde /admin/mailbox)
  const initialTipo = (params.get("tipo") as VoucherTipo) ?? "EGRESO";
  const initialGlosa = params.get("glosa") ?? "";
  const fromEmailId = params.get("from_email");
  // `?oc_id=` — el deeplink de "Crear voucher desde esta OC" en el detalle
  // de la orden. El otro camino (elegir la OC acá con el typeahead) termina
  // en el mismo estado, así que hay un solo flujo de prellenado.
  const ocIdParam = Number(params.get("oc_id"));
  const initialOcId =
    Number.isInteger(ocIdParam) && ocIdParam > 0 ? ocIdParam : null;

  // Header state
  const [tipo, setTipo] = useState<VoucherTipo>(initialTipo);
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [fechaDocumento, setFechaDocumento] = useState(today);
  const [fechaContable, setFechaContable] = useState(today);
  // Round 132 (Observaciones 20/05/2026): fechaVencimiento + fechaPago +
  // documentoDropboxPath + proyectoCodigoGlobal en header (igual que
  // /vouchers/nubox y /vouchers/corfo). Proyecto a nivel voucher, no
  // por línea. Fechas y link Dropbox como campos opcionales.
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [documentoDropboxPath, setDocumentoDropboxPath] = useState("");
  const [proyectoCodigoGlobal, setProyectoCodigoGlobal] = useState("");
  const [glosa, setGlosa] = useState(initialGlosa);
  // Moneda del voucher. Sigue siendo CLP por defecto y el campo está
  // deshabilitado —acá no se elige a mano—, pero cuando el voucher nace de
  // una OC hereda la de la OC. Antes iba "CLP" fijo en el payload: una OC en
  // UF entraba como pesos con la cifra en UF, o sea ~39.000 veces menos plata
  // de la que representa, y el error no se ve en ninguna pantalla.
  const [moneda, setMoneda] = useState("CLP");
  const [contraparteRut, setContraparteRut] = useState("");
  const [contraparteNombre, setContraparteNombre] = useState("");
  const [contraparteTipo, setContraparteTipo] = useState<ContraparteTipo>("PROVEEDOR");
  // El tipo de documento ya no vive encerrado en COMPRA/VENTA: una boleta de
  // honorarios se paga casi siempre como EGRESO, y con el selector escondido
  // el `doc_tributario_tipo` se guardaba en null y el documento quedaba sin
  // identificar. Arranca en "NA" (sin documento) salvo que el tipo de voucher
  // lo exija — así nadie termina con una FACTURA puesta por default.
  const [docTributarioTipo, setDocTributarioTipo] = useState<DocTributarioTipo>(
    () =>
      TIPOS.find((t) => t.value === initialTipo)?.needsTaxDoc
        ? "FACTURA"
        : "NA",
  );
  const [docTributarioFolio, setDocTributarioFolio] = useState("");
  const [banco, setBanco] = useState("");
  const [bancoCuentaAlias, setBancoCuentaAlias] = useState("");

  // OC de origen. `ocId` es lo que viaja en el payload; `ocSeleccionada` es
  // sólo para pintar el chip. Mientras haya OC, la empresa queda fija en la
  // suya: tomar una OC de una empresa y colgarla de un voucher de otra es una
  // fuga cross-tenant.
  const [ocId, setOcId] = useState<number | null>(initialOcId);
  const [ocSeleccionada, setOcSeleccionada] = useState<OcSeleccionada | null>(
    null,
  );

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

  // Round 8 — limites razonables de fecha (mismo razonamiento que Nubox
  // form): 5 anos atras cubre ciclo contable, 7d adelante cubre docs
  // futuros legitimos. Evita typos catastroficos (1900 o 2099).
  const minDateVoucher = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10);
  }, []);
  const maxDateVoucher = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

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

  // ── OC de origen ───────────────────────────────────────────────────────
  // Dos fuentes, un solo estado final:
  //   1. `GET /ordenes-compra/{id}` — la cabecera (empresa, proveedor, tipo de
  //      documento). Endpoint viejo y seguro.
  //   2. `GET /ordenes-compra/{id}/voucher-propuesto` — el ASIENTO. Es la
  //      ÚNICA fuente de montos: acá no se inventa ninguna cifra. Si no
  //      responde, el operador igual queda con la OC linkeada y carga las
  //      líneas a mano — lo que no pasa nunca es que aparezcan montos
  //      adivinados por el frontend.
  const ocDetalle = useApiQuery<OcRead>(
    ["oc-para-voucher", String(ocId ?? "")],
    `/ordenes-compra/${ocId}`,
    ocId !== null,
  );
  const { query: propuestaQuery, resultado: propuesta } =
    usePropuestaVoucherOc(ocId);

  // Cabecera: sólo los HECHOS de la OC (empresa y tipo de documento). La
  // prosa y los montos los pone la propuesta, más abajo.
  const headerPrefillRef = useRef<number | null>(null);
  useEffect(() => {
    const oc = ocDetalle.data;
    if (!oc || headerPrefillRef.current === oc.oc_id) return;
    headerPrefillRef.current = oc.oc_id;
    setOcSeleccionada(oc);
    // Cambiar de empresa invalida las FKs de las líneas cargadas a mano.
    if (empresaCodigo && empresaCodigo !== oc.empresa_codigo) {
      setLines((prev) =>
        prev.map((l) => ({
          ...l,
          cuenta_codigo: "",
          proyecto_codigo: "",
          area_codigo: "",
        })),
      );
    }
    setEmpresaCodigo(oc.empresa_codigo);
    setDocTributarioTipo(oc.tipo_documento as DocTributarioTipo);
    // intencional: corre una vez por OC (lo garantiza el ref), no en cada
    // tecla que el operador toque en el resto del form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocDetalle.data]);

  // Contraparte desde el catálogo de proveedores. Sólo llena lo vacío.
  const { data: proveedoresCache } = useProveedoresCache();
  useEffect(() => {
    const oc = ocDetalle.data;
    if (!oc || oc.proveedor_id === null || !proveedoresCache) return;
    const prov = proveedoresCache.find(
      (p) => p.proveedor_id === oc.proveedor_id,
    );
    if (!prov) return;
    setContraparteTipo("PROVEEDOR");
    setContraparteNombre((prev) => prev || prov.razon_social);
    setContraparteRut((prev) => prev || (prov.rut ?? ""));
  }, [ocDetalle.data, proveedoresCache]);

  // El asiento propuesto. Reemplaza las líneas de una: es la propuesta
  // completa, no un merge. El operador la ve y la edita antes de guardar.
  const propuestaPrefillRef = useRef<number | null>(null);
  useEffect(() => {
    if (ocId === null || !propuesta?.ok) return;
    if (propuestaPrefillRef.current === ocId) return;
    propuestaPrefillRef.current = ocId;
    const p = propuesta.propuesta;

    if (p.empresaCodigo) setEmpresaCodigo(p.empresaCodigo);
    if (p.tipo) setTipo(p.tipo);
    if (p.docTributarioTipo) setDocTributarioTipo(p.docTributarioTipo);
    if (p.docTributarioFolio) setDocTributarioFolio(p.docTributarioFolio);
    if (p.fechaDocumento) setFechaDocumento(p.fechaDocumento);
    if (p.fechaContable) setFechaContable(p.fechaContable);
    if (p.fechaVencimiento) setFechaVencimiento(p.fechaVencimiento);
    if (p.glosa) setGlosa(p.glosa);
    if (p.contraparteTipo) setContraparteTipo(p.contraparteTipo);
    if (p.contraparteNombre) setContraparteNombre(p.contraparteNombre);
    if (p.contraparteRut) setContraparteRut(p.contraparteRut);
    // La moneda sale de la OC, no se asume CLP. Una OC en UF o USD producía
    // un voucher marcado en pesos con la cifra en moneda extranjera: el monto
    // quedaba multiplicado por ~39.000 respecto de lo que representa.
    if (p.moneda) setMoneda(p.moneda);
    if (p.lineas.length > 0) setLines(p.lineas.map(lineaDesdePropuesta));
  }, [ocId, propuesta]);

  // Camino de respaldo: si la propuesta no llegó, la OC queda linkeada igual
  // y ponemos una glosa mínima para que el operador no arranque de cero.
  const fallbackPrefillRef = useRef<number | null>(null);
  useEffect(() => {
    const oc = ocDetalle.data;
    const fallo = propuestaQuery.isError || propuesta?.ok === false;
    if (!oc || ocId === null || !fallo) return;
    if (fallbackPrefillRef.current === ocId) return;
    fallbackPrefillRef.current = ocId;
    setGlosa(
      (prev) => prev || `OC ${oc.numero_oc} · imputación pendiente`.slice(0, 500),
    );
  }, [ocId, ocDetalle.data, propuestaQuery.isError, propuesta]);

  const elegirOc = (oc: OcListItem) => {
    setOcSeleccionada(oc);
    setOcId(oc.oc_id);
  };

  const quitarOc = () => {
    setOcId(null);
    setOcSeleccionada(null);
    headerPrefillRef.current = null;
    propuestaPrefillRef.current = null;
    fallbackPrefillRef.current = null;
  };

  /**
   * Asiento propuesto por el asistente de honorarios (sin OC). Reemplaza las
   * líneas, así que si había trabajo cargado se pregunta antes: perder seis
   * líneas imputadas por un click es un mal trato.
   */
  const aplicarAsientoHonorarios = (asiento: AsientoHonorarios): boolean => {
    const hayTrabajo = lines.some(
      (l) => l.cuenta_codigo || l.debit || l.credit || l.descripcion.trim(),
    );
    if (
      hayTrabajo &&
      !window.confirm(
        `Esto reemplaza las ${lines.length} líneas actuales por el asiento de ` +
          `honorarios (${asiento.lineas.length} líneas). ¿Seguimos?`,
      )
    ) {
      return false;
    }
    setLines(asiento.lineas.map(lineaDesdePropuesta));
    return true;
  };

  const propuestaError =
    propuesta?.ok === false
      ? propuesta.error
      : propuestaQuery.isError
        ? (propuestaQuery.error?.message ??
          "No se pudo traer la propuesta de asiento desde la OC.")
        : null;

  // Si la OC ya tiene voucher, no se crea otro: un voucher duplicado sobre la
  // misma OC es un pago duplicado esperando. Se muestra el que existe.
  const voucherExistenteId = propuesta?.ok
    ? propuesta.propuesta.voucherExistenteId
    : null;
  const voucherExistenteCodigo = propuesta?.ok
    ? propuesta.propuesta.voucherExistenteCodigo
    : null;
  const advertenciasPropuesta = propuesta?.ok
    ? propuesta.propuesta.advertencias
    : [];

  // Requisito del contrato: una propuesta incompleta se marca y NO se guarda.
  // Sólo bloquean las líneas que vinieron de una propuesta — una fila en
  // blanco recién agregada a mano no es un error, es trabajo a medio hacer.
  const lineasSinCuenta = useMemo(
    () =>
      lines
        .map((l, i) => ({ l, numero: i + 1 }))
        .filter(({ l }) => l.origen === "propuesta" && !l.cuenta_codigo),
    [lines],
  );
  const bloqueoPorPropuesta = lineasSinCuenta.length > 0;

  /**
   * Los dos motivos por los que el guardado se corta en seco, con el texto que
   * ve el operador. Los mismos que chequea `submit()` — acá viven para que el
   * botón esté apagado ANTES del click, no para reemplazar la validación.
   */
  const motivoBloqueo =
    voucherExistenteId !== null
      ? `La OC ya tiene el voucher ${voucherExistenteCodigo ?? `#${voucherExistenteId}`}. Abrí ese en vez de crear otro.`
      : bloqueoPorPropuesta
        ? `Falta elegir la cuenta en ${lineasSinCuenta.length === 1 ? "la línea" : "las líneas"} ${lineasSinCuenta.map((x) => x.numero).join(", ")}.`
        : null;
  const guardadoBloqueado = motivoBloqueo !== null;

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
      handleSessionExpired();
      return;
    }
    if (!empresaCodigo) {
      toast.error("Elige una empresa");
      return;
    }
    if (glosa.trim().length < 5) {
      toast.error(
        "La glosa (descripción del movimiento) debe tener al menos 5 " +
        "caracteres. Describe brevemente qué es: ej. 'Pago servicios " +
        "enero' o 'Factura F-12345 combustible'.",
      );
      return;
    }
    if (lines.length === 0) {
      toast.error("Agrega al menos una línea");
      return;
    }

    if (voucherExistenteId !== null) {
      toast.error(
        `La OC ${ocSeleccionada?.numero_oc ?? ""} ya tiene el voucher ` +
          `${voucherExistenteCodigo ?? `#${voucherExistenteId}`}. ` +
          "Abrilo en vez de crear otro: un voucher duplicado es un pago duplicado.",
        { duration: 12_000 },
      );
      return;
    }

    // La propuesta que llega incompleta no se guarda a medias. La cuenta de
    // gasto de una factura/boleta/exenta no se puede derivar de la OC (la OC
    // no tiene `cuenta_codigo`) y proponer una inventada sería peor: se
    // guardaría mal y nadie lo notaría.
    if (bloqueoPorPropuesta) {
      toast.error(
        `Falta elegir la cuenta en ${lineasSinCuenta.length === 1 ? "la línea" : "las líneas"} ` +
          `${lineasSinCuenta.map((x) => x.numero).join(", ")}. ` +
          "La OC no trae la cuenta de gasto: la elige el operador.",
        { duration: 8000 },
      );
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
        toast.error(`Línea ${i + 1}: ingresa un monto en debe o haber`);
        return;
      }
    }

    if (targetStatus === "PENDING" && !isBalanced) {
      toast.error(
        `Partida doble descuadrada · debe=${totalDebit.toLocaleString("es-CL")} ` +
          `vs haber=${totalCredit.toLocaleString("es-CL")}. ` +
          `Guarda como borrador o cuadrá las líneas antes de enviar.`,
      );
      return;
    }

    if (tipoMeta.needsTaxDoc && docTributarioTipo === "NA") {
      toast.error(
        `${tipoMeta.label}: elegí el tipo de documento tributario ` +
          "(factura, boleta, boleta de honorarios…).",
      );
      return;
    }

    if (tipoMeta.needsTaxDoc && !docTributarioFolio.trim()) {
      toast.error(`${tipoMeta.label}: ingresa el folio del documento tributario`);
      return;
    }

    // Round 144 — Pre-validación de adjunto eliminada (decisión operativa).
    // El operador puede mandar a firma sin adjunto y subirlo después
    // desde el detalle del voucher.

    // R152BBBBBB — Validar montos numéricos antes de enviar. Antes
    // `Number(l.debit) || 0` convertía silenciosamente "abc", "1,5", o
    // cualquier input inválido en 0 — el user creía haber cargado $1.500.000
    // pero el voucher se grababa con $0 en esa línea. Ahora fail-loud.
    const invalidLineIdx = lines.findIndex(
      (l) =>
        (l.debit !== "" && Number.isNaN(Number(l.debit))) ||
        (l.credit !== "" && Number.isNaN(Number(l.credit))),
    );
    if (invalidLineIdx !== -1) {
      toast.error(
        `Línea ${invalidLineIdx + 1}: monto inválido. ` +
          `Usá solo números sin separador de miles. Ejemplo: 1500000 (no "1.500.000" ni "1,5M")`,
      );
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
        // Round 132 — fecha_pago mapea a fecha_ejecucion del modelo
        // Voucher (fecha planeada/efectiva del pago).
        fecha_ejecucion: fechaPago || null,
        fecha_vencimiento: fechaVencimiento || null,
        documento_dropbox_path: documentoDropboxPath.trim() || null,
        glosa: glosa.trim(),
        moneda,
        contraparte_rut: contraparteRut.trim() || null,
        contraparte_nombre: contraparteNombre.trim() || null,
        contraparte_tipo: tipoMeta.needsCounterparty ? contraparteTipo : null,
        // El tipo de documento ya no depende de que el voucher sea
        // COMPRA/VENTA: una boleta de honorarios pagada como EGRESO también
        // es un documento tributario y tiene que quedar identificada. "NA"
        // (sin documento) viaja como null, que es lo que el backend espera.
        doc_tributario_tipo:
          docTributarioTipo === "NA" ? null : docTributarioTipo,
        doc_tributario_folio: docTributarioFolio.trim() || null,
        banco: tipoMeta.needsBank ? banco.trim() || null : null,
        banco_cuenta_alias: tipoMeta.needsBank ? bancoCuentaAlias.trim() || null : null,
        threshold_aplicado: false, // backend lo recalcula en Fase 2
        // La OC de origen. El backend valida que sea de la MISMA empresa y
        // que no tenga ya un voucher vivo; acá sólo la mandamos.
        oc_id: ocId,
        lines: lines.map((l, i) => ({
          line_number: i + 1,
          cuenta_codigo: l.cuenta_codigo,
          // Round 132 — proyecto a nivel voucher. Si la línea trae uno
          // custom (legacy), prevalece; sino se aplica el global.
          proyecto_codigo: l.proyecto_codigo || proyectoCodigoGlobal || null,
          area_codigo: l.area_codigo || null,
          // R152BBBBBB — input ya validado arriba, casteo seguro
          debit: l.debit === "" ? 0 : Number(l.debit),
          credit: l.credit === "" ? 0 : Number(l.credit),
          descripcion: l.descripcion.trim() || null,
          // Campos fiscales que la tabla no muestra pero que la propuesta sí
          // determina. Con `iva_tratamiento` en null el exportador a Nubox
          // trata la línea como AFECTA, y una boleta de honorarios no lo es.
          iva_tratamiento: l.iva_tratamiento,
          balance_treatment: l.balance_treatment,
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
      // Round 5 — invalidar caches para que /vouchers, /mis-pendientes y KPIs
      // muestren el voucher recien creado sin necesidad de hard refresh.
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["vouchers-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-state"] });
      // R152aa — feedback NPS post-creación (se levanta del lado destino)
      queueFeedback({
        actionType: "voucher.crear",
        question: "¿Qué tan fácil fue crear el voucher?",
        context: { codigo: result.codigo, target_status: targetStatus },
      });
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
            valida en vivo — no puedes enviar a aprobación con descuadre.
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
                  onChange={(e) => {
                    const siguiente = e.target.value as VoucherTipo;
                    setTipo(siguiente);
                    // COMPRA/VENTA exigen documento tributario. Si venía en
                    // "sin documento", lo dejamos en el más frecuente para que
                    // el operador no descubra el error recién al guardar.
                    if (
                      TIPOS.find((t) => t.value === siguiente)?.needsTaxDoc &&
                      docTributarioTipo === "NA"
                    ) {
                      setDocTributarioTipo("FACTURA");
                    }
                  }}
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
                  // Con una OC enganchada la empresa queda fija en la suya:
                  // colgar una OC de una empresa a un voucher de otra es una
                  // fuga cross-tenant. Para cambiarla, se quita la OC.
                  disabled={ocId !== null}
                  title={
                    ocId !== null
                      ? "La empresa la fija la OC de origen. Quitá la OC para cambiarla."
                      : undefined
                  }
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-500"
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
                  value={moneda}
                  disabled
                  className="w-full rounded-xl border-0 bg-ink-100 px-3 py-2 text-sm text-ink-500 ring-1 ring-hairline"
                />
              </Field>

              {/* Orden de compra de origen. Los dos caminos —venir del detalle
                  de la OC con `?oc_id=`, o elegirla acá— terminan en el mismo
                  estado: llega la propuesta, se pinta EDITABLE, y recién
                  entonces se guarda. */}
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Orden de compra de origen (opcional)">
                  <OcTypeahead
                    empresaCodigo={empresaCodigo}
                    seleccionada={ocSeleccionada}
                    onSelect={elegirOc}
                    onClear={quitarOc}
                  />
                </Field>
                {ocId !== null && (
                  <div className="mt-2 space-y-2">
                    {(ocDetalle.isLoading || propuestaQuery.isLoading) && (
                      <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
                        <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Trayendo el asiento propuesto de la orden…
                      </p>
                    )}
                    {voucherExistenteId !== null && (
                      <AvisoPropuesta
                        tono="error"
                        titulo="Esta OC ya tiene voucher"
                      >
                        No se crea otro: un voucher duplicado sobre la misma OC
                        es un pago duplicado esperando.{" "}
                        <Link
                          href={`/vouchers/${voucherExistenteId}` as Route}
                          className="font-medium underline"
                        >
                          Abrir{" "}
                          {voucherExistenteCodigo ?? `#${voucherExistenteId}`}
                        </Link>
                        .
                      </AvisoPropuesta>
                    )}
                    {propuestaError && (
                      <AvisoPropuesta titulo="No se pudo armar el asiento desde la OC">
                        {propuestaError} La orden queda igual enganchada al
                        voucher; las líneas las cargás vos. No prellenamos
                        montos por nuestra cuenta: una cifra de plata inventada
                        por el formulario es peor que un campo vacío.
                      </AvisoPropuesta>
                    )}
                    {advertenciasPropuesta.length > 0 && (
                      <AvisoPropuesta titulo="Revisá antes de guardar">
                        <ul className="list-disc space-y-0.5 pl-4">
                          {advertenciasPropuesta.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </AvisoPropuesta>
                    )}
                  </div>
                )}
              </div>

              <Field label="Fecha documento" required>
                <input
                  type="date"
                  required
                  value={fechaDocumento}
                  min={minDateVoucher}
                  max={maxDateVoucher}
                  onChange={(e) => setFechaDocumento(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              <Field label="Fecha contable" required>
                <input
                  type="date"
                  required
                  value={fechaContable}
                  min={minDateVoucher}
                  max={maxDateVoucher}
                  onChange={(e) => setFechaContable(e.target.value)}
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              {/* Round 132 (Observaciones 20/05/2026): fecha vencimiento +
                  fecha pago + proyecto global + link Dropbox en header. */}
              <Field label="Fecha vencimiento (opcional)">
                <input
                  type="date"
                  value={fechaVencimiento}
                  min={fechaDocumento || undefined}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  title="Fecha límite de pago según el documento."
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              <Field label="Fecha de pago (opcional)">
                <input
                  type="date"
                  value={fechaPago}
                  onChange={(e) => setFechaPago(e.target.value)}
                  title="Fecha en que efectivamente se paga (o se planea pagar)."
                  className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </Field>

              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Proyecto contable (opcional · se aplica a todas las líneas)">
                  <select
                    value={proyectoCodigoGlobal}
                    onChange={(e) => setProyectoCodigoGlobal(e.target.value)}
                    className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  >
                    <option value="">— Sin proyecto —</option>
                    {(proyectos ?? []).map((p) => (
                      <option key={p.codigo} value={p.codigo}>
                        {p.codigo} — {p.nombre}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

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

              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Documento — link Dropbox (opcional)">
                  <input
                    type="text"
                    value={documentoDropboxPath}
                    onChange={(e) => setDocumentoDropboxPath(e.target.value)}
                    placeholder="/Cehta Capital/Adjuntos-Vouchers/.../factura.pdf"
                    title="Path completo en Dropbox del documento soporte. Si está vacío, puedes adjuntar archivo desde el detalle del voucher."
                    className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
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
                  Contraparte <span className="text-ink-400 normal-case tracking-normal font-normal">· opcional</span>
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
                      {/* Round 62 — usa componente shared */}
                      <ProveedorTypeaheadCached
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
                        idPrefix="vnuevo-prov"
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

            {/* Documento tributario — SIEMPRE visible.
                Antes vivía encerrado en `needsTaxDoc` (sólo COMPRA/VENTA), así
                que "Boleta de honorarios" estaba en el <select> pero era
                inalcanzable: el bloque no se renderizaba y el submit mandaba
                doc_tributario_tipo en null. Una boleta de honorarios pagada
                como EGRESO quedaba sin identificar. Obligatorio en
                COMPRA/VENTA, opcional en el resto. */}
            <div
              className={`mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-2xl p-4 ${
                tipoMeta.needsTaxDoc
                  ? "bg-amber-50/50 ring-1 ring-amber-200"
                  : "bg-ink-50/40"
              }`}
            >
              <p
                className={`sm:col-span-3 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                  tipoMeta.needsTaxDoc ? "text-amber-800" : "text-ink-500"
                }`}
              >
                Documento tributario{" "}
                <span className="font-normal normal-case tracking-normal">
                  ·{" "}
                  {tipoMeta.needsTaxDoc
                    ? "obligatorio"
                    : "opcional, pero es lo que identifica el documento"}
                </span>
              </p>
              <Field label="Tipo" required={tipoMeta.needsTaxDoc}>
                <Combobox
                  items={TIPOS_DOCUMENTO_VOUCHER}
                  value={docTributarioTipo}
                  onValueChange={(v) =>
                    setDocTributarioTipo(v as DocTributarioTipo)
                  }
                  placeholder="Elegí el documento"
                  searchPlaceholder="Factura, honorarios, exenta…"
                  triggerClassName="w-full"
                />
              </Field>
              <Field label="Folio" required={tipoMeta.needsTaxDoc}>
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

              {/* Boleta de honorarios SIN OC: el bruto y la tasa los pone el
                  operador y las tres cifras quedan a la vista antes de
                  guardar. Con OC no aparece — ahí los montos salen de la
                  propuesta del servidor, que es la fuente. */}
              {docTributarioTipo === "HONORARIOS" && ocId === null && (
                <div className="sm:col-span-3">
                  <HonorariosAsistente
                    fechaDocumento={fechaDocumento}
                    onAplicar={aplicarAsientoHonorarios}
                  />
                </div>
              )}
            </div>

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
                Líneas del asiento contable
              </p>
              <p className="text-[11px] text-ink-500">
                Cada línea: cuenta contable · área · monto (cargo O abono)
              </p>
            </div>

            {/* R152uuu — MEJORAS IA.docx #12: el operador no entendía qué es
                "imputación". Bloque explicativo con el concepto en español
                llano + link a la guía y a las páginas de setup. */}
            <details className="mt-3 group rounded-2xl bg-cehta-green/5 ring-1 ring-cehta-green/20 text-xs">
              <summary className="cursor-pointer list-none px-4 py-3 text-cehta-green font-semibold flex items-center justify-between">
                <span>¿Qué es la imputación? · ayuda rápida</span>
                <span className="text-ink-400 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-4 pb-4 space-y-2 text-ink-600 leading-relaxed">
                <p>
                  <strong>Imputar</strong> significa elegir <strong>a qué cuenta contable</strong> va cada peso del asiento.
                  Cada línea tiene un cargo (debe) o un abono (haber).
                  La suma de cargos tiene que ser igual a la de abonos — la partida doble se valida en vivo.
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Cuenta contable</strong> (obligatorio): qué cuenta del plan se afecta. Si la lista está vacía configurala en <Link href="/admin/plan-cuentas" className="underline">/admin/plan-cuentas</Link>.</li>
                  <li><strong>Área</strong> (opcional): centro de costo o área interna. Setup en <Link href="/admin/areas" className="underline">/admin/areas</Link>.</li>
                  <li><strong>Proyecto contable</strong> (opcional, va arriba en el header): para asignar gasto a CORFO / Privado / Interno. Setup en <Link href="/admin/proyectos-contables" className="underline">/admin/proyectos-contables</Link>.</li>
                </ul>
                <p>
                  ¿Más dudas? <Link href={"/vouchers/ejemplos" as Route} className="underline">Ver ejemplos completos de vouchers</Link> o la <Link href="/ayuda" className="underline">Centro de Ayuda</Link>.
                </p>
              </div>
            </details>

            {/* El asiento propuesto se muestra EDITABLE. Nunca se guarda sin
                que el operador lo vea: es lo que después se firma. */}
            {lines.some((l) => l.origen === "propuesta") && (
              <div className="mt-3">
                <AvisoPropuesta
                  tono="info"
                  titulo="Asiento propuesto — revisalo antes de guardar"
                >
                  Las líneas se pueden editar, agregar y borrar. Lo que quede
                  acá es lo que se manda a firma.
                </AvisoPropuesta>
              </div>
            )}

            {bloqueoPorPropuesta && (
              <div className="mt-3">
                <AvisoPropuesta
                  titulo={
                    lineasSinCuenta.length === 1
                      ? `Falta la cuenta de la línea ${lineasSinCuenta[0]?.numero}`
                      : `Faltan las cuentas de las líneas ${lineasSinCuenta.map((x) => x.numero).join(", ")}`
                  }
                >
                  La OC no tiene cuenta contable, así que la línea de gasto se
                  propone <strong>en blanco a propósito</strong>: una cuenta
                  inventada se guarda mal y nadie lo nota. Hasta completarla no
                  se puede guardar, ni como borrador.
                </AvisoPropuesta>
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  <tr>
                    {/* Round 132 (Observaciones 20/05/2026): columna
                        Proyecto eliminada. El proyecto se elige UNA VEZ
                        en el header del voucher y se aplica a todas
                        las líneas al submit. */}
                    <th className="w-8 pb-2">#</th>
                    {/* R152uuu — el label decía "Planificación financiera"
                        pero la columna es la cuenta contable del plan. Lo
                        renombramos para que sea inequívoco. */}
                    <th className="pb-2">Cuenta contable</th>
                    <th className="pb-2">Área</th>
                    <th className="pb-2 text-right">Cargo (debe)</th>
                    <th className="pb-2 text-right">Abono (haber)</th>
                    <th className="w-8 pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.localId} className="border-t border-hairline/50">
                      <td className="py-2 text-xs text-ink-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        {(() => {
                          // Sólo se marca en rojo/ámbar la línea que vino de
                          // una propuesta sin cuenta. Una fila en blanco que
                          // el operador acaba de agregar no es un error.
                          const falta =
                            l.origen === "propuesta" && !l.cuenta_codigo;
                          return (
                            <select
                              value={l.cuenta_codigo}
                              onChange={(e) =>
                                updateLine(l.localId, {
                                  cuenta_codigo: e.target.value,
                                })
                              }
                              aria-invalid={falta}
                              className={`w-full rounded-lg border-0 px-2 py-1.5 text-xs ring-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green ${
                                falta
                                  ? "bg-amber-50 ring-amber-400"
                                  : "bg-ink-50 ring-hairline"
                              }`}
                            >
                              <option value="">
                                {falta ? "⚠ Elegí la cuenta" : "— Elegir cuenta —"}
                              </option>
                              {(cuentas ?? []).map((c) => (
                                <option key={c.codigo} value={c.codigo}>
                                  {c.codigo} · {c.nombre}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                        {l.nota && (
                          <p className="mt-1 text-[10px] leading-snug text-ink-500">
                            {l.nota}
                          </p>
                        )}
                      </td>
                      {/* Round 132: <td> de Proyecto eliminado.
                          Se setea a nivel voucher en el header. */}
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
                disabled={submitting || guardadoBloqueado}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-60"
                title={motivoBloqueo ?? "Guardar como borrador"}
              >
                <Save className="h-4 w-4" strokeWidth={1.75} />
                Guardar borrador
              </button>
              {/* Round 144 — gating del adjunto eliminado. El botón solo
                  exige líneas cuadradas (invariante de partida doble). */}
              <button
                type="button"
                onClick={() => submit("PENDING")}
                disabled={submitting || !isBalanced || guardadoBloqueado}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  motivoBloqueo ??
                  (!isBalanced
                    ? "Cuadrá las líneas antes de enviar"
                    : "Enviar a aprobación")
                }
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

