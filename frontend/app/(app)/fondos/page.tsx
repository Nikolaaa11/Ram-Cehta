import {
  Search,
  Building2,
  Landmark,
  Banknote,
  Sparkles,
  Bookmark,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "Búsqueda de Fondos · Cehta Capital",
};

export default function FondosPage() {
  return (
    <SectionLanding
      title="Búsqueda de Fondos"
      subtitle="Base curada de inversionistas, bancos y programas alineados con la thesis del FIP CEHTA ESG. Pipeline de outreach + AI matchmaker."
      Icon={Search}
      phase={3}
      phaseTitle="Pipeline de capital, sin spreadsheets sueltos"
      phaseDescription="LPs, bancos, programas estatales y family offices con filtros por thesis, ticket size y geografía. Estado de outreach trazable."
      features={[
        {
          title: "LPs Database",
          description: "Inversionistas por geografía y ticket size",
          Icon: Building2,
        },
        {
          title: "Programas Estatales",
          description: "CORFO, ANID y otros públicos",
          Icon: Landmark,
        },
        {
          title: "Bancos Aliados",
          description: "Programas de financiamiento bancario",
          Icon: Banknote,
        },
        {
          title: "AI Matchmaker",
          description: "Sugerencias por empresa del portfolio",
          Icon: Sparkles,
        },
        {
          title: "Watchlist",
          description: "Alertas cuando un fondo abre nueva ronda",
          Icon: Bookmark,
        },
      ]}
    />
  );
}
