/**
 * Parses LinkedIn's `Connected On` export text (e.g. `"12 Mar 2021"`) into a
 * Date, for the collapse migration's owner-selection rule (design.md
 * "Migration plan": "the owner is the BD with the earliest `connected_on`
 * ... unparseable dates sort last"). Returns null for missing or
 * unrecognized text — callers treat that as "sorts last", not an error,
 * since the source CSV's date column is free text (contact-migration spec).
 */
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const CONNECTED_ON_PATTERN = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/;

export function parseConnectedOnDate(raw: string | null | undefined): Date | null {
  const text = raw?.trim();
  if (!text) return null;

  const match = CONNECTED_ON_PATTERN.exec(text);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (month === undefined || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month, day));
  // UTC month/date roll over for impossible combinations (e.g. "31 Feb");
  // reject those instead of silently returning the rolled-over date.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;

  return date;
}
