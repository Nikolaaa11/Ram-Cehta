"use client";

import { Document, Page, View, Text, pdf } from "@react-pdf/renderer";
import { pdfStyles } from "@/lib/reportes/pdf-styles";
import { registerPdfFonts } from "@/lib/reportes/pdf-fonts";
import { fmtCLP, fmtDate, fmtInt } from "@/lib/reportes/format";
import {
  PdfCover,
  PdfPageFooter,
  PdfPageHeader,
  PdfKpi,
  PdfTable,
  type PdfTableColumn,
} from "@/components/reportes/pdf/common";
import type {
  CashflowResponse,
  DashboardKPIs,
  SaldoEmpresaDetalle,
  CashflowPoint,
} from "@/lib/api/schema";

interface Props {
  kpis: DashboardKPIs | null;
  saldos: SaldoEmpresaDetalle[];
  cashflow: CashflowResponse;
  generatedAt: Date;
}

const SALDOS_COLS: PdfTableColumn[] = [
  { key: "empresa_codigo", label: "Empresa", flex: 1 },
  { key: "razon_social", label: "Razón Social", flex: 2 },
  { key: "saldo_contable", label: "Saldo Contable", flex: 1.6, align: "right" },
  { key: "saldo_cehta", label: "Cehta", flex: 1.4, align: "right" },
  { key: "saldo_corfo", label: "CORFO", flex: 1.4, align: "right" },
  { key: "ultima_actualizacion", label: "Actualizado", flex: 1.2 },
];

const CASHFLOW_COLS: PdfTableColumn[] = [
  { key: "periodo", label: "Período", flex: 1 },
  { key: "abono_real", label: "Abono Real", flex: 1.4, align: "right" },
  { key: "egreso_real", label: "Egreso Real", flex: 1.4, align: "right" },
  { key: "flujo_neto_real", label: "Flujo Neto", flex: 1.4, align: "right" },
  { key: "saldo_acumulado", label: "Saldo Acum.", flex: 1.4, align: "right" },
];

function FondoDocument({ kpis, saldos, cashflow, generatedAt }: Props) {
  const meses = cashflow.points.length;
  const aum = kpis ? Number(kpis.saldo_total_consolidado) : saldos.reduce((a, s) => a + Number(s.saldo_contable ?? 0), 0);
  const totalCehta = kpis ? Number(kpis.saldo_total_cehta) : 0;
  const totalCorfo = kpis ? Number(kpis.saldo_total_corfo) : 0;

  const headerTitle = "Estado del Fondo";

  return (
    <Document
      title="Cehta Capital — Estado del Fondo"
      author="Cehta Capital"
      subject="Reporte Estado del Fondo FIP CEHTA ESG"
    >
      {/* Cover */}
      <Page size="A4" style={pdfStyles.page}>
        <PdfCover
          title="Estado del Fondo"
          subtitle="Reporte consolidado para inversionistas — FIP CEHTA ESG"
          meta={[
            { label: "Período", value: meses ? `Últimos ${meses} meses` : "Sin datos" },
            { label: "Compañías", value: String(saldos.length) },
            { label: "Último ETL", value: kpis?.ultimo_etl_run ? fmtDate(kpis.ultimo_etl_run) : "Sin corridas" },
            { label: "Estado ETL", value: kpis?.etl_status ?? "—" },
          ]}
          generatedAt={generatedAt}
        />
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      {/* KPI hero + saldos */}
      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Indicadores consolidados</Text>
          <Text style={pdfStyles.sectionSubtitle}>
            Saldo total bajo administración y composición por aporte.
          </Text>
          <View style={pdfStyles.kpiGrid}>
            <PdfKpi label="AUM Consolidado" value={fmtCLP(aum)} hint="Suma saldos contables" />
            <PdfKpi label="Saldo Cehta" value={fmtCLP(totalCehta)} hint="Aporte del fondo" />
            <PdfKpi label="Saldo CORFO" value={fmtCLP(totalCorfo)} hint="Aporte CORFO" />
            <PdfKpi
              label="Flujo neto del mes"
              value={kpis ? fmtCLP(kpis.flujo_neto_mes) : "—"}
              hint={kpis ? `IVA a pagar ${fmtCLP(kpis.iva_a_pagar_mes)}` : undefined}
            />
            <PdfKpi
              label="OC pendientes"
              value={kpis ? fmtInt(kpis.oc_emitidas_pendientes) : "—"}
              hint={kpis ? fmtCLP(kpis.monto_oc_pendiente) : undefined}
            />
            <PdfKpi
              label="F29 vencidas / próximas"
              value={kpis ? `${fmtInt(kpis.f29_vencidas)} / ${fmtInt(kpis.f29_proximas_30d)}` : "—"}
              hint="Próximos 30 días"
            />
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Saldos por empresa</Text>
          <Text style={pdfStyles.sectionSubtitle}>
            Composición consolidada del portafolio
          </Text>
          <PdfTable<SaldoEmpresaDetalle>
            columns={SALDOS_COLS}
            rows={saldos}
            cellRender={(row, col) => {
              switch (col.key) {
                case "empresa_codigo":
                  return row.empresa_codigo;
                case "razon_social":
                  return row.razon_social;
                case "saldo_contable":
                  return fmtCLP(row.saldo_contable);
                case "saldo_cehta":
                  return fmtCLP(row.saldo_cehta);
                case "saldo_corfo":
                  return fmtCLP(row.saldo_corfo);
                case "ultima_actualizacion":
                  return fmtDate(row.ultima_actualizacion);
                default:
                  return "";
              }
            }}
            emptyText="Sin datos para el período seleccionado."
          />
        </View>

        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      {/* Cashflow timeline */}
      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />
        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Cashflow consolidado</Text>
          <Text style={pdfStyles.sectionSubtitle}>
            Detalle por período · valores reales en CLP
          </Text>
          <PdfTable<CashflowPoint>
            columns={CASHFLOW_COLS}
            rows={cashflow.points}
            cellRender={(row, col) => {
              switch (col.key) {
                case "periodo":
                  return row.periodo;
                case "abono_real":
                  return fmtCLP(row.abono_real);
                case "egreso_real":
                  return fmtCLP(row.egreso_real);
                case "flujo_neto_real":
                  return fmtCLP(row.flujo_neto_real);
                case "saldo_acumulado":
                  return fmtCLP(row.saldo_acumulado);
                default:
                  return "";
              }
            }}
            emptyText="Sin datos de cashflow para el período seleccionado."
          />
        </View>
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

/**
 * Orquestador puro: registra fonts, ejecuta `pdf().toBlob()` y devuelve el
 * Blob para que el caller decida cómo descargarlo (file-saver).
 */
export async function renderFondoPdf(props: Props): Promise<Blob> {
  registerPdfFonts();
  return pdf(<FondoDocument {...props} />).toBlob();
}

export default FondoDocument;
