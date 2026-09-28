/**
 * Pure duck-typing guard + safe accessors for `/admin/migration`'s rendering
 * of a persisted `hubspot_import` report (design D7).
 *
 * Follow-up fix (prod run c9de8587): `finalizeHubSpotExecute` used to
 * persist the planner's raw report (missing `reviewSample`/
 * `reviewThreshold`/`overThreshold`/`createdCompanyKeys`/
 * `domainFilledCompanyKeys` — see importQueries.ts/hubspotRun.ts for the
 * write-side fix), so the page's OLD guard (which required `reviewSample`
 * AND `reviewThreshold`) rejected every already-executed run and rendered
 * nothing. This guard recognizes a hubspot_import report by its ALWAYS-
 * PRESENT base fields (present regardless of dry run, fixed execute, or an
 * already-persisted older partial-shape row) so an executed run's report
 * still renders — falling back to whatever counts exist.
 */
import type { HubSpotImportReport } from "@/lib/hubspot/planner";
import type { HubSpotReviewSampleEntry, HubSpotRunReport } from "@/lib/hubspot/report";

export function isHubSpotReport(report: unknown): report is HubSpotRunReport {
  if (!report || typeof report !== "object") return false;
  const r = report as Record<string, unknown>;
  return "outcomes" in r && "companies" in r && "owners" in r && "backfills" in r;
}

/** `reviewSample` is only present on the full report shape — falls back to
 * an empty list for an older, partial-shape persisted report. Accepts the
 * base `HubSpotImportReport` shape (not just `HubSpotRunReport`) so callers
 * can pass an as-persisted, possibly-partial report without a cast. */
export function hubspotReviewSample(report: HubSpotImportReport): readonly HubSpotReviewSampleEntry[] {
  const sample = (report as Partial<HubSpotRunReport>).reviewSample;
  return Array.isArray(sample) ? sample : [];
}

/** `overThreshold` is only present on the full report shape — falls back to
 * `false` for an older, partial-shape persisted report (never shows the
 * confirm-over-threshold checkbox for a report that can't say either way). */
export function hubspotOverThreshold(report: HubSpotImportReport): boolean {
  return (report as Partial<HubSpotRunReport>).overThreshold === true;
}
