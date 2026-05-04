import { redirect } from "next/navigation";

export const metadata = {
  title: "Avance · Cehta Capital",
};

/**
 * Avance — alias hacia `/cartas-gantt`.
 *
 * La feature real (kanban + timeline + calendario + por empresa) vive en
 * `/cartas-gantt`. Mantenemos esta ruta como atajo desde el sidebar/menú.
 */
export default function AvancePage() {
  redirect("/cartas-gantt");
}
