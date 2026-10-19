import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEBOUNCE_MS,
  DEFAULT_INTERVAL_MS,
  detectBusy,
  readPageHints,
  shouldRefreshNow,
  type DomProbe,
  type RefreshInput,
} from "@/lib/shell/refreshPolicy";

const base: RefreshInput = { trigger: "tick", now: 1_000_000, lastRefreshAt: 1_000_000 - DEFAULT_INTERVAL_MS, hidden: false, busy: false, optedOut: false, intervalMs: DEFAULT_INTERVAL_MS };

test("a tick refreshes once the interval has elapsed", () => {
  assert.equal(shouldRefreshNow(base), true);
  assert.equal(shouldRefreshNow({ ...base, lastRefreshAt: base.now - DEFAULT_INTERVAL_MS + 1 }), false);
});

test("a hidden tab never refreshes, whatever the trigger", () => {
  assert.equal(shouldRefreshNow({ ...base, hidden: true }), false);
  assert.equal(shouldRefreshNow({ ...base, trigger: "wake", hidden: true }), false);
});

test("a busy page or an opted-out page never refreshes", () => {
  assert.equal(shouldRefreshNow({ ...base, busy: true }), false);
  assert.equal(shouldRefreshNow({ ...base, trigger: "wake", busy: true }), false);
  assert.equal(shouldRefreshNow({ ...base, optedOut: true }), false);
});

test("wake (visible again / focus) refreshes after the debounce, not before", () => {
  const wake = { ...base, trigger: "wake" as const };
  assert.equal(shouldRefreshNow({ ...wake, lastRefreshAt: wake.now - DEBOUNCE_MS }), true);
  assert.equal(shouldRefreshNow({ ...wake, lastRefreshAt: wake.now - DEBOUNCE_MS + 1 }), false);
});

test("after a long sleep one wake refresh happens and the timer tick right after it does not stack a second", () => {
  const afterSleep = base.now;
  assert.equal(shouldRefreshNow({ ...base, trigger: "wake", lastRefreshAt: afterSleep - 3_600_000 }), true);
  assert.equal(shouldRefreshNow({ ...base, trigger: "tick", lastRefreshAt: afterSleep }), false);
});

test("a per-page interval hint lengthens the tick interval", () => {
  const slow = { ...base, intervalMs: 180_000, lastRefreshAt: base.now - 120_000 };
  assert.equal(shouldRefreshNow(slow), false);
  assert.equal(shouldRefreshNow({ ...slow, lastRefreshAt: base.now - 180_000 }), true);
});

test("the policy does not mutate its input", () => {
  const input = Object.freeze({ ...base });
  assert.equal(shouldRefreshNow(input), shouldRefreshNow(input));
});

function probe(over: { present?: string[]; active?: { tagName: string; isContentEditable?: boolean; type?: string } | null; attrs?: Record<string, string> } = {}): DomProbe {
  return {
    activeElement: over.active === undefined ? null : over.active,
    has: (selector) => (over.present ?? []).includes(selector),
    attr: (selector, name) => over.attrs?.[`${selector}|${name}`] ?? null,
  };
}

test("detectBusy: an open dialog, popover or marked element is busy", () => {
  assert.equal(detectBusy(probe()), false);
  assert.equal(detectBusy(probe({ present: ['[role="dialog"]'] })), true);
  assert.equal(detectBusy(probe({ present: ['[aria-modal="true"]'] })), true);
  assert.equal(detectBusy(probe({ present: ['[role="menu"]'] })), true);
  assert.equal(detectBusy(probe({ present: ['[data-busy="true"]'] })), true);
  assert.equal(detectBusy(probe({ present: ['[data-dirty="true"]'] })), true);
});

test("detectBusy: typing in an input, textarea, select or contenteditable is busy; a button is not", () => {
  assert.equal(detectBusy(probe({ active: { tagName: "INPUT", type: "text" } })), true);
  assert.equal(detectBusy(probe({ active: { tagName: "TEXTAREA" } })), true);
  assert.equal(detectBusy(probe({ active: { tagName: "SELECT" } })), true);
  assert.equal(detectBusy(probe({ active: { tagName: "DIV", isContentEditable: true } })), true);
  assert.equal(detectBusy(probe({ active: { tagName: "BUTTON" } })), false);
  assert.equal(detectBusy(probe({ active: { tagName: "BODY" } })), false);
  assert.equal(detectBusy(probe({ active: { tagName: "INPUT", type: "checkbox" } })), false);
});

test("readPageHints: opt-out and a per-page interval come from data attributes", () => {
  assert.deepEqual(readPageHints(probe()), { optedOut: false, intervalMs: DEFAULT_INTERVAL_MS });
  assert.deepEqual(readPageHints(probe({ present: ['[data-refresh="off"]'] })), { optedOut: true, intervalMs: DEFAULT_INTERVAL_MS });
  assert.deepEqual(readPageHints(probe({ attrs: { "[data-refresh-interval]|data-refresh-interval": "180000" } })), { optedOut: false, intervalMs: 180_000 });
});

test("readPageHints: a garbage or too-small interval hint falls back to the default (never a refresh storm)", () => {
  for (const bad of ["abc", "0", "-5", "1000"]) {
    assert.equal(readPageHints(probe({ attrs: { "[data-refresh-interval]|data-refresh-interval": bad } })).intervalMs, DEFAULT_INTERVAL_MS, bad);
  }
});
