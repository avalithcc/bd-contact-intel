import * as XLSX from "xlsx";

/**
 * The only module that knows the spreadsheet library. Reads the first sheet of an .xls/.xlsx buffer into a matrix of
 * strings (formatted text, as the portal shows it), header row first.
 */
export function readSheetRows(file: Buffer | ArrayBuffer): string[][] {
  const wb = XLSX.read(file, { type: file instanceof ArrayBuffer ? "array" : "buffer" });
  const first = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<string[]>(first, { header: 1, defval: "", raw: false });
}
