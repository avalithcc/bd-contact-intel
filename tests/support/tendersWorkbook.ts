/**
 * Builds a real binary .xls (BIFF8, the format COMPR.AR exports) in memory, with the portal's exact header row. Synthetic
 * data only: the tests never depend on a downloaded file.
 */
import * as XLSX from "xlsx";

export const PORTAL_HEADER = [
  "Número de Proceso",
  "Expediente",
  "Nombre proceso",
  "Tipo proceso",
  "Fecha de apertura",
  "Estado",
  "Unidad Ejecutora",
  "Servicio Administrativo Financiero",
];

export type PortalRow = [string, string, string, string, string, string, string, string];

export function portalRow(over: Partial<Record<number, string>> = {}): PortalRow {
  const base: PortalRow = [
    "487-0018-LPR26",
    "EX-2026-00000001-   -APN-GAYF#XX",
    "Servicio de desarrollo de software a medida",
    "Licitación Privada",
    "09/12/2026 10:00 Hrs.",
    "Publicado",
    "487 - Compras",
    "105 - Organismo de Prueba",
  ];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v!;
  return base;
}

export function buildXls(rows: PortalRow[], header: string[] = PORTAL_HEADER): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
}
