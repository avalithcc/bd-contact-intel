import type { Tender, TenderPortal } from "@/db/schema";
import type { TenderAnalysis } from "./analysis";
import type { RequirementStatuses } from "./requirementStatus";
import type { TenderTiming } from "./timing";

/** What the ficha reads. Plain data (no `@/db` value import) so the view and its tests stay client-safe. */
export interface TenderDocumentView {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy: string | null;
  /** The reading OF THIS document; null until someone analyses it. A newer upload never inherits it. */
  analysis: TenderAnalysis | null;
  analyzedAt: Date | null;
  analyzedBy: string | null;
}

export type TenderEventKind = "triage" | "note" | "document" | "analysis" | "relevance" | "owner" | "requirement";

export interface TenderEventView {
  id: string;
  kind: TenderEventKind;
  detail: { from?: string; to?: string; text?: string; filename?: string; key?: string };
  createdAt: Date;
  actor: string | null;
}

/** A BD a tender can be assigned to. */
export interface BdOption {
  id: string;
  name: string;
}

export interface TenderDetail {
  tender: Tender & TenderTiming;
  /** What the portal's public view says. NULL = never fetched (the ficha shows nothing); a null FIELD = fetched, the portal does not state it. */
  portal: TenderPortal | null;
  /** Every admin, by name, for the owner picker: only an admin can open the section, so only an admin can own a tender. */
  bdOptions: BdOption[];
  /** The answers given so far, by requirement key; a key that is absent is pending. Independent of the reading: a re-analysis does not touch it. */
  requirementStatuses: RequirementStatuses;
  /** Newest first. */
  documents: TenderDocumentView[];
  /** Newest first, bounded. */
  events: TenderEventView[];
}
