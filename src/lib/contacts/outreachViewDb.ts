/**
 * DB read side of the `/contacts` "Outreach" system view — split from the
 * pure mapping in src/lib/contacts/outreachView.ts (which has no `@/db`
 * import) the same way src/lib/outreach/queries.ts is split from
 * src/lib/outreach/ranking.ts. Reuses listOutreachCandidates unmodified:
 * same fixed-query read (one lane at a time, see lanes.ts), same ranking, same candidate set — only the
 * reason-chip mapping is added on top, no extra query.
 */
import { listOutreachCandidates, type OutreachListOptions } from "@/lib/outreach/queries";
import type { OutreachFilters } from "@/lib/outreach/ranking";
import { attachOutreachReasons, type OutreachContactRow } from "@/lib/contacts/outreachView";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { OutreachLaneSummary } from "@/lib/outreach/lanes";

export interface OutreachContactsPage {
  rows: OutreachContactRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hiringCompanyCount: number;
  laneSummary: OutreachLaneSummary;
}

export async function getOutreachContactsPage(
  bdId: string,
  filters: OutreachFilters,
  page: number,
  pageSize: number,
  relativeTime: (d: Date) => string,
  dict: Dictionary,
  options: OutreachListOptions = {},
): Promise<OutreachContactsPage> {
  const result = await listOutreachCandidates(bdId, filters, page, pageSize, options);
  return { ...result, rows: attachOutreachReasons(result.rows, relativeTime, dict) };
}
