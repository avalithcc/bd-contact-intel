import type { Tender } from "@/db/schema";
import type { TenderAnalysis } from "./analysis";
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

export type TenderEventKind = "triage" | "note" | "document" | "analysis" | "relevance" | "owner";

export interface TenderEventView {
  id: string;
  kind: TenderEventKind;
  detail: { from?: string; to?: string; text?: string; filename?: string };
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
  /** Every BD, by name, for the owner picker. */
  bdOptions: BdOption[];
  /** Newest first. */
  documents: TenderDocumentView[];
  /** Newest first, bounded. */
  events: TenderEventView[];
}
