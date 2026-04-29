"use client";

/**
 * Admin → Importar CSV (V3 fase 11).
 *
 * Two-step flow:
 *   1. Upload CSV (drag-drop o click) → Validar (POST dry-run).
 *   2. Preview con stats (válidos / inválidos / duplicados) → Importar.
 *
 * Tres tabs por entity_type: trabajadores | fondos | proveedores.
 * Cada tab maneja su propio estado (file, report, executing).
 *
 * Scope: el backend rechaza con 403 si el usuario no tiene `{entity}:create`.
 */
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileText,
  Upload,
  Users,
  Wallet,
  Building2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { toast } from "@/components/ui/toast";
import { useDryRun, useExecute } from "@/hooks/use-bulk-import";
import type {
  BulkImportEntityType,
  ValidationReport,
} from "@/lib/api/schema";

type TabId = BulkImportEntityType;

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: "trabajadores", label: "Trabajadores", icon: Users },
  { id: "fondos", label: "Fondos", icon: Wallet },
  { id: "proveedores", label: "Proveedores", icon: Building2 },
];

export default function AdminImportPage() {
  const [tab, setTab] = useState<TabId>("trabajadores");

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      {/* Header */}
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Importar CSV
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Subí un CSV, validá fila por fila (sin escribir en DB todavía) y
          confirmá la importación. Tope 5 MB.
        </p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Entidad a importar"
        className="inline-flex h-10 items-center rounded-xl bg-ink-100/60 p-1 ring-1 ring-hairline"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ease-apple",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                active
                  ? "bg-white text-ink-900 shadow-glass"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Cada tab tiene su propio panel — re-mount al cambiar pierde el state, lo cual es intencional. */}
      <ImportPanel key={tab} entityType={tab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel por entity
// ---------------------------------------------------------------------------

interface ImportPanelProps {
  entityType: TabId;
}

function ImportPanel({ entityType }: ImportPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dryRun = useDryRun(entityType);
  const execute = useExecute(entityType);

  const onSelect = useCallback((f: File | null) => {
    if (f && !f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Archivo inválido", {
        description: "Sólo se aceptan archivos .csv",
      });
      return;
    }
    if (f && f.size > 5 * 1024 * 1024) {
      toast.error("Archivo muy grande", {
        description: "El tope es 5 MB.",
      });
      return;
    }
    setFile(f);
    setReport(null);
  }, []);

  const onValidate = useCallback(async () => {
    if (!file) return;
    try {
      const r = await dryRun.mutateAsync(file);
      setReport(r);
      if (r.valid_rows === 0 && r.invalid_rows.length === 0) {
        toast.info("CSV vacío", {
          description: "No se encontraron filas para procesar.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      toast.error("Validación falló", { description: msg });
    }
  }, [file, dryRun]);

  const onExecute = useCallback(async () => {
    if (!report || report.valid_rows === 0) return;
    try {
      const result = await execute.mutateAsync({
        rows: report.valid.map((v) => v.data),
      });
      toast.success(
        `${result.created} ${entityType} importados`,
        {
          description:
            result.skipped > 0
              ? `${result.skipped} omitidos (duplicados o errores)`
              : "Sin omisiones",
        },
      );
      // Reset state — usuario puede subir otro CSV.
      setFile(null);
      setReport(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      toast.error("Importación falló", { description: msg });
    }
  }, [report, execute, entityType]);

  return (
    <div className="space-y-6">
      {/* Step 1: Upload */}
      <Surface>
        <Surface.Header>
          <Surface.Title>Paso 1 · Subí el CSV</Surface.Title>
          <Surface.Subtitle>
            Drag-drop o clic. Descargá la plantilla si no sabés qué columnas
            poner.
          </Surface.Subtitle>
        </Surface.Header>

        <Surface.Body className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0] ?? null;
              onSelect(f);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
              dragOver
                ? "border-cehta-green bg-cehta-green/5"
                : "border-hairline hover:border-cehta-green/40",
            )}
          >
            <Upload className="h-8 w-8 text-ink-500" strokeWidth={1.5} />
            <p className="text-sm font-medium text-ink-900">
              {file ? file.name : "Arrastrá el CSV o hacé clic"}
            </p>
            <p className="text-xs text-ink-500">CSV · máx 5 MB</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={`/templates/${entityType}.csv`}
              download
              className="inline-flex items-center gap-1.5 text-xs font-medium text-cehta-green hover:underline"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              Descargar plantilla CSV
            </a>
            <Button
              type="button"
              onClick={onValidate}
              disabled={!file || dryRun.isPending}
            >
              {dryRun.isPending ? "Validando…" : "Validar"}
            </Button>
          </div>
        </Surface.Body>
      </Surface>

      {/* Step 2: Preview */}
      {report && (
        <PreviewSection
          report={report}
          executing={execute.isPending}
          onExecute={onExecute}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview con stats + tabs
// ---------------------------------------------------------------------------

interface PreviewSectionProps {
  report: ValidationReport;
  executing: boolean;
  onExecute: () => void;
}

type PreviewTab = "invalidos" | "duplicados" | "validos";

function PreviewSection({ report, executing, onExecute }: PreviewSectionProps) {
  const [tab, setTab] = useState<PreviewTab>(
    report.invalid_rows.length > 0
      ? "invalidos"
      : report.duplicates.length > 0
        ? "duplicados"
        : "validos",
  );

  return (
    <Surface>
      <Surface.Header>
        <Surface.Title>Paso 2 · Revisión</Surface.Title>
        <Surface.Subtitle>
          {report.total_rows} filas leídas. Revisá errores y duplicados antes
          de importar.
        </Surface.Subtitle>
      </Surface.Header>

      <Surface.Body className="space-y-4">
        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Válidos"
            value={report.valid_rows}
            tone="positive"
          />
          <StatCard
            label="Inválidos"
            value={report.invalid_rows.length}
            tone="negative"
          />
          <StatCard
            label="Duplicados"
            value={report.duplicates.length}
            tone="warning"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-hairline">
          <PreviewTabButton
            active={tab === "invalidos"}
            onClick={() => setTab("invalidos")}
            label={`Inválidos (${report.invalid_rows.length})`}
          />
          <PreviewTabButton
            active={tab === "duplicados"}
            onClick={() => setTab("duplicados")}
            label={`Duplicados (${report.duplicates.length})`}
          />
          <PreviewTabButton
            active={tab === "validos"}
            onClick={() => setTab("validos")}
            label={`Válidos (${report.valid_rows})`}
          />
        </div>

        {/* Body por tab */}
        {tab === "invalidos" && (
          <InvalidTable rows={report.invalid_rows} />
        )}
        {tab === "duplicados" && (
          <DuplicatesTable rows={report.duplicates} />
        )}
        {tab === "validos" && <ValidTable rows={report.valid} />}
      </Surface.Body>

      <Surface.Footer className="justify-end">
        <Button
          type="button"
          onClick={onExecute}
          disabled={report.valid_rows === 0 || executing}
        >
          {executing ? "Importando…" : `Importar ${report.valid_rows} válidos`}
        </Button>
      </Surface.Footer>
    </Surface>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  tone: "positive" | "negative" | "warning";
}

function StatCard({ label, value, tone }: StatCardProps) {
  const colorMap: Record<StatCardProps["tone"], string> = {
    positive: "text-positive",
    negative: "text-negative",
    warning: "text-warning",
  };
  return (
    <div className="rounded-xl bg-ink-50 p-3 ring-1 ring-hairline">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", colorMap[tone])}>
        {value}
      </p>
    </div>
  );
}

interface PreviewTabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

function PreviewTabButton({ active, onClick, label }: PreviewTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "border-cehta-green text-ink-900"
          : "border-transparent text-ink-500 hover:text-ink-900",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

function InvalidTable({
  rows,
}: {
  rows: ValidationReport["invalid_rows"];
}) {
  if (rows.length === 0) {
    return <EmptyState icon={CheckCircle2} message="Sin filas inválidas." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-hairline">
      <table className="w-full text-xs">
        <thead className="bg-ink-50 text-ink-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Fila</th>
            <th className="px-3 py-2 text-left font-medium">Errores</th>
            <th className="px-3 py-2 text-left font-medium">Datos originales</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((r) => (
            <tr key={r.row_index}>
              <td className="px-3 py-2 align-top font-mono text-ink-500">
                #{r.row_index + 1}
              </td>
              <td className="px-3 py-2 align-top text-negative">
                <ul className="list-disc pl-4">
                  {r.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </td>
              <td className="px-3 py-2 align-top text-ink-500">
                <details>
                  <summary className="cursor-pointer text-xs">ver</summary>
                  <pre className="mt-1 max-w-md whitespace-pre-wrap break-words text-[10px]">
                    {JSON.stringify(r.original, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicatesTable({
  rows,
}: {
  rows: ValidationReport["duplicates"];
}) {
  if (rows.length === 0) {
    return <EmptyState icon={CheckCircle2} message="Sin duplicados." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-hairline">
      <table className="w-full text-xs">
        <thead className="bg-ink-50 text-ink-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Fila</th>
            <th className="px-3 py-2 text-left font-medium">Clave</th>
            <th className="px-3 py-2 text-left font-medium">Existe id</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((r) => (
            <tr key={r.row_index}>
              <td className="px-3 py-2 font-mono text-ink-500">
                #{r.row_index + 1}
              </td>
              <td className="px-3 py-2 text-ink-900">{r.key}</td>
              <td className="px-3 py-2 font-mono text-ink-500">
                {r.existing_id ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValidTable({ rows }: { rows: ValidationReport["valid"] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={AlertCircle}
        message="No hay filas válidas para importar."
      />
    );
  }
  // Muestra máx 50; si hay más, agregamos nota.
  const visible = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-hairline">
      <table className="w-full text-xs">
        <thead className="bg-ink-50 text-ink-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Fila</th>
            <th className="px-3 py-2 text-left font-medium">Datos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {visible.map((r) => (
            <tr key={r.row_index}>
              <td className="px-3 py-2 align-top font-mono text-ink-500">
                #{r.row_index + 1}
              </td>
              <td className="px-3 py-2 align-top text-ink-900">
                <pre className="max-w-2xl whitespace-pre-wrap break-words text-[10px]">
                  {JSON.stringify(r.data, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <p className="border-t border-hairline bg-ink-50 px-3 py-2 text-xs text-ink-500">
          Mostrando 50 de {rows.length} filas válidas.
        </p>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon: typeof FileText;
  message: string;
}

function EmptyState({ icon: Icon, message }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg bg-ink-50 p-6 text-xs text-ink-500">
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {message}
    </div>
  );
}
