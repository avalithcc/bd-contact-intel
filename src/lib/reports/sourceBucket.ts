/**
 * "Conversión por origen" (owner-reporting decision 8): `person.sourceKey`
 * carries 5 real values, not the 3 the backlog names. Bucketing happens
 * HERE, in application code, since bucketing has no existing DB column
 * (README "What building it would touch"). The SQL side (queries.ts) only
 * does `GROUP BY source_key, status` — a real column pair — and hands the
 * raw combinations to `buildSourceConversionRows` below.
 */

export type SourceBucket = "hubspot" | "linkedin" | "manual" | "other";

const SOURCE_BUCKET_ORDER: readonly SourceBucket[] = ["hubspot", "linkedin", "manual", "other"];

export function bucketSourceKey(sourceKey: string | null): SourceBucket {
  if (sourceKey === "hubspot_import") return "hubspot";
  if (sourceKey === "csv" || sourceKey === "linkedin_import") return "linkedin";
  if (sourceKey === "manual_create") return "manual";
  return "other";
}

export interface SourceStatusCount {
  sourceKey: string | null;
  status: string;
  count: number;
}

export interface SourceConversionRow {
  bucket: SourceBucket;
  /** Every person in this bucket (cumulative — same convention as the funnel card). */
  newCount: number;
  /** Reached `contacted` or further. */
  contactedCount: number;
  /** Reached `replied` or further. */
  repliedCount: number;
  meetingCount: number;
}

const CONTACTED_OR_FURTHER = new Set(["contacted", "replied", "meeting"]);
const REPLIED_OR_FURTHER = new Set(["replied", "meeting"]);

export function buildSourceConversionRows(rows: readonly SourceStatusCount[]): SourceConversionRow[] {
  const byBucket = new Map<SourceBucket, SourceConversionRow>(
    SOURCE_BUCKET_ORDER.map((bucket) => [bucket, { bucket, newCount: 0, contactedCount: 0, repliedCount: 0, meetingCount: 0 }]),
  );

  for (const row of rows) {
    const agg = byBucket.get(bucketSourceKey(row.sourceKey))!;
    if (row.status === "discarded") continue; // not a funnel stage (matches funnel.ts's own rule).
    agg.newCount += row.count;
    if (CONTACTED_OR_FURTHER.has(row.status)) agg.contactedCount += row.count;
    if (REPLIED_OR_FURTHER.has(row.status)) agg.repliedCount += row.count;
    if (row.status === "meeting") agg.meetingCount += row.count;
  }

  return SOURCE_BUCKET_ORDER.map((bucket) => byBucket.get(bucket)!);
}
