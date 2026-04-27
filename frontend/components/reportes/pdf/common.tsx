"use client";

/**
 * Componentes PDF compartidos — header, footer, cover, KPI cards y tablas.
 *
 * IMPORTANTE: cliente puro ("use client"). NUNCA importar desde un Server
 * Component — `@react-pdf/renderer` requiere browser APIs. Las páginas server
 * importan los wrappers en `components/reportes/*ReportView.tsx` que dynamic-
 * loadean estos módulos con `ssr:false`.
 */
import { Text, View } from "@react-pdf/renderer";
import { pdfColors, pdfStyles } from "@/lib/reportes/pdf-styles";
import { fmtDateTime } from "@/lib/reportes/format";

export interface PdfPageHeaderProps {
  title: string;
}

export function PdfPageHeader({ title }: PdfPageHeaderProps) {
  return (
    <View style={pdfStyles.pageHeader} fixed>
      <Text style={pdfStyles.brand}>Cehta Capital · FIP CEHTA ESG</Text>
      <Text style={pdfStyles.pageMeta}>{title}</Text>
    </View>
  );
}

export function PdfPageFooter({ generatedAt }: { generatedAt: Date }) {
  return (
    <View style={pdfStyles.pageFooter} fixed>
      <Text>
        Generado el {fmtDateTime(generatedAt)} · Cehta Capital — Confidencial · No
        distribuir
      </Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `Página ${pageNumber} / ${totalPages}`
        }
      />
    </View>
  );
}

export interface PdfCoverProps {
  badge?: string;
  title: string;
  subtitle?: string;
  meta: { label: string; value: string }[];
  generatedAt: Date;
}

export function PdfCover({ badge = "Reporte para Inversionistas", title, subtitle, meta, generatedAt }: PdfCoverProps) {
  return (
    <View style={pdfStyles.coverPage}>
      <Text style={pdfStyles.coverBadge}>{badge}</Text>
      <Text style={pdfStyles.coverTitle}>{title}</Text>
      {subtitle ? <Text style={pdfStyles.coverSubtitle}>{subtitle}</Text> : null}
      <View style={pdfStyles.coverDivider} />
      {meta.map((m) => (
        <View key={m.label} style={pdfStyles.coverMetaRow}>
          <Text style={pdfStyles.coverMetaLabel}>{m.label}</Text>
          <Text style={pdfStyles.coverMetaValue}>{m.value}</Text>
        </View>
      ))}
      <View style={pdfStyles.coverMetaRow}>
        <Text style={pdfStyles.coverMetaLabel}>Generado</Text>
        <Text style={pdfStyles.coverMetaValue}>{fmtDateTime(generatedAt)}</Text>
      </View>
      <View style={[pdfStyles.coverDivider, { marginTop: 48 }]} />
      <Text style={[pdfStyles.textSmall, pdfStyles.textMuted]}>
        Documento confidencial preparado para inversionistas y comité del fondo.
        No distribuir fuera del círculo autorizado.
      </Text>
    </View>
  );
}

export interface PdfKpiProps {
  label: string;
  value: string;
  hint?: string;
}

export function PdfKpi({ label, value, hint }: PdfKpiProps) {
  return (
    <View style={pdfStyles.kpiCard}>
      <Text style={pdfStyles.kpiLabel}>{label}</Text>
      <Text style={pdfStyles.kpiValue}>{value}</Text>
      {hint ? <Text style={pdfStyles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

export interface PdfTableColumn {
  key: string;
  label: string;
  flex?: number;
  align?: "left" | "right" | "center";
}

export interface PdfTableProps<T> {
  columns: PdfTableColumn[];
  rows: T[];
  cellRender: (row: T, col: PdfTableColumn) => string;
  emptyText?: string;
}

export function PdfTable<T>({ columns, rows, cellRender, emptyText = "Sin datos para el período seleccionado." }: PdfTableProps<T>) {
  if (rows.length === 0) {
    return (
      <View style={pdfStyles.emptyBox}>
        <Text style={pdfStyles.emptyText}>{emptyText}</Text>
      </View>
    );
  }
  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tableHeader} fixed>
        {columns.map((c) => (
          <Text
            key={c.key}
            style={[
              pdfStyles.tableHeaderCell,
              { flex: c.flex ?? 1 },
              c.align === "right" ? pdfStyles.alignRight : c.align === "center" ? pdfStyles.alignCenter : {},
            ]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        return (
          <View
            key={idx}
            style={[
              pdfStyles.tableRow,
              idx % 2 === 1 ? pdfStyles.tableRowZebra : {},
              isLast ? pdfStyles.tableRowLast : {},
            ]}
            wrap={false}
          >
            {columns.map((c) => (
              <Text
                key={c.key}
                style={[
                  pdfStyles.tableCell,
                  { flex: c.flex ?? 1 },
                  c.align === "right" ? pdfStyles.alignRight : c.align === "center" ? pdfStyles.alignCenter : {},
                ]}
              >
                {cellRender(row, c)}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function PdfBadge({ label, tone = "neutral" }: { label: string; tone?: "success" | "warning" | "danger" | "neutral" | "info" }) {
  const map = {
    success: pdfStyles.badgeSuccess,
    warning: pdfStyles.badgeWarning,
    danger: pdfStyles.badgeDanger,
    info: pdfStyles.badgeInfo,
    neutral: pdfStyles.badgeNeutral,
  } as const;
  return <Text style={[pdfStyles.badge, map[tone]]}>{label}</Text>;
}

export const pdfPalette = pdfColors;
