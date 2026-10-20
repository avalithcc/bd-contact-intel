/**
 * DB-backed pin of the phone link of the compliance audience across the picker's SQL and the add guard. The picker FILTERS on the
 * SQL "blocked" flag, so a contact the SQL wrongly blocks never appears; the JS resolver decides the reason a visible row
 * shows and the add itself. Real SQL here, because the unit test can only render it. Opt-in and fail-closed:
 * `npm run test:db`, DATABASE_URL naming a `*_e2e` database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
let bdId: string;
let sequenceId: string;
const personIds: string[] = [];
const ids = new Map<string, string>();

type Spec = { mobilePhone?: string | null; phone?: string | null; country?: string | null };
const SPECS: Record<string, Spec> = {
  arMobile: { mobilePhone: "+5491155551234" },
  arFormatted: { mobilePhone: "+54 (9) 11 5555-1234" },
  arLandline: { phone: "+541155551234" },
  doMobile: { mobilePhone: "+18095551234" },
  usMobile: { mobilePhone: "+13055551234" },
  esMobile: { mobilePhone: "+34612345678" },
  spainWithArPhone: { country: "Spain", mobilePhone: "+5491155551234" },
  noPhone: {},
  noPlus: { mobilePhone: "5491155551234" },
  malformedAr: { mobilePhone: "+5491" },
  fullwidthUs: { mobilePhone: "+１ 305 555 1234" },
  arabicIndicUs: { mobilePhone: "+١ 305 555 1234" },
  jamaica: { mobilePhone: "+18765551234" },
  thailand: { mobilePhone: "+66812345678" },
  georgia: { mobilePhone: "+995555123456" },
  cuba: { mobilePhone: "+5351234567" },
  iran: { mobilePhone: "+989121234567" },
  tokelau: { mobilePhone: "+6907290" },
};

before(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, sequence } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: "ZZ Phone", email: `zz-phone-${run}@example.test` }).returning();
  bdId = b.id;
  const [acc] = await db.insert(emailAccount).values({ bdId, emailAddress: `zz-phone-sender-${run}@example.test` }).returning();
  const [s] = await db.insert(sequence).values({ name: `zz-${run}-seq`, ownerBdId: bdId, emailAccountId: acc.id, schedule: {} }).returning();
  sequenceId = s.id;
  for (const [name, spec] of Object.entries(SPECS)) {
    const email = `zz-${run}-${name}@example.test`;
    const [p] = await db
      .insert(person)
      .values({ firstName: name, lastName: run, email, emailNormalized: email, emailStatus: "verified", emailSource: "apollo", country: spec.country ?? null, mobilePhone: spec.mobilePhone ?? null, phone: spec.phone ?? null })
      .returning();
    personIds.push(p.id);
    ids.set(name, p.id);
  }
});

after(async () => {
  const { db } = await import("@/db");
  const { bd, emailAccount, person, sequence } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(sequence).where(inArray(sequence.ownerBdId, [bdId]));
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(emailAccount).where(inArray(emailAccount.bdId, [bdId]));
  await db.delete(bd).where(inArray(bd.id, [bdId]));
});

async function page(showBlocked: boolean) {
  const { listPickerPage } = await import("@/lib/sequences/pageQueries");
  const { DEFAULT_PICKER_QUERY } = await import("@/lib/sequences/pickerFilters");
  const { contacts } = await listPickerPage({ ...DEFAULT_PICKER_QUERY, search: run, showBlocked }, bdId, "?");
  const byName = new Map(contacts.map((c) => [c.name.split(" ")[0], c.block]));
  return byName;
}

test("the default picker lists every contact a phone LOCATES, Spain and Thailand included, and hides the ones no phone locates", async () => {
  const listed = await page(false);
  for (const name of ["arMobile", "arFormatted", "arLandline", "doMobile", "usMobile", "fullwidthUs", "arabicIndicUs", "esMobile", "spainWithArPhone", "thailand", "georgia", "jamaica"]) assert.equal(listed.get(name), null, name);
  for (const name of ["noPhone", "noPlus", "malformedAr"]) assert.equal(listed.has(name), false, `${name} is hidden`);
});

test("a number too short to be real, or no phone at all, is hidden by default and shown with its reason when blocked rows are on", async () => {
  const shown = await page(true);
  for (const name of ["noPhone", "noPlus", "malformedAr"]) assert.equal(shown.get(name), "unmappedMarket", name);
});

test("decision, pinned: the SQL does not encode the sanctions list, so an embargoed phone is SHOWN with its badge and the add guard refuses it", async () => {
  // A usable row is never hidden; an unusable one is never added. The embargo lives only in complianceAudience.ts.
  const listed = await page(false);
  for (const name of ["cuba", "iran"]) assert.equal(listed.get(name), "unmappedMarket", name);
});

test("known limit, pinned: a real 7-digit Tokelau number clears no length floor, so SQL hides a number JS would mail", async () => {
  // PHONE_MIN_LENGTH is 8 on purpose (it keeps `+5491`-style garbage out); Tokelau and Tristan da Cunha are the two
  // countries it clips (see BELOW_THE_FLOOR in the picker unit test). Owner decision, not a silent behaviour.
  const { resolveComplianceAudience } = await import("@/lib/sequences/complianceAudience");
  assert.notEqual(resolveComplianceAudience({ mobilePhone: SPECS.tokelau.mobilePhone ?? null, phone: null }), null, "JS mails it");
  assert.equal((await page(false)).has("tokelau"), false);
  assert.equal((await page(true)).get("tokelau"), null, "it only surfaces, addable and with no badge, when blocked rows are shown");
});

test("the add guard agrees: a phone-resolved contact is admitted, embargoed and unplaceable phones are refused", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const names = ["arMobile", "doMobile", "fullwidthUs", "arabicIndicUs", "esMobile", "spainWithArPhone", "thailand", "georgia", "jamaica", "malformedAr", "cuba", "iran", "tokelau"];
  const result = await addMembersToSequence(bdId, sequenceId, names.map((n) => ids.get(n)!));
  assert.ok(result.ok);
  const admitted = ["arMobile", "doMobile", "fullwidthUs", "arabicIndicUs", "esMobile", "spainWithArPhone", "thailand", "georgia", "jamaica", "tokelau"];
  assert.deepEqual([...result.accepted].map(String).sort(), admitted.map((n) => ids.get(n)!).sort());
  const reasons = Object.fromEntries(result.rejected.map((r) => [r.personId, r.reason]));
  for (const n of ["malformedAr", "cuba", "iran"]) assert.equal(reasons[ids.get(n)!], "unmapped_market", n);
});
