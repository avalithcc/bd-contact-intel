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
  /** Quality or security certifications the bidder must hold (ISO, CMMI and the like). */
  certifications: string | null;
  /** Balance sheets, turnover or other financial standing the bidder must prove. */
  financialStanding: string | null;
  /** The proposed team: CVs, degrees, credentials. */
  team: string | null;
  /** Sworn statements and annexes the pliego demands to be presented verbatim. */
  affidavits: string | null;
}

export interface TenderAnalysis {
  summary: string;
  viability: string;
  requirements: TenderRequirements;
  /** Pages the model read, when it says so. */
  pages: number | null;
  /**
   * False for a reading stored before the four inadmissibility requirements were asked for: its missing keys mean "never
   * asked", NOT "the pliego does not state it", so the must-list must not be built from it.
   */
  mustListIncluded: boolean;
}

const BASE_REQUIREMENT_KEYS = ["registration", "antecedents", "guarantee", "submissionDeadline"] as const;
const MUST_LIST_KEYS = ["certifications", "financialStanding", "team", "affidavits"] as const;
const REQUIREMENT_KEYS = [...BASE_REQUIREMENT_KEYS, ...MUST_LIST_KEYS] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];

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
  /**
   * The flag can only ever be LOWERED here, never raised, because this function runs TWICE on the same reading: once on
   * the model's answer, and again on what was stored - and what is stored is this function's own output, where the
   * requirement keys have all been filled in. Deriving it from key presence alone therefore resurrected a `false` as
   * `true` on every read, which put "el pliego no lo indica" on four requirements the model was never asked to confirm.
   * A stored `false` now survives the round trip, and a model that volunteers `true` still has to have answered the keys.
   */
  const claimed = typeof v.mustListIncluded === "boolean" ? v.mustListIncluded : true;
  const mustListIncluded = claimed && MUST_LIST_KEYS.every((k) => k in req);
  return { summary, viability, requirements, pages, mustListIncluded };
}

/** The model is asked for bare JSON; it may still wrap it in a code fence or add a line around it. */
export function jsonObjectIn(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseTenderAnalysis(raw: string): TenderAnalysis | null {
  return toTenderAnalysis(jsonObjectIn(raw));
}

const requirementsOf = (value: unknown): Record<string, unknown> => {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return (typeof v.requirements === "object" && v.requirements !== null ? v.requirements : {}) as Record<string, unknown>;
};

/**
 * The requirement keys the model did not answer AT ALL.
 *
 * An absent key and a key whose value is null are not the same thing and must never be conflated: null is an answer
 * ("I looked and the pliego does not state it"), an absent key is a question that was dropped. `toTenderAnalysis` fills
 * every key, so once it has run the difference is gone - this reads the model's own object, before that happens.
 */
export function missingRequirementKeys(value: unknown): readonly RequirementKey[] {
  const req = requirementsOf(value);
  return REQUIREMENT_KEYS.filter((k) => !(k in req));
}

/**
 * Folds a follow-up answer into the first one. A key that was already answered is NEVER overwritten, so re-asking cannot
 * degrade a good reading, and the patch is accepted both bare (`{"team": ...}`) and wrapped (`{"requirements": {...}}`),
 * because the model is told to reply bare and sometimes wraps it anyway.
 */
export function mergeRequirementPatch(analysisObject: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const nested = requirementsOf(patch);
  const flat = { ...patch, ...nested };
  const merged = { ...requirementsOf(analysisObject) };
  for (const k of REQUIREMENT_KEYS) if (!(k in merged) && k in flat) merged[k] = flat[k];
  return { ...analysisObject, requirements: merged };
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
  '"guarantee" (bid or maintenance guarantee) and "submissionDeadline" (date and time to submit, and where),',
  'plus the requirements whose absence makes a bid inadmissible: "certifications" (quality or security certifications such as ISO or CMMI),',
  '"financialStanding" (balance sheets, turnover, cost structure or other economic standing the bidder must prove),',
  '"team" (the people the bidder must provide: roles, profiles, seniority, required technologies, CVs, degrees or credentials) and',
  '"affidavits" (sworn statements, annexes and forms the document demands to be presented). Quote or closely paraphrase what the document says, with the clause when it gives one.',
  "Use null for any the document does not state.",
  "Every one of those eight keys must be present in the object. Leaving a key out is a question you did not answer, which is not the same as null, so never leave one out.",
  "A requirement can be stated anywhere in the document, including the technical specifications and the annexes, not only among the administrative conditions. Look there too before writing null.",
  'Anything you name in "viability" as something the bidder must have, hold or prove must also appear under the matching "requirements" key.',
  '"pages": the number of pages of the document, as an integer, or null.',
].join("\n");

/**
 * The re-ask when the model answered some requirement keys and dropped others.
 *
 * Only the dropped keys are asked for again, never the whole object: the answers it did give are not regenerated (so a good
 * reading cannot be degraded by a second pass) and the follow-up stays short, which keeps it clear of the output cap that
 * a full re-answer of eight quoted clauses would be fighting.
 */
export function requirementFollowUpPrompt(missing: readonly RequirementKey[]): string {
  const one = missing.length === 1;
  return [
    `Your answer left out ${one ? "this key" : "these keys"} of "requirements": ${missing.map((k) => `"${k}"`).join(", ")}.`,
    "Read the document again for each one, including the technical specifications and the annexes.",
    `Reply with one JSON object and nothing else, holding exactly ${one ? "that key" : "those keys"} at the top level.`,
    "Quote or closely paraphrase what the document says, with the clause when it gives one, in neutral Spanish.",
    "Use null only when you have looked and the document truly does not state it.",
  ].join("\n");
}
