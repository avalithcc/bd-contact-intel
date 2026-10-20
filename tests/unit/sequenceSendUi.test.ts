/**
 * What the Sequence screen tells the BD after "Enviar ahora": the outcome of the immediate release in plain terms, with the
 * daily-cap case said clearly ("Supera el tope diario: saldrá en el próximo envío disponible").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseToast, sendRecipients } from "@/lib/sequences/sendUi";

const o = (released: number, deferred = 0, held = 0, failed = 0, lost = 0) => ({ released, deferred, held, failed, lost });

test("everything went out", () => {
  assert.deepEqual(releaseToast(o(1), 1), { key: "sentNow", tone: "success" });
  assert.deepEqual(releaseToast(o(3), 3), { key: "sentNowMany", n: 3, tone: "success" });
});

test("the daily cap held some back: say it, with how many left and how many wait", () => {
  assert.deepEqual(releaseToast(o(0, 1), 1), { key: "capDeferred", tone: "success" });
  assert.deepEqual(releaseToast(o(5, 2), 7), { key: "capDeferredMany", sent: 5, n: 2, tone: "success" });
});

test("a pre-send check held it: approved, with the reason on the card", () => {
  assert.deepEqual(releaseToast(o(0, 0, 1), 1), { key: "held", tone: "success" });
});

test("a failed send is an error toast", () => {
  assert.deepEqual(releaseToast(o(0, 0, 0, 1), 1), { key: "failed", tone: "error" });
});

test("nothing left and nothing was held, deferred or failed: it is queued, never 'sent'", () => {
  assert.deepEqual(releaseToast(o(0), 1), { key: "pending", tone: "success" });
  assert.deepEqual(releaseToast(o(0, 0, 0, 0, 1), 1), { key: "pending", tone: "success" }); // lost the claim to a concurrent run
});

test("some sent and some queued behind another run: say how many actually left", () => {
  assert.deepEqual(releaseToast(o(2, 0, 0, 0, 1), 3), { key: "sentNowMany", n: 2, tone: "success" });
});

test("no outcome (the release could not run): approved, the minute cron takes it", () => {
  assert.deepEqual(releaseToast(undefined, 2), { key: "pending", tone: "success" });
});

test("recipients carry the first name source and a guessed zone, or none", () => {
  const rs = sendRecipients([
    { firstName: "Lucía", lastName: "Paredes", place: { country: "Mexico", city: "Ciudad de México" } },
    { firstName: null, lastName: null, place: undefined },
  ]);
  assert.equal(rs[0]!.name, "Lucía Paredes");
  assert.equal(rs[0]!.zone?.zone, "America/Mexico_City");
  assert.equal(rs[1]!.zone, null);
});
