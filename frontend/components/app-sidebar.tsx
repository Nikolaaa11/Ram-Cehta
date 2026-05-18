"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  Banknote,
  LayoutDashboard,
  Users,
  FileText,
  BarChart3,
  Receipt,
  Wallet,
  Download,
  FileBarChart,
  LogOut,
  Sparkles,
  LineChart,
  CalendarDays,
  Target,
  Search,
  Scale,
  UserCog,
  Database,
  ShieldCheck,
  Building2,
  Bell,
  ChevronDown,
  ChevronRight,
  Plug,
  TrendingUp,
  Layers,
  ScrollText,
  Mail,
  Activity,
  Upload,
  Webhook,
  Inbox,
  Key,
  PenTool,
  CircleDollarSign,
  DollarSign,
  Book,
  ClipboardList,
  GanttChartSquare,
  type LucideIcon,
} from "lucide-react";
import { useMe } from "@/hooks/use-me";
import {
  useMyEmpresas,
} from "@/hooks/use-my-empresas";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { BrandSwitcher } from "@/components/BrandSwitcher";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { useMailboxPrefetch } from "@/hooks/use-mailbox";
import { useF22Prefetch } from "@/hooks/use-f22";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useEntregablesPrefetch } from "@/hooks/use-entregables";
import { usePinnedEmpresas } from "@/hooks/use-pinned-empresas";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { RealtimeIndicator } from "@/components/realtime/RealtimeIndicator";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { cn } from "@/lib/utils";
import { Pin } from "lucide-react";
import Image from "next/image";

/**
 * V3 Sidebar — 5 grupos jerárquicos según docs/V3_VISION.md §1.
 *
 * Visibilidad por `me.app_role` (UI hint puro, Disciplina 3):
 *  - admin → ve todo
 *  - ceo   → ve EJECUTIVO + OPERACIONES + ESTRATEGIA + DOCUMENTOS
 *           (NO existe en backend todavía — se trata igual que admin para
 *            esta fase mientras se agrega el rol al ROLE_SCOPES del backend)
 *  - resto → ve OPERACIONES + ESTRATEGIA + DOCUMENTOS
 *
 * El sidebar es UI rendering puro: el backend re-valida cada endpoint vía
 * `allowed_actions`. Mostrar/ocultar nav items es affordance, no autorización.
 */

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** V4 fase 4 — atributo data-tour para que el OnboardingTour pueda
   * targetear este link (e.g. "action-center", "asistente"). */
  tourId?: string;
  /** Round 73 — title (HTML tooltip) opcional, util cuando el label
   * solo no comunica bien la accion (ej. "Confirmar pagos"). */
  title?: string;
};

type NavGroup = {
  id:
    | "ejecutivo"
    | "operaciones"
    | "estrategia"
    | "documentos"
    | "contabilidad"
    | "admin";
  label: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    id: "ejecutivo",
    label: "Ejecutivo",
    items: [
      { href: "/ceo" as Route, label: "Dashboard CEO", icon: LineChart },
      {
        href: "/reportes/portafolio" as Route,
        label: "Portafolio USD",
        icon: DollarSign,
      },
      { href: "/calendario" as Route, label: "Calendario", icon: CalendarDays },
      {
        href: "/cartas-gantt" as Route,
        label: "Cartas Gantt",
        icon: GanttChartSquare,
      },
      {
        href: "/compliance" as Route,
        label: "Compliance",
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: "operaciones",
    label: "Operaciones",
    items: [
      {
        href: "/action-center" as Route,
        label: "Action Center",
        icon: Inbox,
        tourId: "action-center",
      },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      // V5++ ola AV — Bandeja personal: vouchers que requieren tu acción
      { href: "/mis-pendientes" as Route, label: "Mis pendientes", icon: Inbox },
      // V5++ ola CI — Cola dedicada de aprobaciones (solo lo que requiere
      // tu firma como proximo paso). Pensado para el rol aprobador.
      {
        href: "/aprobaciones" as Route,
        label: "Aprobaciones",
        icon: PenTool,
      },
      // Round 11 — Transferencias masivas: vouchers APPROVED listos para
      // pago + generador de Excel para cargar al banco.
      // Round 64 — renombrado a "Validación · Pagos" para que el operador
      // identifique esta como la pestaña de "validar antes de pagar".
      // Round 73 — re-nombrado a "Confirmar pagos · Planilla" y subido
      // justo despues de Aprobaciones (flujo natural aprobar -> pagar).
      // El operador no lo encontraba con la label anterior.
      // Alias /validacion también funciona.
      {
        href: "/transferencias" as Route,
        label: "Confirmar pagos · Planilla",
        icon: Download,
        title:
          "Vouchers APPROVED listos para transferir. Descarga la planilla Excel para cargar al banco.",
        tourId: "confirmar-pagos",
      },
      // Round 85 — voucher CORFO dedicado a REVTECH/TRONGKAI con bifurcacion
      // F.E/F.A + reparto CORFO/P-tec/Empresa. IVA siempre corporativo.
      {
        href: "/vouchers/corfo" as Route,
        label: "Voucher CORFO · REVTECH/TRONGKAI",
        icon: Sparkles,
        title:
          "Form dedicado para vouchers del subsidio CORFO 2026 ($3.000MM). " +
          "Reparto editable CORFO/P-tec/Empresa, IVA siempre corporativo.",
      },
      { href: "/proveedores", label: "Proveedores", icon: Users },
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: FileText },
      { href: "/solicitudes-pago", label: "Solicitudes Pago", icon: Wallet },
      { href: "/movimientos", label: "Movimientos", icon: BarChart3 },
      { href: "/f29", label: "F29 / Mensual", icon: Receipt },
      { href: "/f22" as Route, label: "F22 / Anual", icon: Receipt },
      // V5: Vouchers (comprobantes contables) — corazón del módulo contable.
      // Imputación triple cuenta × proyecto × área con partida doble.
      {
        href: "/vouchers" as Route,
        label: "Vouchers contables",
        icon: Receipt,
        tourId: "vouchers",
      },
      { href: "/notificaciones" as Route, label: "Notificaciones", icon: Bell },
    ],
  },
  {
    id: "estrategia",
    label: "Estrategia",
    items: [
      { href: "/avance" as Route, label: "Avance Empresas", icon: Target },
      { href: "/fondos" as Route, label: "Búsqueda de Fondos", icon: Search },
      {
        href: "/suscripciones" as Route,
        label: "Suscripciones FIP",
        icon: TrendingUp,
      },
      // V4 fase 9: Pipeline LPs + Informes LP virales
      {
        href: "/admin/lps" as Route,
        label: "Inversionistas (LPs)",
        icon: Users,
      },
      {
        href: "/admin/informes-lp" as Route,
        label: "Informes a Inversionistas",
        icon: Sparkles,
      },
      {
        href: "/asistente" as Route,
        label: "AI Asistente",
        icon: Sparkles,
        tourId: "asistente",
      },
    ],
  },
  {
    id: "documentos",
    label: "Documentos",
    items: [
      { href: "/legal" as Route, label: "Legal", icon: Scale },
      {
        href: "/entregables" as Route,
        label: "Entregables FIP",
        icon: ClipboardList,
      },
      // V5: políticas internas del fondo (reglamento, manual UAF, código ética).
      // Distinto de /legal que es por empresa portfolio. Auditable por CMF.
      {
        href: "/admin/policies-fondo" as Route,
        label: "Políticas del fondo",
        icon: ShieldCheck,
      },
      // V5: actas formales del FIP (Directorio AFIS, Comité Inversión,
      // Asamblea LPs, Comité Vigilancia). Distinto de actas portfolio.
      {
        href: "/admin/fondo-actas" as Route,
        label: "Actas del fondo",
        icon: ScrollText,
      },
      // V5: estados financieros cross-empresa (balance, ER, flujo caja).
      // Sync desde Dropbox /04-Financiero/.
      {
        href: "/admin/estados-financieros" as Route,
        label: "Estados financieros",
        icon: FileBarChart,
      },
      { href: "/reportes" as Route, label: "Reportes", icon: FileBarChart },
    ],
  },
  // V5: Contabilidad — plan de cuentas + proyectos contables + áreas.
  // Fundación del módulo Vouchers. Todo el flujo contable formal pasa
  // por estos 3 catálogos antes de llegar a un voucher.
  {
    id: "contabilidad",
    label: "Contabilidad",
    items: [
      {
        href: "/admin/plan-cuentas" as Route,
        label: "Plan de cuentas",
        icon: Layers,
      },
      {
        href: "/admin/proyectos-contables" as Route,
        label: "Proyectos contables",
        icon: FileBarChart,
      },
      {
        href: "/admin/areas" as Route,
        label: "Áreas (centros de costo)",
        icon: Layers,
      },
      // V5 Fase 2: aprobaciones
      {
        href: "/admin/approval-rules" as Route,
        label: "Reglas de aprobación",
        icon: ShieldCheck,
      },
      {
        href: "/admin/user-company-roles" as Route,
        label: "Roles por empresa",
        icon: UserCog,
      },
      // V5 Fase 3: sync Nubox
      {
        href: "/admin/nubox-exports" as Route,
        label: "Exportar a Nubox",
        icon: Database,
      },
      // V5 Fase 5: conciliación bancaria
      {
        href: "/admin/conciliacion" as Route,
        label: "Conciliación bancaria",
        icon: Banknote,
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin/usuarios" as Route, label: "Usuarios", icon: UserCog },
      // Round 89 — dashboard "donde estan las platas" del subsidio CORFO.
      // Hardcodea el codigo del subsidio activo (CORFO-2026-REVTECH-TRONGKAI)
      // porque hay solo 1 subsidio activo. Cuando haya mas, hacer pagina
      // index /admin/subsidios que liste todos.
      {
        href: "/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI" as Route,
        label: "Subsidio CORFO · $3.000MM",
        icon: CircleDollarSign,
        title:
          "Dashboard donde estan las platas. Ejecucion por empresa coejecutora (REVTECH/TRONGKAI), desglose por fuente CORFO/P-tec/Empresa.",
      },
      // Round 92 — catalogo de proyectos para configurar % + cuentas sin SQL
      {
        href: "/admin/proyectos" as Route,
        label: "Proyectos contables",
        icon: FileText,
        title:
          "Listado de proyectos del Bloque E. Click en uno para editar reparto % + cuentas contables destino.",
      },
      // Round 93 — vista global "todo el estado del sistema"
      {
        href: "/admin/system-status" as Route,
        label: "Estado del sistema",
        icon: Activity,
        title:
          "Health check: subsidios + proyectos + bandeja personal + items pendientes en una sola vista.",
      },
      {
        href: "/admin/empresas" as Route,
        label: "Empresas portfolio",
        icon: Building2,
      },
      { href: "/admin/etl" as Route, label: "ETL Runs", icon: Database },
      {
        href: "/admin/cartolas-runs" as Route,
        label: "Cartolas OCR",
        icon: Banknote,
        tourId: "cartolas",
      },
      {
        href: "/admin/bitacora" as Route,
        label: "Bitácora (actividad)",
        icon: ScrollText,
      },
      {
        href: "/admin/audit" as Route,
        label: "Auditoría de cambios",
        icon: ScrollText,
      },
      {
        href: "/admin/http-trail" as Route,
        label: "Audit trail HTTP",
        icon: ScrollText,
      },
      {
        href: "/admin/data-quality" as Route,
        label: "Data Quality",
        icon: ShieldCheck,
      },
      {
        href: "/admin/integraciones" as Route,
        label: "Integraciones",
        icon: Plug,
      },
      {
        href: "/admin/digest" as Route,
        label: "Digest CEO",
        icon: Mail,
      },
      {
        href: "/admin/mailbox" as Route,
        label: "Inbox · contactocehta",
        icon: Mail,
        tourId: "mailbox",
      },
      {
        href: "/admin/import" as Route,
        label: "Importar CSV",
        icon: Upload,
      },
      {
        href: "/admin/status" as Route,
        label: "Status del sistema",
        icon: Activity,
      },
      {
        href: "/admin/health" as Route,
        label: "Health detallado",
        icon: Activity,
      },
      {
        href: "/admin/webhooks" as Route,
        label: "Webhooks",
        icon: Webhook,
      },
      {
        href: "/admin/api-tokens" as Route,
        label: "API tokens",
        icon: Key,
      },
      {
        href: "/admin/api-docs" as Route,
        label: "API docs",
        icon: Book,
      },
      {
        // V4 fase 2: 2FA TOTP. Visible bajo "Admin" (mismo grupo que el
        // resto de configuración sensible). El target page acepta a
        // cualquier rol — la entrada está acá porque admins son quienes
        // están bloqueados en endpoints high-impact si no activan 2FA.
        href: "/2fa" as Route,
        label: "Configuración 2FA",
        icon: ShieldCheck,
      },
    ],
  },
];

// Sub-items que aparecen al expandir cada empresa.
const EMPRESA_SUBSECTIONS = [
  { suffix: "", label: "Resumen", icon: Building2 },
  { suffix: "/flujo-mensual", label: "Flujo Mensual", icon: TrendingUp },
  { suffix: "/transacciones", label: "Transacciones", icon: Receipt },
  { suffix: "/categorias", label: "Categorías", icon: Layers },
  { suffix: "/trabajadores", label: "Trabajadores", icon: Users },
  { suffix: "/legal", label: "Legal", icon: Scale },
  { suffix: "/avance", label: "Avance", icon: Target },
  { suffix: "/asistente", label: "AI Asistente", icon: Sparkles },
] as const;

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname() ?? "";
  const { data: me } = useMe();
  const role = me?.app_role;
  const isAdmin = role === "admin";
  // `ceo` aún no existe en backend (ROLE_SCOPES). Mientras tanto lo tratamos
  // como nivel ejecutivo: ve EJECUTIVO pero NO ve ADMIN.
  const isExecutive = isAdmin || role === "ceo";

  const visibleGroups = GROUPS.filter((g) => {
    if (g.id === "ejecutivo") return isExecutive;
    if (g.id === "admin") return isAdmin;
    return true; // operaciones, estrategia, documentos → todos
  });

  // V5++ perf: 1 endpoint composite reemplaza 4 queries paralelas.
  // Latencia ~250ms (era ~1.8s en cascade). SSE invalida cuando cambia.
  const { data: state } = useSidebarState();
  const unreadCount = state?.unread_notifications ?? 0;
  const criticalObligationsCount = state?.critical_obligations ?? 0;
  const criticalEntregablesCount = state?.critical_entregables ?? 0;
  const mailboxPending = state?.mailbox_pending ?? 0;
  // V5++ ola AT — counters de vouchers para el usuario
  const voucherDraftsMine = state?.voucher_drafts_mine ?? 0;
  const voucherPendingApprovals = state?.voucher_pending_approvals ?? 0;
  // Round 67 — vouchers APPROVED listos para transferir (badge /validacion).
  const voucherApprovedReady = state?.voucher_approved_ready_to_pay ?? 0;
  const prefetchEntregables = useEntregablesPrefetch();
  const prefetchMailbox = useMailboxPrefetch();
  const prefetchF22 = useF22Prefetch();
  // Atajos teclado globales (gd → dashboard, gv → vouchers, etc.)
  useKeyboardShortcuts();

  // V5++ ola BR — Logo + nombre dinámicos según la empresa activa
  // Prioridad: URL > expanded en sidebar > única empresa del user > default
  const { data: myEmpresas } = useMyEmpresas();
  const { active: activeEmpresaCodigo } = useActiveEmpresa();

  // V5++ ola CA hotfix 3: el brand del sidebar SIEMPRE muestra Cehta
  // Capital + logo. La empresa activa se ve solo en el subtitle (código)
  // y en el dropdown del BrandSwitcher para cambiar contexto.
  const activeEmpresa = activeEmpresaCodigo
    ? (myEmpresas?.empresas.find((e) => e.codigo === activeEmpresaCodigo) ??
       { codigo: activeEmpresaCodigo, razon_social: activeEmpresaCodigo,
         rut: null, activo: true, roles: ["admin"] })
    : null;

  const brandLogo = "/logos/cehta.png";
  const brandName = "Cehta Capital";
  const brandSubtitle = activeEmpresa
    ? `Empresa activa: ${activeEmpresa.codigo}`
    : "FIP CEHTA ESG";

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-hairline bg-white">
      {/* Brand — V5++ ola BS: clickeable para cambiar empresa */}
      <div className="border-b border-hairline px-4 py-5">
        <div className="flex items-center gap-3">
          <BrandSwitcher
            currentLogo={brandLogo}
            currentName={brandName}
            currentSubtitle={brandSubtitle}
            activeCodigo={activeEmpresaCodigo}
          />
          {/* V4 fase 4 — data-tour anchor para el OnboardingTour. Wrappeamos
              en un span para no tener que modificar la API de NotificationsBell. */}
          <span data-tour="notifications-bell" className="contents">
            <NotificationsBell />
          </span>
          <RealtimeIndicator />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {visibleGroups.map((group) => (
          <div key={group.id}>
            <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300 dark:text-ink-500">
              {group.label}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const showUnreadBadge =
                  String(item.href) === "/notificaciones" &&
                  unreadCount > 0;
                const showCriticalBadge =
                  String(item.href) === "/calendario" &&
                  criticalObligationsCount > 0;
                const showEntregablesBadge =
                  String(item.href) === "/entregables" &&
                  criticalEntregablesCount > 0;
                const showMailboxBadge =
                  String(item.href) === "/admin/mailbox" &&
                  mailboxPending > 0;
                // V5++ ola AT — badge en /vouchers: total de pending + drafts
                const voucherBadgeTotal =
                  voucherDraftsMine + voucherPendingApprovals;
                const showVoucherBadge =
                  String(item.href) === "/vouchers" && voucherBadgeTotal > 0;
                // V5++ ola CI — badge en /aprobaciones: solo lo que requiere
                // MI firma como proximo paso (sin drafts).
                const showAprobacionesBadge =
                  String(item.href) === "/aprobaciones" &&
                  voucherPendingApprovals > 0;
                // Round 67 — badge en /transferencias (Validación · Pagos):
                // vouchers APPROVED esperando ser transferidos al banco.
                const showValidacionBadge =
                  String(item.href) === "/transferencias" &&
                  voucherApprovedReady > 0;
                // Prefetch on hover para rutas con datos pesados.
                // V4 fase 7.5 — calienta cache TanStack antes del click.
                // V5+ extendido a /admin/mailbox y /f22 (lists costosas).
                const hrefStr = String(item.href);
                const onMouseEnter =
                  hrefStr === "/entregables"
                    ? prefetchEntregables
                    : hrefStr === "/admin/mailbox"
                      ? prefetchMailbox
                      : hrefStr === "/f22"
                        ? prefetchF22
                        : undefined;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onMouseEnter={onMouseEnter}
                    onFocus={onMouseEnter}
                    aria-current={isActive ? "page" : undefined}
                    data-tour={item.tourId}
                    title={item.title}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ease-apple",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                      isActive
                        ? "bg-gradient-to-r from-cehta-green/15 via-cehta-green/10 to-transparent text-cehta-green dark:from-cehta-green/25 dark:via-cehta-green/15"
                        : "text-ink-700 hover:bg-cehta-green/[0.06] hover:text-cehta-green hover:translate-x-0.5 dark:text-ink-300 dark:hover:bg-cehta-green/15 dark:hover:text-cehta-green",
                    )}
                  >
                    {/* Active indicator — barra vertical izquierda */}
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-cehta-green shadow-glow-green"
                      />
                    )}
                    <Icon
                      className={cn(
                        "h-4 w-4 transition-transform duration-200 ease-apple",
                        isActive ? "scale-110" : "group-hover:scale-110",
                      )}
                      strokeWidth={isActive ? 2 : 1.5}
                    />
                    <span className="flex-1">{item.label}</span>
                    {showUnreadBadge && (
                      <span
                        aria-label={`${unreadCount} sin leer`}
                        className="relative inline-flex min-w-[20px] items-center justify-center rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white tabular-nums shadow-sm pulse-glow-red"
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                    {showCriticalBadge && (
                      <span
                        aria-label={`${criticalObligationsCount} obligaciones vencidas`}
                        title={`${criticalObligationsCount} obligaciones vencidas`}
                        className="relative inline-flex min-w-[20px] items-center justify-center rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white tabular-nums shadow-sm pulse-glow-red"
                      >
                        {criticalObligationsCount > 99
                          ? "99+"
                          : criticalObligationsCount}
                      </span>
                    )}
                    {showEntregablesBadge && (
                      <span
                        aria-label={`${criticalEntregablesCount} entregables críticos`}
                        title={`${criticalEntregablesCount} entregables críticos (≤5 días)`}
                        className="relative inline-flex min-w-[20px] items-center justify-center rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white tabular-nums shadow-sm pulse-glow-red"
                      >
                        {criticalEntregablesCount > 99
                          ? "99+"
                          : criticalEntregablesCount}
                      </span>
                    )}
                    {showMailboxBadge && (
                      <span
                        aria-label={`${mailboxPending} emails pendientes`}
                        title={`${mailboxPending} emails pendientes de revisión`}
                        className="relative inline-flex min-w-[20px] items-center justify-center rounded-full bg-cehta-green px-1.5 text-[10px] font-semibold text-white tabular-nums shadow-sm pulse-glow"
                      >
                        {mailboxPending > 99 ? "99+" : mailboxPending}
                      </span>
                    )}
                    {showVoucherBadge && (
                      <span
                        aria-label={`${voucherBadgeTotal} vouchers requieren tu acción`}
                        title={
                          `${voucherDraftsMine} borradores propios + ` +
                          `${voucherPendingApprovals} pendientes de tu firma`
                        }
                        className={cn(
                          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white tabular-nums",
                          voucherPendingApprovals > 0
                            ? "bg-amber-500"
                            : "bg-cehta-green",
                        )}
                      >
                        {voucherBadgeTotal > 99 ? "99+" : voucherBadgeTotal}
                      </span>
                    )}
                    {showAprobacionesBadge && (
                      <span
                        aria-label={`${voucherPendingApprovals} vouchers esperando tu firma`}
                        title={`${voucherPendingApprovals} vouchers esperando tu firma`}
                        className="relative inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white tabular-nums shadow-sm pulse-glow"
                      >
                        {voucherPendingApprovals > 99
                          ? "99+"
                          : voucherPendingApprovals}
                      </span>
                    )}
                    {showValidacionBadge && (
                      <span
                        aria-label={`${voucherApprovedReady} vouchers listos para transferir`}
                        title={`${voucherApprovedReady} vouchers APPROVED listos para pagar`}
                        className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-cehta-green px-1.5 text-[10px] font-semibold text-white tabular-nums"
                      >
                        {voucherApprovedReady > 99 ? "99+" : voucherApprovedReady}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            {/* Empresas list — solo dentro del grupo "operaciones" */}
            {group.id === "operaciones" && <EmpresasNav pathname={pathname} />}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-2 border-t border-hairline px-4 py-4 dark:border-ink-800">
        <div className="flex items-center justify-between gap-2">
          <p
            className="truncate px-2 text-xs text-ink-500 tabular-nums dark:text-ink-400"
            title={email}
          >
            {email}
          </p>
          <ThemeToggle />
        </div>
        <form action="/logout" method="POST">
          <button
            type="submit"
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple dark:text-ink-300",
              "hover:bg-negative/10 hover:text-negative dark:hover:bg-negative/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
            )}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}

/**
 * EmpresasNav — sub-grupo dinámico que lista las 9 empresas del portfolio.
 * Cada empresa es expandible con sus 5 sub-secciones.
 */
function EmpresasNav({ pathname }: { pathname: string }) {
  // V5++ ola BR — sincronizar empresa activa cuando user expande/clickea
  const { setActive: setActiveEmpresa } = useActiveEmpresa();
  const { data: empresas, isLoading } = useCatalogoEmpresas();
  const { pinned } = usePinnedEmpresas();
  const [expanded, setExpanded] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("sidebar-empresa-expanded");
  });
  // V4 fase 5 fix: trackear el último pathname aplicado para evitar que el
  // auto-expand revierta el click manual del usuario. Antes el useEffect
  // incluía `expanded` en deps → cuando el user clickeaba empresa B, se
  // disparaba el effect, detectaba pathname=/empresa/A y revertía a A.
  const lastAppliedPathRef = useRef<string | null>(null);

  // Empresas pineadas, en orden de pin (más reciente al final).
  const pinnedEmpresas = (empresas ?? []).filter((e) =>
    pinned.includes(e.codigo),
  );

  // Auto-expand SOLO cuando cambia el pathname a una nueva empresa.
  // Si el user ya navegó a /empresa/CENERGY, expanded queda en CENERGY.
  // Si después clickea RHO en el sidebar (sin navegar), `expanded` cambia
  // a RHO pero este effect NO se re-ejecuta (pathname sigue igual).
  useEffect(() => {
    if (lastAppliedPathRef.current === pathname) return;
    lastAppliedPathRef.current = pathname;
    const match = /^\/empresa\/([^/]+)/.exec(pathname);
    if (match && match[1]) {
      setExpanded(match[1]);
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (expanded) {
      localStorage.setItem("sidebar-empresa-expanded", expanded);
    } else {
      localStorage.removeItem("sidebar-empresa-expanded");
    }
  }, [expanded]);

  if (isLoading) {
    return (
      <>
        <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
          Empresas
        </h3>
        <div className="space-y-0.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mx-3 my-1 h-7 animate-pulse rounded-xl bg-ink-100/40"
            />
          ))}
        </div>
      </>
    );
  }

  if (!empresas || empresas.length === 0) return null;

  return (
    <>
      {/* V4 fase 5: sección "Favoritos" — empresas pineadas por el user. */}
      {pinnedEmpresas.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-4 flex items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-cehta-green">
            <Pin className="h-2.5 w-2.5 fill-cehta-green" strokeWidth={2} />
            Favoritos
          </h3>
          <div className="space-y-0.5">
            {pinnedEmpresas.map((emp) => {
              const isActive = pathname.startsWith(`/empresa/${emp.codigo}`);
              return (
                <Link
                  key={`pinned-${emp.codigo}`}
                  href={`/empresa/${emp.codigo}` as Route}
                  aria-current={isActive ? "page" : undefined}
                  title={emp.razon_social}
                  onClick={() => setActiveEmpresa(emp.codigo)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-apple",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                    isActive
                      ? "bg-cehta-green/15 text-cehta-green"
                      : "text-ink-700 hover:bg-cehta-green/10 hover:text-cehta-green",
                  )}
                >
                  <EmpresaLogo
                    empresaCodigo={emp.codigo}
                    size={22}
                    className="shrink-0"
                  />
                  <span className="flex-1 truncate text-left">{emp.codigo}</span>
                  <Pin
                    className="h-3 w-3 shrink-0 fill-cehta-green text-cehta-green"
                    strokeWidth={2}
                  />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
        Empresas
      </h3>
      <div className="space-y-0.5">
        {empresas.map((emp) => {
          const isExpanded = expanded === emp.codigo;
          const isActive = pathname.startsWith(`/empresa/${emp.codigo}`);
          const Chevron = isExpanded ? ChevronDown : ChevronRight;
          return (
            <div key={emp.codigo}>
              <button
                type="button"
                onClick={() => {
                  const newExpanded = isExpanded ? null : emp.codigo;
                  setExpanded(newExpanded);
                  // V5++ ola BR: dispara update global del brand
                  setActiveEmpresa(newExpanded);
                }}
                aria-expanded={isExpanded}
                title={emp.razon_social}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-apple",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                  isActive
                    ? "bg-cehta-green/10 text-cehta-green"
                    : "text-ink-700 hover:bg-cehta-green/5 hover:text-cehta-green",
                )}
              >
                <Chevron
                  className="h-3.5 w-3.5 shrink-0 text-ink-300"
                  strokeWidth={2}
                />
                <EmpresaLogo
                  empresaCodigo={emp.codigo}
                  size={22}
                  className="shrink-0"
                />
                <span className="flex-1 truncate text-left">{emp.codigo}</span>
              </button>
              {isExpanded && (
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-hairline pl-3">
                  {EMPRESA_SUBSECTIONS.map((sec) => {
                    const Icon = sec.icon;
                    const href = `/empresa/${emp.codigo}${sec.suffix}` as Route;
                    const subActive =
                      pathname === href ||
                      (sec.suffix !== "" && pathname.startsWith(`${href}/`));
                    return (
                      <Link
                        key={sec.suffix}
                        href={href}
                        aria-current={subActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-apple",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                          subActive
                            ? "bg-cehta-green/15 text-cehta-green font-medium"
                            : "text-ink-500 hover:bg-cehta-green/5 hover:text-cehta-green",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {sec.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

