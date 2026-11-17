/**
 * The "Terminada" badge, and the invariant it exists to explain.
 *
 * The sidebar pill counts Sequences with at least one member OUTSIDE `CLOSED_STATES`
 * (appShellBadgeCountsQuery.ts); this list shows every Sequence the BD owns. The owner saw "2" beside Secuencias and
 * three rows on the page and asked which was wrong. Neither: one of his was finished. So the badge must mark exactly
 * the rows the pill leaves out — if these two definitions ever drift, the badge explains nothing and the contradiction
 * is back.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { listView } from "@/lib/sequences/listView";
import { CLOSED_STATES, MEMBER_STATES } from "@/lib/sequences/memberState";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";

const member = (state: string, over: Record<string, unknown> = {}) =>
  ({ state, hasDraft: true, approvedAt: null, scheduledFor: null, sentAt: null, ...over }) as never;

const row = (name: string, states: readonly string[]) =>
  ({
    id: name, name, createdAt: new Date("2026-11-01T00:00:00Z"), dailySendCap: 5,
    schedule: DEFAULT_SCHEDULE, companies: [], members: states.map((s) => member(s)),
  }) as never;

const finishedOf = (states: readonly string[]) => listView([row("s", states)]).rows[0]!.finished;

describe("the Terminada badge", () => {
  it("marks a sequence whose every member is in a closed state", () => {
    assert.equal(finishedOf(["replied", "no_reply", "discarded"]), true);
  });

  it("does not mark one with a single member still open", () => {
    assert.equal(finishedOf(["replied", "discarded", "sent"]), false, "sent is NOT closed: the reminder is still due");
    assert.equal(finishedOf(["discarded", "drafted"]), false);
  });

  it("does not mark an EMPTY sequence, which is not finished but never started", () => {
    assert.equal(finishedOf([]), false);
  });

  it("agrees with CLOSED_STATES member by member, so the badge cannot drift from the sidebar's rule", () => {
    for (const state of MEMBER_STATES) {
      const closed = (CLOSED_STATES as readonly string[]).includes(state);
      assert.equal(finishedOf([state]), closed, `a lone "${state}" member should ${closed ? "" : "not "}be finished`);
    }
  });

  it("reproduces the owner's three sequences: two count for the pill, one is finished", () => {
    const view = listView([
      row("Florida + US · octubre", ["discarded", "drafted", "sent"]),
      row("Latam Banca - #1", ["discarded", "no_reply"]),
      row("Logistica y Transporte #1", ["discarded", "sent"]),
    ]);
    const finished = view.rows.filter((r) => r.finished).map((r) => r.name);
    assert.deepEqual(finished, ["Latam Banca - #1"]);
    assert.equal(view.rows.length - finished.length, 2, "and the other two are what the sidebar shows");
  });
});
