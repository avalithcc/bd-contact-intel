/**
 * The dialog's "Ver la versión actual" state, as a pure reducer so the stuck states can be tested without a DOM.
 *
 * A reload is pending from the click until the refetched props ARRIVE, not until the version happens to differ: a refresh
 * that lands the same version (another action already refreshed) must still end it. It also ends when the dialog closes,
 * when another draft is shown, or on timeout, so the button always becomes usable again and a reopened draft never starts
 * with the previous session's pending state. `reads` moves only when a reload of THIS draft was answered: it remounts the
 * form with the current text and re-reports the review mark once.
 */
export type ReloadState = { pending: { key: string; marker: unknown } | null; reads: number };
export type ReloadEvent =
  | { type: "click"; key: string; marker: unknown }
  /** The dialog's current inputs: `marker` is the identity of the member object the props carry (new on every refetch). */
  | { type: "props"; open: boolean; key: string | null; marker: unknown }
  | { type: "timeout" };

export const INITIAL_RELOAD: ReloadState = { pending: null, reads: 0 };
export const reloadKey = (memberId: string, step: 1 | 2) => `${memberId}:${step}`;

export function reloadReducer(state: ReloadState, ev: ReloadEvent): ReloadState {
  if (ev.type === "click") return { ...state, pending: { key: ev.key, marker: ev.marker } };
  if (!state.pending) return state;
  if (ev.type === "timeout") return { ...state, pending: null };
  if (!ev.open || ev.key !== state.pending.key) return { ...state, pending: null };
  if (ev.marker === state.pending.marker) return state;
  return { pending: null, reads: state.reads + 1 };
}
