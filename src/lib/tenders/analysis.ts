/**
 * The AI reading of a tender's pliego, as data. Pure: no I/O, no model call (that is analyse.ts), so the parsing and the
 * "which analysis counts" rules are tested without a gateway.
 */
export interface TenderRequirements {
  /** Each is null when the document does not state it: absence is reported, never filled in. */
  registration: string | null;
  antecedents: string | null;
  guarantee: string | null;
  submissionDeadline: string | null;
}

export interface TenderAnalysis {
  summary: string;
  viability: string;
  requirements: TenderRequirements;
  /** Pages the model read, when it says so. */
  pages: number | null;
}

const REQUIREMENT_KEYS = ["registration", "antecedents", "guarantee", "submissionDeadline"] as const;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/** Validates a stored or model-produced object; null when the summary or the viability is missing (nothing to show). */
export function toTenderAnalysis(value: unknown): TenderAnalysis | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const summary = text(v.summary, 4000);
  const viability = text(v.viability, 4000);
  if (!summary || !viability) return null;
  const req = (typeof v.requirements === "object" && v.requirements !== null ? v.requirements : {}) as Record<string, unknown>;
  const requirements = Object.fromEntries(REQUIREMENT_KEYS.map((k) => [k, text(req[k], 1500)])) as unknown as TenderRequirements;
  const pages = typeof v.pages === "number" && Number.isInteger(v.pages) && v.pages > 0 ? v.pages : null;
  return { summary, viability, requirements, pages };
}

/** The model is asked for bare JSON; it may still wrap it in a code fence or add a line around it. */
export function parseTenderAnalysis(raw: string): TenderAnalysis | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return toTenderAnalysis(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export interface DocumentLike {
  id: string;
  createdAt: Date;
}

/** The newest upload is THE document. Older ones are history and their analyses never count as current. */
export function currentDocument<T extends DocumentLike>(documents: readonly T[]): T | null {
  return documents.reduce<T | null>((best, d) => (best === null || d.createdAt.getTime() > best.createdAt.getTime() ? d : best), null);
}

/** Analysis needs a document to read: with none, the control is off rather than answering from the title. */
export function canAnalyse(document: DocumentLike | null): boolean {
  return document !== null;
}

export const ANALYSIS_SYSTEM_PROMPT = [
  "You read a public tender document (a pliego) for Avalith, a software and cloud services company in Argentina.",
  "Answer ONLY from the attached document. If the document does not say something, say it does not; never infer a requirement.",
  "Reply with one JSON object and nothing else, with these keys, all values in neutral Spanish:",
  '"summary": what is being bought, scope, duration and any option to extend, in 3 to 5 sentences.',
  '"viability": technical fit for a software, cloud and infrastructure services company, and the points to verify before bidding.',
  '"requirements": an object with "registration" (supplier registry enrollment), "antecedents" (similar past projects required),',
  '"guarantee" (bid or maintenance guarantee) and "submissionDeadline" (date and time to submit, and where). Use null for any the document does not state.',
  '"pages": the number of pages of the document, as an integer, or null.',
].join("\n");
