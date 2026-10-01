/** Synthetic fixtures for the hotel-sheet importer tests (no real people). */
export const HEADERS = [
  "First name", "Last name", "Company name", "Website", "Industry", "Number of employees", "LinkedIn profile URL",
  "Company LinkedIn URL", "Contact country", "Country", "Job title", "Campaigns", "Professional email",
  "Phone number", "TYPE OF CONTACT", "Mobile phone",
] as const;

type Header = (typeof HEADERS)[number];

const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Serializes synthetic rows under the sheet's real header, CRLF like the export. */
export function sheetCsv(rows: Partial<Record<Header, string>>[], headers: readonly string[] = HEADERS): string {
  const lines = [headers.map(q).join(",")];
  for (const r of rows) lines.push(headers.map((h) => q((r as Record<string, string>)[h] ?? "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

export const BASE: Partial<Record<Header, string>> = {
  "First name": "Ana", "Last name": "Prueba", "Company name": "Hotel Uno", Country: "Spain", "Job title": "Sales Director",
  "TYPE OF CONTACT": "BUYER-CHAMPION", "Mobile phone": "+34 616 01 64 75", "LinkedIn profile URL": "https://www.linkedin.com/in/ana-prueba-1",
  "Professional email": "ana@hotel-uno.example",
};
