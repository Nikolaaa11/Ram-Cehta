"use client";

import { Document, Page, View, Text, pdf } from "@react-pdf/renderer";
import { pdfStyles } from "@/lib/reportes/pdf-styles";
import { registerPdfFonts } from "@/lib/reportes/pdf-fonts";
import { fmtCLP, fmtDate, fmtInt } from "@/lib/reportes/format";
import {
  PdfBadge,
  PdfCover,
  PdfKpi,
  PdfPageFooter,
  PdfPageHeader,
  PdfTable,
  type PdfTableColumn,
} from "@/components/reportes/pdf/common";
import type { F29Read } from "@/lib/api/schema";

interface CountersRow {
  empresa: string;
  pendientes: number;
  vencidas: number;
  proximas30d: number;
  pagadas: number;
  monto_pendiente: number;
}

interface Props {
  items: F29Read[];
  counters: CountersRow[];
  totals: { pagadasMes: number; vencidas: number; proximas30d: number; total: number };
  filters: { empresa?: string };
  generatedAt: Date;
}

const COUNTER_COLS: PdfTableColumn[] = [
  { key: "empresa", label: "Empresa", flex: 1.2 },
  { key: "pendientes", label: "Pendientes", flex: 1, align: "right" },
  { key: "vencidas", label: "Vencidas", flex: 1, align: "right" },
  { key: "proximas30d", label: "Próx. 30d", flex: 1, align: "right" },
  { key: "pagadas", label: "Pagadas", flex: 1, align: "right" },
  { key: "monto_pendiente", label: "Monto pendiente", flex: 1.6, align: "right" },
];

const DETALLE_COLS: PdfTableColumn[] = [
  { key: "empresa", label: "Empresa", flex: 1 },
  { key: "periodo", label: "Período", flex: 1 },
  { key: "vencimiento", label: "Vencimiento", flex: 1.2 },
  { key: "monto", label: "Monto", flex: 1.2, align: "right" },
  { key: "estado", label: "Estado", flex: 0.8 },
  { key: "fecha_pago", label: "Fecha pago", flex: 1.2 },
];

function tone(estado: string): "success" | "warning" | "danger" | "neutral" {
  if (estado === "pagado") return "success";
  if (estado === "vencido") return "danger";
  if (estado === "exento") return "neutral";
  return "warning";
}

function TributarioDocument({ items, counters, totals, filters, generatedAt }: Props) {
  const headerTitle = "Compliance Tributario";
  return (
    <Document title="Cehta Capital — Compliance Tributario">
      <Page size="A4" style={pdfStyles.page}>
        <PdfCover
          title="Compliance Tributario"
          subtitle="F29 por empresa — últimos 12 meses"
          meta={[
            { label: "Empresa", value: filters.empresa ?? "Todas" },
            { label: "Total registros", value: fmtInt(totals.total) },
            { label: "Pagadas mes actual", value: fmtInt(totals.pagadasMes) },
            { label: "Vencidas", value: fmtInt(totals.vencidas) },
            { label: "Próximas 30 días", value: fmtInt(totals.proximas30d) },
          ]}
          generatedAt={generatedAt}
        />
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />
        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Indicadores</Text>
          <View style={pdfStyles.kpiGrid}>
            <PdfKpi label="Pagadas mes actual" value={fmtInt(totals.pagadasMes)} />
            <PdfKpi label="Vencidas" value={fmtInt(totals.vencidas)} />
            <PdfKpi label="Próximas 30 días" value={fmtInt(totals.proximas30d)} />
            <PdfKpi label="Total registros 12m" value={fmtInt(totals.total)} />
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Resumen por empresa</Text>
          <Text style={pdfStyles.sectionSubtitle}>Counters consolidados</Text>
          <PdfTable<CountersRow>
            columns={COUNTER_COLS}
            rows={counters}
            cellRender={(row, col) => {
              switch (col.key) {
                case "empresa":
                  return row.empresa;
                case "pendientes":
                  return fmtInt(row.pendientes);
                case "vencidas":
                  return fmtInt(row.vencidas);
                case "proximas30d":
                  return fmtInt(row.proximas30d);
                case "pagadas":
                  return fmtInt(row.pagadas);
                case "monto_pendiente":
                  return fmtCLP(row.monto_pendiente);
                default:
                  return "";
              }
            }}
            emptyText="Sin counters por empresa."
          />
        </View>

        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />
        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Detalle de obligaciones F29</Text>
          <Text style={pdfStyles.sectionSubtitle}>{items.length} registros · ordenados por vencimiento</Text>
          {items.length === 0 ? (
            <View style={pdfStyles.emptyBox}>
              <Text style={pdfStyles.emptyText}>Sin obligaciones tributarias para el período seleccionado.</Text>
            </View>
          ) : (
            <View style={pdfStyles.table}>
              <View style={pdfStyles.tableHeader} fixed>
                {DETALLE_COLS.map((c) => (
                  <Text
                    key={c.key}
                    style={[
                      pdfStyles.tableHeaderCell,
                      { flex: c.flex ?? 1 },
                      c.align === "right" ? pdfStyles.alignRight : {},
                    ]}
                  >
                    {c.label}
                  </Text>
                ))}
              </View>
              {items.map((f, idx) => {
                const isLast = idx === items.length - 1;
                return (
                  <View
                    key={f.f29_id}
                    style={[
                      pdfStyles.tableRow,
                      idx % 2 === 1 ? pdfStyles.tableRowZebra : {},
                      isLast ? pdfStyles.tableRowLast : {},
                    ]}
                    wrap={false}
                  >
                    <Text style={[pdfStyles.tableCell, { flex: 1 }]}>{f.empresa_codigo}</Text>
                    <Text style={[pdfStyles.tableCell, { flex: 1 }]}>{f.periodo_tributario}</Text>
                    <Text style={[pdfStyles.tableCell, { flex: 1.2 }]}>{fmtDate(f.fecha_vencimiento)}</Text>
                    <Text style={[pdfStyles.tableCell, { flex: 1.2 }, pdfStyles.alignRight]}>{fmtCLP(f.monto_a_pagar)}</Text>
                    <View style={[{ flex: 0.8 }, pdfStyles.tableCell]}>
                      <PdfBadge label={f.estado} tone={tone(f.estado)} />
                    </View>
                    <Text style={[pdfStyles.tableCell, { flex: 1.2 }]}>{fmtDate(f.fecha_pago)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

export async function renderTributarioPdf(props: Props): Promise<Blob> {
  registerPdfFonts();
  return pdf(<TributarioDocument {...props} />).toBlob();
}

export default TributarioDocument;
