"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
  MessageSquare,
  Landmark,
  RefreshCw,
  FileCheck,
  FileSpreadsheet,
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
import { useAprobacionesPrefetch } from "@/hooks/use-aprobaciones-prefetch";
import { useActionCenterPrefetch } from "@/hooks/use-action-center-prefetch";
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
  /** R152qq — Marca el item con un chip "Nuevo" durante un tiempo después
   * de liberarlo. El chip se oculta automaticamente si el usuario ya
   * visitó la URL (almacenado en localStorage 'sidebar-visited-X'). */
  isNew?: boolean;
};

type NavGroup = {
  id:
    | "ejecutivo"
    | "operaciones"
    | "estrategia"
    | "sii"
    | "claudia"
    | "documentos"
    | "contabilidad"
    | "admin"
    | "avanzado";
  label: string;
  items: NavItem[];
  /** Round 152h — si true, el grupo se puede colapsar con click. */
  collapsible?: boolean;
  /** Round 152j — si true, arranca EXPANDIDO; si false/undefined, COLAPSADO.
   * Los grupos "núcleo" (operaciones, documentos) arrancan expandidos para
   * que se vean al primer click; los secundarios colapsados para limpieza. */
  defaultOpen?: boolean;
  /** R152ss — Gate de visibilidad opcional. Si está, el grupo solo se
   * muestra para users que cumplen el predicado. Si no está, el grupo se
   * muestra para todos. Usado para el grupo ClaudIA (acceso restringido a
   * Claudia, GG de REVTECH/TRONGKAI, Guido y admins). */
  requiresAccess?: (user: {
    email?: string | null;
    app_role?: string;
  }) => boolean;
};

// R152ss — Whitelist de emails con acceso al grupo ClaudIA.
// Editar acá si hay que sumar más coordinadores. Los admins siempre tienen
// acceso (ver predicado en el grupo).
const CLAUDIA_GROUP_EMAILS = new Set([
  "claudia@trongkai.com",
  // Agregar más a medida que se confirmen los emails de los GG y Guido:
  // "guido@...",
  // "gg-revtech@...",
  // "gg-trongkai@...",
]);

// R152ss — Dominios cuyos users SIEMPRE ven el grupo ClaudIA.
// (Cualquier email @trongkai.com o @revtech.com se considera del equipo CORFO.)
const CLAUDIA_GROUP_DOMAINS = ["@trongkai.com", "@revtech.com", "@revtech.cl"];

function canSeeClaudiaGroup(user: { email?: string | null; app_role?: string }): boolean {
  if (user.app_role === "admin") return true;
  const email = (user.email ?? "").toLowerCase().trim();
  if (!email) return false;
  if (CLAUDIA_GROUP_EMAILS.has(email)) return true;
  if (CLAUDIA_GROUP_DOMAINS.some((d) => email.endsWith(d))) return true;
  if (email.includes("guido")) return true;
  return false;
}

const GROUPS: NavGroup[] = [
  {
    id: "ejecutivo",
    label: "Ejecutivo",
    collapsible: true,
    defaultOpen: false,
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
    collapsible: true,
    defaultOpen: true,
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
      // R152ss — Voucher CORFO, Rendiciones CORFO y Subsidio CORFO
      // movidos al nuevo grupo "ClaudIA" (acceso restringido).
      { href: "/proveedores", label: "Proveedores", icon: Users },
      { href: "/solicitudes-pago", label: "Solicitudes Pago", icon: Wallet },
      { href: "/movimientos", label: "Movimientos", icon: BarChart3 },
      // R152rr — F29/F22 movidos al grupo "SII" dedicado.
      // V5: Vouchers (comprobantes contables) — corazón del módulo contable.
      // Imputación triple cuenta × proyecto × área con partida doble.
      {
        href: "/vouchers" as Route,
        label: "Vouchers contables",
        icon: Receipt,
        tourId: "vouchers",
      },
      { href: "/notificaciones" as Route, label: "Notificaciones", icon: Bell },
      // Round 152 — Dashboard Institucional CEHTA Capital (ILPA v2.0 + IRIS+)
      {
        href: "/dashboard/directorio" as Route,
        label: "Dashboard Institucional",
        icon: Sparkles,
        title:
          "Vista nivel Blackstone/KKR para directorio + LPs. ILPA v2.0 + IRIS+ v5.3.",
      },
    ],
  },
  {
    id: "estrategia",
    label: "Estrategia",
    collapsible: true,
    defaultOpen: false,
    items: [
      { href: "/avance" as Route, label: "Avance Empresas", icon: Target },
    ],
  },
  // R152ss — Grupo ClaudIA · Coordinación CORFO 2024-265638 (REVTECH+TRONGKAI).
  // Acceso restringido por whitelist + dominios + admin. Claudia coordina
  // todo lo del subsidio CORFO desde acá: creación de vouchers, reparto por
  // fuente de financiamiento (CORFO/P-tec/Empresa), rendiciones oficiales,
  // y dashboard de ejecución del fondo $3.000MM.
  {
    id: "claudia",
    label: "ClaudIA · CORFO 2026",
    collapsible: true,
    defaultOpen: true,
    requiresAccess: canSeeClaudiaGroup,
    items: [
      // Dashboard ejecución subsidio (R89 — "donde están las platas").
      {
        href: "/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI" as Route,
        label: "Subsidio CORFO · $3.000MM",
        icon: CircleDollarSign,
        title:
          "Dashboard de ejecución del subsidio CORFO 2026 ($3.000MM). " +
          "Reparto por empresa coejecutora (REVTECH/TRONGKAI), desglose por " +
          "fuente CORFO/P-tec/Empresa, gasto acumulado vs presupuesto.",
        isNew: true,
      },
      // Form dedicado para vouchers CORFO con bifurcación F.E/F.A.
      {
        href: "/vouchers/corfo" as Route,
        label: "Crear voucher CORFO",
        icon: Sparkles,
        title:
          "Form dedicado para vouchers del subsidio CORFO 2026. " +
          "Bifurcación F.E (sin IVA) vs F.A (con IVA + asignación), " +
          "reparto editable CORFO/P-tec/Empresa, IVA siempre corporativo.",
      },
      // Generador de planillas oficiales (R152w + R152mm sección embebida).
      {
        href: "/admin/rendiciones-corfo" as Route,
        label: "Rendiciones oficiales CORFO",
        icon: FileSpreadsheet,
        title:
          "Generador de los 2 Excel oficiales del folio 2024-265638 " +
          "(Carga_Gastos 21 cols + Carga_RRHH 17 cols). Pre-llenado " +
          "desde vouchers aprobados + remuneraciones Nubox del período. " +
          "Auto-sugerencia de mapeo cuenta_local → CORFO.",
        isNew: true,
      },
      // Editor masivo de mapeo cuenta_local → CORFO (R152x).
      {
        href: "/admin/rendiciones-corfo/mapping" as Route,
        label: "Editor mapeo CORFO",
        icon: FileCheck,
        title:
          "Editor masivo para mapear cuentas del plan local a las cuentas " +
          "oficiales CORFO. Auto-sugerencia con 18 keywords (Honorario→" +
          "SUBCONTRATOS, Arriendo→ARRIENDO, etc.).",
      },
    ],
  },
  // R152rr — Grupo SII dedicado. Centraliza todo lo tributario:
  // F29/F22, sync RCV, conciliación, dashboard de status por empresa.
  // Cada item lleva a una pantalla con función específica clara.
  {
    id: "sii",
    label: "SII · Tributario",
    collapsible: true,
    defaultOpen: false,
    items: [
      // R152rr — Dashboard hub central con stats de las 9 empresas.
      {
        href: "/sii" as Route,
        label: "Dashboard SII",
        icon: Landmark,
        title:
          "Hub central del SII: status de credenciales, último sync, DTEs pendientes de conciliar, F29 estimado por empresa. CTAs rápidos a las acciones operativas.",
        isNew: true,
      },
      // Sync RCV (antes "Integración SII" en Admin).
      {
        href: "/admin/sii" as Route,
        label: "Sincronizar RCV",
        icon: RefreshCw,
        title:
          "Disparar y monitorear el sync del Registro de Compras y Ventas con sii.cl. Status por run + log de errores.",
      },
      // Conciliación DTE ↔ vouchers locales.
      {
        href: "/admin/sii?tab=conciliar" as Route,
        label: "Conciliar DTE",
        icon: FileCheck,
        title:
          "Match automático: cada DTE descargado del SII vs los vouchers locales. Marca matches exactos, sugiere parciales, y permite crear voucher desde DTE faltante.",
      },
      // F29 mensual (declaración IVA).
      {
        href: "/f29",
        label: "F29 · IVA Mensual",
        icon: Receipt,
        title:
          "Formulario 29 mensual: IVA débito, crédito y PPM. Vence día 12 del mes siguiente (paperless: 20). Estado por empresa.",
      },
      // F22 anual (declaración renta).
      {
        href: "/f22" as Route,
        label: "F22 · Renta Anual",
        icon: FileSpreadsheet,
        title:
          "Formulario 22 anual: declaración de renta. Vence 30 abril del año siguiente al ejercicio. Estado por empresa + folio.",
      },
    ],
  },
  {
    id: "documentos",
    label: "Documentos",
    collapsible: true,
    defaultOpen: true,
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
      // Round 152i — Centro de Ayuda: guías HTML interactivas servidas in-app.
      { href: "/ayuda" as Route, label: "Centro de Ayuda", icon: Book },
      // Round 152v — Centro de Aprendizaje: módulos + quizzes con badges.
      { href: "/aprender" as Route, label: "Centro de Aprendizaje", icon: Sparkles, isNew: true },
    ],
  },
  // V5: Contabilidad — plan de cuentas + proyectos contables + áreas.
  // Fundación del módulo Vouchers. Todo el flujo contable formal pasa
  // por estos 3 catálogos antes de llegar a un voucher.
  {
    id: "contabilidad",
    label: "Contabilidad",
    collapsible: true,
    defaultOpen: false,
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
    collapsible: true,
    defaultOpen: false,
    items: [
      { href: "/admin/usuarios" as Route, label: "Usuarios", icon: UserCog },
      // Round 152u — Mapa de Adopción (Mapeo de Actores · Gestión del Cambio).
      { href: "/admin/adopcion" as Route, label: "Mapa de Adopción", icon: Users, isNew: true },
      // R152dd — Dashboard NPS feedback.
      {
        href: "/admin/feedback" as Route,
        label: "Feedback NPS",
        icon: MessageSquare,
        title: "Respuestas de feedback de usuarios por flujo (crear, firmar, pagar, CORFO).",
        isNew: true,
      },
      // R152ss — Subsidio CORFO movido al grupo "ClaudIA".
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
      // Round 128 — checklist en vivo de pre-marcha-blanca
      {
        href: "/admin/marcha-blanca" as Route,
        label: "Checklist marcha blanca",
        icon: Target,
        title:
          "Estado en vivo: ¿estamos listos para arrancar operación real? Bloqueantes vs importantes vs nice-to-have.",
      },
      // Round 120 — vista unica de data del fondo (empresas + directorio + inversionistas)
      {
        href: "/admin/data" as Route,
        label: "Data del fondo",
        icon: Book,
        title:
          "Vista unica de empresas portafolio, directorio formal e inversionistas/aportantes. Una sola pantalla con todo el contexto del fondo.",
      },
      // R152rr — Integración SII movida al grupo "SII" dedicado.
      // Round 123 — Nubox remuneraciones
      {
        href: "/admin/nubox" as Route,
        label: "Integración Nubox (sueldos)",
        icon: Users,
        title:
          "Libro de Remuneraciones de Nubox. Auto-sync best-effort + upload manual del xlsx. Resumen mensual de haberes, descuentos, AFP, salud y aportes patronales.",
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
      // R152tt — http-trail movido a "Avanzado" (es muy técnico, dev-only).
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
      // R152tt — Movidos a "Avanzado": Status/Health duplicaban system-status,
      // y Webhooks/API tokens/API docs/HTTP trail son dev-only.
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
  // Round 152h — Módulos que existen pero no se usan a diario (vacíos o
  // pendientes de activación). Agrupados y colapsados por default para no
  // saturar el menú principal. Se reactivan cuando tengan uso real.
  {
    id: "avanzado",
    label: "Avanzado / Futuro",
    collapsible: true,
    items: [
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: FileText },
      { href: "/fondos" as Route, label: "Búsqueda de Fondos", icon: Search },
      {
        href: "/suscripciones" as Route,
        label: "Suscripciones FIP",
        icon: TrendingUp,
      },
      { href: "/admin/lps" as Route, label: "Inversionistas (LPs)", icon: Users },
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
      // R152tt — Items dev-only movidos desde Admin a Avanzado.
      // Las URLs siguen siendo válidas — solo cambia el agrupamiento del sidebar
      // para reducir bloat del menú Admin (era 25 items, ahora 18).
      {
        href: "/admin/http-trail" as Route,
        label: "Audit trail HTTP",
        icon: ScrollText,
        title: "Log detallado de cada request HTTP entrante. Dev-only.",
      },
      {
        href: "/admin/status" as Route,
        label: "Status básico",
        icon: Activity,
        title: "Status rápido del sistema. Para vista completa usá Estado del sistema en Admin.",
      },
      {
        href: "/admin/health" as Route,
        label: "Health detallado",
        icon: Activity,
        title: "Health check exhaustivo de todas las integraciones. Tarda más en cargar.",
      },
      {
        href: "/admin/webhooks" as Route,
        label: "Webhooks",
        icon: Webhook,
        title: "Configurar webhooks salientes a sistemas externos.",
      },
      {
        href: "/admin/api-tokens" as Route,
        label: "API tokens",
        icon: Key,
        title: "Generar/revocar tokens API para integraciones externas.",
      },
      {
        href: "/admin/api-docs" as Route,
        label: "API docs",
        icon: Book,
        title: "Documentación OpenAPI del backend (Swagger UI).",
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

  // R152tt — Memoizar visibleGroups. Solo recalcula si cambian role/email,
  // no en cada navegación. GROUPS es const, así que solo dependemos de los 3
  // inputs reales. Antes: 72 items filtrados en CADA render = waste.
  const visibleGroups = useMemo(
    () =>
      GROUPS.filter((g) => {
        if (g.id === "ejecutivo") return isExecutive;
        if (g.id === "admin") return isAdmin;
        if (g.requiresAccess) return g.requiresAccess({ email, app_role: role });
        return true;
      }),
    [isExecutive, isAdmin, role, email],
  );

  // Round 152j — estado de grupos colapsables. Cada grupo arranca con su
  // defaultOpen (operaciones+documentos = true, resto = false). Si el user
  // ya tocó un grupo, su preferencia (localStorage) gana sobre el default.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // 1. Empezar con los defaults de cada grupo
    const defaults: Record<string, boolean> = {};
    for (const g of GROUPS) {
      defaults[g.id] = g.defaultOpen ?? false;
    }
    // 2. Mergear con preferencias persistidas (user override)
    if (typeof window === "undefined") return defaults;
    try {
      const stored = JSON.parse(
        localStorage.getItem("sidebar-open-groups") || "{}",
      ) as Record<string, boolean>;
      return { ...defaults, ...stored };
    } catch {
      return defaults;
    }
  });
  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("sidebar-open-groups", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

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
  // R152iii — prefetch hover para items hot del sidebar
  const prefetchAprobaciones = useAprobacionesPrefetch();
  const prefetchActionCenter = useActionCenterPrefetch();
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
            {group.collapsible ? (
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="mb-1.5 mt-4 flex w-full items-center gap-1 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300 transition-colors hover:text-ink-500"
              >
                <ChevronRight
                  className={`size-3 transition-transform ${openGroups[group.id] ? "rotate-90" : ""}`}
                />
                {group.label}
              </button>
            ) : (
              <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                {group.label}
              </h3>
            )}
            <div
              className="space-y-0.5"
              hidden={group.collapsible ? !openGroups[group.id] : false}
            >
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
                        : hrefStr === "/aprobaciones"
                          ? prefetchAprobaciones
                          : hrefStr === "/action-center"
                            ? prefetchActionCenter
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
                        ? "bg-gradient-to-r from-cehta-green/15 via-cehta-green/10 to-transparent text-cehta-green"
                        : "text-ink-700 hover:bg-cehta-green/[0.06] hover:text-cehta-green hover:translate-x-0.5",
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
                    {/* R152qq — chip "Nuevo" para features recién liberadas.
                        Se autoesconde cuando isActive (estás en la URL → ya la
                        viste) para mantener el sidebar limpio. */}
                    {item.isNew && !isActive && (
                      <span
                        aria-label="Nuevo"
                        className="inline-flex items-center rounded-full bg-cehta-green/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cehta-green ring-1 ring-cehta-green/30"
                      >
                        Nuevo
                      </span>
                    )}
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
      <div className="space-y-2 border-t border-hairline px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p
            className="truncate px-2 text-xs text-ink-500 tabular-nums"
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
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple",
              "hover:bg-negative/10 hover:text-negative",
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

