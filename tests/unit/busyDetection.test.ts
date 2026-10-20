import assert from "node:assert/strict";
import { test } from "node:test";
import { detectBusy, type DomProbe } from "@/lib/shell/busyDetection";

function probe(over: { present?: string[]; active?: { tagName: string; isContentEditable?: boolean; type?: string } | null } = {}): DomProbe {
  return {
    activeElement: over.active === undefined ? null : over.active,
    has: (selector) => (over.present ?? []).includes(selector),
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
