import assert from "node:assert/strict";
import { test } from "node:test";
import { doNotCallFor, lushaBadgeFor, type LushaView } from "../../src/lib/lusha/revealView";

const view = (revealed: NonNullable<LushaView["phones"]["revealed"]>) => ({ phones: { revealed }, emails: { revealed: null } }) as unknown as LushaView;

test("both rows get the Lusha badge, and the do-not-call flag only on the row it describes", () => {
  const v = view({ by: "A", at: "14 oct", column: "phone", also: { column: "mobilePhone", doNotCall: true } });
  assert.deepEqual([lushaBadgeFor(v, "phone"), lushaBadgeFor(v, "mobilePhone")], [true, true]);
  assert.deepEqual([doNotCallFor(v, "phone"), doNotCallFor(v, "mobilePhone")], [false, true]);
  const w = view({ by: "A", at: null, column: "phone", doNotCall: true, also: { column: "mobilePhone" } });
  assert.deepEqual([doNotCallFor(w, "phone"), doNotCallFor(w, "mobilePhone")], [true, false]);
  assert.equal(lushaBadgeFor(view({ by: null, at: null, column: "mobilePhone" }), "phone"), false);
});
