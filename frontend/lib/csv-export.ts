/**
 * Export CSV browser-side — sin librerías.
 *
 * Genera un Blob con BOM UTF-8 (Excel chileno lo necesita para que
 * acentos y ñ se vean bien) + delimitador `;` (Excel ES) y dispara
 * descarga directa.
 *
 * Limitación: para data >50MB usar streaming (fuera de scope).
 *
 * Uso:
 *   exportCsv({
 *     filename: "vouchers_2026-04.csv",
 *     headers: ["Código", "Empresa", "Total"],
 *     rows: vouchers.map(v => [v.codigo, v.empresa_codigo, v.total]),
 *   });
 */

interface ExportOpts {
  filename: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

/** Escape CSV: si la celda contiene `;`, `"`, `\n` o `\r` la rodeamos en
 *  comillas y duplicamos las comillas internas (RFC 4180). */
function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (
    s.includes(";") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r")
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCsv({ filename, headers, rows }: ExportOpts): void {
  const lines: string[] = [headers.map(escapeCell).join(";")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(";"));
  }
  // BOM UTF-8 (﻿) → Excel chileno detecta encoding correcto
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Cleanup async para que el browser termine de iniciar la descarga
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Helper para construir filename con timestamp ISO sin colons (no válido en Windows). */
export function csvFilename(prefix: string): string {
  const ts = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "")
    .replace("T", "_");
  return `${prefix}_${ts}.csv`;
}
