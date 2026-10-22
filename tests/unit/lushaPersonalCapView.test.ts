import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contactActionErrorMessage } from "@/lib/contacts/labels";
import { t } from "@/lib/i18n/dictionaries";
import type { LushaConfigResult } from "@/lib/lusha/config";
import { buildLushaView } from "@/lib/lusha/revealView";
import type { LatestRows, LedgerRow } from "@/lib/lusha/revealState";

const ON: LushaConfigResult = { ok: true, config: { apiKey: "k" } };
const EMPTY = { email: null, emailStatus: "none", emailSource: null, phone: null, mobilePhone: null };
const CRM = { name: "Marta Olivera", company: "Nodo Labs", domain: "nodo.example", linkedin: null };
const row = (over: Partial<LedgerRow>): LedgerRow => ({ id: "r", searchId: "s1", at: new Date("2026-10-14T15:00:00Z"), field: "search", state: "settled", outcome: null, value: null, payload: {}, ...over });
const SEARCH = row({ id: "s1", outcome: "matched", payload: { identity: CRM, canReveal: [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }] } });
const build = (rows: LatestRows, over: Partial<Parameters<typeof buildLushaView>[0]> = {}) =>
  buildLushaView({ config: ON, enabled: true, rows, spentToday: 0, spentCycle: 0, dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: 12, cycleEnd: new Date("2026-11-21T03:00:00.000Z"), person: EMPTY, crm: CRM, companyHref: null, formatDay: () => "21 nov", ...over })!;
const shape = (v: ReturnType<typeof build>) => [v.emails.note, v.emails.control && [v.emails.control.kind, v.emails.control.price, v.emails.control.disabled], v.phones.note];

test("a BD at her own cap sees both rows locked with the personal note, the priced controls kept but disabled", () => {
  const v = build({}, { actorSpentToday: 12 });
  assert.deepEqual(shape(v), ["capped_personal", ["search", 2, true], "capped_personal"]);
  assert.deepEqual([v.actorSpentToday, v.personalCap], [12, 12]);
});

test("the team having room is exactly what the personal note is about: team figures under their caps still lock her", () => {
  const v = build({ search: SEARCH }, { spentToday: 12, spentCycle: 80, actorSpentToday: 12 });
  assert.deepEqual([v.emails.note, v.phones.note], ["capped_personal", "capped_personal"]);
});

test("the notes follow the cap that ranks first: monthly, then personal, then the team's daily rail", () => {
  assert.equal(build({}, { spentCycle: 400, actorSpentToday: 12, spentToday: 60 }).emails.note, "capped_monthly");
  assert.equal(build({}, { actorSpentToday: 12, spentToday: 60 }).emails.note, "capped_personal");
  assert.equal(build({}, { spentToday: 60 }).emails.note, "capped");
});

test("with no personal cap the view is what it was: an actor's spend, however high, locks nothing", () => {
  const free = build({ search: SEARCH }, { personalCap: null, actorSpentToday: 9999 });
  assert.deepEqual(shape(free), [null, ["reveal", 1, false], null]);
  assert.equal(free.personalCap, null);
});

test("an explicit personal cap of 0 locks the BD from her first step, with its own note (a standing block, not a daily one)", () => {
  const v = build({}, { personalCap: 0, actorSpentToday: 0 });
  assert.deepEqual([v.emails.note, v.phones.note], ["capped_personal_zero", "capped_personal_zero"]);
  assert.equal(build({}, { personalCap: 1, actorSpentToday: 1 }).emails.note, "capped_personal", "only an explicit 0 gets the standing-block copy");
});

test("the copy for a cap of 0 promises no tomorrow, prints no 'x of y', and does not read as the on/off switch", () => {
  for (const locale of ["es", "en"] as const) {
    const d = t(locale);
    const l = { ...d.contactRecord, leadStatuses: d.leadStatuses, meetings: d.meetings };
    const texts = [l.lushaNoteCappedPersonalZero, l.lushaNoteCappedPersonalZeroShort, l.errorLushaPersonalCapZero, contactActionErrorMessage(l, "lusha_personal_cap_reached") === l.errorLushaPersonalCapReached ? l.errorLushaPersonalCapZero : ""];
    for (const text of texts) {
      assert.ok(text.length > 0);
      assert.doesNotMatch(text, /mañana|tomorrow|resets|restablece/i, `${locale}: ${text}`);
      assert.doesNotMatch(text, /\d+\s*(de|of)\s*\d+|\{spent\}|\{cap\}/i, `${locale}: ${text}`);
      assert.doesNotMatch(text, /habilit|enabled|deshabilit|switch/i, `${locale}: ${text}`);
      assert.match(text, /administrador|administrator/, `${locale}: names who can fix it`);
    }
    assert.notEqual(l.lushaNoteCappedPersonalZero, l.lushaNoteCappedPersonal);
    assert.notEqual(l.lushaNoteCappedPersonalZero, l.lushaNoteNotEnabled);
  }
});

test("a reveal already paid for stays readable behind a personal cap", () => {
  const paid = row({ field: "emails", searchId: "s1", outcome: "revealed", value: "m@nodo.example" });
  assert.equal(build({ search: SEARCH, emails: paid }, { actorSpentToday: 12 }).emails.note, null);
});

test("the personal copy speaks to the BD in the first person and never blames the team's allowance", () => {
  const es = t("es");
  const l = { ...es.contactRecord, leadStatuses: es.leadStatuses, meetings: es.meetings };
  const fullEs = l.lushaNoteCappedPersonal;
  assert.match(fullEs, /tu tope propio/);
  assert.match(fullEs, /no del equipo/);
  // It must NOT claim the team has room. By the monthly -> personal -> daily
  // precedence, this note is also what shows when the team's daily cap is out
  // too, so "al equipo todavia le queda cupo" would be false exactly when the
  // BD needs the message to be true. Naming whose cap it is always is.
  assert.doesNotMatch(fullEs, /le queda cupo|todavía le queda/i);
  assert.match(fullEs, /administrador/);
  assert.notEqual(l.lushaNoteCappedPersonalShort, fullEs);
  for (const text of [l.lushaNoteCappedPersonalShort, contactActionErrorMessage(l, "lusha_personal_cap_reached")]) {
    assert.doesNotMatch(text, /el equipo ya usó|freno diario/i, text);
    assert.match(text, /tu tope propio|Tu tope propio|tu tope de hoy/, text);
  }
  assert.match(contactActionErrorMessage(l, "lusha_personal_cap_reached"), /administrador/);
  assert.match(contactActionErrorMessage(l, "lusha_personal_cap_reached"), /No se llamó a Lusha ni se cobró nada/);
  const en = t("en");
  const le = { ...en.contactRecord, leadStatuses: en.leadStatuses, meetings: en.meetings };
  // Forbid the CLAIM, not the noun: the copy may say "not the team's", but never that the team has room or credit left.
  const claimsTeamRoom = /team (still )?(has|have|had) (some )?(room|credits?|allowance|left)|room (left )?for the team|team'?s? (limit )?(is not|isn't) (used up|reached)/i;
  assert.doesNotMatch(contactActionErrorMessage(le, "lusha_personal_cap_reached"), /the team already|daily safety/i);
  assert.doesNotMatch(contactActionErrorMessage(le, "lusha_personal_cap_reached"), claimsTeamRoom);
  assert.doesNotMatch(le.lushaNoteCappedPersonalShort, claimsTeamRoom);
  assert.doesNotMatch(le.lushaNoteCappedPersonal, claimsTeamRoom);
  assert.match(le.lushaNoteCappedPersonal, /not the team's/, "it names whose cap it is without saying anything about the team's room");
  assert.match(contactActionErrorMessage(le, "lusha_personal_cap_reached"), /your own limit/);
});

test("the contact page gains no round trip for the third cap: it still reads the spend once, now for the viewing BD", () => {
  const page = readFileSync("src/app/(app)/contacts/[id]/page.tsx", "utf8");
  assert.equal(page.match(/getCreditSpend\(/g)?.length, 1);
  assert.match(page, /getCreditSpend\(now, limits\.cycleStartDay, undefined, me\.id\)/);
  assert.match(page, /personalCap: spent\.personalCap/);
});
