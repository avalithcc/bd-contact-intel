/**
 * Whether the new-email dialog should explain why Send is disabled: only once
 * the body has content and the subject is still empty. Uses the same trimmed
 * values as the Send gate so the hint can never contradict the button.
 */
export function shouldShowSubjectHint(subject: string, body: string): boolean {
  return body.trim() !== "" && subject.trim() === "";
}
