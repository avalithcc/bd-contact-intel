import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import {
  ANALYSIS_SYSTEM_PROMPT,
  analysisFollowUpPrompt,
  jsonObjectIn,
  mergeAnalysisPatch,
  missingKeys,
  toTenderAnalysis,
  type TenderAnalysis,
} from "./analysis";

/** Same model the outreach generator uses (src/lib/outreach/generateMessage.ts); Claude reads a PDF natively. */
const ANALYSIS_MODEL = "anthropic/claude-sonnet-5";
/** The cap counts reasoning tokens too (see MAX_OUTPUT_TOKENS in generateMessage.ts); the answer itself is short. */
const MAX_OUTPUT_TOKENS = 6000;

/**
 * How many times a dropped key (requirements or economics) is asked for again.
 *
 * Asked once, the model answered four of the eight keys on a real 23-page pliego and said nothing about the other four -
 * including a team requirement it had just described in its own "viability" text. The must-list is the artifact the owner
 * pastes to the administrative area, so its completeness cannot rest on the prompt being obeyed: a prompt instruction is a
 * request, this is the constraint. Two re-asks, because the first one costs a document read and the second is the last
 * attempt that is still cheaper than a reading the owner cannot use.
 */
const REQUIREMENT_RETRY_ATTEMPTS = 2;
/** A follow-up answers a handful of keys, never the whole object, so it needs a fraction of the first answer's room. */
const MAX_FOLLOW_UP_TOKENS = 3000;

const FIRST_TURN = "Analyse the attached tender document and reply with the JSON object described.";

export type AnalyseResult = { ok: true; analysis: TenderAnalysis } | { ok: false; error: "gatewayNotConfigured" | "generationFailed" | "invalidModelOutput" };

/**
 * Reads the pliego and answers the three things a BD needs to decide. The PDF itself goes to the model as a file part (the
 * gateway base64-encodes it); no text is extracted first, so tables and scanned pages are read as the model sees them.
 * The tender's title is deliberately NOT in the prompt: the reading must come from the document, never from the title.
 */
export async function runTenderAnalysis(pdf: Uint8Array, filename: string, generate: typeof generateText = generateText): Promise<AnalyseResult> {
  try {
    const opening = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: FIRST_TURN },
          { type: "file" as const, data: pdf, mediaType: "application/pdf", filename },
        ],
      },
    ];
    const { text, finishReason } = await generate({
      model: ANALYSIS_MODEL,
      system: ANALYSIS_SYSTEM_PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      messages: opening,
    });
    // A cut-off answer is never usable, even when the truncated text happens to parse.
    if (finishReason === "length") return { ok: false, error: "invalidModelOutput" };
    let object = jsonObjectIn(text);
    if (!object) return { ok: false, error: "invalidModelOutput" };

    // Every follow-up is anchored on the SAME first answer and names only what is still missing, so two re-asks never
    // compound into a conversation where the model is answering its own corrections.
    let missing = missingKeys(object);
    for (let attempt = 0; attempt < REQUIREMENT_RETRY_ATTEMPTS && missing.length > 0; attempt++) {
      const followUp = await generate({
        model: ANALYSIS_MODEL,
        system: ANALYSIS_SYSTEM_PROMPT,
        maxOutputTokens: MAX_FOLLOW_UP_TOKENS,
        messages: [...opening, { role: "assistant", content: text }, { role: "user", content: analysisFollowUpPrompt(missing) }],
      });
      if (followUp.finishReason === "length") break;
      const patch = jsonObjectIn(followUp.text);
      if (!patch) break;
      object = mergeAnalysisPatch(object, patch);
      const left = missingKeys(object);
      // A re-ask that answered nothing will not answer anything on the next one either: stop rather than pay for it.
      if (left.length === missing.length) break;
      missing = left;
    }

    // Still incomplete is reported, never papered over: toTenderAnalysis leaves mustListIncluded or economicsIncluded false and the ficha
    // asks for a new analysis instead of showing a key that was never answered as "the pliego does not state it".
    const analysis = toTenderAnalysis(object);
    return analysis ? { ok: true, analysis } : { ok: false, error: "invalidModelOutput" };
  } catch (error) {
    console.error("runTenderAnalysis failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) return { ok: false, error: "gatewayNotConfigured" };
    return { ok: false, error: "generationFailed" };
  }
}
