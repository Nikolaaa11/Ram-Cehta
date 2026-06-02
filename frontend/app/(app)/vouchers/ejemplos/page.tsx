"use client";

/**
 * /vouchers/ejemplos — Guía de datos mínimos para crear un voucher
 * (R152uuu, item #2 de MEJORAS IA.docx).
 *
 * El operador (o el extractor IA, o el importador CSV) necesita saber
 * exactamente qué campos llenar. Esta página es una "ficha técnica"
 * con:
 *   1. Datos mínimos obligatorios
 *   2. Datos opcionales recomendados
 *   3. Ejemplos reales (Compra, Venta, Egreso, Traspaso)
 *   4. Prompts listos para usar con ChatGPT/Claude/IA propia
 *   5. CSV de ejemplo descargable
 */
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import {
  FileText,
  Sparkles,
  Receipt,
  Download,
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Wallet,
  TrendingUp,
  ArrowLeftRight,
  Upload,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

interface FieldDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  example: string;
  description: string;
}

const CABECERA_FIELDS: FieldDef[] = [
  {
    key: "empresa_codigo",
    label: "Empresa",
    type: "código",
    required: true,
    example: "REVTECH",
    description: "Código corto de la empresa pagadora (REVTECH, TRONGKAI, CSL, RHO, etc.)",
  },
  {
    key: "tipo",
    label: "Tipo de voucher",
    type: "enum",
    required: true,
    example: "COMPRA",
    description:
      "COMPRA · VENTA · EGRESO · INGRESO · TRASPASO · APERTURA · CIERRE · REVERSO",
  },
  {
    key: "fecha_contable",
    label: "Fecha contable",
    type: "fecha",
    required: true,
    example: "2026-04-15",
    description: "Día contable del asiento. Formato AAAA-MM-DD.",
  },
  {
    key: "glosa",
    label: "Glosa",
    type: "texto libre",
    required: true,
    example: "Pago factura 12345 — Servicios consultoría TI abril REVTECH",
    description: "Descripción del asiento. Idealmente con proveedor, mes y concepto.",
  },
  {
    key: "contraparte_rut",
    label: "RUT de la contraparte",
    type: "texto",
    required: false,
    example: "76.234.567-8",
    description:
      "RUT del proveedor o cliente. Si existe en el catálogo, se auto-completa el nombre.",
  },
  {
    key: "contraparte_nombre",
    label: "Razón social",
    type: "texto",
    required: false,
    example: "PROVEEDOR DEMO SPA",
    description: "Si NO está en el catálogo, se crea un proveedor nuevo automáticamente.",
  },
  {
    key: "doc_tributario_tipo",
    label: "Tipo doc tributario",
    type: "enum",
    required: false,
    example: "FACTURA",
    description: "FACTURA · BOLETA · NOTA_CREDITO · NOTA_DEBITO · GUIA_DESPACHO",
  },
  {
    key: "doc_tributario_folio",
    label: "Folio",
    type: "texto",
    required: false,
    example: "12345",
    description: "Número del documento tributario.",
  },
  {
    key: "moneda",
    label: "Moneda",
    type: "código ISO",
    required: false,
    example: "CLP",
    description: "CLP por defecto. Otras: USD, EUR, UF.",
  },
  {
    key: "forma_pago",
    label: "Forma de pago",
    type: "enum",
    required: false,
    example: "TRANSFERENCIA",
    description: "TRANSFERENCIA · CHEQUE · EFECTIVO · TARJETA_CREDITO · CONTADO",
  },
];

const LINEA_FIELDS: FieldDef[] = [
  {
    key: "cuenta_codigo",
    label: "Código de cuenta",
    type: "texto",
    required: true,
    example: "5-1-1-001",
    description: "Código del plan de cuentas. Debe existir en el catálogo de la empresa.",
  },
  {
    key: "debit",
    label: "Débito (DEBE)",
    type: "decimal",
    required: true,
    example: "1000000",
    description: "Monto en DEBE. Total de DEBE debe ser = total de HABER (partida doble).",
  },
  {
    key: "credit",
    label: "Crédito (HABER)",
    type: "decimal",
    required: true,
    example: "0",
    description: "Monto en HABER. Por línea solo se llena uno: o DEBE o HABER, no ambos.",
  },
  {
    key: "comentario",
    label: "Comentario",
    type: "texto",
    required: false,
    example: "Servicios profesionales abril 2026",
    description: "Descripción de la línea individual (puede ser distinta de la glosa global).",
  },
  {
    key: "iva_amount",
    label: "Monto IVA",
    type: "decimal",
    required: false,
    example: "190000",
    description: "Si la línea tiene IVA, indicar el monto. Solo aplica para FACTURA.",
  },
  {
    key: "proyecto_codigo",
    label: "Proyecto contable",
    type: "código",
    required: false,
    example: "PRJ-REVTECH-COR-001",
    description: "Si se imputa a un proyecto del catálogo. Opcional pero recomendado para CORFO.",
  },
];

const EJEMPLOS = [
  {
    tipo: "COMPRA · Factura proveedor",
    icon: Receipt,
    color: "emerald",
    payload: {
      empresa_codigo: "REVTECH",
      tipo: "COMPRA",
      fecha_contable: "2026-04-15",
      glosa: "Pago factura 12345 — Consultoría TI abril 2026",
      contraparte_rut: "76.234.567-8",
      contraparte_nombre: "TI Consultores SpA",
      doc_tributario_tipo: "FACTURA",
      doc_tributario_folio: "12345",
      moneda: "CLP",
      forma_pago: "TRANSFERENCIA",
      lineas: [
        { cuenta_codigo: "5-1-1-001", debit: 1000000, credit: 0, comentario: "Servicios netos" },
        { cuenta_codigo: "1-1-1-005", debit: 190000, credit: 0, iva_amount: 190000, comentario: "IVA 19%" },
        { cuenta_codigo: "2-1-1-001", debit: 0, credit: 1190000, comentario: "Cuentas por pagar" },
      ],
    },
  },
  {
    tipo: "VENTA · Factura cliente",
    icon: TrendingUp,
    color: "blue",
    payload: {
      empresa_codigo: "RHO",
      tipo: "VENTA",
      fecha_contable: "2026-04-20",
      glosa: "Venta generación abril 2026 — Cliente ABC",
      contraparte_rut: "99.123.456-7",
      contraparte_nombre: "Cliente ABC SpA",
      doc_tributario_tipo: "FACTURA",
      doc_tributario_folio: "5001",
      moneda: "CLP",
      lineas: [
        { cuenta_codigo: "1-1-2-001", debit: 11900000, credit: 0, comentario: "Cuentas por cobrar" },
        { cuenta_codigo: "4-1-1-001", debit: 0, credit: 10000000, comentario: "Ingreso neto" },
        { cuenta_codigo: "2-1-1-005", debit: 0, credit: 1900000, iva_amount: 1900000, comentario: "IVA débito" },
      ],
    },
  },
  {
    tipo: "EGRESO · Pago sin factura",
    icon: Wallet,
    color: "amber",
    payload: {
      empresa_codigo: "CSL",
      tipo: "EGRESO",
      fecha_contable: "2026-04-22",
      glosa: "Pago arriendo oficina abril 2026",
      contraparte_rut: "78.555.111-1",
      contraparte_nombre: "Inmobiliaria XYZ Ltda",
      moneda: "CLP",
      forma_pago: "TRANSFERENCIA",
      lineas: [
        { cuenta_codigo: "5-2-1-002", debit: 500000, credit: 0, comentario: "Arriendo" },
        { cuenta_codigo: "1-1-1-001", debit: 0, credit: 500000, comentario: "Banco BCI" },
      ],
    },
  },
  {
    tipo: "TRASPASO · Entre bancos",
    icon: ArrowLeftRight,
    color: "purple",
    payload: {
      empresa_codigo: "TRONGKAI",
      tipo: "TRASPASO",
      fecha_contable: "2026-04-25",
      glosa: "Traspaso BCI → Santander para pagos abril",
      moneda: "CLP",
      lineas: [
        { cuenta_codigo: "1-1-1-002", debit: 5000000, credit: 0, comentario: "Santander destino" },
        { cuenta_codigo: "1-1-1-001", debit: 0, credit: 5000000, comentario: "BCI origen" },
      ],
    },
  },
];

const PROMPT_IA = `Extrae los datos de esta factura/boleta y devuélvelos como JSON con esta estructura EXACTA:

{
  "empresa_codigo": "REVTECH | TRONGKAI | CSL | RHO | AFIS | CEHTA | CENERGY | EVOQUE | DTE",
  "tipo": "COMPRA",
  "fecha_contable": "AAAA-MM-DD (fecha del documento)",
  "glosa": "Pago factura {folio} — {concepto breve}",
  "contraparte_rut": "11.111.111-1 (formato chileno con puntos y guión)",
  "contraparte_nombre": "RAZON SOCIAL COMPLETA",
  "doc_tributario_tipo": "FACTURA | BOLETA | NOTA_CREDITO",
  "doc_tributario_folio": "número del documento",
  "moneda": "CLP",
  "forma_pago": "TRANSFERENCIA | CHEQUE | EFECTIVO",
  "lineas": [
    {
      "cuenta_codigo": "5-1-1-001",
      "debit": 1000000,
      "credit": 0,
      "comentario": "descripción del gasto"
    },
    {
      "cuenta_codigo": "1-1-1-005",
      "debit": 190000,
      "credit": 0,
      "iva_amount": 190000,
      "comentario": "IVA 19%"
    },
    {
      "cuenta_codigo": "2-1-1-001",
      "debit": 0,
      "credit": 1190000,
      "comentario": "Cuentas por pagar al proveedor"
    }
  ]
}

REGLAS:
- Suma total de DEBE = suma total de HABER (partida doble OBLIGATORIA).
- Para FACTURA con IVA: línea 1 = neto en DEBE, línea 2 = IVA en DEBE, línea 3 = total en HABER.
- Monto en pesos chilenos sin separador de miles ni decimales.
- Si dudás del cuenta_codigo, pregúntame antes de devolver el JSON.`;

export default function VouchersEjemplosPage() {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
    toast.success("Copiado al portapapeles");
  };

  const downloadCsv = () => {
    const header =
      "empresa_codigo,tipo,fecha_contable,glosa,contraparte_rut,contraparte_nombre,doc_tributario_tipo,doc_tributario_folio,moneda,forma_pago,linea_cuenta_codigo,linea_debit,linea_credit,linea_comentario,linea_iva_amount,linea_proyecto_codigo";
    const rows = [
      "REVTECH,COMPRA,2026-04-15,Pago factura 12345 — Consultoría TI abril,76.234.567-8,TI Consultores SpA,FACTURA,12345,CLP,TRANSFERENCIA,5-1-1-001,1000000,0,Servicios netos,,",
      "REVTECH,COMPRA,2026-04-15,Pago factura 12345 — Consultoría TI abril,76.234.567-8,TI Consultores SpA,FACTURA,12345,CLP,TRANSFERENCIA,1-1-1-005,190000,0,IVA 19%,190000,",
      "REVTECH,COMPRA,2026-04-15,Pago factura 12345 — Consultoría TI abril,76.234.567-8,TI Consultores SpA,FACTURA,12345,CLP,TRANSFERENCIA,2-1-1-001,0,1190000,Cuentas por pagar,,",
    ];
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ejemplo_voucher_REVTECH.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      {/* Header */}
      <header>
        <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
          <FileText className="size-3.5 text-cehta-green" strokeWidth={2} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Guía de datos para vouchers
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          ¿Qué datos lleva un voucher?
        </h1>
        <p className="mt-2 max-w-3xl text-base text-ink-600">
          Esta es la "ficha técnica" para crear un voucher desde cualquier
          fuente: formulario manual, IA (Claude/ChatGPT), importador CSV o
          extracción desde PDF. Mientras tengas los campos obligatorios, el
          voucher entra OK.
        </p>
      </header>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link
          href={"/vouchers/nuevo" as Route}
          className="group flex items-start gap-3 rounded-2xl border border-hairline bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <FileText className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              Crear voucher manual
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">Form paso a paso</p>
          </div>
        </Link>
        <Link
          href={"/vouchers/desde-mensaje" as Route}
          className="group flex items-start gap-3 rounded-2xl border border-hairline bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
            <MessageSquare className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              Crear desde texto/IA
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Pegar conversación o JSON
            </p>
          </div>
        </Link>
        <Link
          href={"/vouchers/importar" as Route}
          className="group flex items-start gap-3 rounded-2xl border border-hairline bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Upload className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              Importar CSV / Excel
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">Bulk + masivo</p>
          </div>
        </Link>
      </div>

      {/* Campos de cabecera */}
      <section className="rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            1. Datos de cabecera del voucher
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Los marcados con <span className="text-red-600">*</span> son
            obligatorios. El resto se autocompleta o queda en blanco.
          </p>
        </header>
        <div className="divide-y divide-hairline">
          {CABECERA_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-12 gap-4 px-6 py-3">
              <div className="col-span-12 md:col-span-3">
                <p className="text-sm font-semibold text-ink-900">
                  {f.label}
                  {f.required && (
                    <span className="ml-1 text-red-600">*</span>
                  )}
                </p>
                <code className="mt-0.5 text-[10px] text-ink-400">{f.key}</code>
              </div>
              <div className="col-span-12 md:col-span-2 text-[11px] text-ink-500">
                {f.type}
              </div>
              <div className="col-span-12 md:col-span-4">
                <p className="text-xs text-ink-700">{f.description}</p>
              </div>
              <div className="col-span-12 md:col-span-3">
                <code className="block rounded-lg bg-ink-50 px-2 py-1 text-[11px] font-mono text-ink-700">
                  {f.example}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Líneas */}
      <section className="rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            2. Líneas contables (1 o más)
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Cada línea es una entrada del libro mayor. La{" "}
            <strong>partida doble</strong> se valida:{" "}
            <code>SUM(debit) === SUM(credit)</code>.
          </p>
        </header>
        <div className="divide-y divide-hairline">
          {LINEA_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-12 gap-4 px-6 py-3">
              <div className="col-span-12 md:col-span-3">
                <p className="text-sm font-semibold text-ink-900">
                  {f.label}
                  {f.required && (
                    <span className="ml-1 text-red-600">*</span>
                  )}
                </p>
                <code className="mt-0.5 text-[10px] text-ink-400">{f.key}</code>
              </div>
              <div className="col-span-12 md:col-span-2 text-[11px] text-ink-500">
                {f.type}
              </div>
              <div className="col-span-12 md:col-span-4">
                <p className="text-xs text-ink-700">{f.description}</p>
              </div>
              <div className="col-span-12 md:col-span-3">
                <code className="block rounded-lg bg-ink-50 px-2 py-1 text-[11px] font-mono text-ink-700">
                  {f.example}
                </code>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Ejemplos JSON */}
      <section>
        <h2 className="mb-4 text-base font-semibold tracking-tight text-ink-900">
          3. Ejemplos completos (4 casos comunes)
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {EJEMPLOS.map((ej) => {
            const Icon = ej.icon;
            const json = JSON.stringify(ej.payload, null, 2);
            return (
              <div
                key={ej.tipo}
                className="rounded-2xl border border-hairline bg-white shadow-card"
              >
                <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`size-4 text-${ej.color}-700`}
                      strokeWidth={2}
                    />
                    <p className="text-sm font-semibold text-ink-900">
                      {ej.tipo}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(json, ej.tipo)}
                    className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-[10px] font-medium text-ink-700 hover:bg-ink-50"
                  >
                    {copiedField === ej.tipo ? (
                      <>
                        <CheckCircle2 className="size-3 text-emerald-600" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        Copiar JSON
                      </>
                    )}
                  </button>
                </header>
                <pre className="overflow-x-auto bg-ink-50/50 px-4 py-3 text-[10px] leading-relaxed text-ink-800">
                  <code>{json}</code>
                </pre>
              </div>
            );
          })}
        </div>
      </section>

      {/* Prompt IA */}
      <section className="rounded-2xl border border-purple-200 bg-purple-50/40 p-5">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-purple-700" strokeWidth={2} />
            <h2 className="text-base font-semibold text-purple-900">
              4. Prompt listo para IA (Claude / ChatGPT)
            </h2>
          </div>
          <button
            type="button"
            onClick={() => copy(PROMPT_IA, "prompt")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
          >
            {copiedField === "prompt" ? (
              <>
                <CheckCircle2 className="size-3.5" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copiar prompt
              </>
            )}
          </button>
        </header>
        <p className="mt-2 text-xs text-purple-800">
          Pega este prompt + una foto/PDF de la factura en cualquier modelo de
          IA. El JSON resultante se puede pegar en{" "}
          <Link
            href={"/vouchers/desde-mensaje" as Route}
            className="font-semibold underline hover:text-purple-900"
          >
            /vouchers/desde-mensaje
          </Link>
          .
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-white px-4 py-3 text-[11px] leading-relaxed text-ink-800 ring-1 ring-purple-200">
          <code>{PROMPT_IA}</code>
        </pre>
      </section>

      {/* CSV download */}
      <section className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-amber-900">
              5. Template CSV para importar masivo
            </h2>
            <p className="mt-1 text-xs text-amber-800">
              Cada fila = una línea contable. Si un voucher tiene 3 líneas,
              repetir los datos de cabecera en 3 filas.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-amber-800"
          >
            <Download className="size-4" strokeWidth={1.8} />
            Descargar template CSV
          </button>
        </div>
      </section>

      {/* Validaciones obligatorias */}
      <section className="rounded-2xl border border-red-200 bg-red-50/40 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="mt-1 size-5 shrink-0 text-red-700"
            strokeWidth={2}
          />
          <div>
            <h2 className="text-base font-semibold text-red-900">
              Validaciones que el sistema rechaza
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs text-red-900">
              <li>
                ❌ <strong>SUM(debit) ≠ SUM(credit)</strong> — la partida doble es obligatoria.
              </li>
              <li>
                ❌ <strong>Sin líneas</strong> — un voucher debe tener al menos 1 línea.
              </li>
              <li>
                ❌ <strong>cuenta_codigo inexistente</strong> en el plan de cuentas de la empresa.
              </li>
              <li>
                ❌ <strong>empresa_codigo inválido</strong> — debe estar en el catálogo de empresas activas.
              </li>
              <li>
                ❌ <strong>fecha_contable futura</strong> — no se pueden crear vouchers con fecha posterior a hoy.
              </li>
              <li>
                ❌ <strong>tipo inválido</strong> — solo se aceptan los 8 valores del enum: COMPRA, VENTA, EGRESO, INGRESO, TRASPASO, APERTURA, CIERRE, REVERSO.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="text-center">
        <Link
          href={"/vouchers/nuevo" as Route}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-6 py-3 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
        >
          Crear mi primer voucher
          <ArrowRight className="size-4" strokeWidth={2} />
        </Link>
      </section>
    </div>
  );
}
