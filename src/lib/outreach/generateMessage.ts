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
import { parseEmailModelOutput, parseSubjectModelOutput, capBody, MAX_BODY_CHARS, type ParsedEmailMessage } from "@/lib/outreach/emailOutputParsing";
import { bannedTermsInBody, describeViolations, validateSubject } from "@/lib/outreach/subjectRules";
import { repeatsAny } from "@/lib/outreach/subjectDifference";
import { addSpanishOpeningMarks } from "@/lib/outreach/spanishMarks";
import type { MessageLanguage } from "@/lib/outreach/messageLanguage";
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
      errorKey: "notFound" | "gatewayNotConfigured" | "generationFailed" | "invalidModelOutput" | "bannedVocabulary";
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
 * Regenerates while the subject or the body breaks the vendor-vocabulary rule, telling the model exactly what it broke.
 *
 * The two ends differ on purpose. A subject that still breaks the rule after the retries is returned and logged: a BD can
 * edit one line. A BODY that still carries banned vocabulary is NOT returned: `null` makes the caller fail the generation
 * visibly. The subject's log-and-return is what let 81.5% of live subjects break the rule unnoticed, and the body must not
 * repeat it. Approval refuses such a body too (approvalChecks.checkBodyVocabulary), so the two locks do not rely on each other.
 */
async function retryUntilRulesPass(
  first: ParsedEmailMessage,
  ctx: { system: string; prompt: string; input: BuildOutreachMessagePromptInput; generate: typeof generateText },
): Promise<ParsedEmailMessage | null> {
  const subjectOpts = { senderName: ctx.input.senderName, companyName: ctx.input.contact.companyName };
  let current = first;

  for (let attempt = 1; attempt <= SUBJECT_RETRY_ATTEMPTS; attempt++) {
    const violations = validateSubject(current.subject, subjectOpts);
    const bodyTerms = bannedTermsInBody(current.body);
    if (violations.length === 0 && bodyTerms.length === 0) return withSpanishMarks(current, ctx.input.language);

    const feedback = [
      violations.length ? `the subject "${current.subject}" was REJECTED because ${describeViolations(violations)}. Write a different subject that obeys every subject rule` : null,
      bodyTerms.length ? `the body was REJECTED because it used the banned vendor ${bodyTerms.length > 1 ? "terms" : "term"} ${bodyTerms.map((t) => `"${t}"`).join(", ")}. Rewrite the body without them, describing what Avalith does in plain words instead` : null,
    ].filter(Boolean).join(". Also, ");
    const { text, finishReason } = await ctx.generate({
      model: OUTREACH_MODEL,
      system: ctx.system,
      prompt: `${ctx.prompt}\n\nYour previous attempt was rejected: ${feedback}. Keep everything that was not rejected.`,
      maxOutputTokens: MAX_OUTPUT_TOKENS.email,
    });

    if (finishReason === "length") break;
    const reparsed = parseEmailModelOutput(text);
    if (!reparsed) break;
    current = reparsed;
  }

  const remaining = validateSubject(current.subject, subjectOpts);
  if (remaining.length > 0) {
    console.error(
      `[outreach] subject still breaks the rule after ${SUBJECT_RETRY_ATTEMPTS} retries: ${JSON.stringify({ subject: current.subject, violations: remaining })}`,
    );
  }
  const remainingBody = bannedTermsInBody(current.body);
  if (remainingBody.length > 0) {
    console.error(`[outreach] body still carries banned vocabulary after ${SUBJECT_RETRY_ATTEMPTS} retries, draft discarded: ${JSON.stringify(remainingBody)}`);
    return null;
  }
  return withSpanishMarks(current, ctx.input.language);
}

/**
 * The last thing every draft passes through, on BOTH exits of the retry loop. Spanish opens a question with ¿ and the
 * model keeps forgetting: both drafts the automatic path wrote on 2026-11-19 ended in "?" with no "¿".
 *
 * Repaired rather than retried: it is orthography, so the fix cannot change meaning, and a retry would spend a model
 * call on a punctuation mark. Repaired rather than asked for in the prompt, because a prompt instruction is a
 * request - 78.6% of live subjects once broke a rule that was written there.
 */
function withSpanishMarks(m: ParsedEmailMessage, language: MessageLanguage): ParsedEmailMessage {
  return { ...m, subject: addSpanishOpeningMarks(m.subject, language), body: addSpanishOpeningMarks(m.body, language) };
}

export type GenerateSubjectResult = { ok: true; subject: string } | { ok: false; errorKey: "generationFailed" | "invalidModelOutput" | "gatewayNotConfigured" | "unchanged" };

/**
 * Extra rounds allowed when a regenerated subject is only a repeat of one the BD already rejected. A button that
 * sometimes hands back the same string reads as broken (production, 2026-11-20: five clicks, one identical subject),
 * so a repeat is retried; but each round is a paid model call, so it is capped rather than looped until different.
 *
 * Worst case per click: (1 + SUBJECT_DIFFERENT_RETRIES) rounds x (1 + SUBJECT_RETRY_ATTEMPTS) calls = 3 x 3 = 9 model
 * calls, and only when every round both repeats AND breaks a subject rule. A typical click is 1 call.
 */
export const SUBJECT_DIFFERENT_RETRIES = 2;

/**
 * Rewrites ONLY the subject of an email whose body is already written ("Regenerar solo el asunto").
 *
 * The body goes INTO the prompt (see `subjectOnly` in messagePrompt.ts) so the new subject matches the email that will
 * actually be sent. Each round runs the same validate-and-retry as a full generation, because a subject regenerated on
 * demand is exactly where a BD will notice the vendor vocabulary this rule exists to keep out. A round whose subject
 * repeats a rejected one (see subjectDifference.ts) is retried with every rejected subject in the prompt; if the last
 * round still repeats, the outcome is `unchanged` so the caller can tell the BD instead of storing the repeat.
 */
export async function runGenerateOutreachSubject(
  input: BuildOutreachMessagePromptInput & { subjectOnly: { existingBody: string; rejectedSubjects?: string[] } },
  generate: typeof generateText = generateText,
): Promise<GenerateSubjectResult> {
  const rejected = (input.subjectOnly.rejectedSubjects ?? []).filter((x) => x.trim() !== "");

  async function round(): Promise<GenerateSubjectResult> {
    const { system, prompt } = buildOutreachMessagePrompt({ ...input, subjectOnly: { ...input.subjectOnly, rejectedSubjects: rejected } });

    async function attempt(extra: string): Promise<string | null> {
      const { text, finishReason } = await generate({
        model: OUTREACH_MODEL,
        system,
        prompt: `${prompt}${extra}`,
        maxOutputTokens: MAX_OUTPUT_TOKENS.email,
      });
      if (finishReason === "length") return null;
      return parseSubjectModelOutput(text);
    }

    let subject = await attempt("");
    if (!subject) return { ok: false, errorKey: "invalidModelOutput" };

    for (let i = 0; i < SUBJECT_RETRY_ATTEMPTS; i++) {
      const violations = validateSubject(subject, { senderName: input.senderName });
      if (violations.length === 0) return { ok: true, subject };
      const next = await attempt(
        `\n\nYour previous attempt used the subject "${subject}", which was REJECTED because ${describeViolations(violations)}. Write a different subject that obeys every subject rule.`,
      );
      if (!next) break;
      subject = next;
    }

    const remaining = validateSubject(subject, { senderName: input.senderName });
    if (remaining.length > 0) {
      console.error(`[outreach] regenerated subject still breaks the rule: ${JSON.stringify({ subject, violations: remaining })}`);
    }
    return { ok: true, subject };
  }

  try {
    for (let i = 0; i <= SUBJECT_DIFFERENT_RETRIES; i++) {
      const r = await round();
      if (!r.ok) return r;
      if (!repeatsAny(r.subject, rejected)) return r;
      rejected.push(r.subject);
    }
    return { ok: false, errorKey: "unchanged" };
  } catch (error) {
    console.error("runGenerateOutreachSubject failed", error);
    if (GatewayError.isInstance(error) && (error.statusCode === 401 || error.statusCode === 403)) {
      return { ok: false, errorKey: "gatewayNotConfigured" };
    }
    return { ok: false, errorKey: "generationFailed" };
  }
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
      const accepted = await retryUntilRulesPass(parsed, { system, prompt, input, generate });
      if (!accepted) return { ok: false, errorKey: "bannedVocabulary" };
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
