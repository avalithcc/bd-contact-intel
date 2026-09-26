/**
 * Pure planner for the "Pegar señal" quick action (task 11.6; design.md
 * "signal { source: 'manual_paste', data: { text } }"). No I/O — the caller
 * inserts a `signal` row with this data. Ports the legacy `/leads/[id]` and
 * `/contact/[id]` "+ Paste signal" composer (`src/app/ManualSignal.tsx` →
 * `/api/signals/manual`) onto the unified Contact record; that composer had
 * no equivalent on `/contacts/[id]` before this task (feature-parity gap
 * flagged in PR 11c).
 */

export class ManualSignalTextRequiredError extends Error {
  constructor() {
    super("Signal text is required");
    this.name = "ManualSignalTextRequiredError";
  }
}

export interface ManualSignalData {
  text: string;
}

export function planManualSignal(rawText: string): ManualSignalData {
  const text = rawText.trim();
  if (!text) throw new ManualSignalTextRequiredError();
  return { text };
}
