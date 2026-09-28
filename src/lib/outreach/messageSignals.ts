/**
 * "Señales utilizadas" chips for the "Generar mensaje" dialog (owner
 * direction, 2026-09-26: mockups/contact-record.html #generate). Pure
 * derivation from the SAME input handed to buildOutreachMessagePrompt
 * (messagePrompt.ts) — deliberately NOT parsed out of the model's output,
 * so the chips always describe what was actually fed into the prompt, even
 * if the model ignores or misuses a signal.
 *
 * Returns structured data, not localized strings: UI copy (the chip labels)
 * lives in the i18n dictionaries (src/lib/i18n/dictionaries), same as every
 * other user-facing string in this app.
 */
import type { BuildOutreachMessagePromptInput } from "@/lib/outreach/messagePrompt";

export type OutreachSignal =
  | { kind: "hiring"; count: number }
  | { kind: "leadership" }
  | { kind: "repliedBefore" }
  | { kind: "notesPresent"; count: number }
  | { kind: "lastContact"; date: string };

/**
 * Only the fields extractOutreachSignals actually reads — a structural
 * subset of BuildOutreachMessagePromptInput, so callers that already build
 * one (e.g. personMessageInput.ts, actions.ts) can pass it straight through.
 */
export type OutreachSignalInput = Pick<
  BuildOutreachMessagePromptInput,
  "contact" | "company" | "history" | "notes"
>;

export function extractOutreachSignals(input: OutreachSignalInput): OutreachSignal[] {
  const { contact, company, history, notes = [] } = input;
  const signals: OutreachSignal[] = [];

  // `company.postings` is a bounded sample (see getCompanyPostingsForKey's
  // DETAIL_ROW_LIMIT, src/lib/hiring/queries.ts) — the chip must show the
  // real total, not the sample size, or a company with more open postings
  // than the cap would show a shrunk count here.
  if (company && company.totalCount > 0) {
    signals.push({ kind: "hiring", count: company.totalCount });
  }

  if (contact.isLeadership) {
    signals.push({ kind: "leadership" });
  }

  if (history.some((m) => m.direction === "received")) {
    signals.push({ kind: "repliedBefore" });
  }

  if (notes.length > 0) {
    signals.push({ kind: "notesPresent", count: notes.length });
  }

  if (history.length > 0) {
    // History is always passed oldest-to-newest (see
    // OutreachHistoryMessage in messagePrompt.ts) — the last element is the
    // most recent contact.
    const lastMessage = history[history.length - 1]!;
    signals.push({ kind: "lastContact", date: lastMessage.sentAt.toISOString().slice(0, 10) });
  }

  return signals;
}
