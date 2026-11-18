import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import { ANALYSIS_SYSTEM_PROMPT, parseTenderAnalysis, type TenderAnalysis } from "./analysis";

/** Same model the outreach generator uses (src/lib/outreach/generateMessage.ts); Claude reads a PDF natively. */
const ANALYSIS_MODEL = "anthropic/claude-sonnet-5";
/** The cap counts reasoning tokens too (see MAX_OUTPUT_TOKENS in generateMessage.ts); the answer itself is short. */
const MAX_OUTPUT_TOKENS = 4000;

export type AnalyseResult = { ok: true; analysis: TenderAnalysis } | { ok: false; error: "gatewayNotConfigured" | "generationFailed" | "invalidModelOutput" };

/**
 * Reads the pliego and answers the three things a BD needs to decide. The PDF itself goes to the model as a file part (the
 * gateway base64-encodes it); no text is extracted first, so tables and scanned pages are read as the model sees them.
 * The tender's title is deliberately NOT in the prompt: the reading must come from the document, never from the title.
 */
export async function runTenderAnalysis(pdf: Uint8Array, filename: string, generate: typeof generateText = generateText): Promise<AnalyseResult> {
  try {
    const { text, finishReason } = await generate({
      model: ANALYSIS_MODEL,
      system: ANALYSIS_SYSTEM_PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyse the attached tender document and reply with the JSON object described." },
            { type: "file", data: pdf, mediaType: "application/pdf", filename },
          ],
        },
      ],
    });
    // A cut-off answer is never usable, even when the truncated text happens to parse.
    if (finishReason === "length") return { ok: false, error: "invalidModelOutput" };
    const analysis = parseTenderAnalysis(text);
    return analysis ? { ok: true, analysis } : { ok: false, error: "invalidModelOutput" };
  } catch (error) {
    console.error("runTenderAnalysis failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) return { ok: false, error: "gatewayNotConfigured" };
    return { ok: false, error: "generationFailed" };
  }
}
