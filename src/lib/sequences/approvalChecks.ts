/** Content checks that run at approval time. Pure. */

export type SubjectCheck = { ok: true } | { ok: false; reason: "reply_prefix_subject"; explanation: string };

// A cold step 1 that opens with "Re:" or "Fwd:" fakes an existing conversation; it must never be approved.
const FAKE_THREAD_PREFIX = /^\s*(re|fwd?)\s*:/i;

export function checkStep1Subject(subject: string): SubjectCheck {
  if (!FAKE_THREAD_PREFIX.test(subject)) return { ok: true };
  return {
    ok: false,
    reason: "reply_prefix_subject",
    explanation: 'A first email cannot start with "Re:" or "Fwd:" because it pretends to continue a conversation that never happened. Rewrite the subject.',
  };
}
