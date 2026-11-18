/**
 * Tender deadlines inside the 08:30 digest: a BD with zero tasks and a closing tender must still get the email (the exact
 * trap the follow-up warning fell into), the 7/14 day windows, closed and irrelevant tenders never listed, and a human
 * relevance override respected here and not only in the list.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigestEmail, type DigestGroups, type DigestTask } from "@/lib/tasks/digest";
import type { DigestTender } from "@/lib/tasks/digestTenders";

const SITE = "https://crm.example.test";
const RECIPIENT = { name: "Ana Perez", email: "ana@example.test" };
const NO_TASKS: DigestGroups<DigestTask> = { today: [], yesterday: [], overdue: [] };

function dt(id: string, daysLeft: number): DigestTender {
  return { id, processNumber: `487-00${id}-LPR26`, name: `Tender ${id}`, openingAt: new Date("2026-11-21T14:00:00Z"), daysLeft };
}

test("a BD with zero tasks and one tender closing in 3 days DOES get an email", () => {
  const email = buildDigestEmail(RECIPIENT, NO_TASKS, SITE, [], { mine: [dt("1", 3)], unowned: [] });
  assert.ok(email, "expected an email for a BD with only a closing tender");
  assert.match(email.subject, /licitaci/i);
  assert.ok(email.text.includes("Tender 1"));
  assert.ok(email.text.includes(`${SITE}/licitaciones/1`));
});

test("a BD with zero tasks, zero follow-ups and zero tenders still gets null", () => {
  assert.equal(buildDigestEmail(RECIPIENT, NO_TASKS, SITE, [], { mine: [], unowned: [] }), null);
  assert.equal(buildDigestEmail(RECIPIENT, NO_TASKS, SITE, []), null);
});

test("unowned tenders are labelled as having nobody on them, apart from the BD's own", () => {
  const email = buildDigestEmail(RECIPIENT, NO_TASKS, SITE, [], { mine: [dt("1", 3)], unowned: [dt("2", 10)] });
  assert.ok(email);
  assert.ok(email.text.includes("Tender 1") && email.text.includes("Tender 2"));
  assert.match(email.text, /sin responsable/i);
});

// ---- who gets which tender -------------------------------------------------------------------------------------------

import { planTenderDigest, type ClosingTenderRow, type DigestBd } from "@/lib/tenders/digestPlan";
import { buildDigestRecipients, groupDigestTaskRowsByBd } from "@/lib/tasks/digestRecipients";


const NOW = new Date("2026-11-18T11:30:00Z"); // 08:30 in Buenos Aires
const ANA: DigestBd = { bdId: "bd-ana", bdEmail: "ana@example.test", bdName: "Ana Perez" };
const LUIS: DigestBd = { bdId: "bd-luis", bdEmail: "luis@example.test", bdName: "Luis Gomez" };
const EVERYONE = [ANA, LUIS];

/** A tender whose opening day is `days` Argentina days from NOW, at 14:00 ART. */
function tender(id: string, days: number, over: Partial<ClosingTenderRow> = {}): ClosingTenderRow {
  const open = new Date(NOW.getTime() + days * 86_400_000 + 3 * 3_600_000);
  return { id, processNumber: `P-${id}`, name: `Tender ${id}`, openingAt: open, owner: null, aiRelevant: true, aiReason: null, relevanceOverride: null, ...over };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("a tender owned by Ana closing in 3 days reaches Ana only, in her own list", () => {
  const plan = planTenderDigest([tender("1", 3, { owner: ANA })], EVERYONE, NOW);
  assert.deepEqual([...plan.keys()], ["bd-ana"]);
  assert.deepEqual(ids(plan.get("bd-ana")!.tenders.mine), ["1"]);
  assert.deepEqual(plan.get("bd-ana")!.tenders.unowned, []);
});

test("an owned tender beyond 7 days is nobody's warning yet, and it is never shown to the other BDs", () => {
  assert.equal(planTenderDigest([tender("1", 10, { owner: ANA })], EVERYONE, NOW).size, 0);
});

test("an unowned relevant tender closing in 10 days reaches every BD; in 20 days it reaches nobody", () => {
  const plan = planTenderDigest([tender("near", 10), tender("far", 20)], EVERYONE, NOW);
  assert.deepEqual([...plan.keys()].sort(), ["bd-ana", "bd-luis"]);
  for (const bd of plan.values()) assert.deepEqual(ids(bd.tenders.unowned), ["near"]);
  assert.equal(planTenderDigest([tender("far", 20)], EVERYONE, NOW).size, 0);
});

test("the 7 and 14 day edges are inclusive and day 8 / day 15 are out", () => {
  assert.deepEqual(ids(planTenderDigest([tender("a", 7, { owner: ANA }), tender("b", 8, { owner: ANA })], EVERYONE, NOW).get("bd-ana")!.tenders.mine), ["a"]);
  assert.deepEqual(ids(planTenderDigest([tender("a", 14), tender("b", 15)], [ANA], NOW).get("bd-ana")!.tenders.unowned), ["a"]);
});

test("a closed tender never appears, owned or not; one closing later today still does", () => {
  const closed = new Date(NOW.getTime() - 3_600_000);
  assert.equal(planTenderDigest([tender("c", 0, { openingAt: closed }), tender("d", 0, { openingAt: closed, owner: ANA })], EVERYONE, NOW).size, 0);
  const later = tender("e", 0, { openingAt: new Date(NOW.getTime() + 3_600_000), owner: ANA });
  assert.equal(planTenderDigest([later], EVERYONE, NOW).get("bd-ana")!.tenders.mine[0]!.daysLeft, 0);
});

test("an irrelevant tender never appears, but an unclassified one does (a failed model call must not hide a deadline)", () => {
  assert.equal(planTenderDigest([tender("x", 3, { aiRelevant: false, owner: ANA }), tender("y", 3, { aiRelevant: false })], EVERYONE, NOW).size, 0);
  assert.deepEqual(ids(planTenderDigest([tender("u", 3, { aiRelevant: null })], [ANA], NOW).get("bd-ana")!.tenders.unowned), ["u"]);
});

test("a human override beats the model in the digest: relevant over an AI no, irrelevant over an AI yes", () => {
  const yes = tender("h1", 3, { aiRelevant: false, relevanceOverride: true });
  const no = tender("h2", 3, { aiRelevant: true, relevanceOverride: false });
  const plan = planTenderDigest([yes, no], [ANA], NOW);
  assert.deepEqual(ids(plan.get("bd-ana")!.tenders.unowned), ["h1"]);
});

test("soonest first, and the planner never mutates its input and gives the same answer twice", () => {
  const rows = Object.freeze([tender("late", 12), tender("soon", 2), tender("mid", 5)].map((r) => Object.freeze(r)));
  const recipients = Object.freeze([ANA]);
  const first = planTenderDigest(rows, recipients, NOW);
  const second = planTenderDigest(rows, recipients, NOW);
  assert.deepEqual(ids(first.get("bd-ana")!.tenders.unowned), ["soon", "mid", "late"]);
  assert.deepEqual([...first], [...second]);
  assert.deepEqual(ids([...rows]), ["late", "soon", "mid"]);
});

test("the recipient list includes a BD who has NO tasks and NO follow-ups but owns a closing tender, and that BD gets an email", () => {
  const plan = planTenderDigest([tender("1", 3, { owner: ANA })], [], NOW);
  const recipients = buildDigestRecipients(groupDigestTaskRowsByBd([]), new Map(), plan);
  assert.deepEqual([...recipients.keys()], ["bd-ana"]);
  const r = recipients.get("bd-ana")!;
  const email = buildDigestEmail({ name: r.bdName, email: r.bdEmail }, { today: [], yesterday: [], overdue: [] }, SITE, [], r.tenders);
  assert.ok(email);
});

test("a BD with tasks keeps them when tenders are merged in, and one with only unowned tenders is added", () => {
  const taskRow = {
    id: "t1", title: "Call", dueAt: new Date("2026-11-18T00:00:00Z"), personId: null, companyKey: null,
    subjectPersonFirstName: null, subjectPersonLastName: null, subjectPersonCompany: null, subjectCompanyName: null,
    bdId: "bd-ana", bdEmail: ANA.bdEmail, bdName: ANA.bdName,
  };
  const plan = planTenderDigest([tender("9", 10)], EVERYONE, NOW);
  const recipients = buildDigestRecipients(groupDigestTaskRowsByBd([taskRow]), new Map(), plan);
  assert.deepEqual([...recipients.keys()].sort(), ["bd-ana", "bd-luis"]);
  assert.equal(recipients.get("bd-ana")!.tasks.length, 1);
  assert.equal(recipients.get("bd-luis")!.tasks.length, 0);
});
