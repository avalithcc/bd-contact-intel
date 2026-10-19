/**
 * Shape check for the outcome dialog's payload. A server action receives whatever the client sent, so every field is read as
 * `unknown` and only strings (and the one boolean) survive; the rules about what an outcome may contain live in outcome.ts.
 */
import type { OutcomeInput } from "@/lib/meetings/outcome";

const text = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.slice(0, max) : undefined);

export function sanitizeOutcomeInput(raw: unknown): OutcomeInput {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    outcome: text(o.outcome, 20) ?? "",
    notes: text(o.notes, 5000),
    reason: text(o.reason, 500),
    newDate: text(o.newDate, 10),
    newTime: text(o.newTime, 5),
    followUp: o.followUp === true,
    followUpDueDate: text(o.followUpDueDate, 10),
  };
}
