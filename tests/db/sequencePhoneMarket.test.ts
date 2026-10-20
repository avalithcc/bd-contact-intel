/**
 * DB-backed pin of the phone link of recipientMarket across the picker's SQL and the add guard. The picker FILTERS on the
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

test("the default picker lists the contacts a phone unblocks and hides the ones with no footer", async () => {
  const listed = await page(false);
  for (const name of ["arMobile", "arFormatted", "arLandline", "doMobile", "usMobile"]) assert.equal(listed.get(name), null, name);
  for (const name of ["esMobile", "spainWithArPhone", "noPhone", "noPlus"]) assert.equal(listed.has(name), false, `${name} is hidden`);
});

test("SQL never hides what JS allows: a malformed number the SQL shows is blocked by the JS reason", async () => {
  const shown = await page(true);
  for (const name of ["esMobile", "spainWithArPhone", "noPhone", "noPlus"]) assert.equal(shown.get(name), "unmappedMarket", name);
  assert.equal(shown.get("malformedAr"), "unmappedMarket", "SQL lets +5491 through, the JS resolver rejects it and says why");
  assert.equal((await page(false)).has("malformedAr"), true, "so it is listed, with its badge, rather than silently hidden");
});

test("the add guard agrees: a phone-resolved contact is admitted, Spain with an Argentine phone is refused", async () => {
  const { addMembersToSequence } = await import("@/lib/sequences/rosterQueries");
  const result = await addMembersToSequence(bdId, sequenceId, ["arMobile", "doMobile", "esMobile", "spainWithArPhone", "malformedAr"].map((n) => ids.get(n)!));
  assert.ok(result.ok);
  assert.deepEqual([...result.accepted].map(String).sort(), ["arMobile", "doMobile"].map((n) => ids.get(n)!).sort());
  const reasons = Object.fromEntries(result.rejected.map((r) => [r.personId, r.reason]));
  for (const n of ["esMobile", "spainWithArPhone", "malformedAr"]) assert.equal(reasons[ids.get(n)!], "unmapped_market", n);
});
