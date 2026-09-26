/**
 * Streams a HubSpot export CSV into row objects keyed by header name
 * (design D2). Uses the `csv-parse` stream API over
 * `fs.createReadStream(path, "utf8")` rather than `csv-parse/sync`, so each
 * ~180 KB cell (e.g. `Associated Email`) is projected and discarded instead
 * of held for the whole file.
 *
 * PII rule (D8): a parser error is rethrown as a sanitized
 * `Error("CSV parse failed at line N (code)")`. `CsvError` carries
 * `.record`/`.raw` — this function never lets those reach a caller, since
 * Node's default error path would print raw row contents.
 *
 * `columns: true` keeps only the LAST occurrence of a duplicated header name
 * (the real export has duplicates, e.g. "Función laboral" x2, "Billing
 * Contact IDs" x3) — every earlier column sharing that name is silently
 * dropped from each row object. When `requiredHeaders` is passed, this
 * guards against that for headers this import actually depends on: it
 * inspects the raw header row (via `csv-parse`'s `columns` callback form,
 * which runs once with the header line before dedup) and throws a sanitized
 * `SanitizedHubSpotError` (header names only, never row data) if any
 * `requiredHeaders` name repeats.
 */
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { assertNoDuplicateRequiredHeaders, SanitizedHubSpotError } from "./columns";

export async function parseHubSpotCsv(
  path: string,
  requiredHeaders?: readonly string[],
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path, "utf8").pipe(
    parse({
      bom: true,
      columns: requiredHeaders
        ? (header: string[]) => {
            assertNoDuplicateRequiredHeaders(header, requiredHeaders);
            return header;
          }
        : true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 2_000_000,
    }),
  );

  try {
    for await (const record of parser) {
      rows.push(record as Record<string, string>);
    }
  } catch (err) {
    if (err instanceof SanitizedHubSpotError) throw err;
    const line = typeof (err as { lines?: number }).lines === "number" ? (err as { lines: number }).lines : 0;
    const code = typeof (err as { code?: string }).code === "string" ? (err as { code: string }).code : "unknown";
    throw new Error(`CSV parse failed at line ${line} (${code})`);
  }

  return rows;
}
