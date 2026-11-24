/**
 * Unit tests for src/lib/lusha/titleBackfill.ts — the pure planner that
 * decides whether a Lusha job title may be written onto a person whose
 * role_group is "no_position". Fixtures are synthetic.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LUSHA_TITLE_SOURCE,
  planLushaTitle,
  registrableBase,
  type LushaTitleCrm,
  type LushaTitleRecord,
} from "@/lib/lusha/titleBackfill";

function crm(o: Partial<LushaTitleCrm> = {}): LushaTitleCrm {
  return {
    personId: "p1",
    email: "ana.perez@acme.com",
    firstName: "Ana",
    lastName: "Pérez",
    company: "Acme S.A.",
    jobTitle: null,
    roleGroup: "no_position",
    ...o,
  };
}
function lusha(o: Partial<LushaTitleRecord> = {}): LushaTitleRecord {
  return {
    email: "ana.perez@acme.com",
    firstName: "Ana",
    lastName: "Perez",
    title: "Chief Executive Officer",
    seniority: "C-Level",
    companyName: "Acme",
    companyDomain: "www.acme.com",
    ...o,
  };
}
function skipReason(r: ReturnType<typeof planLushaTitle>): string {
  assert.equal(r.action, "skip");
  return (r as { reason: string }).reason;
}

test("writes a classifiable title and recomputes role_group away from no_position", () => {
  const r = planLushaTitle(lusha(), crm());
  assert.equal(r.action, "write");
  if (r.action !== "write") return;
  assert.equal(r.jobTitle, "Chief Executive Officer");
  assert.notEqual(r.roleGroup, "no_position");
  assert.notEqual(r.roleGroup, "other");
  assert.deepEqual(r.historyRows.map((h) => h.property).sort(), ["jobTitle", "roleGroup"]);
  assert.ok(r.historyRows.every((h) => h.source === LUSHA_TITLE_SOURCE && h.personId === "p1"));
  assert.ok(LUSHA_TITLE_SOURCE.includes("2026-11-24"));
});

test("a lookup that found nobody is skipped as not_found", () => {
  assert.equal(skipReason(planLushaTitle({ email: "x@acme.com", notFound: true }, crm())), "not_found_at_lusha");
});

test("a missing person is skipped as no_person", () => {
  assert.equal(skipReason(planLushaTitle(lusha(), null)), "no_person");
});

test("title Other is rejected with its own reason, distinct from no title", () => {
  const other = skipReason(planLushaTitle(lusha({ title: "Other" }), crm()));
  const none = skipReason(planLushaTitle(lusha({ title: null }), crm()));
  assert.equal(other, "lusha_unknown_title");
  assert.equal(none, "no_title");
  assert.notEqual(other, none);
});

test("a blank title is skipped as no_title", () => {
  assert.equal(skipReason(planLushaTitle(lusha({ title: "   " }), crm())), "no_title");
});

test("a title that is a handle built from the person's surname is rejected", () => {
  assert.equal(skipReason(planLushaTitle(lusha({ title: "anaperez87" }), crm())), "title_is_person_name");
});

test("a title that is the person's surname is rejected", () => {
  assert.equal(skipReason(planLushaTitle(lusha({ title: "Perez" }), crm())), "title_is_person_name");
});

test("a real title that classifies to other is WRITTEN and role_group becomes other, not no_position", () => {
  const r = planLushaTitle(lusha({ title: "Zorblax Wrangler" }), crm());
  assert.equal(r.action, "write");
  if (r.action !== "write") return;
  assert.equal(r.roleGroup, "other");
  assert.equal(r.historyRows.find((h) => h.property === "roleGroup")?.newValue, "other");
});

test("a multi-word title containing a short name as a substring is not mistaken for a handle", () => {
  const people = { firstName: "Mark", lastName: "Ruiz" };
  for (const title of ["Marketing Manager", "Marketing"]) {
    assert.equal(planLushaTitle(lusha({ ...people, title }), crm(people)).action, "write", title);
  }
});

test("a non-empty CRM job_title is never overwritten", () => {
  const r = planLushaTitle(lusha(), crm({ jobTitle: "Gerente" }));
  assert.equal(skipReason(r), "crm_title_present");
});

test("a person whose role_group is not no_position is skipped", () => {
  assert.equal(skipReason(planLushaTitle(lusha(), crm({ roleGroup: "other" }))), "role_group_not_no_position");
});

test("different company domain AND different company name goes to needs_review", () => {
  const r = planLushaTitle(lusha({ companyName: "Zeta GmbH", companyDomain: "zeta.de" }), crm());
  assert.equal(skipReason(r), "needs_review_company_mismatch");
});

test("different domain but same company name still writes (fluxit.com.ar vs fluxitsoft.com)", () => {
  const r = planLushaTitle(
    lusha({ email: "ana@fluxit.com.ar", companyName: "Fluxit", companyDomain: "fluxitsoft.com" }),
    crm({ email: "ana@fluxit.com.ar", company: "FLUXIT" }),
  );
  assert.equal(r.action, "write");
});

test("a CRM person with no name at all goes to needs_review and is never written", () => {
  const r = planLushaTitle(lusha(), crm({ email: "zzz@acme.com", firstName: null, lastName: "" }));
  assert.equal(skipReason(r), "needs_review_no_crm_name");
});

test("with no CRM name, a local-part token matching the returned name writes", () => {
  const nameless = { firstName: null, lastName: null };
  for (const [local, f, l] of [["mvalli", "Mauricio", "Valli"], ["acampos", "Agustín", "Campos Ramírez"], ["john.rr", "John", "Abhi"], ["esteban", "Esteban", "Etcheverry"]]) {
    const r = planLushaTitle(lusha({ email: `${local}@acme.com`, firstName: f, lastName: l }), crm({ email: `${local}@acme.com`, ...nameless }));
    assert.equal(r.action, "write", local);
  }
});

test("with no CRM name and no local-part match it stays in needs_review (suarezg / Juarez)", () => {
  const e = "suarezg@acme.com";
  const r = planLushaTitle(lusha({ email: e, firstName: "Federico", lastName: "Juarez" }), crm({ email: e, firstName: null, lastName: null }));
  assert.equal(skipReason(r), "needs_review_no_crm_name");
});

test("the local-part fallback does not apply when the CRM has a name", () => {
  const r = planLushaTitle(lusha({ firstName: "Marcos", lastName: "Gil" }), crm({ email: "marcos.gil@acme.com" }));
  assert.equal(skipReason(r), "needs_review_name_mismatch");
});

test("company accepted when Lusha's name contains the email base (Flux IT shape)", () => {
  const r = planLushaTitle(lusha({ companyName: "Flux IT", companyDomain: "fluxitsoft.com" }), crm({ email: "ana@fluxit.com.ar", company: null }));
  assert.equal(r.action, "write");
});

test("company accepted when the email base is contained in Lusha's longer name (Unnax shape)", () => {
  const r = planLushaTitle(
    lusha({ companyName: "Unnax - A Powens Group Company", companyDomain: "powens.com" }),
    crm({ email: "ana@unnax.com", company: null }),
  );
  assert.equal(r.action, "write");
});

test("a genuinely different employer is still needs_review (Spring Automation shape)", () => {
  const r = planLushaTitle(
    lusha({ companyName: "Spring Automation", companyDomain: "springautomation.com" }),
    crm({ email: "ana@hoplonapp.com", company: null }),
  );
  assert.equal(skipReason(r), "needs_review_company_mismatch");
});

test("an identical hyphenated domain matches: both sides are normalized the same way", () => {
  // Regression: emailBase was compacted (hyphen stripped) while the Lusha domain base was not, so
  // pan-energy.com vs www.pan-energy.com compared "panenergy" to "pan-energy" and check (a) failed
  // on every hyphenated domain. The company name is deliberately unrelated here, so ONLY the domain
  // check can make this pass.
  const r = planLushaTitle(
    lusha({ companyName: "Zzz Holdings", companyDomain: "www.pan-energy.com" }),
    crm({ email: "ana@pan-energy.com", company: null }),
  );
  assert.equal(r.action, "write");
});

test("containment does not fire when the shorter string is under 4 characters", () => {
  const r = planLushaTitle(
    lusha({ companyName: "Acme Industrial Holdings", companyDomain: "other.com" }),
    crm({ email: "ana@ac.com", company: null }),
  );
  assert.equal(skipReason(r), "needs_review_company_mismatch");
});

test("company accepted by equal normalized name when the CRM company is present", () => {
  const r = planLushaTitle(lusha({ companyName: "Zeta S.R.L.", companyDomain: "zeta.de" }), crm({ company: "Zeta" }));
  assert.equal(r.action, "write");
});

test("a returned name sharing no 3+ char token with the CRM name goes to needs_review", () => {
  const r = planLushaTitle(lusha({ firstName: "Marcos", lastName: "Gil" }), crm());
  assert.equal(skipReason(r), "needs_review_name_mismatch");
});

test("a shared first name still matches despite a different surname", () => {
  const r = planLushaTitle(lusha({ lastName: "Q." }), crm());
  assert.equal(r.action, "write");
});

test("name matching ignores accents and case", () => {
  const r = planLushaTitle(lusha({ firstName: "ANA", lastName: "PEREZ" }), crm({ firstName: null, lastName: "Pérez" }));
  assert.equal(r.action, "write");
});

test("re-running against the post-write CRM state is a no-op", () => {
  const first = planLushaTitle(lusha(), crm());
  assert.equal(first.action, "write");
  if (first.action !== "write") return;
  const after = crm({ jobTitle: first.jobTitle, roleGroup: first.roleGroup });
  assert.equal(skipReason(planLushaTitle(lusha(), after)), "role_group_not_no_position");
});

test("the planner does not mutate its inputs and is repeatable", () => {
  const l = lusha();
  const c = crm();
  const lSnap = JSON.stringify(l);
  const cSnap = JSON.stringify(c);
  const a = planLushaTitle(l, c);
  const b = planLushaTitle(l, c);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(l), lSnap);
  assert.equal(JSON.stringify(c), cSnap);
});

test("registrableBase strips www and the public suffix", () => {
  assert.equal(registrableBase("www.acme.com"), "acme");
  assert.equal(registrableBase("mail.fluxit.com.ar"), "fluxit");
  assert.equal(registrableBase("acme.io"), "acme");
});
