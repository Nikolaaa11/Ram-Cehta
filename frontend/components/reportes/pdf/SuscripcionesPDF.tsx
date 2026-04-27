"use client";

import { Document, Page, View, Text, pdf } from "@react-pdf/renderer";
import { pdfStyles } from "@/lib/reportes/pdf-styles";
import { registerPdfFonts } from "@/lib/reportes/pdf-fonts";
import { fmtCLP, fmtDate, fmtInt, fmtUF } from "@/lib/reportes/format";
import {
  PdfCover,
  PdfKpi,
  PdfPageFooter,
  PdfPageHeader,
  PdfTable,
  type PdfTableColumn,
} from "@/components/reportes/pdf/common";
import type { SuscripcionAccion, SuscripcionTotals } from "@/lib/reportes/types";

interface Props {
  items: SuscripcionAccion[];
  totals: SuscripcionTotals;
  filters: { empresa?: string; anio?: string };
  generatedAt: Date;
}

const COLS: PdfTableColumn[] = [
  { key: "fecha_recibo", label: "Fecha", flex: 1 },
  { key: "empresa_codigo", label: "Empresa", flex: 1 },
  { key: "acciones_pagadas", label: "Acciones", flex: 1, align: "right" },
  { key: "monto_uf", label: "UF", flex: 1, align: "right" },
  { key: "monto_clp", label: "CLP", flex: 1.4, align: "right" },
  { key: "contrato_ref", label: "Contrato", flex: 1.2 },
  { key: "firmado", label: "Firmado", flex: 0.8 },
];

function SuscripcionesDocument({ items, totals, filters, generatedAt }: Props) {
  const headerTitle = "Suscripciones de Acciones";
  return (
    <Document title="Cehta Capital — Suscripciones de Acciones">
      <Page size="A4" style={pdfStyles.page}>
        <PdfCover
          title="Suscripciones de Acciones"
          subtitle="Acciones FIP CEHTA ESG suscritas por inversionistas"
          meta={[
            { label: "Empresa", value: filters.empresa ?? "Todas" },
            { label: "Año", value: filters.anio ?? "Todos" },
            { label: "Contratos", value: fmtInt(totals.total_contratos) },
            { label: "Acciones suscritas", value: fmtInt(totals.total_acciones) },
            { label: "Total CLP", value: fmtCLP(totals.total_clp) },
            { label: "Total UF", value: fmtUF(Number(totals.total_uf)) },
          ]}
          generatedAt={generatedAt}
        />
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Totales</Text>
          <View style={pdfStyles.kpiGrid}>
            <PdfKpi label="Acciones suscritas" value={fmtInt(totals.total_acciones)} />
            <PdfKpi label="Total CLP" value={fmtCLP(totals.total_clp)} />
            <PdfKpi label="Total UF" value={fmtUF(Number(totals.total_uf))} />
            <PdfKpi label="Contratos firmados" value={fmtInt(totals.total_contratos)} />
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Detalle de suscripciones</Text>
          <Text style={pdfStyles.sectionSubtitle}>
            {items.length} {items.length === 1 ? "registro" : "registros"} · ordenados por fecha de recibo
          </Text>
          <PdfTable<SuscripcionAccion>
            columns={COLS}
            rows={items}
            cellRender={(row, col) => {
              switch (col.key) {
                case "fecha_recibo":
                  return fmtDate(row.fecha_recibo);
                case "empresa_codigo":
                  return row.empresa_codigo;
                case "acciones_pagadas":
                  return fmtInt(row.acciones_pagadas);
                case "monto_uf":
                  return fmtUF(Number(row.monto_uf ?? 0));
                case "monto_clp":
                  return fmtCLP(row.monto_clp);
                case "contrato_ref":
                  return row.contrato_ref ?? "—";
                case "firmado":
                  return row.firmado ? "Firmado" : "Pendiente";
                default:
                  return "";
              }
            }}
            emptyText="Sin suscripciones para el período seleccionado."
          />
        </View>

        <PdfPageFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

export async function renderSuscripcionesPdf(props: Props): Promise<Blob> {
  registerPdfFonts();
  return pdf(<SuscripcionesDocument {...props} />).toBlob();
}

export default SuscripcionesDocument;
