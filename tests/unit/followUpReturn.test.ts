/**
 * What the send confirmation may promise. The follow-up queue is built per CONTACT OWNER
 * (candidateQuery.ts: `where fuq_owner_bd_id = $bdId`) and applies THAT owner's role-group deny list, not the
 * sender's. Measured in production: 330 of 2,339 manual sends — 1 in 7 — go to a contact someone else owns, so a
 * confirmation reading "vuelve a TUS seguimientos" with the sender's own list would name the wrong queue that often.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";
import { followUpReturn, followUpReturnToWire, followUpToast } from "@/lib/followUp/returnDate";

const SENT = new Date("2026-11-17T18:00:00Z");
const ME = "bd-me";
const mine = (excluded: readonly string[] = []) => ({ bdId: ME, name: "Yo", excludedRoleGroups: excluded });
const hers = (excluded: readonly string[] = []) => ({ bdId: "bd-her", name: "Macarena", excludedRoleGroups: excluded });

describe("when a manually sent contact comes back", () => {
  it("is the send instant plus the entry window, read from the constant", () => {
    const r = followUpReturn(SENT, "cto", mine(), ME);
    assert.equal(r.kind, "earliest");
    assert.equal(r.kind === "earliest" ? r.at.getTime() : 0, SENT.getTime() + FOLLOW_UP_ENTRY_DAYS * 86_400_000);
  });

  it("does not mutate the instant it was given", () => {
    const before = SENT.getTime();
    followUpReturn(SENT, "cto", mine(), ME);
    assert.equal(SENT.getTime(), before);
  });

  it("a contact with no owner enters nobody's queue, so it gets no date at all", () => {
    // candidateQuery requires `person.owner_bd_id is not null`. A date here would be a promise nothing keeps.
    assert.deepEqual(followUpReturn(SENT, "cto", { bdId: null, name: null, excludedRoleGroups: [] }, ME), { kind: "unowned" });
  });
});

describe("whose deny list decides it", () => {
  it("uses the OWNER's list, not the sender's: excluded for her, even though I exclude nothing", () => {
    const r = followUpReturn(SENT, "developer", hers(["developer"]), ME);
    assert.deepEqual(r, { kind: "excluded", mine: false, ownerName: "Macarena" });
  });

  it("and the reverse: my own exclusion must NOT suppress a contact she owns", () => {
    const r = followUpReturn(SENT, "developer", hers([]), ME);
    assert.equal(r.kind, "earliest", "her queue has no such exclusion, so it comes back");
    assert.equal(r.kind === "earliest" ? r.mine : true, false);
  });

  it("an unclassified role group is never excluded: null is not a group", () => {
    assert.equal(followUpReturn(SENT, null, mine(["developer"]), ME).kind, "earliest");
  });

  it("an empty list excludes nobody", () => {
    assert.equal(followUpReturn(SENT, "developer", mine([]), ME).kind, "earliest");
  });

  it("my own contact reports as mine, with no owner name to print", () => {
    assert.deepEqual(followUpReturn(SENT, "cto", mine(), ME), { kind: "earliest", at: new Date(SENT.getTime() + FOLLOW_UP_ENTRY_DAYS * 86_400_000), mine: true, ownerName: null });
  });
});

describe("the wire shape and the copy", () => {
  const fmt = () => "22/11";

  it("carries the owner across the server boundary, not just the date", () => {
    const w = followUpReturnToWire(followUpReturn(SENT, "cto", hers(), ME));
    assert.deepEqual(w, { kind: "earliest", atIso: new Date(SENT.getTime() + FOLLOW_UP_ENTRY_DAYS * 86_400_000).toISOString(), mine: false, ownerName: "Macarena" });
  });

  for (const [locale, d] of [["es", es], ["en", en]] as const) {
    it(`${locale}: names the other BD's queue and never calls it mine`, () => {
      const l = d.contactRecord;
      const other = followUpToast({ kind: "earliest", atIso: SENT.toISOString(), mine: false, ownerName: "Macarena" }, l, fmt);
      assert.match(other, /Macarena/);
      assert.ok(other.includes("22/11"), "the date is filled, not left as a placeholder");
      const ownIt = followUpToast({ kind: "earliest", atIso: SENT.toISOString(), mine: true, ownerName: null }, l, fmt);
      assert.doesNotMatch(ownIt, /Macarena|\{owner\}/);
      assert.ok(ownIt.includes("22/11"));
    });

    it(`${locale}: an excluded role group says so instead of inventing a date`, () => {
      const l = d.contactRecord;
      for (const t of [
        followUpToast({ kind: "excluded", mine: true, ownerName: null }, l, fmt),
        followUpToast({ kind: "excluded", mine: false, ownerName: "Macarena" }, l, fmt),
      ]) {
        assert.ok(!t.includes("22/11"), `a date was promised for an excluded contact: ${t}`);
        assert.ok(!t.includes("{"), `an unfilled placeholder reached the toast: ${t}`);
      }
    });

    it(`${locale}: every branch fills every placeholder`, () => {
      const l = d.contactRecord;
      for (const r of [
        { kind: "earliest", atIso: SENT.toISOString(), mine: true, ownerName: null },
        { kind: "earliest", atIso: SENT.toISOString(), mine: false, ownerName: "Macarena" },
        { kind: "excluded", mine: true, ownerName: null },
        { kind: "excluded", mine: false, ownerName: "Macarena" },
        { kind: "unowned" },
      ] as const) {
        const t = followUpToast(r, l, fmt);
        assert.ok(t.length > 0 && !t.includes("{"), `${r.kind} left a placeholder: ${t}`);
      }
    });
  }
});
