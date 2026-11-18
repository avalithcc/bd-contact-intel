import { generateText } from "ai";
import { tenderKey, type TenderInput } from "./parse";

/** Same model as the pliego analysis (analyse.ts) and the outreach generator. */
const CLASSIFY_MODEL = "anthropic/claude-sonnet-5";
/** The cap counts reasoning tokens too; ~25 tokens per answered row, with room for the thinking. */
const MAX_OUTPUT_TOKENS = 12000;
/** One call per file; a file with more rows than this classifies the first ones and leaves the rest unclassified (shown). */
export const CLASSIFY_CAP = 200;
const REASON_MAX = 120;

export interface TenderVerdict {
  relevant: boolean;
  reason: string;
}

/** Verdicts keyed by `tenderKey(processNumber)`, the same builder the planner reads them through. */
export type TenderVerdicts = Map<string, TenderVerdict>;

/** What the selection needs to know about a stored row; the planner's StoredTender satisfies it. */
export interface StoredRelevance {
  name: string;
  aiRelevant: boolean | null;
  relevanceOverride: boolean | null;
}

/**
 * Pure: the rows worth a model call. New ones, ones whose title changed, and ones that never got a verdict (a failed earlier
 * import retries here). A row a human decided is never sent: the model cannot change that outcome. Capped; mutates nothing.
 */
export function tendersToClassify(incoming: readonly TenderInput[], existing: ReadonlyMap<string, StoredRelevance>): TenderInput[] {
  const out: TenderInput[] = [];
  for (const t of incoming) {
    const current = existing.get(tenderKey(t.processNumber));
    if (current && current.relevanceOverride !== null) continue;
    if (!current || current.name !== t.name || current.aiRelevant === null) out.push(t);
    if (out.length >= CLASSIFY_CAP) break;
  }
  return out;
}

/**
 * The prompt Cristian verified on the 79 live rows, verbatim, plus the answer format. The "when in doubt say SI" bias was
 * considered and left out: it was not measured, and the human override already covers a wrong NO.
 */
export const CLASSIFY_SYSTEM_PROMPT = `Clasificás licitaciones públicas argentinas para Avalith, una empresa de INGENIERÍA DE SOFTWARE (desarrollo de sistemas y aplicaciones, plataformas web, nube, ciberseguridad, soporte y mantenimiento de software). Para cada ítem respondé SI solo si Avalith podría prestar ese servicio. Respondé NO a compra de equipamiento, licencias de producto de terceros sin desarrollo, obras, limpieza, seguridad física, telefonía, CCTV, drenajes, impresiones, UAV y todo lo ajeno al software.

Respondé SOLO con un arreglo JSON, sin texto alrededor, con un objeto por ítem: {"n": <número del ítem>, "relevant": true|false, "reason": "<motivo de hasta seis palabras>"}.`;

const clean = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null;
  const t = reason.trim();
  return t === "" ? null : t.slice(0, REASON_MAX);
};

/** Pure: item number (1-based) to verdict. A row with a wrong type, an out-of-range number or no reason is dropped, never guessed. */
export function parseVerdicts(text: string, count: number): Map<number, TenderVerdict> {
  const out = new Map<number, TenderVerdict>();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue;
    const { n, relevant, reason } = row as Record<string, unknown>;
    const why = clean(reason);
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > count) continue;
    if (typeof relevant !== "boolean" || !why) continue;
    out.set(n, { relevant, reason: why });
  }
  return out;
}

/**
 * One model call for the whole list. NEVER throws and never fails an import: any failure (gateway down, cut-off answer,
 * unreadable output) returns no verdicts, and a tender without a verdict is shown, not hidden. Rows the model skipped stay
 * unclassified too and are retried by the next import.
 */
export async function classifyTenders(items: readonly TenderInput[], generate: typeof generateText = generateText): Promise<TenderVerdicts> {
  const verdicts: TenderVerdicts = new Map();
  if (items.length === 0) return verdicts;
  const batch = items.slice(0, CLASSIFY_CAP);
  try {
    const { text, finishReason } = await generate({
      model: CLASSIFY_MODEL,
      system: CLASSIFY_SYSTEM_PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      prompt: batch.map((t, i) => `${i + 1}. ${t.name}`).join("\n"),
    });
    if (finishReason === "length") return verdicts;
    for (const [n, verdict] of parseVerdicts(text, batch.length)) verdicts.set(tenderKey(batch[n - 1]!.processNumber), verdict);
  } catch (error) {
    console.error("classifyTenders failed", error);
    return new Map();
  }
  return verdicts;
}
