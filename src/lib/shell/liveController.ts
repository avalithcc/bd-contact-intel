/**
 * WHEN the shell re-fetches after a live change message (see src/lib/shell/liveRelevance.ts for WHICH messages count).
 * A small state machine with every side effect injected, so it is tested with a manual clock. There is no interval: the
 * only timers exist while a refresh is pending (the debounce, and a local re-check while the screen is busy), so an idle
 * tab with no messages never fetches anything.
 */
import type { LiveChange } from "@/lib/shell/liveRelevance";

/** A message this soon after a refresh is probably the echo of the tab's own action: it is not dropped, its refresh trails the window. */
export const ECHO_MS = 1_500;
/** While a refresh is held back by a dialog, a focused field or unsaved input, how often that is re-checked locally. */
export const BUSY_RECHECK_MS = 2_000;

export interface LiveDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  refresh(): void;
  isBusy(): boolean;
  isHidden(): boolean;
  relevant(change: LiveChange): boolean;
  debounceMs(): number;
}

export function createLiveController(d: LiveDeps) {
  let pending = false;
  let timer: unknown = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;

  const cancel = () => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    cancel();
    timer = d.setTimer(flush, ms);
  };
  function flush() {
    timer = null;
    if (!pending) return;
    // Held back: a hidden tab resumes through onIdle (visibility), a busy screen through onIdle or the local re-check.
    if (d.isHidden()) return;
    if (d.isBusy()) return schedule(BUSY_RECHECK_MS);
    pending = false;
    lastRefreshAt = d.now();
    d.refresh();
  }

  return {
    get pending() {
      return pending;
    },
    onChange(change: LiveChange) {
      if (!d.relevant(change)) return;
      pending = true;
      // Trailing debounce: each message in a burst pushes the single refresh back, and never into the echo window.
      schedule(Math.max(d.debounceMs(), lastRefreshAt + ECHO_MS - d.now()));
    },
    /** Blur, dialog closed, tab visible again: run what was held back. */
    onIdle() {
      if (pending) schedule(d.debounceMs());
    },
    /** After a reconnect: messages may have been missed, so refresh once whatever the echo window says. */
    catchUp() {
      if (pending) return;
      pending = true;
      schedule(d.debounceMs());
    },
    /** A navigation fetches the new page fresh, so nothing is owed. */
    reset() {
      pending = false;
      cancel();
      lastRefreshAt = d.now();
    },
    dispose() {
      pending = false;
      cancel();
    },
  };
}

export type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export interface ConnectionState {
  everJoined: boolean;
  /** A join was lost since the last successful one. */
  dropped: boolean;
  failures: number;
}

export const initialConnection: ConnectionState = { everJoined: false, dropped: false, failures: 0 };
/** A channel that never joins (missing config, the receive policy refusing this user) stops retrying after this many failures. */
const GIVE_UP_AFTER = 4;

export function stepConnection(s: ConnectionState, status: ChannelStatus): { next: ConnectionState; catchUp: boolean; giveUp: boolean } {
  if (status === "SUBSCRIBED") return { next: { everJoined: true, dropped: false, failures: 0 }, catchUp: s.dropped, giveUp: false };
  const failures = s.failures + 1;
  return { next: { everJoined: s.everJoined, dropped: true, failures }, catchUp: false, giveUp: !s.everJoined && failures >= GIVE_UP_AFTER };
}
