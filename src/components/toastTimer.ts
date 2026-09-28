/**
 * Pure timer state helpers for Toast auto-dismiss with pause on
 * hover/focus (tasks.md mockup-parity 2.3). Side-effect free — the
 * ToastProvider owns the actual `setInterval`/wall-clock reads; this
 * module only computes the next state given a `now` timestamp, which
 * keeps the pause/resume/expiry logic unit-testable without real timers.
 */
export interface ToastTimerState {
  /** Milliseconds left before the toast should auto-dismiss. */
  remainingMs: number;
  /** Timestamp (ms) the timer last (re)started running, or `null` while paused. */
  startedAt: number | null;
}

export function createTimer(durationMs: number, now: number): ToastTimerState {
  if (durationMs <= 0) {
    throw new RangeError("durationMs must be positive");
  }
  return { remainingMs: durationMs, startedAt: now };
}

export function pauseTimer(state: ToastTimerState, now: number): ToastTimerState {
  if (state.startedAt === null) return state;
  const elapsed = now - state.startedAt;
  return { remainingMs: Math.max(state.remainingMs - elapsed, 0), startedAt: null };
}

export function resumeTimer(state: ToastTimerState, now: number): ToastTimerState {
  if (state.startedAt !== null) return state;
  return { remainingMs: state.remainingMs, startedAt: now };
}

export function isExpired(state: ToastTimerState, now: number): boolean {
  const remaining =
    state.startedAt === null ? state.remainingMs : state.remainingMs - (now - state.startedAt);
  return remaining <= 0;
}
