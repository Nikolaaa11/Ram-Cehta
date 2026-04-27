"use client";

import { Document, Page, View, Text, pdf } from "@react-pdf/renderer";
import { pdfStyles, pdfColors } from "@/lib/reportes/pdf-styles";
import { registerPdfFonts } from "@/lib/reportes/pdf-fonts";
import { fmtCLP, fmtDate, fmtInt } from "@/lib/reportes/format";
import {
  PdfCover,
  PdfKpi,
  PdfPageFooter,
  PdfPageHeader,
  PdfTable,
  type PdfTableColumn,
} from "@/components/reportes/pdf/common";
import type { ProyectoRanking } from "@/lib/api/schema";
import type { EmpresaPortafolioStats } from "@/lib/reportes/types";

interface Props {
  empresas: EmpresaPortafolioStats[];
  ranking: ProyectoRanking[];
  generatedAt: Date;
}

const RANKING_COLS: PdfTableColumn[] = [
  { key: "rank", label: "#", flex: 0.4 },
  { key: "proyecto", label: "Proyecto", flex: 2.5 },
  { key: "total_egreso", label: "Total Egresos", flex: 1.4, align: "right" },
  { key: "num_movimientos", label: "Movs.", flex: 0.8, align: "right" },
  { key: "empresas", label: "Empresas", flex: 2 },
];

function EmpresaCard({ e }: { e: EmpresaPortafolioStats }) {
  const issues: string[] = [];
  if (e.f29_vencidas > 0) issues.push(`${e.f29_vencidas} F29 vencida${e.f29_vencidas !== 1 ? "s" : ""}`);
  if (e.ocs_pendientes > 0) issues.push(`${e.ocs_pendientes} OC pendiente${e.ocs_pendientes !== 1 ? "s" : ""}`);
  return (
    <View
      style={{
        marginBottom: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: pdfColors.hairline,
        borderRadius: 8,
      }}
      wrap={false}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: 600 }}>{e.codigo}</Text>
        <Text style={{ fontSize: 9, color: pdfColors.ink500 }}>{e.rut ?? "Sin RUT"}</Text>
      </View>
      <Text style={{ fontSize: 10, color: pdfColors.ink700, marginBottom: 8 }}>{e.razon_social}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <PdfKpi label="Saldo contable" value={fmtCLP(e.saldo_contable)} />
        <PdfKpi label="Saldo Cehta" value={fmtCLP(e.saldo_cehta)} />
        <PdfKpi label="Saldo CORFO" value={fmtCLP(e.saldo_corfo)} />
        <PdfKpi label="OCs pendientes" value={fmtInt(e.ocs_pendientes)} hint={fmtCLP(e.monto_oc_pendiente)} />
        <PdfKpi label="F29 pendientes" value={fmtInt(e.f29_pendientes)} hint={`Vencidas: ${fmtInt(e.f29_vencidas)}`} />
        <PdfKpi label="Última actualización" value={fmtDate(e.ultima_actualizacion)} />
      </View>
      {issues.length > 0 ? (
        <Text style={{ fontSize: 9, color: pdfColors.warning, marginTop: 8 }}>
          Atención: {issues.join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function PortafolioDocument({ empresas, ranking, generatedAt }: Props) {
  const totalAum = empresas.reduce((acc, e) => acc + Number(e.saldo_contable ?? 0), 0);
  const totalOcs = empresas.reduce((acc, e) => acc + e.ocs_pendientes, 0);
  const totalF29Vencidas = empresas.reduce((acc, e) => acc + e.f29_vencidas, 0);
  const headerTitle = "Composición del Portafolio";

  return (
    <Document title="Cehta Capital — Composición del Portafolio">
      <Page size="A4" style={pdfStyles.page}>
        <PdfCover
          title="Composición del Portafolio"
          subtitle="Vista por compañía con KPIs operativos"
          meta={[
            { label: "Compañías", value: String(empresas.length) },
            { label: "AUM total", value: fmtCLP(totalAum) },
            { label: "OCs pendientes", value: fmtInt(totalOcs) },
            { label: "F29 vencidas", value: fmtInt(totalF29Vencidas) },
          ]}
          generatedAt={generatedAt}
        />
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      {/* Empresas — paginan automáticamente, 2 por página vía wrap=false en cada card */}
      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />
        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Empresas del portafolio</Text>
          <Text style={pdfStyles.sectionSubtitle}>
            KPIs operativos por compañía · datos consolidados al cierre del último ETL.
          </Text>
          {empresas.length === 0 ? (
            <View style={pdfStyles.emptyBox}>
              <Text style={pdfStyles.emptyText}>Sin compañías en el catálogo.</Text>
            </View>
          ) : (
            empresas.map((e) => <EmpresaCard key={e.codigo} e={e} />)
          )}
        </View>
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>

      {/* Ranking */}
      <Page size="A4" style={pdfStyles.page}>
        <PdfPageHeader title={headerTitle} />
        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>Ranking de proyectos</Text>
          <Text style={pdfStyles.sectionSubtitle}>Top {ranking.length} por gasto consolidado</Text>
          <PdfTable<ProyectoRanking>
            columns={RANKING_COLS}
            rows={ranking}
            cellRender={(row, col) => {
              switch (col.key) {
                case "rank":
                  return String(ranking.indexOf(row) + 1);
                case "proyecto":
                  return row.proyecto;
                case "total_egreso":
                  return fmtCLP(row.total_egreso);
                case "num_movimientos":
                  return fmtInt(row.num_movimientos);
                case "empresas":
                  return row.empresas.join(", ");
                default:
                  return "";
              }
            }}
            emptyText="Sin datos de ranking."
          />
        </View>
        <PdfPageFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

export async function renderPortafolioPdf(props: Props): Promise<Blob> {
  registerPdfFonts();
  return pdf(<PortafolioDocument {...props} />).toBlob();
}

export default PortafolioDocument;
