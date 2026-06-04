"use client";

/**
 * WhatsNewBanner — comunica novedades del release R152 (R152aa).
 *
 * Aplica "Comunicación Bidireccional" + "Plan Comunicacional" de Ray
 * Gallegos: anuncia las features nuevas para que los usuarios sepan
 * qué probar. Dismiss persistente — localStorage por versión.
 *
 * Bumpear `VERSION_KEY` cuando se libere algo nuevo lo re-muestra a todos.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Sparkles, X, ArrowRight, BookOpen, Users, Receipt } from "lucide-react";

const VERSION_KEY = "whats-new-dismissed-r152";

const ITEMS: {
  icon: typeof BookOpen;
  title: string;
  desc: string;
  href: Route;
  cta: string;
}[] = [
  {
    icon: BookOpen,
    title: "Centro de Aprendizaje",
    desc: "5 módulos guiados + quizzes. Aprendé las funciones críticas en tu propio ritmo.",
    href: "/aprender" as Route,
    cta: "Ver módulos",
  },
  {
    icon: Users,
    title: "Mapa de Adopción",
    desc: "Visualizá quiénes son aliados, espectadores y detractores en tu equipo.",
    href: "/admin/adopcion" as Route,
    cta: "Ver mapa",
  },
  {
    icon: Receipt,
    title: "Rendiciones CORFO",
    desc: "REVTECH y TRONGKAI: generá los Excels oficiales pre-llenados con los datos de la plataforma.",
    href: "/admin/rendiciones-corfo" as Route,
    cta: "Probar",
  },
];

export function WhatsNewBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(VERSION_KEY);
    if (!dismissed) {
      // pequeño delay para que no aparezca al toque de cargar
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(VERSION_KEY, String(Date.now()));
    }
  };

  if (!visible) return null;

  return (
    <div className="relative mx-auto mb-4 max-w-6xl overflow-hidden rounded-2xl bg-gradient-to-br from-cehta-green/8 via-white to-sf-blue/8 ring-1 ring-cehta-green/20 shadow-card px-5 py-4 print:hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 size-48 rounded-full bg-cehta-green/15 blur-3xl"
      />
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-900"
        aria-label="Cerrar"
      >
        <X className="size-4" />
      </button>
      <div className="relative">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-cehta-green" strokeWidth={2} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Novedades de la plataforma
          </span>
        </div>
        <h3 className="mt-1 font-display text-lg font-semibold text-ink-900">
          R152 está aquí — 3 herramientas nuevas
        </h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Probalas cuando tengas un minuto. Si algo no se entiende, usá el botón
          de feedback abajo a la derecha.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href as string}
                href={item.href}
                onClick={dismiss}
                className="group flex flex-col gap-1.5 rounded-xl border border-hairline bg-white/80 px-3 py-2.5 transition-all hover:border-cehta-green/40 hover:bg-white hover:shadow-card"
              >
                <div className="flex items-center gap-2">
                  <Icon className="size-3.5 text-cehta-green" strokeWidth={2} />
                  <span className="text-xs font-semibold text-ink-900">
                    {item.title}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-ink-600">
                  {item.desc}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 text-[10px] font-medium text-cehta-green opacity-0 transition-opacity group-hover:opacity-100">
                  {item.cta}
                  <ArrowRight className="size-3" strokeWidth={2} />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
