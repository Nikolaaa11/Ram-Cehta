"use client";

/**
 * /gastos — R152VVVVVV · Área de gastos rápidos (Marketing / Desarrollo).
 *
 * Página SÚPER simple pensada para usuarios operativos (ej. Erick Méndez)
 * que solo necesitan reportar gastos sin conocer contabilidad:
 *   1. Elegir categoría (Marketing / Desarrollo) — grande, con emoji.
 *   2. Elegir empresa (solo las que su scope permite).
 *   3. Foto de la boleta/factura (opcional) → la IA autocompleta monto,
 *      fecha y proveedor vía /vouchers/extract-from-upload.
 *   4. Monto + fecha + detalle → POST /vouchers como EGRESO en DRAFT.
 *
 * La imputación contable queda pre-armada (invariante: el operador NO
 * inventa cuentas — usamos cuentas existentes + centro de costo):
 *   Marketing  → debe 4201-08 GASTOS GENERALES        · área COM
 *   Desarrollo → debe 4201-37 SERVICIOS COMPUTACIONALES · área TIC
 *   Contrapartida → haber 2102-01 FACTURAS POR PAGAR, CORRIENTES
 * El voucher nace DRAFT: el contador revisa/reclasifica y sigue el flujo
 * normal de firmas (GG + DIRECTOR). Nada se paga desde aquí.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Megaphone,
  MonitorSmartphone,
  Paperclip,
  ReceiptText,
  Sparkles,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmpresaMetadata {
  codigo: string;
  razon_social: string;
}

interface FormMetadata {
  empresas: EmpresaMetadata[];
}

interface ExtractedLine {
  comentario: string;
  cuenta_codigo: string;
  total: string;
}

interface ExtractResponse {
  suggestion: {
    proveedor_rut: string;
    proveedor_nombre: string;
    tipo_documento: string;
    numero_documento: string;
    fecha_documento: string;
    glosa: string;
    informacion_contable: ExtractedLine[];
  };
  warnings: string[];
  dropbox_path: string | null;
}

interface CreatedVoucher {
  voucher_id: number;
  codigo: string;
}

/** Categorías cerradas — mapeo a cuenta imputable existente + centro de costo. */
const CATEGORIAS = [
  {
    key: "MARKETING",
    label: "Marketing",
    icon: Megaphone,
    hint: "Publicidad, redes sociales, diseño, eventos, merchandising",
    cuenta: "4201-08", // GASTOS GENERALES
    area: "COM", // Comercial y Desarrollo de Negocio
  },
  {
    key: "DESARROLLO",
    label: "Desarrollo",
    icon: MonitorSmartphone,
    hint: "Software, web, apps, licencias, servicios informáticos",
    cuenta: "4201-37", // SERVICIOS COMPUTACIONALES
    area: "TIC", // Tecnología y Sistemas
  },
  // MEGAPROMPT PREVOUCHER — categoría universal: cualquier gasto entra como
  // pre-voucher y el especialista reclasifica la cuenta al procesarlo.
  {
    key: "OTRO",
    label: "Otro gasto",
    icon: ReceiptText,
    hint: "Cualquier otro gasto o compra — finanzas lo clasifica",
    cuenta: "4201-08", // GASTOS GENERALES (el contador reclasifica)
    area: "ADM", // Administración y Finanzas
  },
] as const;

const CUENTA_POR_PAGAR = "2102-01"; // FACTURAS POR PAGAR, CORRIENTES

// Tipos de doc tributario que el backend acepta con seguridad desde extract.
const DOC_TIPOS_SEGUROS = new Set(["FACTURA", "BOLETA", "NOTA_CREDITO"]);

const ACCEPT_FOTO = ".pdf,.jpg,.jpeg,.png,.heic,.webp,image/*,application/pdf";

function parseCLP(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function formatCLP(n: number): string {
  return n.toLocaleString("es-CL");
}

function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export default function GastosRapidosPage() {
  const { session } = useSession();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [meta, setMeta] = useState<FormMetadata | null>(null);
  const [categoria, setCategoria] = useState<string>("");
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [detalle, setDetalle] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [proveedorRut, setProveedorRut] = useState("");
  const [docTipo, setDocTipo] = useState<string | null>(null);
  const [docFolio, setDocFolio] = useState<string | null>(null);
  const [dropboxPath, setDropboxPath] = useState<string | null>(null);
  const [adjuntoNombre, setAdjuntoNombre] = useState<string | null>(null);

  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState<CreatedVoucher | null>(null);
  const [historial, setHistorial] = useState<
    { codigo: string; empresa: string; monto: number; categoria: string }[]
  >([]);

  useEffect(() => {
    if (!session) return;
    apiClient
      .get<FormMetadata>("/vouchers/form-metadata", session)
      .then((m) => {
        setMeta(m);
        const unica = m.empresas.length === 1 ? m.empresas[0] : undefined;
        if (unica) setEmpresaCodigo(unica.codigo);
      })
      .catch(() => toast.error("No pude cargar las empresas. Refrescá la página."));
  }, [session]);

  const cat = useMemo(
    () => CATEGORIAS.find((c) => c.key === categoria) ?? null,
    [categoria],
  );
  const montoNum = parseCLP(monto);
  const listo =
    !!cat && !!empresaCodigo && montoNum > 0 && detalle.trim().length >= 3 && !!fecha;

  async function handleFoto(file: File) {
    if (!session) return;
    if (!empresaCodigo) {
      toast.error("Elegí primero la empresa — la foto se guarda en su carpeta.");
      return;
    }
    setAnalizando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("empresa_codigo", empresaCodigo);
      const res = await apiClient.postForm<ExtractResponse>(
        "/vouchers/extract-from-upload",
        fd,
        session,
      );
      const s = res.suggestion;
      // Autocompletar SOLO campos vacíos — lo que el usuario ya escribió manda.
      const totalExtraido = (s.informacion_contable ?? []).reduce(
        (acc, l) => acc + parseCLP(l.total ?? ""),
        0,
      );
      if (!montoNum && totalExtraido > 0) setMonto(String(totalExtraido));
      if (!detalle.trim() && s.glosa) setDetalle(s.glosa.slice(0, 200));
      if (!proveedorNombre && s.proveedor_nombre) setProveedorNombre(s.proveedor_nombre);
      if (!proveedorRut && s.proveedor_rut) setProveedorRut(s.proveedor_rut);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.fecha_documento ?? "")) setFecha(s.fecha_documento);
      if (s.tipo_documento && DOC_TIPOS_SEGUROS.has(s.tipo_documento)) {
        setDocTipo(s.tipo_documento);
        if (s.numero_documento) setDocFolio(s.numero_documento.slice(0, 50));
      }
      setDropboxPath(res.dropbox_path);
      setAdjuntoNombre(file.name);
      toast.success("Foto leída — revisá que el monto y la fecha estén bien.");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "No pude leer el archivo. Podés cargar el gasto igual, a mano.";
      toast.error(msg);
    } finally {
      setAnalizando(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleEnviar() {
    if (!session || !cat || !listo || enviando) return;
    setEnviando(true);
    try {
      const glosa = `Gasto ${cat.label}: ${detalle.trim()}`.slice(0, 500);
      const payload = {
        empresa_codigo: empresaCodigo,
        tipo: "EGRESO",
        status: "DRAFT",
        // MEGAPROMPT PREVOUCHER — marca el origen: entra a la cola de
        // /prevouchers para que el especialista lo complete.
        source: "prevoucher",
        fecha_documento: fecha,
        fecha_contable: fecha,
        glosa,
        moneda: "CLP",
        ...(proveedorNombre.trim()
          ? {
              contraparte_nombre: proveedorNombre.trim().slice(0, 200),
              contraparte_tipo: "PROVEEDOR",
              ...(proveedorRut.trim() ? { contraparte_rut: proveedorRut.trim().slice(0, 20) } : {}),
            }
          : {}),
        ...(docTipo && docFolio
          ? { doc_tributario_tipo: docTipo, doc_tributario_folio: docFolio }
          : {}),
        ...(dropboxPath ? { documento_dropbox_path: dropboxPath } : {}),
        lines: [
          {
            line_number: 1,
            cuenta_codigo: cat.cuenta,
            area_codigo: cat.area,
            debit: montoNum,
            credit: 0,
            descripcion: detalle.trim().slice(0, 300),
          },
          {
            line_number: 2,
            cuenta_codigo: CUENTA_POR_PAGAR,
            debit: 0,
            credit: montoNum,
            descripcion: `Por pagar — ${proveedorNombre.trim() || cat.label}`.slice(0, 300),
          },
        ],
      };
      const created = await apiClient.post<CreatedVoucher>("/vouchers", payload, session);
      setCreado(created);
      setHistorial((h) => [
        { codigo: created.codigo, empresa: empresaCodigo, monto: montoNum, categoria: cat.label },
        ...h,
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "No se pudo enviar el gasto. Probá de nuevo.";
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  function resetForm() {
    setCreado(null);
    setMonto("");
    setDetalle("");
    setProveedorNombre("");
    setProveedorRut("");
    setDocTipo(null);
    setDocFolio(null);
    setDropboxPath(null);
    setAdjuntoNombre(null);
    setFecha(todayISO());
    // categoría y empresa se mantienen — lo normal es cargar varios seguidos
  }

  // ---------- Pantalla de éxito ----------
  if (creado) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-cehta-green/10 ring-1 ring-cehta-green/30">
          <CheckCircle2 className="h-10 w-10 text-cehta-green" strokeWidth={1.5} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
          ¡Pre-voucher enviado!
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Quedó registrado como{" "}
          <span className="font-mono font-semibold text-ink-900">{creado.codigo}</span>{" "}
          en la cola de finanzas.
          <br />
          Un especialista lo va a completar y mandar a firmas.
        </p>
        <Button className="mt-8 w-full" size="lg" onClick={resetForm}>
          Cargar otro gasto
        </Button>
        <Link
          href={{ pathname: `/vouchers/${creado.voucher_id}` }}
          className="mt-3 text-sm font-medium text-cehta-green hover:underline"
        >
          Ver el detalle →
        </Link>
        {historial.length > 0 && (
          <div className="mt-10 w-full text-left">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
              Enviados en esta sesión
            </p>
            <ul className="divide-y divide-hairline rounded-xl ring-1 ring-hairline bg-white">
              {historial.map((g) => (
                <li key={g.codigo} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-ink-700">
                    {g.categoria} · {g.empresa}
                  </span>
                  <span className="font-medium tabular-nums text-ink-900">
                    ${formatCLP(g.monto)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ---------- Formulario ----------
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-24 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Cargar un gasto</h1>
      <p className="mt-1 text-sm text-ink-500">
        3 datos y listo. Finanzas se encarga del resto.
      </p>

      {/* 1 · Categoría */}
      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">
        1 · ¿De qué es el gasto?
      </p>
      <div className="grid grid-cols-2 gap-3">
        {CATEGORIAS.map((c) => {
          const Icon = c.icon;
          const active = categoria === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategoria(c.key)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-2xl p-4 text-left ring-1 transition-all",
                active
                  ? "bg-cehta-green text-white ring-cehta-green shadow-glow-green"
                  : "bg-white text-ink-900 ring-hairline hover:ring-cehta-green/40",
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={1.5} />
              <span className="text-base font-semibold">{c.label}</span>
              <span className={cn("text-[11px] leading-snug", active ? "text-white/80" : "text-ink-500")}>
                {c.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2 · Empresa */}
      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">
        2 · ¿Para qué empresa?
      </p>
      <select
        value={empresaCodigo}
        onChange={(e) => setEmpresaCodigo(e.target.value)}
        className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
      >
        <option value="">— Elegir empresa —</option>
        {(meta?.empresas ?? []).map((e) => (
          <option key={e.codigo} value={e.codigo}>
            {e.codigo} — {e.razon_social}
          </option>
        ))}
      </select>

      {/* 3 · Foto (opcional) */}
      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">
        3 · Boleta o factura <span className="font-normal normal-case">(opcional — autocompleta solo)</span>
      </p>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFoto(e.target.files[0])}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_FOTO}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFoto(e.target.files[0])}
      />
      {adjuntoNombre ? (
        <div className="flex items-center justify-between rounded-xl bg-cehta-green/5 px-4 py-3 ring-1 ring-cehta-green/30">
          <span className="flex min-w-0 items-center gap-2 text-sm text-ink-700">
            <Paperclip className="h-4 w-4 shrink-0 text-cehta-green" />
            <span className="truncate">{adjuntoNombre}</span>
          </span>
          <button
            type="button"
            aria-label="Quitar adjunto"
            onClick={() => {
              setDropboxPath(null);
              setAdjuntoNombre(null);
            }}
            className="ml-2 shrink-0 text-ink-500 hover:text-negative"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-xl"
            disabled={analizando}
            onClick={() => cameraInputRef.current?.click()}
          >
            {analizando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            Sacar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-xl"
            disabled={analizando}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
            Subir archivo
          </Button>
        </div>
      )}
      {analizando && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
          <Sparkles className="h-3.5 w-3.5 text-cehta-green" />
          Leyendo el documento con IA…
        </p>
      )}

      {/* 4 · Datos */}
      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">
        4 · Los datos
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="gasto-monto" className="mb-1 block text-xs font-medium text-ink-700">
            Monto (CLP) <span className="text-negative">*</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink-500">
              $
            </span>
            <input
              id="gasto-monto"
              inputMode="numeric"
              autoComplete="off"
              value={montoNum ? formatCLP(montoNum) : ""}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0"
              className="h-14 w-full rounded-xl border-0 bg-white pl-9 pr-4 text-2xl font-semibold tabular-nums text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
        <div>
          <label htmlFor="gasto-detalle" className="mb-1 block text-xs font-medium text-ink-700">
            ¿Qué compraste? <span className="text-negative">*</span>
          </label>
          <input
            id="gasto-detalle"
            type="text"
            value={detalle}
            maxLength={200}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Ej: Campaña Instagram julio / Hosting sitio web"
            className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="gasto-fecha" className="mb-1 block text-xs font-medium text-ink-700">
              Fecha <span className="text-negative">*</span>
            </label>
            <input
              id="gasto-fecha"
              type="date"
              value={fecha}
              max={todayISO()}
              onChange={(e) => setFecha(e.target.value)}
              className="h-12 w-full rounded-xl border-0 bg-white px-3 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div>
            <label htmlFor="gasto-proveedor" className="mb-1 block text-xs font-medium text-ink-700">
              Proveedor <span className="text-ink-300">(opcional)</span>
            </label>
            <input
              id="gasto-proveedor"
              type="text"
              value={proveedorNombre}
              maxLength={200}
              onChange={(e) => setProveedorNombre(e.target.value)}
              placeholder="Ej: Meta, Google…"
              className="h-12 w-full rounded-xl border-0 bg-white px-3 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
      </div>

      {/* Enviar */}
      <Button
        type="button"
        size="lg"
        className="mt-7 h-14 w-full rounded-xl text-base"
        disabled={!listo || enviando}
        onClick={handleEnviar}
      >
        {enviando ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
          </>
        ) : (
          <>
            Enviar gasto
            {montoNum > 0 && <span className="tabular-nums">· ${formatCLP(montoNum)}</span>}
            <ChevronRight className="h-4 w-4" />
          </>
        )}
      </Button>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-500">
        El gasto queda en borrador para revisión de finanzas.
        <br />
        Desde acá no se paga nada — solo se reporta.
      </p>
    </div>
  );
}
