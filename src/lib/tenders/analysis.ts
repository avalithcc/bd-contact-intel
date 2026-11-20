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

/** The money side of the pliego. Each is null when the document does not state it, like the requirements. */
export interface TenderEconomics {
  /** Official budget or estimated contract amount, with the currency and the clause. */
  budget: string | null;
  /** The bare figure with its currency as the document writes it ("ARS 48.000.000"), for a table cell. Null when the document fixes no amount. */
  budgetAmount: string | null;
  /** How and when the supplier is paid, with the clause. */
  paymentTerms: string | null;
  /** Fines and penalties (SLA breaches, caps as a share of the contract), with the clause. */
  penalties: string | null;
}

export interface TenderAnalysis {
  summary: string;
  viability: string;
  requirements: TenderRequirements;
  economics: TenderEconomics;
  /** Pages the model read, when it says so. */
  pages: number | null;
  /**
   * False for a reading stored before the four inadmissibility requirements were asked for: its missing keys mean "never
   * asked", NOT "the pliego does not state it", so the must-list must not be built from it.
   */
  mustListIncluded: boolean;
  /** False for a reading stored before the economics block was asked for: its null keys mean "never asked". */
  economicsIncluded: boolean;
}

const BASE_REQUIREMENT_KEYS = ["registration", "antecedents", "guarantee", "submissionDeadline"] as const;
const MUST_LIST_KEYS = ["certifications", "financialStanding", "team", "affidavits"] as const;
const REQUIREMENT_KEYS = [...BASE_REQUIREMENT_KEYS, ...MUST_LIST_KEYS] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];
const ECONOMICS_KEYS = ["budget", "budgetAmount", "paymentTerms", "penalties"] as const;
export type EconomicsKey = (typeof ECONOMICS_KEYS)[number];

/** The blocks of the analysis whose keys must each be answered (null counts as an answer, absence does not). */
const BLOCKS = { requirements: REQUIREMENT_KEYS, economics: ECONOMICS_KEYS } as const;
export type AnalysisBlock = keyof typeof BLOCKS;
export interface MissingKey {
  block: AnalysisBlock;
  key: RequirementKey | EconomicsKey;
}

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
  const req = blockOf(v, "requirements");
  const requirements = Object.fromEntries(REQUIREMENT_KEYS.map((k) => [k, text(req[k], 1500)])) as unknown as TenderRequirements;
  const econ = blockOf(v, "economics");
  const economics = Object.fromEntries(ECONOMICS_KEYS.map((k) => [k, text(econ[k], k === "budgetAmount" ? 40 : 1500)])) as unknown as TenderEconomics;
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
  // Same rule as above and for the same reason: only ever lowered, never recomputed upward from filled keys.
  const economicsClaimed = typeof v.economicsIncluded === "boolean" ? v.economicsIncluded : true;
  const economicsIncluded = economicsClaimed && ECONOMICS_KEYS.every((k) => k in econ);
  return { summary, viability, requirements, economics, pages, mustListIncluded, economicsIncluded };
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

function blockOf(value: unknown, block: AnalysisBlock): Record<string, unknown> {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return (typeof v[block] === "object" && v[block] !== null ? v[block] : {}) as Record<string, unknown>;
}

/**
 * The keys, in every block, that the model did not answer AT ALL.
 *
 * An absent key and a key whose value is null are not the same thing and must never be conflated: null is an answer
 * ("I looked and the pliego does not state it"), an absent key is a question that was dropped. `toTenderAnalysis` fills
 * every key, so once it has run the difference is gone - this reads the model's own object, before that happens.
 */
export function missingKeys(value: unknown): readonly MissingKey[] {
  return (Object.keys(BLOCKS) as AnalysisBlock[]).flatMap((block) => {
    const answered = blockOf(value, block);
    return BLOCKS[block].filter((k) => !(k in answered)).map((key) => ({ block, key }));
  });
}

/**
 * Folds a follow-up answer into the first one. A key that was already answered is NEVER overwritten, so re-asking cannot
 * degrade a good reading, and the patch is accepted both bare (`{"team": ...}`) and wrapped (`{"requirements": {...}}`,
 * `{"economics": {...}}`), because the model is told to reply bare and sometimes wraps it anyway. Key names are unique
 * across blocks, so a bare patch is unambiguous.
 */
export function mergeAnalysisPatch(analysisObject: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const flat = { ...patch, ...blockOf(patch, "requirements"), ...blockOf(patch, "economics") };
  const result: Record<string, unknown> = { ...analysisObject };
  for (const block of Object.keys(BLOCKS) as AnalysisBlock[]) {
    const merged = { ...blockOf(analysisObject, block) };
    for (const k of BLOCKS[block]) if (!(k in merged) && k in flat) merged[k] = flat[k];
    result[block] = merged;
  }
  return result;
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
  '"economics": an object with "budget" (the official budget or estimated contract amount, with the currency and the clause),',
  '"budgetAmount" (ONLY the bare figure with its currency, exactly as the document writes it, e.g. "ARS 48.000.000" or "USD 120.000", at most 30 characters and nothing else: no clause, no explanation; null when the document fixes no amount, which is common because many pliegos leave the price blank for the bidder to fill in, while "budget" still carries that explanation),',
  '"paymentTerms" (how and when the supplier is paid, e.g. days after the invoice is approved) and',
  '"penalties" (fines and penalties, e.g. SLA breaches and any cap as a percentage of the contract). Quote or closely paraphrase the document, with the clause when it gives one, and use null for any it does not state.',
  "Every one of those four economics keys must be present too, with the same rule: leaving one out is not the same as null.",
  '"pages": the number of pages of the document, as an integer, or null.',
].join("\n");

/**
 * The re-ask when the model answered some keys and dropped others, in any block.
 *
 * Only the dropped keys are asked for again, never the whole object: the answers it did give are not regenerated (so a good
 * reading cannot be degraded by a second pass) and the follow-up stays short, which keeps it clear of the output cap that
 * a full re-answer of eleven quoted clauses would be fighting.
 */
export function analysisFollowUpPrompt(missing: readonly MissingKey[]): string {
  const one = missing.length === 1;
  const blocks = (Object.keys(BLOCKS) as AnalysisBlock[]).filter((b) => missing.some((m) => m.block === b));
  const where = blocks.map((b) => `"${b}"`).join(" and ");
  return [
    `Your answer left out ${one ? "this key" : "these keys"} of ${where}: ${missing.map((m) => `"${m.key}"`).join(", ")}.`,
    "Read the document again for each one, including the technical specifications and the annexes.",
    `Reply with one JSON object and nothing else, holding exactly ${one ? "that key" : "those keys"} at the top level.`,
    "Quote or closely paraphrase what the document says, with the clause when it gives one, in neutral Spanish.",
    "Use null only when you have looked and the document truly does not state it.",
    'If "budgetAmount" is among them, it is ONLY the bare figure with its currency as the document writes it (e.g. "ARS 48.000.000"), at most 30 characters, and null when the document fixes no amount; "budget" keeps the explanation.',
  ].join("\n");
}
