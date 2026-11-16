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
import { parseEmailModelOutput, capBody, MAX_BODY_CHARS, type ParsedEmailMessage } from "@/lib/outreach/emailOutputParsing";
import { describeViolations, validateSubject } from "@/lib/outreach/subjectRules";
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
//
// The cap counts REASONING tokens too: claude-sonnet-5 spends 190-500 tokens thinking before the ~300-token answer, so
// the old 500/350 cut the JSON off (finishReason "length", truncated or empty text) for roughly half the members of a
// Sequence. The headroom below leaves room for the thinking and the answer; the prompt still bounds the answer length.
export const MAX_OUTPUT_TOKENS: Record<OutreachChannel, number> = {
  email: 2000,
  linkedin: 1500,
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

/**
 * How many extra generations a rejected subject is worth. Capped because every attempt is a paid call.
 *
 * Read this before trusting it: measured against production on 2026-11-16, 22 of 28 live subjects (78.6%) broke the
 * rule. If retries were independent draws from that distribution, two of them would still leave ~49% broken — so the
 * retry is a NET, not the cure. The cure is meant to be the rewritten rule 5 (which no longer pushes vendor framing at
 * a model that has no hiring data to work from) plus the fact that each retry is told exactly what it broke, which
 * makes the draws anything but independent. How much that helps is NOT yet known.
 *
 * `scripts/measure/subject-rule-violations.ts` answers it against live data, and answering it is the point: the last
 * attempt at this problem shipped unmeasured and was still failing weeks later. Re-run it before concluding anything.
 */
export const SUBJECT_RETRY_ATTEMPTS = 2;

/**
 * Regenerates while the subject breaks the rule, telling the model exactly what it broke each time.
 *
 * When every attempt fails, the LAST one is returned rather than failing the draft: a BD with a flawed subject they can
 * edit is better off than a BD with no draft. The give-up is logged with the subject and the violations, because the
 * previous attempt to fix this shipped with no way to tell whether it had worked — and it had not, for weeks, silently.
 * `scripts/measure/subject-rule-violations.ts` reads the same rule against live data to answer that question.
 */
async function retryUntilSubjectPasses(
  first: ParsedEmailMessage,
  ctx: { system: string; prompt: string; input: BuildOutreachMessagePromptInput; generate: typeof generateText },
): Promise<ParsedEmailMessage> {
  let current = first;

  for (let attempt = 1; attempt <= SUBJECT_RETRY_ATTEMPTS; attempt++) {
    const violations = validateSubject(current.subject, { senderName: ctx.input.senderName });
    if (violations.length === 0) return current;

    const { text, finishReason } = await ctx.generate({
      model: OUTREACH_MODEL,
      system: ctx.system,
      prompt: `${ctx.prompt}\n\nYour previous attempt used the subject "${current.subject}", which was REJECTED because ${describeViolations(violations)}. Write a different subject that obeys every subject rule. Keep the body's substance; only the subject must change.`,
      maxOutputTokens: MAX_OUTPUT_TOKENS.email,
    });

    if (finishReason === "length") break;
    const reparsed = parseEmailModelOutput(text);
    if (!reparsed) break;
    current = reparsed;
  }

  const remaining = validateSubject(current.subject, { senderName: ctx.input.senderName });
  if (remaining.length > 0) {
    console.error(
      `[outreach] subject still breaks the rule after ${SUBJECT_RETRY_ATTEMPTS} retries: ${JSON.stringify({ subject: current.subject, violations: remaining })}`,
    );
  }
  return current;
}

export async function runGenerateOutreachMessage(
  input: BuildOutreachMessagePromptInput,
  historyCount: number,
  generate: typeof generateText = generateText,
): Promise<GenerateOutreachMessageResult> {
  const { system, prompt } = buildOutreachMessagePrompt(input);
  const signals = extractOutreachSignals(input);

  try {
    const { text, finishReason } = await generate({
      model: OUTREACH_MODEL,
      system,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS[input.channel],
    });

    // A cut-off answer is never usable, even when the truncated text happens to parse.
    if (finishReason === "length") return { ok: false, errorKey: "invalidModelOutput" };

    if (input.channel === "email") {
      const parsed = parseEmailModelOutput(text);
      if (!parsed) return { ok: false, errorKey: "invalidModelOutput" };

      // The subject rule is checked, not merely requested. See subjectRules.ts for why: it was stated in the prompt for
      // weeks while 10 of the last 25 live subjects broke it. A violation costs a retry that NAMES what was broken.
      const accepted = await retryUntilSubjectPasses(parsed, { system, prompt, input, generate });
      return {
        ok: true,
        channel: "email",
        message: formatEmailDraft(accepted.subject, accepted.body),
        subject: accepted.subject,
        body: accepted.body,
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
