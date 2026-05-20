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
import type {
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
  const { data: proyectos } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables-corfo", empresa],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>(
        `/proyectos-contables?empresa_codigo=${empresa}`,
        session,
      ),
    enabled: !!session,
  });

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
      monto: number;
    }> = [];
    if (effectivePcts.corfo > 0) {
      out.push({
        label: `CORFO ${effectivePcts.corfo}%`,
        fuente: "CORFO_SUBSIDIO",
        cuenta: reparto.cuenta_aporte_corfo ?? "?",
        monto: Math.round((neto * effectivePcts.corfo) / 100),
      });
    }
    if (effectivePcts.ptec > 0) {
      out.push({
        label: `P-tec (CEHTA) ${effectivePcts.ptec}%`,
        fuente: "PTEC_CEHTA",
        cuenta: reparto.cuenta_aporte_ptec_cehta ?? "?",
        monto: Math.round((neto * effectivePcts.ptec) / 100),
      });
    }
    if (effectivePcts.empresa > 0) {
      out.push({
        label: `Empresa directa ${effectivePcts.empresa}%`,
        fuente: "EMPRESA_DIRECTA",
        cuenta: reparto.cuenta_aporte_empresa_directa ?? "?",
        monto: Math.round((neto * effectivePcts.empresa) / 100),
      });
    }
    // IVA siempre corporativo si afecta
    if (afecta && iva > 0) {
      out.push({
        label: "IVA crédito fiscal (siempre corporativo)",
        fuente: "IVA_CORPORATIVO",
        cuenta: reparto.cuenta_iva_corporativo ?? "?",
        monto: iva,
      });
    }
    return out;
  }, [reparto, effectivePcts, neto, iva, afecta]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!reparto) throw new Error("Proyecto sin configurar");
      // Construir lineas para POST /vouchers/nubox-form
      // Lado CONTABLE (DEBE): N lineas por fuente (CORFO/P-tec/Empresa) + 1 IVA si afecta.
      const informacion_contable = lineasPreview.map((l) => ({
        comentario: `${glosa || folio} · ${l.label}`,
        cuenta_codigo: l.cuenta,
        total: l.monto,
        proyecto_codigo: proyectoCodigo,
        area_codigo: null,
        fuente_financiamiento: l.fuente,
      }));
      // Lado FINANCIERO (HABER): contracuenta única, suma = bruto.
      // Usamos cuenta proveedores (2101-01) o caja si no aplica.
      const cuentaHaber = "2101-01"; // Cuentas por pagar proveedores (default)
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
        // Round 129 — campos antes hardcoded null, ahora controlables
        fecha_vencimiento: fechaVencimiento || null,
        documento_dropbox_path: documentoDropboxPath || null,
        glosa: glosa || `Voucher CORFO ${proyectoCodigo}`,
        informacion_contable,
        informacion_financiera,
        // Round 129 — fecha de pago va por separado al endpoint (si el
        // backend lo soporta). Lo agregamos al payload base — endpoints
        // que no lo procesen lo ignoran sin romper.
        ...(fechaPago ? { fecha_pago: fechaPago } : {}),
      };
      return apiClient.post<{ voucher_id: number; codigo: string }>(
        "/vouchers/nubox-form",
        payload,
        session,
      );
    },
    onSuccess: (r) => {
      toast.success(`Voucher ${r.codigo} creado · DRAFT`);
      router.push(`/vouchers/${r.voucher_id}` as Route);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo crear el voucher",
        { duration: 8000 },
      );
    },
  });

  const canSubmit =
    !!session &&
    !!proyectoCodigo &&
    !!folio.trim() &&
    neto > 0 &&
    (afecta && !asignaFinanciamiento ? true : sumaOk) &&
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
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 dark:bg-ink-900 ring-1 ring-hairline p-8 shadow-card">
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
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent dark:from-white dark:via-ink-100 dark:to-cehta-green">
            Reparto CORFO / P-tec / Empresa
          </h1>
          <p className="text-sm md:text-base text-ink-500 dark:text-ink-400 mt-2 max-w-2xl">
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
            {!proyectos && <option>Cargando proyectos...</option>}
            {proyectos &&
              proyectos.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.codigo} — {p.nombre}
                </option>
              ))}
            {proyectos && proyectos.length === 0 && (
              <option value="">⚠ No hay proyectos cargados para {empresa}</option>
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
          <div className="rounded-xl border border-cehta-green/20 bg-cehta-green/5 p-4">
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
                {lineasPreview.map((l, i) => (
                  <tr key={i} className="border-t border-cehta-green/10">
                    <td className="py-1.5">{l.label}</td>
                    <td className="py-1.5 font-mono text-xs">{l.cuenta}</td>
                    <td className="py-1.5 text-right font-mono">{fmtCLP(l.monto)}</td>
                  </tr>
                ))}
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
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-hairline">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => createMut.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
          >
            <FileText className="h-4 w-4" strokeWidth={1.75} />
            {createMut.isPending ? "Creando..." : "Crear voucher DRAFT"}
          </button>
        </div>
      </Surface>
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
