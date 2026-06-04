"use client";

/**
 * /ayuda — Centro de Ayuda (Round 152i).
 *
 * Landing que lista las guías HTML interactivas + tips rápidos. Las guías
 * viven en /public/ayuda/*.html y se abren en pestaña nueva (self-contained).
 */
import {
  BookOpen,
  Receipt,
  HelpCircle,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Building2,
  Wallet,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";

const GUIDES = [
  {
    title: "Guía de la Plataforma",
    desc: "Para los encargados. Explica cada módulo y función: roles, núcleo operativo, empresas, SII, dashboard institucional, contabilidad y administración.",
    href: "/ayuda/plataforma.html",
    icon: BookOpen,
    badge: "13 secciones",
  },
  {
    title: "Guía de Vouchers",
    desc: "El flujo completo de vouchers de la A a la Z: qué son, ciclo de vida, cómo crearlos, firmarlos, pagarlos, carga masiva y exportar a Nubox.",
    href: "/ayuda/vouchers.html",
    icon: Receipt,
    badge: "12 secciones",
  },
];

// Round 152r — destacados directos a las secciones más útiles (FAQ + Errores).
const HIGHLIGHTS = [
  {
    title: "FAQ — Plataforma",
    desc: "Las 8 preguntas más preguntadas por los encargados, ordenadas por frecuencia real.",
    href: "/ayuda/plataforma.html#faq",
    icon: MessageCircle,
    accent: "emerald",
  },
  {
    title: "Errores comunes — Plataforma",
    desc: "6 errores con su tasa de incidencia + mensaje literal + cómo arreglarlo.",
    href: "/ayuda/plataforma.html#errores",
    icon: AlertTriangle,
    accent: "red",
  },
  {
    title: "FAQ — Vouchers",
    desc: "Las 8 dudas top sobre el flujo de vouchers: firmas, estados, pagos, CORFO.",
    href: "/ayuda/vouchers.html#faq",
    icon: MessageCircle,
    accent: "emerald",
  },
  {
    title: "Errores Vouchers — mayor tasa",
    desc: "Top 6 problemas que paran el flujo: no cuadra, cuenta inexistente, doble pago, etc.",
    href: "/ayuda/vouchers.html#tasa-error",
    icon: AlertTriangle,
    accent: "red",
  },
];

const QUICK = [
  { icon: Wallet, title: "Cómo pagar", text: "Voucher → 2 firmas → Confirmar pagos (planilla banco) → Marcar pagado. Nunca sale plata sin las 2 firmas." },
  { icon: Building2, title: "Ver una empresa", text: "Menú lateral → Empresas → elegí una. Tiene 14 pestañas: contabilidad, valuación, impacto, tributario, etc." },
  { icon: ShieldCheck, title: "SII conectado", text: "Las 9 empresas tienen credenciales SII validadas. Admin → Integración SII para sincronizar RCV y F29." },
  { icon: Sparkles, title: "Ayuda contextual", text: "En cualquier página, el botón (?) abajo a la izquierda muestra el instructivo del módulo donde estés." },
];

export default function AyudaPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <HelpCircle className="size-7" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Centro de Ayuda
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Guías prácticas para entender y operar la plataforma del FIP CEHTA ESG.
          </p>
        </div>
      </div>

      {/* Guías principales */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {GUIDES.map((g) => {
          const Icon = g.icon;
          return (
            <a
              key={g.href}
              href={g.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-hairline bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated-lg"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-12 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green">
                  <Icon className="size-6" strokeWidth={1.6} />
                </div>
                <span className="rounded-full bg-ink-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                  {g.badge}
                </span>
              </div>
              <h2 className="mt-4 flex items-center gap-1.5 text-lg font-semibold text-ink-900">
                {g.title}
                <ExternalLink className="size-3.5 text-ink-300 transition-colors group-hover:text-cehta-green" />
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{g.desc}</p>
            </a>
          );
        })}
      </div>

      {/* Highlights — FAQ + Errores (acceso directo) */}
      <h3 className="mt-10 mb-4 text-xs font-semibold uppercase tracking-wider text-ink-400">
        Atajos directos a lo más útil
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {HIGHLIGHTS.map((h) => {
          const Icon = h.icon;
          const isRed = h.accent === "red";
          return (
            <a
              key={h.href}
              href={h.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`group flex gap-3 rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-card ${
                isRed
                  ? "border-red-100 bg-red-50/30 hover:border-red-200"
                  : "border-emerald-100 bg-emerald-50/30 hover:border-emerald-200"
              }`}
            >
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  isRed
                    ? "bg-red-100 text-red-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                <Icon className="size-4" strokeWidth={1.6} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                  {h.title}
                  <ExternalLink className="size-3 text-ink-300" />
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                  {h.desc}
                </p>
              </div>
            </a>
          );
        })}
      </div>

      {/* Tips rápidos */}
      <h3 className="mt-10 mb-4 text-xs font-semibold uppercase tracking-wider text-ink-400">
        Atajos rápidos
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK.map((q) => {
          const Icon = q.icon;
          return (
            <div
              key={q.title}
              className="flex gap-3 rounded-xl border border-hairline bg-white p-4"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-cehta-green">
                <Icon className="size-4" strokeWidth={1.6} />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-900">{q.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{q.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Nota footer */}
      <div className="mt-10 rounded-2xl bg-cehta-green/5 px-6 py-5 text-sm text-ink-700">
        <p className="font-medium text-cehta-green">¿No encuentras lo que buscas?</p>
        <p className="mt-1 text-ink-600">
          En cualquier página, haz clic en el botón de ayuda{" "}
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-cehta-green align-middle text-white">
            <HelpCircle className="size-3" />
          </span>{" "}
          (abajo a la izquierda) para ver el instructivo específico de ese módulo.
        </p>
      </div>
    </div>
  );
}
