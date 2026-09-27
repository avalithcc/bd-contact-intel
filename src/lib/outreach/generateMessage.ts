/**
 * Shared "call the model and turn its output into a result" step for the
 * outreach message generator, used by both generateOutreachMessage
 * (src/app/(app)/outreach/actions.ts, the LinkedIn-triage view) and
 * generatePersonOutreachMessageAction (src/app/(app)/contacts/messageActions.ts,
 * the record page + bulk action). Not itself a "use server" action file —
 * only its two callers are, keeping this a plain importable helper.
 *
 * Centralizes the one genuinely risky bit: the email channel asks the model
 * for a bare JSON {subject, body} object (see the "email" branch of
 * buildOutreachMessagePrompt), which is a real output-format parsing risk —
 * a model can wrap it in a code fence, add stray text, or ignore the format
 * — handled by parseEmailModelOutput (src/lib/outreach/emailOutputParsing.ts).
 */
import { generateText } from "ai";
import { GatewayError } from "@ai-sdk/gateway";
import {
  buildOutreachMessagePrompt,
  type BuildOutreachMessagePromptInput,
} from "@/lib/outreach/messagePrompt";
import { extractOutreachSignals, type OutreachSignal } from "@/lib/outreach/messageSignals";
import { parseEmailModelOutput, capBody, MAX_BODY_CHARS } from "@/lib/outreach/emailOutputParsing";
import { formatEmailDraft } from "@/lib/outreach/emailDraftFormat";
import type { OutreachChannel } from "@/lib/outreach/channel";

// Model id verified against the live AI Gateway catalog
// (https://ai-gateway.vercel.sh/v1/models) at implementation time — highest
// released Sonnet version available. Re-check that endpoint before bumping
// this if Anthropic ships a newer Sonnet.
const OUTREACH_MODEL = "anthropic/claude-sonnet-5";

// The email channel's body target (90-150 words) is noticeably longer than
// the LinkedIn DM's (60-100 words) and also carries a subject line and JSON
// framing overhead — a higher ceiling avoids truncating a valid response
// mid-JSON, while still bounding a misbehaving/looping generation.
const MAX_OUTPUT_TOKENS: Record<OutreachChannel, number> = {
  email: 500,
  linkedin: 350,
};

export type GenerateOutreachMessageResult =
  | {
      ok: true;
      channel: OutreachChannel;
      // linkedin: the DM text. email: "Asunto: <subject>\n\n<body>" — kept
      // as one renderable/copyable string for the existing display, while
      // `subject`/`body` below carry the parts separately (e.g. for the
      // "Usar en correo" prefill).
      message: string;
      subject?: string;
      body?: string;
      historyCount: number;
      signals: OutreachSignal[];
    }
  | {
      ok: false;
      errorKey: "notFound" | "gatewayNotConfigured" | "generationFailed" | "invalidModelOutput";
    };

export async function runGenerateOutreachMessage(
  input: BuildOutreachMessagePromptInput,
  historyCount: number,
): Promise<GenerateOutreachMessageResult> {
  const { system, prompt } = buildOutreachMessagePrompt(input);
  const signals = extractOutreachSignals(input);

  try {
    const { text } = await generateText({
      model: OUTREACH_MODEL,
      system,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS[input.channel],
    });

    if (input.channel === "email") {
      const parsed = parseEmailModelOutput(text);
      if (!parsed) return { ok: false, errorKey: "invalidModelOutput" };
      return {
        ok: true,
        channel: "email",
        message: formatEmailDraft(parsed.subject, parsed.body),
        subject: parsed.subject,
        body: parsed.body,
        historyCount,
        signals,
      };
    }

    // Casual Spanish chat drops the opening "¿"/"¡"; the prompt asks for
    // that, and this guarantees it even if the model slips.
    const cleaned = (input.language === "es" ? text.replace(/[¿¡]/g, "") : text).trim();
    if (!cleaned) return { ok: false, errorKey: "generationFailed" };
    // Same cap as the email body (MAX_BODY_CHARS) — a degenerate or
    // injection-influenced response could otherwise push an unbounded DM
    // into the dialog just like an unbounded email body would.
    const message = capBody(cleaned, MAX_BODY_CHARS);
    return { ok: true, channel: "linkedin", message, historyCount, signals };
  } catch (error) {
    // Missing/invalid AI Gateway credentials (no AI_GATEWAY_API_KEY locally,
    // no OIDC token on Vercel) surface as an authentication failure from the
    // gateway itself — worth a distinct, actionable error message rather
    // than the generic "generation failed". The Gateway wraps *every*
    // failure (auth, 402 insufficient credits, 429 rate limit, ...) in its
    // own GatewayError subclasses before it ever reaches generateText's
    // caller — it is never an APICallError here, so that's what must be
    // checked (confirmed by reading node_modules/@ai-sdk/gateway: doGenerate
    // catches and rethrows via asGatewayError() for every error, including
    // ones raised before any HTTP call, like a missing OIDC token).
    console.error("runGenerateOutreachMessage failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
      return { ok: false, errorKey: "gatewayNotConfigured" };
    }
    return { ok: false, errorKey: "generationFailed" };
  }
}
