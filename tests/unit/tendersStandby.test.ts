/**
 * The Licitaciones module is on standby (src/lib/tenders/enabled.ts, 2026-11-20). This pins the WHOLE paused surface, and the
 * first test documents the current state: flipping TENDERS_ENABLED back on is a visible, deliberate diff right here.
 * Source-level pins where the code imports the DB or Next runtime (the repo's convention for gates); behaviour tests where the
 * logic is pure or takes its dependencies as arguments (spies that FAIL the test when called).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TENDERS_ENABLED, requireTendersEnabled } from "@/lib/tenders/enabled";
import { buildDigestEmail, type DigestTask } from "@/lib/tasks/digest";
import { loadTenderDigestPlan } from "@/lib/tenders/digestGate";
import { handlePortalRequest } from "@/lib/tenders/portalRun";
import { handlePliegoRequest } from "@/lib/tenders/pliegoRun";
import type { DigestTenders } from "@/lib/tasks/digestTenders";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const SITE = "https://bd-contact-intel.vercel.app";
const authed = new Request("http://x", { headers: { authorization: "Bearer s" } });

const TENDERS: DigestTenders = {
  mine: [{ id: "t1", processNumber: "10/2026", name: "Servicio de software", openingAt: new Date("2026-11-25T12:00:00Z"), daysLeft: 2 }] as unknown as DigestTenders["mine"],
  unowned: [],
};
const TASK: DigestTask = {
  id: "k1", title: "Llamar", dueAt: new Date("2026-11-20T15:00:00Z"), bdId: "b1", bdEmail: "a@avalith.net", bdName: "Ana",
  personId: null, companyId: null, personName: null, companyName: null,
} as unknown as DigestTask;
const GROUPS = { today: [TASK], overdue: [], yesterday: [] };
const ana = { name: "Ana", email: "a@avalith.net" };

test("current state: the module is on standby", () => {
  assert.equal(TENDERS_ENABLED, false);
});

test("navigation: the Licitaciones link renders only behind the switch", () => {
  const sidebar = read("src/app/contacts/Sidebar.tsx");
  const at = sidebar.indexOf('href="/licitaciones"');
  assert.ok(at > 0);
  const gate = sidebar.lastIndexOf("{TENDERS_ENABLED && (", at);
  assert.ok(gate > 0 && !sidebar.slice(gate, at).includes(")}"), "the link must sit inside {TENDERS_ENABLED && (...)}");
  assert.equal(sidebar.split('href="/licitaciones"').length, 2, "one link only");
});

test("pages and document route answer 404 first when paused", () => {
  for (const f of ["src/app/(app)/licitaciones/page.tsx", "src/app/(app)/licitaciones/[id]/page.tsx"]) {
    const src = read(f);
    assert.match(src, /if \(!TENDERS_ENABLED\) notFound\(\);/);
    assert.ok(src.indexOf("!TENDERS_ENABLED") < src.indexOf("requireAdmin()"), `${f}: the switch comes before any read`);
  }
  const doc = read("src/app/(app)/licitaciones/[id]/documento/route.ts");
  assert.match(doc, /if \(!TENDERS_ENABLED\) return new NextResponse\(null, \{ status: 404 \}\);/);
  assert.ok(doc.indexOf("!TENDERS_ENABLED") < doc.indexOf("createClient()"));
});

test("every server action refuses while paused, right after the admin gate", () => {
  const src = read("src/app/(app)/licitaciones/actions.ts");
  const count = (src.match(/export async function /g) ?? []).length;
  assert.equal((src.match(/const me = await requireAdmin\(\);\n  requireTendersEnabled\(\);/g) ?? []).length, count);
  assert.throws(() => requireTendersEnabled(), /disabled/);
  assert.doesNotThrow(() => requireTendersEnabled(true));
});

test("digest: with the module paused there is no tender section, count, wording or link, even if tenders are passed", () => {
  const email = buildDigestEmail(ana, GROUPS, SITE, [], TENDERS)!;
  for (const out of [email.subject, email.html, email.text]) assert.doesNotMatch(out, /licitaci/i);
  assert.doesNotMatch(email.html + email.text, /\/licitaciones/);
  assert.match(email.subject, /1 para hoy/);
});

test("digest: a BD whose only item is a tender gets no email at all while paused", () => {
  assert.equal(buildDigestEmail(ana, { today: [], overdue: [], yesterday: [] }, SITE, [], TENDERS), null);
});

test("digest: switched on, the same input does carry the tender block (the flag is the only difference)", () => {
  const email = buildDigestEmail(ana, GROUPS, SITE, [], TENDERS, true)!;
  assert.match(email.subject, /licitaci/);
  assert.match(email.text, /licitaciones/);
});

test("digest plan: paused reads nothing; enabled does read", async () => {
  const boom = async (): Promise<never> => assert.fail("a tender read ran while the module is paused");
  const plan = await loadTenderDigestPlan(new Date(), { getClosing: boom, getRecipients: boom });
  assert.equal(plan.size, 0);
  let reads = 0;
  await loadTenderDigestPlan(new Date(), { getClosing: async () => (reads++, []), getRecipients: boom }, true);
  assert.equal(reads, 1);
  assert.match(read("src/app/api/tasks/digest/route.ts"), /loadTenderDigestPlan\(/);
  assert.doesNotMatch(read("src/app/api/tasks/digest/route.ts"), /planTenderDigest\(/);
});

test("cron routes: paused answers plainly and runs nothing, bearer check still first", async () => {
  const run = async (): Promise<never> => assert.fail("the run executed while the module is paused");
  for (const handle of [handlePortalRequest, handlePliegoRequest] as const) {
    const ok = await handle(authed, { secret: "s", run });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { status: "disabled" });
    const bad = await handle(new Request("http://x"), { secret: "s", run });
    assert.equal(bad.status, 401);
  }
  for (const f of ["src/app/api/tenders/portal/route.ts", "src/app/api/tenders/pliegos/route.ts"]) {
    assert.doesNotMatch(read(f), /enabled/i, "the routes carry no flag of their own");
  }
});
