"use client";

/**
 * /admin/data — Round 120 — Vista única de la data del fondo
 *
 * Muestra todo lo que cargó el seed Round 116 (data del Excel
 * `Data (4).xlsx`):
 *   - 9 empresas con sus webs, giros, direcciones SII, credenciales
 *   - 5 miembros del directorio
 *   - 5 inversionistas/aportantes
 *
 * Si la migración 115 todavía no se aplicó, muestra banner amber
 * indicando que se ven datos parciales hasta correr la migración.
 *
 * Solo admin.
 */
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Globe,
  HelpCircle,
  Mail,
  PhoneCall,
  Shield,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface EmpresaData {
  empresa_codigo: string;
  razon_social: string | null;
  rut: string | null;
  pagina_web: string | null;
  giro: string | null;
  direccion: string | null;
  direccion_sii: string | null;
  contabilidad_proveedor: string | null;
  representante_legal: string | null;
  email_firmante: string | null;
  activo: boolean;
  tiene_credencial_sii: boolean;
  tiene_credencial_previred: boolean;
  sii_ultima_validacion_ok: boolean | null;
  sii_ultima_validacion_at: string | null;
}

interface DirectorioMiembro {
  miembro_id: number;
  nombre: string;
  rut: string | null;
  direccion: string | null;
  telefono: string | null;
  banco: string | null;
  cuenta: string | null;
  codigo_banco: string | null;
  correo: string | null;
  activo: boolean;
}

interface Inversionista {
  inversionista_id: number;
  nombre: string;
  rut: string | null;
  direccion: string | null;
  telefono: string | null;
  banco: string | null;
  cuenta: string | null;
  codigo_banco: string | null;
  correo: string | null;
  tipo: string;
  activo: boolean;
}

interface FondoOverview {
  empresas: EmpresaData[];
  directorio: DirectorioMiembro[];
  inversionistas: Inversionista[];
  empresas_count: number;
  empresas_con_sii: number;
  empresas_con_previred: number;
  directorio_count: number;
  inversionistas_count: number;
  migracion_115_aplicada: boolean;
  columna_pagina_web_existe: boolean;
}

const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CL");
  } catch {
    return iso;
  }
};

const normalizeWebUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export default function AdminDataPage() {
  const { session } = useSession();
  const { data, isLoading } = useQuery<FondoOverview>({
    queryKey: ["fondo-overview"],
    queryFn: () =>
      apiClient.get<FondoOverview>("/admin/fondo-overview", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <Link
        href={"/admin/system-status" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al panel admin
      </Link>

      {/* Hero */}
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
            <Building2 className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              FIP CEHTA ESG · Vista única
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Data del fondo
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-600 max-w-2xl">
            Empresas portafolio, directorio formal e inversionistas/aportantes
            del fondo. La data se carga vía el seed Round 116 desde el Excel{" "}
            <code className="font-mono text-xs">Data.xlsx</code>.
          </p>
        </div>
      </div>

      {/* Migración no aplicada */}
      {data && !data.migracion_115_aplicada && (
        <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">
                Migración Round 115 todavía no aplicada
              </p>
              <p className="text-xs mt-1">
                Las tablas <code>core.empresa_credenciales</code>,{" "}
                <code>core.directorio_miembros</code> e{" "}
                <code>core.inversionistas_aportantes</code> no existen aún.
                Aplicá <code>backend/scripts/sql/round115_migration.sql</code>{" "}
                en Supabase SQL Editor para ver toda la data. Por ahora se
                muestran solo las empresas con sus campos básicos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">
              Empresas
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink-900 mt-1">
              {data.empresas_count}
            </p>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">
              Con clave SII
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-cehta-green mt-1">
              {data.empresas_con_sii}/{data.empresas_count}
            </p>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">
              Con Previred
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink-900 mt-1">
              {data.empresas_con_previred}/{data.empresas_count}
            </p>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">
              Directorio
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink-900 mt-1">
              {data.directorio_count}
            </p>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-500">
              Inversionistas
            </p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-ink-900 mt-1">
              {data.inversionistas_count}
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-ink-500 px-2">Cargando…</p>}

      {/* Empresas */}
      {data && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline flex items-center gap-2">
            <Building2 className="size-4 text-cehta-green" />
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Empresas portafolio ({data.empresas.length})
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Razón social / RUT</th>
                  <th className="px-4 py-3">Web</th>
                  <th className="px-4 py-3">Giro</th>
                  <th className="px-4 py-3">Contabilidad</th>
                  <th className="px-4 py-3 text-center">SII</th>
                  <th className="px-4 py-3 text-center">Previred</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.empresas.map((e) => (
                  <tr key={e.empresa_codigo}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-ink-900">
                      {e.empresa_codigo}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink-900">
                        {e.razon_social ?? "—"}
                      </div>
                      <div className="text-[10px] font-mono text-ink-500">
                        {e.rut ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {e.pagina_web ? (
                        <a
                          href={normalizeWebUrl(e.pagina_web)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cehta-green hover:underline"
                        >
                          <Globe className="size-3" />
                          {e.pagina_web.replace(/^https?:\/\//, "").slice(0, 30)}
                        </a>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-600 max-w-xs truncate">
                      {e.giro ?? <span className="text-ink-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {e.contabilidad_proveedor ?? (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.tiene_credencial_sii ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            e.sii_ultima_validacion_ok === true
                              ? "bg-cehta-green/10 text-cehta-green"
                              : e.sii_ultima_validacion_ok === false
                                ? "bg-red-50 text-red-700"
                                : "bg-ink-100 text-ink-600"
                          }`}
                          title={
                            e.sii_ultima_validacion_at
                              ? `Última validación: ${fmtFecha(e.sii_ultima_validacion_at)}`
                              : "Nunca validada"
                          }
                        >
                          {e.sii_ultima_validacion_ok === true ? (
                            <CheckCircle2 className="size-3" />
                          ) : e.sii_ultima_validacion_ok === false ? (
                            <XCircle className="size-3" />
                          ) : (
                            <HelpCircle className="size-3" />
                          )}
                          {e.sii_ultima_validacion_ok === true
                            ? "OK"
                            : e.sii_ultima_validacion_ok === false
                              ? "FAIL"
                              : "Sin probar"}
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.tiene_credencial_previred ? (
                        <CheckCircle2 className="size-4 text-cehta-green inline" />
                      ) : (
                        <span className="text-[10px] text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="px-6 py-3 border-t border-hairline bg-ink-50/40 text-xs text-ink-500 flex flex-wrap items-center gap-3">
            <Link
              href={"/admin/sii" as Route}
              className="inline-flex items-center gap-1 text-cehta-green hover:underline"
            >
              <Shield className="size-3" />
              Gestionar credenciales SII
            </Link>
            <span className="text-ink-300">·</span>
            <span>
              Para editar empresas: <code>/admin/empresas</code>
            </span>
          </footer>
        </section>
      )}

      {/* Directorio */}
      {data && data.directorio.length > 0 && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline flex items-center gap-2">
            <Users className="size-4 text-cehta-green" />
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Directorio formal ({data.directorio.length})
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Nombre / RUT</th>
                  <th className="px-4 py-3">Dirección</th>
                  <th className="px-4 py-3">Contacto</th>
                  <th className="px-4 py-3">Banco / cuenta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.directorio.map((m) => (
                  <tr key={m.miembro_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-900">{m.nombre}</div>
                      <div className="text-[10px] font-mono text-ink-500">
                        {m.rut ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700 max-w-sm">
                      {m.direccion ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {m.telefono && (
                        <div className="flex items-center gap-1">
                          <PhoneCall className="size-3 text-ink-400" />
                          {m.telefono}
                        </div>
                      )}
                      {m.correo && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="size-3 text-ink-400" />
                          {m.correo}
                        </div>
                      )}
                      {!m.telefono && !m.correo && (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {m.banco ? (
                        <>
                          <div>{m.banco}</div>
                          <div className="text-[10px] font-mono text-ink-500">
                            {m.cuenta ?? "—"}
                          </div>
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Inversionistas */}
      {data && data.inversionistas.length > 0 && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline flex items-center gap-2">
            <Wallet className="size-4 text-cehta-green" />
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Inversionistas / Aportantes ({data.inversionistas.length})
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Nombre / RUT</th>
                  <th className="px-4 py-3">Dirección</th>
                  <th className="px-4 py-3">Contacto</th>
                  <th className="px-4 py-3">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.inversionistas.map((i) => (
                  <tr key={i.inversionista_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-900">{i.nombre}</div>
                      <div className="text-[10px] font-mono text-ink-500">
                        {i.rut ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700 max-w-sm">
                      {i.direccion ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {i.telefono && (
                        <div className="flex items-center gap-1">
                          <PhoneCall className="size-3 text-ink-400" />
                          {i.telefono}
                        </div>
                      )}
                      {i.correo && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="size-3 text-ink-400" />
                          {i.correo}
                        </div>
                      )}
                      {!i.telefono && !i.correo && (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="inline-flex rounded-full bg-cehta-green/10 px-2 py-0.5 text-cehta-green">
                        {i.tipo}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Empty states */}
      {data &&
        data.migracion_115_aplicada &&
        data.directorio.length === 0 &&
        data.inversionistas.length === 0 && (
          <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-4 text-sm text-amber-900">
            La migración 115 está aplicada pero el seed 116 no se corrió aún.
            Ejecutá{" "}
            <code className="font-mono text-xs">
              python scripts/seed_empresas_excel_round116.py "C:\Users\DELL\Downloads\Data (4).xlsx"
            </code>{" "}
            para cargar el directorio e inversionistas.
          </div>
        )}
    </div>
  );
}
