import { parse } from "csv-parse/sync";

export interface ParsedConnection {
  profileKey: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  email: string | null;
  connectedOn: string | null;
}

/**
 * Normalize a LinkedIn profile URL into a stable identity key.
 * Lowercases the host/path, drops the protocol, query string, and any
 * trailing slash, so the same person always maps to the same key across
 * BDs and re-uploads.
 */
export function normalizeProfileKey(rawUrl: string): string | null {
  const url = rawUrl?.trim();
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path || path === "/") return null;
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Parse a LinkedIn `Connections.csv` export.
 *
 * The export prepends a "Notes:" preamble (a few lines plus a blank line)
 * before the real header row, so we locate the header line that starts with
 * "First Name" and parse from there. Rows without a usable profile URL are
 * skipped (they cannot participate in dedup or overlap).
 */
export function parseConnectionsCsv(raw: string): ParsedConnection[] {
  const text = raw.replace(/^﻿/, ""); // strip BOM
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith("First Name,"));
  const body = headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : text;

  const records = parse(body, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const out: ParsedConnection[] = [];
  for (const r of records) {
    const profileKey = normalizeProfileKey(r["URL"] ?? "");
    if (!profileKey) continue;
    out.push({
      profileKey,
      firstName: blankToNull(r["First Name"]),
      lastName: blankToNull(r["Last Name"]),
      company: blankToNull(r["Company"]),
      position: blankToNull(r["Position"]),
      email: blankToNull(r["Email Address"]),
      connectedOn: blankToNull(r["Connected On"]),
    });
  }
  return out;
}
