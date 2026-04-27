/**
 * Apple-style PDF stylesheet compartido por todos los reportes.
 *
 * Tokens replican los del frontend (cehta-green, ink-*, hairline) para
 * coherencia visual entre HTML preview y PDF final.
 */
import { StyleSheet } from "@react-pdf/renderer";

export const pdfColors = {
  cehtaGreen: "#1d6f42",
  cehtaGreenSoft: "#dcf0e3",
  ink900: "#1d1d1f",
  ink700: "#424245",
  ink500: "#6e6e73",
  ink300: "#a1a1a6",
  ink100: "#d2d2d7",
  hairline: "#e5e5e7",
  surface: "#ffffff",
  surfaceMuted: "#f5f5f7",
  positive: "#34c759",
  negative: "#ff3b30",
  warning: "#ff9500",
  sfBlue: "#0a84ff",
} as const;

export const pdfStyles = StyleSheet.create({
  // ─── Page ───────────────────────────────────────────────────────────────
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontFamily: "Inter",
    fontSize: 10,
    color: pdfColors.ink900,
    lineHeight: 1.5,
  },

  // ─── Header (per-page) ──────────────────────────────────────────────────
  pageHeader: {
    position: "absolute",
    top: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.hairline,
    paddingBottom: 12,
  },
  brand: {
    fontSize: 11,
    fontWeight: 600,
    color: pdfColors.cehtaGreen,
    letterSpacing: 0.2,
  },
  pageMeta: {
    fontSize: 9,
    color: pdfColors.ink500,
  },

  // ─── Footer (per-page) ──────────────────────────────────────────────────
  pageFooter: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: pdfColors.hairline,
    paddingTop: 10,
    fontSize: 8,
    color: pdfColors.ink500,
  },

  // ─── Cover ──────────────────────────────────────────────────────────────
  coverPage: {
    paddingHorizontal: 48,
    paddingTop: 96,
    fontFamily: "Inter",
    color: pdfColors.ink900,
  },
  coverBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: pdfColors.cehtaGreen,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  coverTitle: {
    fontSize: 32,
    fontWeight: 700,
    marginTop: 16,
    letterSpacing: -0.8,
    color: pdfColors.ink900,
  },
  coverSubtitle: {
    fontSize: 14,
    color: pdfColors.ink500,
    marginTop: 8,
  },
  coverDivider: {
    height: 1,
    backgroundColor: pdfColors.hairline,
    marginTop: 32,
    marginBottom: 24,
  },
  coverMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  coverMetaLabel: {
    fontSize: 9,
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  coverMetaValue: {
    fontSize: 11,
    fontWeight: 500,
    color: pdfColors.ink900,
  },

  // ─── Section ────────────────────────────────────────────────────────────
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 9,
    color: pdfColors.ink500,
    marginBottom: 12,
  },

  // ─── KPI grid ───────────────────────────────────────────────────────────
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flexBasis: "48%",
    flexGrow: 1,
    padding: 14,
    borderWidth: 1,
    borderColor: pdfColors.hairline,
    borderRadius: 8,
    backgroundColor: pdfColors.surface,
  },
  kpiLabel: {
    fontSize: 8,
    color: pdfColors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: -0.4,
    marginTop: 4,
    color: pdfColors.ink900,
  },
  kpiHint: {
    fontSize: 9,
    color: pdfColors.ink500,
    marginTop: 4,
  },

  // ─── Table ──────────────────────────────────────────────────────────────
  table: {
    borderWidth: 1,
    borderColor: pdfColors.hairline,
    borderRadius: 8,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.hairline,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: pdfColors.ink500,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.hairline,
  },
  tableRowZebra: { backgroundColor: pdfColors.surfaceMuted },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    fontSize: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: pdfColors.ink900,
  },
  tableCellMuted: { color: pdfColors.ink500 },
  alignRight: { textAlign: "right" },
  alignCenter: { textAlign: "center" },

  // ─── Empty state ────────────────────────────────────────────────────────
  emptyBox: {
    padding: 24,
    borderWidth: 1,
    borderColor: pdfColors.hairline,
    borderRadius: 8,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 10,
    color: pdfColors.ink500,
    textAlign: "center",
  },

  // ─── Misc helpers ───────────────────────────────────────────────────────
  badge: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  badgeSuccess: { backgroundColor: "#e9f9ec", color: pdfColors.positive },
  badgeWarning: { backgroundColor: "#fff3e0", color: pdfColors.warning },
  badgeDanger: { backgroundColor: "#fde8e6", color: pdfColors.negative },
  badgeNeutral: { backgroundColor: pdfColors.surfaceMuted, color: pdfColors.ink700 },
  badgeInfo: { backgroundColor: "#e6f0ff", color: pdfColors.sfBlue },

  divider: {
    height: 1,
    backgroundColor: pdfColors.hairline,
    marginVertical: 12,
  },

  textMuted: { color: pdfColors.ink500 },
  textSmall: { fontSize: 9 },
  bold: { fontWeight: 600 },
});
