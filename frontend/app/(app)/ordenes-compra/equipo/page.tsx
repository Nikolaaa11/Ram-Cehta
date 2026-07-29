"use client";

/**
 * /ordenes-compra/equipo — MEGAPROMPT F3.
 *
 * Pantalla de configuración (no de operación diaria): acá se carga UNA VEZ la
 * gente que firma las OC de cada empresa. Después, al preparar una orden, esas
 * personas aparecen como chips para elegirlas con un click.
 *
 * Client Component completo a propósito: es una pantalla chica, 100%
 * interactiva (selector + CRUD + reorden), sin nada que ganar del SSR.
 */

import Link from "next/link";
import { ArrowLeft, PenTool } from "lucide-react";
import { EquipoFirmantesPanel } from "@/components/ordenes-compra/EquipoFirmantesPanel";

export default function EquipoFirmantesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <Link
            href="/ordenes-compra"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Volver a Órdenes de Compra
          </Link>
          <h1 className="mt-2 flex items-center gap-2.5 text-3xl font-semibold tracking-tight text-ink-900">
            <PenTool className="h-7 w-7 text-cehta-green" strokeWidth={1.5} />
            Equipo de firmantes
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            Acá cargás, por empresa, quiénes firman las órdenes de compra: nombre,
            cargo y correo. Después, cuando prepares una OC, esas personas
            aparecen como botones para agregarlas o sacarlas con un click, sin
            volver a escribir los mismos datos cada vez.
          </p>
          <p className="mt-1.5 text-sm text-ink-500">
            Las que marques como <strong className="text-ink-700">habituales</strong>{" "}
            vienen ya cargadas en cada orden nueva, y el orden de la lista es el
            orden en que las firmas salen impresas en el PDF.
          </p>
        </div>
      </div>

      <EquipoFirmantesPanel />
    </div>
  );
}
