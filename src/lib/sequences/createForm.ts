/**
 * The "Nueva secuencia" form rules. The cap rules are `validateDailySendCap` (the same function the server runs); this
 * only reads the text field into it. The server re-applies every rule, so what is shown here never decides what is saved.
 */
import { validateDailySendCap } from "./capValidation";

export type CapState = { value: number | null; error: "ceiling" | "invalid" | null; warn: boolean };

export function capState(raw: string): CapState {
  const r = validateDailySendCap(raw.trim() === "" ? Number.NaN : Number(raw));
  if (r.ok) return { value: r.value, error: null, warn: r.warn };
  return { value: null, error: r.reason === "above_ceiling" ? "ceiling" : "invalid", warn: false };
}

/**
 * `blocked` disables the button (nothing to create from); `valid` is what submit checks. They differ on purpose: a
 * missing name or a bad cap leaves the button enabled so pressing it shows the error instead of a silent dead button.
 */
export function createFormView(i: { name: string; cap: string; selectedCount: number; hasAccount: boolean }) {
  const cap = capState(i.cap);
  const nameMissing = i.name.trim() === "";
  const blocked = i.selectedCount === 0 || !i.hasAccount;
  return { nameMissing, cap, submit: (i.selectedCount === 0 ? "none" : i.selectedCount === 1 ? "one" : "many") as "none" | "one" | "many", blocked, valid: !blocked && !nameMissing && cap.error === null };
}
