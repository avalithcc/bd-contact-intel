/**
 * Unit tests for src/lib/identity/merge.ts — the pure merge/unmerge planner
 * (Phase 6 tasks 6.1-6.4; design.md D6, contact-identity R7,
 * duplicate-review spec). Pure planning only; the thin DB layer
 * (./mergeDb.ts) is not unit-tested here (same convention as
 * resolve.ts/resolveDb.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailMessagePersonKey,
  followUpQueueItemKey,
  parseMergeSnapshot,
  planMerge,
  planUnmerge,
  type EmailMessagePersonRow,
  type FollowUpQueueItemRow,
  type MergeConnection,
  type MergeDuplicateCandidateRow,
  type MergeIdMapRow,
  type MergePersonFields,
  type MergeReferenceRow,
  type PlanMergeInput,
} from "@/lib/identity/merge";

// Non-null by default so fixtures exercise Date (de)serialization across the
// snapshot boundary instead of always taking the "both null" shortcut.
const DEFAULT_FIRST_MESSAGE_AT = new Date("2023-01-01T00:00:00.000Z");
const DEFAULT_LAST_MESSAGE_AT = new Date("2023-06-01T00:00:00.000Z");

function person(overrides: Partial<MergePersonFields> & { id: string }): MergePersonFields {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    phone: null,
    mobilePhone: null,
    company: "Acme",
    companyKey: "acme",
    companyCategory: null,
    jobTitle: null,
    roleGroup: null,
    seniority: null,
    industry: null,
    city: null,
    region: null,
    country: null,
    ownerBdId: null,
    sourceKey: "csv",
    ...overrides,
  };
}

function connection(overrides: Partial<MergeConnection> & { personId: string; bdId: string }): MergeConnection {
  return {
    connectedOn: null,
    legacyContactId: null,
    messageCount: 0,
    sentCount: 0,
    receivedCount: 0,
    firstMessageAt: DEFAULT_FIRST_MESSAGE_AT,
    lastMessageAt: DEFAULT_LAST_MESSAGE_AT,
    initiatedByMe: null,
    reciprocal: false,
    ...overrides,
  };
}

const DEFAULT_LAST_TOUCH_AT = new Date("2023-02-01T00:00:00.000Z");
const DEFAULT_CREATED_AT = new Date("2023-01-15T00:00:00.000Z");
const DEFAULT_UPDATED_AT = new Date("2023-01-16T00:00:00.000Z");

function emailMessagePersonRow(overrides: Partial<EmailMessagePersonRow> & { id: string; emailMessageId: string; personId: string }): EmailMessagePersonRow {
  return {
    matchedEmail: "a@x.com",
    matchConfidence: "inferred",
    ...overrides,
  };
}

function queueItemRow(overrides: Partial<FollowUpQueueItemRow> & { id: string; bdId: string; queueDate: string; personId: string }): FollowUpQueueItemRow {
  return {
    position: 1,
    dueStatus: "contacted",
    lastTouchAt: DEFAULT_LAST_TOUCH_AT,
    state: "pending",
    snoozedUntil: null,
    createdAt: DEFAULT_CREATED_AT,
    updatedAt: DEFAULT_UPDATED_AT,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PlanMergeInput> = {}): PlanMergeInput {
  return {
    survivor: person({ id: "survivor" }),
    merged: person({ id: "merged" }),
    survivorConnections: [],
    mergedConnections: [],
    referencesOnMerged: [],
    idMapRowsOnMerged: [],
    duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [],
    emailMessagePersonRowsOnMerged: [],
    survivorEmailMessagePersonRows: [],
    queueItemRowsOnMerged: [],
    survivorQueueItemRows: [],
    ...overrides,
  };
}

test("planMerge: richer/more specific property wins, loser recorded", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", jobTitle: "VP" }),
    merged: person({ id: "merged", jobTitle: "VP of Engineering" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.survivorUpdate.jobTitle, "VP of Engineering");
  assert.deepEqual(
    plan.snapshot.propertyLosses.find((l) => l.property === "jobTitle"),
    { property: "jobTitle", value: "VP" },
  );
});

test("planMerge: verified email wins over probable, ties recorded as loss", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", email: "a@x.com", emailNormalized: "a@x.com", emailStatus: "probable" }),
    merged: person({ id: "merged", email: "b@x.com", emailNormalized: "b@x.com", emailStatus: "verified" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.survivorUpdate.email, "b@x.com");
  assert.equal(plan.survivorUpdate.emailStatus, "verified");
  assert.deepEqual(
    plan.snapshot.propertyLosses.find((l) => l.property === "email"),
    { property: "email", value: "a@x.com" },
  );
});

test("planMerge: owner is the earliest connector across both persons", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", ownerBdId: "bd-old" }),
    merged: person({ id: "merged", ownerBdId: "bd-lead" }),
    survivorConnections: [connection({ personId: "survivor", bdId: "bd-old", connectedOn: "10 Mar 2022" })],
    mergedConnections: [connection({ personId: "merged", bdId: "bd-early", connectedOn: "1 Jan 2020" })],
  });
  const plan = planMerge(input);
  assert.equal(plan.ownerBdId, "bd-early");
});

test("planMerge: no parseable connection falls back to the lead's existing owner", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", ownerBdId: null }),
    merged: person({ id: "merged", ownerBdId: "bd-lead" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.ownerBdId, "bd-lead");
});

test("planMerge: connections unique to merged are repointed, same-BD ones are aggregated (not dropped)", () => {
  const input = baseInput({
    survivorConnections: [
      connection({ personId: "survivor", bdId: "bd-1", messageCount: 3, sentCount: 1, receivedCount: 2, connectedOn: "10 Mar 2022" }),
    ],
    mergedConnections: [
      connection({ personId: "merged", bdId: "bd-1", messageCount: 5, sentCount: 2, receivedCount: 3, connectedOn: "1 Jan 2020" }),
      connection({ personId: "merged", bdId: "bd-2", messageCount: 2 }),
    ],
  });
  const plan = planMerge(input);
  assert.equal(plan.connectionsToRepoint.length, 1);
  assert.equal(plan.connectionsToRepoint[0].bdId, "bd-2");
  assert.equal(plan.connectionsToRepoint[0].personId, "survivor");

  assert.equal(plan.connectionConflicts.length, 1);
  const conflict = plan.connectionConflicts[0];
  assert.equal(conflict.bdId, "bd-1");
  assert.equal(conflict.aggregated.messageCount, 8);
  assert.equal(conflict.aggregated.sentCount, 3);
  assert.equal(conflict.aggregated.receivedCount, 5);
  assert.equal(conflict.aggregated.connectedOn, "1 Jan 2020"); // earliest wins
  assert.equal(conflict.aggregated.personId, "survivor");
  assert.deepEqual(conflict.survivorOriginal, input.survivorConnections[0]);
  assert.deepEqual(conflict.mergedOriginal, input.mergedConnections[0]);
});

test("planMerge: references and id-map rows on merged are all repointed", () => {
  const references: MergeReferenceRow[] = [
    { table: "activity", id: "act-1" },
    { table: "task", id: "task-1" },
  ];
  const idMapRows: MergeIdMapRow[] = [{ legacyTable: "lead", legacyId: "lead-1" }];
  const plan = planMerge(baseInput({ referencesOnMerged: references, idMapRowsOnMerged: idMapRows }));
  assert.deepEqual(plan.referencesToRepoint, references);
  assert.deepEqual(plan.idMapRowsToRepoint, idMapRows);
});

test("planMerge: the (survivor, merged) candidate pair is marked merged, not repointed", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-1", personAId: "merged", personBId: "survivor", status: "open" },
  ];
  const plan = planMerge(baseInput({ duplicateCandidatesInvolvingMerged: candidates }));
  assert.equal(plan.duplicateCandidateToMarkMerged, "cand-1");
  assert.equal(plan.duplicateCandidatesToRepoint.length, 0);
});

test("planMerge: a pair with a third person repoints to (survivor, third)", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-2", personAId: "merged", personBId: "third", status: "open" },
  ];
  const plan = planMerge(baseInput({ duplicateCandidatesInvolvingMerged: candidates }));
  assert.equal(plan.duplicateCandidatesToRepoint.length, 1);
  const [a, b] = ["survivor", "third"].sort();
  assert.deepEqual(plan.duplicateCandidatesToRepoint[0], { id: "cand-2", personAId: a, personBId: b });
});

test("planMerge: a repoint that collides with an existing survivor pair is dropped instead", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-3", personAId: "merged", personBId: "third", status: "open" },
  ];
  const plan = planMerge(
    baseInput({ duplicateCandidatesInvolvingMerged: candidates, survivorPairedPersonIds: ["third"] }),
  );
  assert.equal(plan.duplicateCandidatesToRepoint.length, 0);
  assert.deepEqual(plan.duplicateCandidatesToDrop, ["cand-3"]);
});

// --- parseMergeSnapshot: safe revival of a jsonb-round-tripped snapshot ---

test("parseMergeSnapshot: throws a clear error on an invalid snapshot", () => {
  assert.throws(() => parseMergeSnapshot(null), /Invalid merge snapshot/);
  assert.throws(() => parseMergeSnapshot(undefined), /Invalid merge snapshot/);
  assert.throws(() => parseMergeSnapshot("nope"), /Invalid merge snapshot/);
  assert.throws(() => parseMergeSnapshot({}), /Invalid merge snapshot/);
  assert.throws(() => parseMergeSnapshot({ merged: {} }), /Invalid merge snapshot/);
});

test("parseMergeSnapshot: round-trips through JSON, reviving Date fields on a same-BD conflict's survivorOriginal", () => {
  const survivor = person({ id: "survivor" });
  const merged = person({ id: "merged" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-0" })]; // unrelated bdId, no conflict
  const mergedConnections = [connection({ personId: "merged", bdId: "bd-0" }), connection({ personId: "merged", bdId: "bd-1" })];
  const mergePlan = planMerge(baseInput({ survivor, merged, survivorConnections, mergedConnections }));
  assert.deepEqual(mergePlan.snapshot.movedConnectionBdIds, ["bd-1"]);

  const roundTripped = JSON.parse(JSON.stringify(mergePlan.snapshot));
  // jsonb round-trip turns Dates into ISO strings.
  assert.equal(typeof roundTripped.connectionConflicts[0].survivorOriginal.firstMessageAt, "string");

  const parsed = parseMergeSnapshot(roundTripped);
  const survivorOriginal = parsed.connectionConflicts[0].survivorOriginal;
  assert.ok(survivorOriginal.firstMessageAt instanceof Date);
  assert.equal(survivorOriginal.firstMessageAt?.getTime(), DEFAULT_FIRST_MESSAGE_AT.getTime());
  assert.ok(survivorOriginal.lastMessageAt instanceof Date);
  assert.equal(survivorOriginal.lastMessageAt?.getTime(), DEFAULT_LAST_MESSAGE_AT.getTime());
});

test("parseMergeSnapshot: revives Date fields inside connectionConflicts (survivorOriginal/mergedOriginal/aggregated)", () => {
  const survivor = person({ id: "survivor" });
  const merged = person({ id: "merged" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-1" })];
  const mergedConnections = [connection({ personId: "merged", bdId: "bd-1" })];
  const mergePlan = planMerge(baseInput({ survivor, merged, survivorConnections, mergedConnections }));

  const parsed = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const conflict = parsed.connectionConflicts[0];
  assert.ok(conflict.survivorOriginal.firstMessageAt instanceof Date);
  assert.ok(conflict.mergedOriginal.lastMessageAt instanceof Date);
  assert.ok(conflict.aggregated.firstMessageAt instanceof Date);
  assert.equal(conflict.aggregated.lastMessageAt?.getTime(), DEFAULT_LAST_MESSAGE_AT.getTime());
});

test("6.4: false merge then unmerge restores both original Contacts exactly (no intervening change)", () => {
  const survivor = person({ id: "survivor", jobTitle: "VP", ownerBdId: "bd-old" });
  const merged = person({ id: "merged", jobTitle: "VP of Engineering", ownerBdId: "bd-lead" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-old", connectedOn: "10 Mar 2022" })];
  const mergedConnections = [
    connection({ personId: "merged", bdId: "bd-early", connectedOn: "1 Jan 2020", messageCount: 3 }),
  ];
  const references: MergeReferenceRow[] = [{ table: "activity", id: "act-1" }];
  const idMapRows: MergeIdMapRow[] = [{ legacyTable: "lead", legacyId: "lead-1" }];
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-1", personAId: "merged", personBId: "survivor", status: "open" },
  ];

  const input = baseInput({
    survivor,
    merged,
    survivorConnections,
    mergedConnections,
    referencesOnMerged: references,
    idMapRowsOnMerged: idMapRows,
    duplicateCandidatesInvolvingMerged: candidates,
  });

  const mergePlan = planMerge(input);
  // Nothing changed since the merge: current survivor state == what the merge wrote.
  const currentSurvivor: MergePersonFields = { id: "survivor", ...mergePlan.survivorUpdate };
  // Route through a jsonb round-trip + parseMergeSnapshot, same as the real
  // unmerge path (merge_event.snapshot is jsonb — Dates come back as strings).
  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, { currentSurvivor, currentSurvivorConnections: [] });

  // Every changed field reverts exactly to its pre-merge value.
  assert.equal(unmergePlan.survivorFieldsKept.length, 0);
  const revertedFields = Object.fromEntries(unmergePlan.survivorFieldReverts.map((r) => [r.field, r.to]));
  assert.equal(revertedFields.jobTitle, "VP");
  assert.equal(revertedFields.roleGroup, survivor.roleGroup);
  assert.equal(revertedFields.ownerBdId, "bd-old");

  assert.deepEqual(unmergePlan.mergedRestore, merged);
  assert.deepEqual(unmergePlan.movedConnectionBdIdsBack, ["bd-early"]);
  assert.deepEqual(unmergePlan.referencesToRepointBack, references);
  assert.deepEqual(unmergePlan.idMapRowsToRepointBack, idMapRows);
  assert.deepEqual(unmergePlan.mergedPairCandidateToReopen, { id: "cand-1", originalStatus: "open" });
});

test("safe unmerge: a survivor field edited after the merge is kept, not reverted", () => {
  const survivor = person({ id: "survivor", jobTitle: "VP" });
  const merged = person({ id: "merged", jobTitle: "VP of Engineering" });
  const mergePlan = planMerge(baseInput({ survivor, merged }));

  // A manual edit after the merge changed jobTitle again.
  const currentSurvivor: MergePersonFields = { id: "survivor", ...mergePlan.survivorUpdate, jobTitle: "CTO" };
  const unmergePlan = planUnmerge(mergePlan.snapshot, { currentSurvivor, currentSurvivorConnections: [] });

  assert.equal(unmergePlan.survivorFieldReverts.some((r) => r.field === "jobTitle"), false);
  const kept = unmergePlan.survivorFieldsKept.find((k) => k.field === "jobTitle");
  assert.deepEqual(kept, { field: "jobTitle", currentValue: "CTO" });
});

test("safe unmerge: merge A, merge B into same survivor, unmerge A keeps B's contribution and a manual edit", () => {
  const survivor = person({ id: "survivor", jobTitle: "VP", company: "Acme" });
  const mergedA = person({ id: "merged-a", jobTitle: "VP of Engineering" });
  const planA = planMerge(baseInput({ survivor, merged: mergedA }));
  const survivorAfterA: MergePersonFields = { id: "survivor", ...planA.survivorUpdate };

  const mergedB = person({ id: "merged-b", company: "Globex" });
  const planB = planMerge(baseInput({ survivor: survivorAfterA, merged: mergedB }));
  const survivorAfterB: MergePersonFields = { id: "survivor", ...planB.survivorUpdate, jobTitle: "CTO" }; // + manual edit

  const unmergeA = planUnmerge(planA.snapshot, { currentSurvivor: survivorAfterB, currentSurvivorConnections: [] });

  // jobTitle was changed again after merge A (by the manual edit) -> kept, not reverted to "VP".
  assert.equal(unmergeA.survivorFieldReverts.some((r) => r.field === "jobTitle"), false);
  assert.ok(unmergeA.survivorFieldsKept.some((k) => k.field === "jobTitle" && k.currentValue === "CTO"));
});

test("safe unmerge: a moved connection with post-merge activity returns to merged with its current values", () => {
  const survivor = person({ id: "survivor" });
  const merged = person({ id: "merged" });
  const mergedConnections = [connection({ personId: "merged", bdId: "bd-1", messageCount: 2 })];
  const mergePlan = planMerge(baseInput({ survivor, merged, mergedConnections }));

  // More messages arrived on bd-1 after the merge (now sitting under survivor).
  const currentSurvivorConnections = [connection({ personId: "survivor", bdId: "bd-1", messageCount: 9 })];
  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections,
  });

  assert.deepEqual(unmergePlan.movedConnectionBdIdsBack, ["bd-1"]);
  assert.deepEqual(unmergePlan.movedConnectionsKeptOnSurvivor, []);
  // The plan only says WHICH bdIds move back; the DB layer repoints person_id
  // while keeping the row's CURRENT values (messageCount 9), never a snapshot.
});

test("safe unmerge: chained same-BD merge — a later merge's conflict on the same bdId keeps the row on the survivor", () => {
  const survivor = person({ id: "survivor" });
  const mergedA = person({ id: "merged-a" });
  const mergedAConnections = [connection({ personId: "merged-a", bdId: "bd-1", messageCount: 2 })];
  const planA = planMerge(baseInput({ survivor, merged: mergedA, mergedConnections: mergedAConnections }));

  // Merge A moved bd-1 onto survivor cleanly (no conflict yet).
  assert.deepEqual(planA.snapshot.movedConnectionBdIds, ["bd-1"]);
  assert.deepEqual(planA.snapshot.movedConnectionOriginals, mergedAConnections);

  const survivorAfterA: MergePersonFields = { id: "survivor", ...planA.survivorUpdate };

  const snapshotA = parseMergeSnapshot(JSON.parse(JSON.stringify(planA.snapshot)));

  // Unmerging A: the orchestrator (mergeDb) discovered a LATER merge_event on
  // this survivor recorded a same-BD conflict for bd-1 (merge C aggregated
  // onto the row A moved). The row must stay on the survivor, not follow A.
  const unmergeA = planUnmerge(snapshotA, {
    currentSurvivor: survivorAfterA,
    currentSurvivorConnections: [],
    laterConflictBdIds: ["bd-1"],
  });

  assert.deepEqual(unmergeA.movedConnectionBdIdsBack, []);
  assert.equal(unmergeA.movedConnectionsKeptOnSurvivor.length, 1);
  assert.equal(unmergeA.movedConnectionsKeptOnSurvivor[0].bdId, "bd-1");
  assert.deepEqual(unmergeA.movedConnectionsKeptOnSurvivor[0].mergedRestore, mergedAConnections[0]);
});

test("safe unmerge: same-BD conflict aggregation — unchanged survivor row reverts both originals", () => {
  const survivor = person({ id: "survivor" });
  const merged = person({ id: "merged" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-1", messageCount: 3 })];
  const mergedConnections = [connection({ personId: "merged", bdId: "bd-1", messageCount: 5 })];
  const mergePlan = planMerge(baseInput({ survivor, merged, survivorConnections, mergedConnections }));
  const conflict = mergePlan.connectionConflicts[0];

  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [conflict.aggregated], // untouched since the merge
  });

  const restore = unmergePlan.connectionConflictRestores[0];
  assert.equal(restore.kind, "reverted");
  assert.deepEqual(restore.survivorRestore, survivorConnections[0]);
  assert.deepEqual(restore.mergedRestore, mergedConnections[0]);
  assert.ok(restore.survivorRestore?.firstMessageAt instanceof Date);
});

test("safe unmerge: same-BD conflict aggregation — changed survivor row is kept, merged's original still restored", () => {
  const survivor = person({ id: "survivor" });
  const merged = person({ id: "merged" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-1", messageCount: 3 })];
  const mergedConnections = [connection({ personId: "merged", bdId: "bd-1", messageCount: 5 })];
  const mergePlan = planMerge(baseInput({ survivor, merged, survivorConnections, mergedConnections }));

  // More activity landed on the aggregated row after the merge.
  const changedCurrent = connection({ personId: "survivor", bdId: "bd-1", messageCount: 42 });
  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [changedCurrent],
  });

  const restore = unmergePlan.connectionConflictRestores[0];
  assert.equal(restore.kind, "kept_changed");
  assert.equal(restore.survivorRestore, null);
  assert.deepEqual(restore.mergedRestore, mergedConnections[0]);
});

// --- Bugfix: merge repointing gap for email_message_person / follow_up_queue_item ---

test("key builders: emailMessagePersonKey/followUpQueueItemKey are the single source of truth for their maps' keys", () => {
  assert.equal(emailMessagePersonKey({ emailMessageId: "msg-1" }), "msg-1");
  assert.equal(followUpQueueItemKey({ bdId: "bd-1", queueDate: "2026-01-05" }), "bd-1:2026-01-05");
});

test("planMerge: email_message_person rows unique to merged are repointed, survivor's are left alone", () => {
  const rows = [emailMessagePersonRow({ id: "emp-1", emailMessageId: "msg-1", personId: "merged" })];
  const plan = planMerge(baseInput({ emailMessagePersonRowsOnMerged: rows }));
  assert.deepEqual(plan.emailMessagePersonRowsToRepoint, [{ id: "emp-1" }]);
  assert.equal(plan.emailMessagePersonCollisions.length, 0);
  assert.deepEqual(plan.snapshot.movedEmailMessagePersonIds, ["emp-1"]);
});

test("planMerge: email_message_person collision — merged's exact confidence beats survivor's inferred, moves together with its own address", () => {
  const mergedRow = emailMessagePersonRow({ id: "emp-merged", emailMessageId: "msg-1", personId: "merged", matchedEmail: "exact@x.com", matchConfidence: "exact" });
  const survivorRow = emailMessagePersonRow({ id: "emp-survivor", emailMessageId: "msg-1", personId: "survivor", matchedEmail: "guess@x.com", matchConfidence: "inferred" });
  const plan = planMerge(
    baseInput({ emailMessagePersonRowsOnMerged: [mergedRow], survivorEmailMessagePersonRows: [survivorRow] }),
  );
  assert.equal(plan.emailMessagePersonRowsToRepoint.length, 0);
  assert.equal(plan.emailMessagePersonCollisions.length, 1);
  const collision = plan.emailMessagePersonCollisions[0];
  assert.deepEqual(collision.winner, { matchedEmail: "exact@x.com", matchConfidence: "exact" });
  assert.deepEqual(collision.survivorOriginal, survivorRow);
  assert.deepEqual(collision.mergedOriginal, mergedRow);
});

test("planMerge: email_message_person collision — both inferred (tie) keeps survivor's own row untouched", () => {
  const mergedRow = emailMessagePersonRow({ id: "emp-merged", emailMessageId: "msg-1", personId: "merged", matchedEmail: "other@x.com", matchConfidence: "inferred" });
  const survivorRow = emailMessagePersonRow({ id: "emp-survivor", emailMessageId: "msg-1", personId: "survivor", matchedEmail: "guess@x.com", matchConfidence: "inferred" });
  const plan = planMerge(
    baseInput({ emailMessagePersonRowsOnMerged: [mergedRow], survivorEmailMessagePersonRows: [survivorRow] }),
  );
  const collision = plan.emailMessagePersonCollisions[0];
  assert.deepEqual(collision.winner, { matchedEmail: "guess@x.com", matchConfidence: "inferred" });
});

test("planMerge: follow_up_queue_item rows unique to merged are repointed", () => {
  const rows = [queueItemRow({ id: "q-1", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged" })];
  const plan = planMerge(baseInput({ queueItemRowsOnMerged: rows }));
  assert.deepEqual(plan.queueItemRowsToRepoint, [{ id: "q-1" }]);
  assert.equal(plan.queueItemCollisions.length, 0);
  assert.deepEqual(plan.snapshot.movedQueueItemIds, ["q-1"]);
});

test("planMerge: follow_up_queue_item collision — merged's decided state wins over survivor's still-pending row", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped", snoozedUntil: "2026-01-06" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "pending", snoozedUntil: null });
  const plan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));
  assert.equal(plan.queueItemRowsToRepoint.length, 0);
  const collision = plan.queueItemCollisions[0];
  assert.deepEqual(collision.winner, { state: "skipped", snoozedUntil: "2026-01-06" });
  assert.deepEqual(collision.survivorOriginal, survivorRow);
  assert.deepEqual(collision.mergedOriginal, mergedRow);
});

test("planMerge: follow_up_queue_item collision — a decided state is never resurrected as pending", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "pending" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "postponed", snoozedUntil: "2026-01-06" });
  const plan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));
  const collision = plan.queueItemCollisions[0];
  assert.deepEqual(collision.winner, { state: "postponed", snoozedUntil: "2026-01-06" });
});

test("planMerge: follow_up_queue_item collision — both already decided keeps survivor's own decision", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped", snoozedUntil: "2026-01-06" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "postponed", snoozedUntil: "2026-01-06" });
  const plan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));
  const collision = plan.queueItemCollisions[0];
  assert.deepEqual(collision.winner, { state: "postponed", snoozedUntil: "2026-01-06" });
});

test("planMerge: pure — never mutates its inputs, same input twice gives the same result", () => {
  const input = baseInput({
    survivorConnections: [connection({ personId: "survivor", bdId: "bd-1", messageCount: 3 })],
    mergedConnections: [connection({ personId: "merged", bdId: "bd-1", messageCount: 5 }), connection({ personId: "merged", bdId: "bd-2" })],
    emailMessagePersonRowsOnMerged: [emailMessagePersonRow({ id: "emp-1", emailMessageId: "msg-1", personId: "merged", matchConfidence: "exact" })],
    survivorEmailMessagePersonRows: [emailMessagePersonRow({ id: "emp-2", emailMessageId: "msg-1", personId: "survivor" })],
    queueItemRowsOnMerged: [queueItemRow({ id: "q-1", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped" })],
    survivorQueueItemRows: [queueItemRow({ id: "q-2", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor" })],
  });
  const snapshotBefore = JSON.stringify(input);
  const first = planMerge(input);
  const second = planMerge(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), snapshotBefore, "planMerge must never mutate its input");
});

test("safe unmerge: email_message_person collision unchanged since merge — reverts survivor's row and re-inserts merged's dropped row", () => {
  const mergedRow = emailMessagePersonRow({ id: "emp-merged", emailMessageId: "msg-1", personId: "merged", matchedEmail: "exact@x.com", matchConfidence: "exact" });
  const survivorRow = emailMessagePersonRow({ id: "emp-survivor", emailMessageId: "msg-1", personId: "survivor", matchedEmail: "guess@x.com", matchConfidence: "inferred" });
  const mergePlan = planMerge(baseInput({ emailMessagePersonRowsOnMerged: [mergedRow], survivorEmailMessagePersonRows: [survivorRow] }));

  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [],
    // Nothing touched survivor's row since the merge: it still shows the winner (exact) values.
    currentSurvivorEmailMessagePersonRows: [{ ...survivorRow, id: "emp-survivor", matchedEmail: "exact@x.com", matchConfidence: "exact" }],
  });

  assert.equal(unmergePlan.emailMessagePersonRestores.length, 1);
  const restore = unmergePlan.emailMessagePersonRestores[0];
  assert.deepEqual(restore.mergedOriginal, mergedRow);
  assert.deepEqual(restore.survivorRevert, { id: "emp-survivor", matchedEmail: "guess@x.com", matchConfidence: "inferred" });
});

test("safe unmerge: email_message_person collision changed since merge (e.g. a later merge) — survivor's row is kept, merged's is still restored", () => {
  const mergedRow = emailMessagePersonRow({ id: "emp-merged", emailMessageId: "msg-1", personId: "merged", matchedEmail: "exact@x.com", matchConfidence: "exact" });
  const survivorRow = emailMessagePersonRow({ id: "emp-survivor", emailMessageId: "msg-1", personId: "survivor", matchedEmail: "guess@x.com", matchConfidence: "inferred" });
  const mergePlan = planMerge(baseInput({ emailMessagePersonRowsOnMerged: [mergedRow], survivorEmailMessagePersonRows: [survivorRow] }));

  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [],
    // A later merge changed it again since.
    currentSurvivorEmailMessagePersonRows: [{ id: "emp-survivor", emailMessageId: "msg-1", personId: "survivor", matchedEmail: "third@x.com", matchConfidence: "exact" }],
  });

  const restore = unmergePlan.emailMessagePersonRestores[0];
  assert.deepEqual(restore.mergedOriginal, mergedRow);
  assert.equal(restore.survivorRevert, null);
});

test("safe unmerge: email_message_person — no collision at merge time needs no revert, just repoint-back by id", () => {
  const rows = [emailMessagePersonRow({ id: "emp-1", emailMessageId: "msg-1", personId: "merged" })];
  const mergePlan = planMerge(baseInput({ emailMessagePersonRowsOnMerged: rows }));
  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [],
  });
  assert.deepEqual(unmergePlan.emailMessagePersonIdsToRepointBack, ["emp-1"]);
  assert.deepEqual(unmergePlan.emailMessagePersonRestores, []);
});

test("safe unmerge: follow_up_queue_item collision unchanged since merge — reverts survivor's row and re-inserts merged's dropped row", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped", snoozedUntil: "2026-01-06" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "pending", snoozedUntil: null });
  const mergePlan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));

  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [],
    currentSurvivorQueueItemRows: [{ ...survivorRow, state: "skipped", snoozedUntil: "2026-01-06" }],
  });

  assert.equal(unmergePlan.queueItemRestores.length, 1);
  const restore = unmergePlan.queueItemRestores[0];
  assert.deepEqual(restore.mergedOriginal, mergedRow);
  assert.deepEqual(restore.survivorRevert, { id: "q-survivor", state: "pending", snoozedUntil: null });
});

test("safe unmerge: follow_up_queue_item collision changed since merge (BD skipped again after) — kept, merged's original still restored", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped", snoozedUntil: "2026-01-06" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "pending", snoozedUntil: null });
  const mergePlan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));

  const snapshot = parseMergeSnapshot(JSON.parse(JSON.stringify(mergePlan.snapshot)));
  const unmergePlan = planUnmerge(snapshot, {
    currentSurvivor: { id: "survivor", ...mergePlan.survivorUpdate },
    currentSurvivorConnections: [],
    // The BD postponed it again after the merge -- not the same value the merge wrote.
    currentSurvivorQueueItemRows: [{ ...survivorRow, state: "postponed", snoozedUntil: "2026-01-07" }],
  });

  const restore = unmergePlan.queueItemRestores[0];
  assert.deepEqual(restore.mergedOriginal, mergedRow);
  assert.equal(restore.survivorRevert, null);
});

test("parseMergeSnapshot: round-trips follow_up_queue_item collisions, reviving lastTouchAt/createdAt/updatedAt as Dates", () => {
  const mergedRow = queueItemRow({ id: "q-merged", bdId: "bd-1", queueDate: "2026-01-05", personId: "merged", state: "skipped", snoozedUntil: "2026-01-06" });
  const survivorRow = queueItemRow({ id: "q-survivor", bdId: "bd-1", queueDate: "2026-01-05", personId: "survivor", state: "pending", snoozedUntil: null });
  const mergePlan = planMerge(baseInput({ queueItemRowsOnMerged: [mergedRow], survivorQueueItemRows: [survivorRow] }));

  const roundTripped = JSON.parse(JSON.stringify(mergePlan.snapshot));
  assert.equal(typeof roundTripped.queueItemCollisions[0].mergedOriginal.lastTouchAt, "string");

  const parsed = parseMergeSnapshot(roundTripped);
  const collision = parsed.queueItemCollisions[0];
  assert.ok(collision.mergedOriginal.lastTouchAt instanceof Date);
  assert.ok(collision.mergedOriginal.createdAt instanceof Date);
  assert.ok(collision.mergedOriginal.updatedAt instanceof Date);
  assert.equal(collision.mergedOriginal.lastTouchAt.getTime(), DEFAULT_LAST_TOUCH_AT.getTime());
});
