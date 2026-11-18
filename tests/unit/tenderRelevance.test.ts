/**
 * Tender relevance without a database or a gateway: the effective value (a human beats the model, no verdict is shown),
 * which rows are worth a model call, the answer parser, the failure path, and the pure planner.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { generateText } from "ai";
import { tenderRelevance } from "@/lib/tenders/relevance";
import { CLASSIFY_CAP, classifyTenders, parseVerdicts, tendersToClassify } from "@/lib/tenders/classify";
import { indexTendersByKey, planTenderImport, type StoredTender } from "@/lib/tenders/plan";
import { tenderKey, type TenderInput } from "@/lib/tenders/parse";

const input = (n: string, name = `Tender ${n}`): TenderInput => ({
  processNumber: n,
  fileNumber: "",
  name,
  processType: "",
  openingAt: new Date("2026-12-09T13:00:00Z"),
  portalStatus: "",
  executingUnit: "",
  financialAdminService: "",
});

const stored = (n: string, over: Partial<StoredTender> = {}): StoredTender => ({ ...input(n), id: `id-${n}`, aiRelevant: null, relevanceOverride: null, ...over });

const fakeGenerate = (text: string, finishReason = "stop") => (async () => ({ text, finishReason })) as unknown as typeof generateText;

test("a human override beats the model, in both directions", () => {
  assert.deepEqual(tenderRelevance({ aiRelevant: false, aiReason: "equipamiento", relevanceOverride: true }), { state: "relevant", source: "human", reason: "equipamiento" });
  assert.equal(tenderRelevance({ aiRelevant: true, aiReason: "software", relevanceOverride: false }).state, "irrelevant");
  assert.equal(tenderRelevance({ aiRelevant: false, aiReason: "x", relevanceOverride: null }).state, "irrelevant");
});

test("a tender nobody classified is unclassified, which the list shows", () => {
  assert.deepEqual(tenderRelevance({ aiRelevant: null, aiReason: null, relevanceOverride: null }), { state: "unclassified", source: "none", reason: null });
});

test("only rows that need a verdict are sent to the model: new, renamed, or never classified; never a human-decided row", () => {
  const existing = indexTendersByKey<StoredTender>([
    stored("DONE", { aiRelevant: true }),
    stored("NEVER"),
    stored("RENAMED", { aiRelevant: false }),
    stored("HUMAN", { relevanceOverride: false }),
  ]);
  const incoming = [input("DONE"), input("NEVER"), input("RENAMED", "A new title"), input("HUMAN", "Another title"), input("BRAND-NEW")];
  assert.deepEqual(tendersToClassify(incoming, existing).map((t) => t.processNumber), ["NEVER", "RENAMED", "BRAND-NEW"]);
});

test("a file bigger than the cap sends only the cap and leaves the rest unclassified for the next import", () => {
  const incoming = Array.from({ length: CLASSIFY_CAP + 5 }, (_, i) => input(`N-${i}`));
  assert.equal(tendersToClassify(incoming, new Map()).length, CLASSIFY_CAP);
});

test("the parser reads the model's JSON, a fenced one too, and ignores rows it cannot trust", () => {
  const text = '```json\n[{"n":1,"relevant":true,"reason":"Software ERP"},{"n":2,"relevant":false,"reason":"Drenaje"},{"n":9,"relevant":true,"reason":"out of range"},{"n":3,"relevant":"yes","reason":"bad type"},{"n":4,"relevant":true}]\n```';
  const parsed = parseVerdicts(text, 4);
  assert.deepEqual([...parsed.entries()], [
    [1, { relevant: true, reason: "Software ERP" }],
    [2, { relevant: false, reason: "Drenaje" }],
  ]);
  assert.equal(parseVerdicts("not json at all", 3).size, 0);
});

test("classifyTenders maps verdicts to the tender key and survives a model failure with no verdicts and no throw", async () => {
  const items = [input("A-1"), input("B-2")];
  const ok = await classifyTenders(items, fakeGenerate('[{"n":1,"relevant":true,"reason":"Software"},{"n":2,"relevant":false,"reason":"Obra"}]'));
  assert.deepEqual(ok.get(tenderKey("A-1")), { relevant: true, reason: "Software" });
  assert.equal(ok.get(tenderKey("B-2"))?.relevant, false);

  const boom = (async () => {
    throw new Error("gateway down");
  }) as unknown as typeof generateText;
  assert.equal((await classifyTenders(items, boom)).size, 0);
  assert.equal((await classifyTenders(items, fakeGenerate("[]", "length"))).size, 0);
  assert.equal((await classifyTenders(items, fakeGenerate("garbage"))).size, 0);
});

test("the planner never mutates its inputs: twice with the same input gives the same plan, and a verdict-only row is planned", () => {
  const incoming = [input("A-1"), input("B-2"), input("C-3", "Changed")];
  const existing = indexTendersByKey<StoredTender>([stored("B-2"), stored("C-3")]);
  const verdicts = new Map([[tenderKey("B-2"), { relevant: true, reason: "Software" }]]);
  const snapshot = JSON.stringify({ incoming, existing: [...existing.entries()], verdicts: [...verdicts.entries()] });
  const first = planTenderImport(incoming, existing, verdicts);
  const second = planTenderImport(incoming, existing, verdicts);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ incoming, existing: [...existing.entries()], verdicts: [...verdicts.entries()] }), snapshot);
  assert.deepEqual(first.create.map((t) => t.processNumber), ["A-1"]);
  assert.deepEqual(first.update.map((t) => t.processNumber), ["C-3"]);
  assert.deepEqual(first.verdictOnly.map((t) => t.processNumber), ["B-2"]);
});
