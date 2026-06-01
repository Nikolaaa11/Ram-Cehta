"use client";

/**
 * /vouchers/corfo — Round 85 — Bloque E completo
 *
 * Form de voucher DEDICADO para REVTECH y TRONGKAI (coejecutores del
 * subsidio CORFO-2026 de $3.000.000.000). Implementa los Ajustes
 * E3-E9 del prompt_v2_voucher_claudia.md:
 *
 *   - Selector de empresa (solo REVTECH o TRONGKAI)
 *   - Selector de proyecto (filtrado por empresa)
 *   - Tipo de documento F.E (sin IVA) o F.A (con IVA)
 *   - Si F.A: bifurcación "¿Asignás a financiamiento?" Sí / No
 *   - Editor de % por fuente (CORFO / P-tec / Empresa directa)
 *     con defaults del proyecto y validación suma 100%
 *   - IVA SIEMPRE va a EMPRESA (regla CORFO bloqueante)
 *   - Generación automática de N líneas con fuente_financiamiento
 *   - Submit como DRAFT → redirect al detalle del voucher
 *
 * Tras crear el voucher, el operador continúa el flow normal:
 *   subir adjunto → enviar a aprobación → 2 firmas → APPROVED.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleDollarSign,
  FileText,
  Info,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import dynamic from "next/dynamic";

// R152tt — Lazy-load RendicionDescargaSection. Ese componente importa
// recharts (~80kB gzipped) y AnimatedNumber para los donuts. Como vive
// debajo del form principal, no necesita estar en el primer-load.
// Reduce /vouchers/corfo de 313kB → ~230kB First Load JS.
const RendicionDescargaSection = dynamic(
  () =>
    import("@/components/corfo/RendicionDescargaSection").then((m) => ({
      default: m.RendicionDescargaSection,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 animate-pulse rounded-3xl bg-amber-50/40 ring-1 ring-amber-200/40" />
    ),
  },
);
import type {
  PlanCuenta,
  ProyectoContable,
  RepartoDefault,
  SubsidioRead,
} from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

type EmpresaCorfo = "REVTECH" | "TRONGKAI";
const EMPRESAS_PERMITIDAS: EmpresaCorfo[] = ["REVTECH", "TRONGKAI"];

type TipoDocCorfo =
  | "FACTURA_ELECTRONICA"
  | "FACTURA_ELECTRONICA_EXENTA"
  | "FACTURA_EXENTA";
const TIPO_DOC_LABEL: Record<TipoDocCorfo, string> = {
  FACTURA_ELECTRONICA: "Factura Electrónica (afecta IVA)",
  FACTURA_ELECTRONICA_EXENTA: "Factura Electrónica Exenta",
  FACTURA_EXENTA: "Factura Exenta",
};

function isAfecta(tipo: TipoDocCorfo): boolean {
  return tipo === "FACTURA_ELECTRONICA";
}

const fmtCLP = (n: number) =>
  `$${Math.round(n).toLocaleString("es-CL")}`;

export default function VoucherCorfoPage() {
  const { session } = useSession();
  const router = useRouter();

  // Header
  const [empresa, setEmpresa] = useState<EmpresaCorfo>("REVTECH");
  const [tipoDoc, setTipoDoc] = useState<TipoDocCorfo>("FACTURA_ELECTRONICA");
  const [folio, setFolio] = useState("");
  const [fechaDoc, setFechaDoc] = useState(
    new Date().toISOString().slice(0, 10),
  );
  // Round 129 (Observaciones 20/05/2026): agregamos fecha vencimiento +
  // fecha pago + link Dropbox al form CORFO. Antes solo había fecha doc.
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [documentoDropboxPath, setDocumentoDropboxPath] = useState("");
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [glosa, setGlosa] = useState("");
  const [neto, setNeto] = useState<number>(1_000_000);

  // Proyecto + reparto
  const [proyectoCodigo, setProyectoCodigo] = useState("");
  // Para F.A: asignar el neto al financiamiento subsidiado o NO (100% empresa)
  // Round 129 — bifurcación F.A. eliminada de la UI. Mantenemos el valor
  // forzado a true para que la lógica downstream (editor de %, preview,
  // payload) siga funcionando sin tocarse. setAsignaFinanciamiento queda
  // como no-op (no se llama desde ningún lado tras la edición).
  const [asignaFinanciamiento] = useState(true);
  const [pctCorfo, setPctCorfo] = useState<number>(50);
  const [pctPtec, setPctPtec] = useState<number>(20);
  const [pctEmpresa, setPctEmpresa] = useState<number>(30);

  // Fetch proyectos de la empresa
  const { data: proyectosAll } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables-corfo", empresa],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>(
        `/proyectos-contables?empresa_codigo=${empresa}`,
        session,
      ),
    enabled: !!session,
  });

  // Round 142 hotfix — filtrar solo proyectos tipo CORFO. Antes el form
  // mostraba TODOS los proyectos de REVTECH/TRONGKAI (incluyendo los
  // INTERNO), y los INTERNO no tienen las cuentas cuenta_aporte_*
  // configuradas → el preview mostraba "?" en columna CUENTA → al crear
  // el voucher el backend rechazaba con "Cuenta '?' no existe".
  // El form CORFO está DISEÑADO para gastos imputables al subsidio
  // CORFO, así que filtrar tiene sentido semántico también.
  const proyectos = useMemo(() => {
    return (proyectosAll ?? []).filter(
      (p) => p.tipo_financiamiento === "CORFO",
    );
  }, [proyectosAll]);

  // Auto-seleccionar primer proyecto del empresa cuando cambia
  useEffect(() => {
    if (proyectos && proyectos.length > 0 && !proyectoCodigo) {
      const first = proyectos[0];
      if (first) setProyectoCodigo(first.codigo);
    }
  }, [proyectos, proyectoCodigo]);

  // Cuando cambia el proyecto, cargar su reparto-default
  const { data: reparto } = useQuery<RepartoDefault>({
    queryKey: ["reparto-default", proyectoCodigo],
    queryFn: () =>
      apiClient.get<RepartoDefault>(
        `/proyectos-contables/${proyectoCodigo}/reparto-default`,
        session,
      ),
    enabled: !!session && !!proyectoCodigo,
  });

  // Cuando cambia reparto, aplicar defaults al state
  useEffect(() => {
    if (reparto) {
      setPctCorfo(Number(reparto.aporte_corfo_pct));
      setPctPtec(Number(reparto.aporte_ptec_pct));
      setPctEmpresa(Number(reparto.aporte_empresa_directa_pct));
    }
  }, [reparto]);

  // Subsidio del proyecto (info contextual)
  const { data: subsidio } = useQuery<SubsidioRead>({
    queryKey: ["subsidio", reparto?.subsidio_codigo],
    queryFn: () =>
      apiClient.get<SubsidioRead>(
        `/subsidios/${reparto?.subsidio_codigo}`,
        session,
      ),
    enabled: !!session && !!reparto?.subsidio_codigo,
  });

  // Round 146 — Cargar el plan de cuentas habilitado para la empresa.
  // Solo cuentas imputables (nivel 4) + activas + habilitadas para esta
  // empresa. Este es el universo de opciones que el combo box muestra
  // en cada fila del preview de líneas.
  const { data: cuentasDisponibles } = useQuery<PlanCuenta[]>({
    queryKey: ["plan-cuentas-corfo", empresa],
    queryFn: () =>
      apiClient.get<PlanCuenta[]>(
        `/plan-cuentas?empresa_codigo=${empresa}&imputable=true&activa=true`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  // Round 146 — overrides manuales de cuenta por fuente. Si el operador
  // cambia la cuenta default del reparto en el combo box, guardamos el
  // override acá indexado por fuente. Si está vacío, usamos el default
  // del reparto. Cuando cambia el proyecto, reseteamos.
  const [cuentaOverrides, setCuentaOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    // Al cambiar proyecto, limpiar overrides (toma los defaults del nuevo reparto)
    setCuentaOverrides({});
  }, [proyectoCodigo]);

  const setOverride = (fuente: string, cuenta: string) => {
    setCuentaOverrides((prev) => ({ ...prev, [fuente]: cuenta }));
  };

  // Cálculos derivados
  const sumaPct = pctCorfo + pctPtec + pctEmpresa;
  const sumaOk = Math.abs(sumaPct - 100) < 0.01;
  const afecta = isAfecta(tipoDoc);
  const iva = afecta ? Math.round(neto * 0.19) : 0;
  const bruto = neto + iva;

  // Si F.A y NO asignás a financiamiento → 100% empresa
  const effectivePcts = useMemo(() => {
    if (!afecta) {
      // F.E siempre usa el reparto
      return { corfo: pctCorfo, ptec: pctPtec, empresa: pctEmpresa };
    }
    if (afecta && !asignaFinanciamiento) {
      // F.A + no asigna → 100% empresa directa
      return { corfo: 0, ptec: 0, empresa: 100 };
    }
    return { corfo: pctCorfo, ptec: pctPtec, empresa: pctEmpresa };
  }, [afecta, asignaFinanciamiento, pctCorfo, pctPtec, pctEmpresa]);

  const lineasPreview = useMemo(() => {
    if (!reparto) return [];
    const out: Array<{
      label: string;
      fuente: string;
      cuenta: string;
      cuentaDefault: string; // cuenta default del reparto (para reset al hacer click "default")
      monto: number;
    }> = [];
    // Round 146 — resolveCuenta toma el override si existe, sino el default.
    const resolveCuenta = (fuente: string, defaultCuenta: string | null) =>
      cuentaOverrides[fuente] || defaultCuenta || "";
    if (effectivePcts.corfo > 0) {
      const def = reparto.cuenta_aporte_corfo ?? "";
      out.push({
        label: `CORFO ${effectivePcts.corfo}%`,
        fuente: "CORFO_SUBSIDIO",
        cuenta: resolveCuenta("CORFO_SUBSIDIO", def),
        cuentaDefault: def,
        monto: Math.round((neto * effectivePcts.corfo) / 100),
      });
    }
    if (effectivePcts.ptec > 0) {
      const def = reparto.cuenta_aporte_ptec_cehta ?? "";
      out.push({
        label: `P-tec (CEHTA) ${effectivePcts.ptec}%`,
        fuente: "PTEC_CEHTA",
        cuenta: resolveCuenta("PTEC_CEHTA", def),
        cuentaDefault: def,
        monto: Math.round((neto * effectivePcts.ptec) / 100),
      });
    }
    if (effectivePcts.empresa > 0) {
      const def = reparto.cuenta_aporte_empresa_directa ?? "";
      out.push({
        label: `Empresa directa ${effectivePcts.empresa}%`,
        fuente: "EMPRESA_DIRECTA",
        cuenta: resolveCuenta("EMPRESA_DIRECTA", def),
        cuentaDefault: def,
        monto: Math.round((neto * effectivePcts.empresa) / 100),
      });
    }
    // IVA siempre corporativo si afecta
    if (afecta && iva > 0) {
      const def = reparto.cuenta_iva_corporativo ?? "";
      out.push({
        label: "IVA crédito fiscal (siempre corporativo)",
        fuente: "IVA_CORPORATIVO",
        cuenta: resolveCuenta("IVA_CORPORATIVO", def),
        cuentaDefault: def,
        monto: iva,
      });
    }
    return out;
  }, [reparto, effectivePcts, neto, iva, afecta, cuentaOverrides]);

  // Round 142 hotfix — bug "?" en columna CUENTA del preview.
  // Si el RepartoDefault del proyecto no tiene cuentas configuradas
  // (cuenta_aporte_corfo IS NULL en DB), el preview rendea "?" y el
  // backend rechaza al crear con "Cuenta '?' no existe". Detectamos el
  // estado y bloqueamos el submit con UX clara antes del POST.
  const cuentasFaltantes = useMemo(() => {
    return lineasPreview.filter((l) => !l.cuenta || l.cuenta === "?" || l.cuenta === "").length;
  }, [lineasPreview]);

  // Round 142 — Helper compartido por los 2 botones (DRAFT y PENDING).
  // El backend nubox-form siempre crea DRAFT; si target=PENDING, después
  // del POST exitoso llamamos /vouchers/{id}/submit que valida partida
  // doble + COMPRA con adjunto y pasa el voucher a PENDING.
  const buildPayloadAndCreate = async (
    targetStatus: "DRAFT" | "PENDING",
  ): Promise<{ voucher_id: number; codigo: string }> => {
    if (!reparto) throw new Error("Proyecto sin configurar");
    if (cuentasFaltantes > 0) {
      throw new Error(
        `El proyecto ${proyectoCodigo} no tiene las cuentas del reparto ` +
          `configuradas (faltan ${cuentasFaltantes}). Anda a ` +
          `/admin/proyectos-contables/${proyectoCodigo} y completá ` +
          `"cuenta_aporte_corfo", "cuenta_aporte_ptec_cehta", ` +
          `"cuenta_aporte_empresa_directa" y "cuenta_iva_corporativo" ` +
          `antes de crear vouchers.`,
      );
    }
    const informacion_contable = lineasPreview.map((l) => ({
      comentario: `${glosa || folio} · ${l.label}`,
      cuenta_codigo: l.cuenta,
      total: l.monto,
      proyecto_codigo: proyectoCodigo,
      area_codigo: null,
      fuente_financiamiento: l.fuente,
    }));
    const cuentaHaber = "2101-01";
    const informacion_financiera = [
      {
        comentario: `Por pagar a proveedor · ${proveedorNombre || folio}`,
        cuenta_codigo: cuentaHaber,
        total: bruto,
        proyecto_codigo: proyectoCodigo,
        area_codigo: null,
        fuente_financiamiento: "EMPRESA_DIRECTA",
      },
    ];
    const payload = {
      empresa_codigo: empresa,
      proveedor_rut: proveedorRut || null,
      proveedor_nombre: proveedorNombre || null,
      source: "corfo_form",
      tipo_documento: tipoDoc,
      numero_documento: folio,
      forma_pago: "TRANSFERENCIA",
      fecha_documento: fechaDoc,
      fecha_vencimiento: fechaVencimiento || null,
      documento_dropbox_path: documentoDropboxPath || null,
      glosa: glosa || `Voucher CORFO ${proyectoCodigo}`,
      informacion_contable,
      informacion_financiera,
      ...(fechaPago ? { fecha_pago: fechaPago } : {}),
    };
    const created = await apiClient.post<{
      voucher_id: number;
      codigo: string;
    }>("/vouchers/nubox-form", payload, session);

    // Round 142 — si el operador quiere enviar a firma, llamar /submit
    // que es DRAFT → PENDING. Si esto falla, el voucher YA está creado
    // como DRAFT (no se pierde nada), solo no avanzó el estado.
    if (targetStatus === "PENDING") {
      try {
        await apiClient.post(
          `/vouchers/${created.voucher_id}/submit`,
          {},
          session,
        );
      } catch (err) {
        // Re-lanzar con mensaje contextual: el voucher existe pero no
        // pudo avanzar a PENDING. El operador puede ir al detalle y
        // hacer submit desde ahí.
        const detail =
          err instanceof ApiError
            ? err.detail
            : "Error desconocido enviando a aprobación";
        throw new Error(
          `Voucher ${created.codigo} creado como DRAFT, pero no pudo ` +
            `enviarse a aprobación: ${detail}. Abrí el voucher e intentá ` +
            `"Enviar a aprobación" desde el detalle.`,
        );
      }
    }
    return created;
  };

  const createMut = useMutation({
    mutationFn: (targetStatus: "DRAFT" | "PENDING") =>
      buildPayloadAndCreate(targetStatus),
    onSuccess: (r, targetStatus) => {
      toast.success(
        `Voucher ${r.codigo} ${
          targetStatus === "PENDING"
            ? "creado y enviado a aprobación · PENDING"
            : "creado · DRAFT"
        }`,
      );
      router.push(`/vouchers/${r.voucher_id}` as Route);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : (err as Error).message,
        { duration: 12000 },
      );
    },
  });

  const canSubmit =
    !!session &&
    !!proyectoCodigo &&
    !!folio.trim() &&
    neto > 0 &&
    (afecta && !asignaFinanciamiento ? true : sumaOk) &&
    cuentasFaltantes === 0 &&
    !createMut.isPending;

  return (
    <div className="mx-auto max-w-[1024px] px-6 py-8 space-y-6">
      <div>
        <Link
          href={"/vouchers" as Route}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a vouchers
        </Link>
      </div>

      {/* Round 96 — hero pattern consistente con /admin/subsidios y system-status */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <Sparkles className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Voucher CORFO · Bloque E
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Reparto CORFO / P-tec / Empresa
          </h1>
          <p className="text-sm md:text-base text-ink-500 mt-2 max-w-2xl">
            Form dedicado a <strong>REVTECH</strong> y <strong>TRONGKAI</strong>{" "}
            como coejecutores del subsidio CORFO 2026 ($3.000.000.000). El IVA
            siempre va al pozo corporativo (regla CORFO bloqueante).
          </p>
        </div>
      </div>

      {/* Header */}
      <Surface className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Empresa coejecutora
            </label>
            <select
              value={empresa}
              onChange={(e) => {
                setEmpresa(e.target.value as EmpresaCorfo);
                setProyectoCodigo("");
              }}
              className="form-input"
            >
              {EMPRESAS_PERMITIDAS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Tipo de documento
            </label>
            <select
              value={tipoDoc}
              onChange={(e) => setTipoDoc(e.target.value as TipoDocCorfo)}
              className="form-input"
            >
              {(Object.keys(TIPO_DOC_LABEL) as TipoDocCorfo[]).map((t) => (
                <option key={t} value={t}>
                  {TIPO_DOC_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Folio del documento *
            </label>
            <input
              type="text"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="ej. 12345"
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Fecha del documento
            </label>
            <input
              type="date"
              value={fechaDoc}
              onChange={(e) => setFechaDoc(e.target.value)}
              className="form-input"
            />
          </div>
          {/* Round 129 — Fecha vencimiento + Fecha pago.
              Antes solo había fecha doc. Estos 2 campos son críticos para
              flujo de tesorería + alertas de pago atrasado. */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Fecha de vencimiento (opcional)
            </label>
            <input
              type="date"
              value={fechaVencimiento}
              min={fechaDoc || undefined}
              onChange={(e) => setFechaVencimiento(e.target.value)}
              className="form-input"
              title="Fecha límite de pago según el documento. Si dice 'pago a 30 días', sumar 30 días a fecha doc."
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Fecha de pago (opcional)
            </label>
            <input
              type="date"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              className="form-input"
              title="Fecha en que efectivamente se paga (o se planea pagar)."
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Proveedor RUT (opcional)
            </label>
            <input
              type="text"
              value={proveedorRut}
              onChange={(e) => setProveedorRut(e.target.value)}
              placeholder="76.123.456-7"
              className="form-input"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Proveedor nombre (opcional)
            </label>
            <input
              type="text"
              value={proveedorNombre}
              onChange={(e) => setProveedorNombre(e.target.value)}
              placeholder="Razón social"
              className="form-input"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
            Proyecto contable (subsidio asociado)
          </label>
          <select
            value={proyectoCodigo}
            onChange={(e) => setProyectoCodigo(e.target.value)}
            className="form-input"
          >
            {!proyectosAll && <option>Cargando proyectos...</option>}
            {proyectos.length > 0 &&
              proyectos.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.codigo} — {p.nombre}
                </option>
              ))}
            {proyectosAll && proyectos.length === 0 && (
              <option value="">
                ⚠ {empresa} no tiene proyectos tipo CORFO configurados
              </option>
            )}
          </select>
          {subsidio && (
            <p className="mt-2 text-[11px] text-ink-500">
              <CircleDollarSign className="inline size-3 mr-1 text-cehta-green" />
              Subsidio asociado:{" "}
              <strong className="font-semibold text-ink-700">
                {subsidio.nombre}
              </strong>{" "}
              · monto total ${Number(subsidio.monto_total).toLocaleString("es-CL")}
            </p>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
            Glosa
          </label>
          <input
            type="text"
            value={glosa}
            onChange={(e) => setGlosa(e.target.value)}
            placeholder="Descripción operativa del gasto"
            className="form-input"
          />
        </div>

        {/* Round 129 — Link de carga de documentos (path Dropbox del
            archivo soporte). Aparece después de la glosa, antes del cierre
            del Surface. Si el operador ya subió el doc a Dropbox, pega el
            path acá. Si no, puede dejarlo vacío y subir el archivo después
            desde el detalle del voucher. */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
            Documento — link Dropbox (opcional)
          </label>
          <input
            type="text"
            value={documentoDropboxPath}
            onChange={(e) => setDocumentoDropboxPath(e.target.value)}
            placeholder="/Cehta Capital/Adjuntos-Vouchers/.../factura.pdf"
            className="form-input"
            title="Path completo en Dropbox del documento soporte. Si está vacío, podés adjuntarlo después desde /vouchers/{id}."
          />
          <p className="mt-1 text-[10px] text-ink-400">
            Si el documento ya está en Dropbox, pegá el path. Sino, podés
            adjuntar el archivo después de crear el voucher.
          </p>
        </div>
      </Surface>

      {/* Montos + reparto */}
      <Surface className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Monto NETO
            </label>
            <input
              type="number"
              value={neto}
              min={1}
              onChange={(e) => setNeto(Math.max(0, Number(e.target.value)))}
              className="form-input font-mono text-right"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              IVA (19% si afecta)
            </label>
            <input
              type="text"
              value={fmtCLP(iva)}
              disabled
              className="form-input font-mono text-right bg-ink-50"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
              Total BRUTO
            </label>
            <input
              type="text"
              value={fmtCLP(bruto)}
              disabled
              className="form-input font-mono text-right bg-ink-50 text-ink-900 font-semibold"
            />
          </div>
        </div>

        {/* Round 129 (Observaciones 20/05/2026): la bifurcación F.A. fue
            eliminada. Si llegaste a este form (/vouchers/corfo) es porque
            VAS A asignar al financiamiento subsidiado por definición.
            Si querés un voucher 100% Empresa directa, usá /vouchers/nubox.

            Detrás de la UI, `asignaFinanciamiento` queda forzado a `true`
            siempre — la lógica de validación del editor de % y del
            preview se mantiene intacta. */}

        {/* Editor % — solo si está repartiendo */}
        {(!afecta || asignaFinanciamiento) && (
          <div className="rounded-xl border border-hairline bg-white p-4">
            <p className="text-sm font-semibold text-ink-900 mb-3">
              Reparto del neto por fuente {reparto?.bloquear_edicion_pct ? "(bloqueado por el proyecto)" : ""}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <PctInput
                label="CORFO subsidio"
                value={pctCorfo}
                setValue={setPctCorfo}
                monto={Math.round((neto * pctCorfo) / 100)}
                disabled={reparto?.bloquear_edicion_pct}
                tone="cehta"
              />
              <PctInput
                label="P-tec (CEHTA)"
                value={pctPtec}
                setValue={setPctPtec}
                monto={Math.round((neto * pctPtec) / 100)}
                disabled={reparto?.bloquear_edicion_pct}
                tone="blue"
              />
              <PctInput
                label="Empresa directa"
                value={pctEmpresa}
                setValue={setPctEmpresa}
                monto={Math.round((neto * pctEmpresa) / 100)}
                disabled={reparto?.bloquear_edicion_pct}
                tone="ink"
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-ink-600">
                Suma: <strong className={sumaOk ? "text-cehta-green" : "text-negative"}>
                  {sumaPct.toFixed(2)}%
                </strong>
              </span>
              {!sumaOk && (
                <span className="text-negative font-medium text-[11px]">
                  ⚠ Los % deben sumar exactamente 100%
                </span>
              )}
            </div>
          </div>
        )}

        {/* Preview líneas que se van a generar */}
        {lineasPreview.length > 0 && (
          <div
            className={`rounded-xl border p-4 ${
              cuentasFaltantes > 0
                ? "border-negative/30 bg-negative/5"
                : "border-cehta-green/20 bg-cehta-green/5"
            }`}
          >
            <p className="text-sm font-semibold text-ink-900 mb-2">
              Líneas que se van a crear (DEBE):
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="pb-1">Fuente</th>
                  <th className="pb-1">Cuenta</th>
                  <th className="pb-1 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {lineasPreview.map((l, i) => {
                  const cuentaVacia = !l.cuenta || l.cuenta === "?" || l.cuenta === "";
                  const overrideado =
                    !!cuentaOverrides[l.fuente] &&
                    cuentaOverrides[l.fuente] !== l.cuentaDefault;
                  return (
                    <tr key={i} className="border-t border-cehta-green/10">
                      <td className="py-1.5 align-top">{l.label}</td>
                      <td className="py-1.5 align-top">
                        {/* Round 146 — combo box de cuentas habilitadas
                            para la empresa. Default = cuenta del reparto
                            del proyecto. El operador puede sobrescribir
                            con cualquier cuenta nivel 4 activa. */}
                        <select
                          value={l.cuenta}
                          onChange={(e) => setOverride(l.fuente, e.target.value)}
                          className={`w-full rounded-md border bg-white px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cehta-green ${
                            cuentaVacia
                              ? "border-negative ring-1 ring-negative/30 text-negative"
                              : overrideado
                                ? "border-amber-300 text-amber-900"
                                : "border-hairline text-ink-700"
                          }`}
                          title={
                            cuentaVacia
                              ? `El proyecto ${proyectoCodigo} no tiene cuenta default para ${l.fuente}. Elige una manualmente.`
                              : overrideado
                                ? `Override manual. Default del proyecto: ${l.cuentaDefault || "—"}`
                                : `Cuenta default del reparto del proyecto ${proyectoCodigo}`
                          }
                        >
                          <option value="">— Elegir cuenta —</option>
                          {cuentasDisponibles?.map((c) => (
                            <option key={c.codigo} value={c.codigo}>
                              {c.codigo} — {c.nombre}
                            </option>
                          ))}
                          {/* Si la cuenta actual no está en la lista
                              (ej. cuenta inactiva pero seteada en el reparto)
                              la mostramos igual para no perderla. */}
                          {l.cuenta &&
                            !cuentasDisponibles?.some((c) => c.codigo === l.cuenta) && (
                              <option value={l.cuenta}>
                                {l.cuenta} ⚠ (no listada)
                              </option>
                            )}
                        </select>
                        {overrideado && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...cuentaOverrides };
                              delete next[l.fuente];
                              setCuentaOverrides(next);
                            }}
                            className="mt-1 text-[10px] text-amber-700 hover:underline"
                            title={`Restaurar a la cuenta del reparto: ${l.cuentaDefault}`}
                          >
                            ↩ Volver al default ({l.cuentaDefault})
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono align-top">
                        {fmtCLP(l.monto)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-cehta-green/20 font-semibold">
                  <td className="py-1.5" colSpan={2}>TOTAL BRUTO</td>
                  <td className="py-1.5 text-right font-mono">{fmtCLP(bruto)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-ink-500">
              + 1 línea HABER en cuenta 2101-01 (Cuentas por pagar proveedores)
              por {fmtCLP(bruto)} para cuadrar la partida doble.
            </p>
            {cuentasFaltantes > 0 && (
              <div className="mt-3 rounded-lg bg-negative/10 ring-1 ring-negative/30 px-3 py-2 text-[12px] text-negative">
                <p className="font-semibold mb-1">
                  ⚠ El proyecto {proyectoCodigo} tiene {cuentasFaltantes}{" "}
                  cuenta{cuentasFaltantes === 1 ? "" : "s"} sin configurar
                </p>
                <p className="text-[11px] text-negative/85 leading-relaxed">
                  Antes de crear el voucher, andá a{" "}
                  <Link
                    href={`/admin/proyectos-contables/${proyectoCodigo}` as Route}
                    className="underline font-semibold"
                  >
                    /admin/proyectos-contables/{proyectoCodigo}
                  </Link>{" "}
                  y completá la sección &quot;Reparto default → Cuentas contables&quot;.
                  Sin estas, el backend rechazará el POST con{" "}
                  <code className="font-mono">&quot;Cuenta &apos;?&apos; no existe&quot;</code>.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Round 142 — 2 botones: Guardar DRAFT vs Crear + enviar a firma.
            Antes solo había un botón "Crear DRAFT" y el usuario tenía que
            ir al detalle del voucher para hacer Submit a aprobación manual.
            Ahora puede hacerlo en un click desde el form. */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-hairline">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => createMut.mutate("DRAFT")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-white px-5 py-2 text-sm font-semibold text-cehta-green hover:bg-cehta-green/5 disabled:opacity-60"
            title="Guardar el voucher como borrador. Después podés editarlo o enviarlo a aprobación desde el detalle."
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            {createMut.isPending && createMut.variables === "DRAFT"
              ? "Guardando…"
              : "Guardar borrador"}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => createMut.mutate("PENDING")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
            title="Crear el voucher Y mandarlo a aprobación en un solo paso. Si la partida doble cuadra y hay adjunto (si requerido), pasa a PENDING."
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            {createMut.isPending && createMut.variables === "PENDING"
              ? "Creando y enviando…"
              : "Crear y enviar a firma"}
          </button>
        </div>
      </Surface>

      {/* R152mm — Sección de descarga de planillas de rendición CORFO.
          Aparece debajo del form de voucher CORFO, scoped a la empresa
          actualmente seleccionada arriba (REVTECH o TRONGKAI). Llama a
          los endpoints /admin/corfo/rendicion/* del backend. */}
      <RendicionDescargaSection empresa={empresa} variant="full" />
    </div>
  );
}

function PctInput({
  label,
  value,
  setValue,
  monto,
  disabled,
  tone,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  monto: number;
  disabled: boolean | undefined;
  tone: "cehta" | "blue" | "ink";
}) {
  const ring =
    tone === "cehta"
      ? "ring-cehta-green/30 bg-cehta-green/5"
      : tone === "blue"
        ? "ring-blue-300/40 bg-blue-50/40"
        : "ring-hairline bg-ink-50/50";
  return (
    <div className={`rounded-lg ring-1 ${ring} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-600">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          step={0.01}
          min={0}
          max={100}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(Number(e.target.value))}
          className="w-20 rounded-md border-0 bg-white px-2 py-1 text-sm ring-1 ring-hairline focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
        />
        <span className="text-sm text-ink-500">%</span>
      </div>
      <p className="mt-1 text-xs font-mono text-ink-700">{fmtCLP(monto)}</p>
    </div>
  );
}
