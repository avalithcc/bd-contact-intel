/**
 * The 18:00 (Argentina) "meetings still unconfirmed" email (meeting-outcomes): who gets one, what it lists and says. Pure; the
 * cron route reads the rows, claims the (BD, day) and sends (tests/db/meetingDigest.test.ts covers the claim).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { t } from "@/lib/i18n/dictionaries";
import { buildMeetingDigestEmail, selectMeetingDigests, type DigestMeetingRow } from "@/lib/meetings/digest";

const L = t("es").meetings;
// 18:00 ART on Thu 2026-10-22.
const NOW = new Date("2026-10-22T21:00:00.000Z");
const art = (date: string, time: string) => new Date(`${date}T${time}:00.000-03:00`);

const row = (over: Partial<DigestMeetingRow> = {}): DigestMeetingRow => ({
  meetingId: "m1",
  bdId: "bd-1",
  bdName: "Cristian Civita",
  bdEmail: "cristian@avalith.net",
  firstName: "Lucía",
  lastName: "Fernández",
  company: "Andes Labs",
  scheduledAt: art("2026-10-22", "11:00"),
  ...over,
});

test("a BD with a meeting of today still unconfirmed gets one email listing it", () => {
  const [digest] = selectMeetingDigests([row()], NOW);
  assert.equal(digest?.bdId, "bd-1");
  assert.deepEqual(digest?.today.map((m) => m.meetingId), ["m1"]);
  assert.equal(digest?.olderCount, 0);
});

test("only meetings of today list; earlier days are one line, and a BD with nothing from today gets nothing", () => {
  const rows = [
    row({ meetingId: "today-a", scheduledAt: art("2026-10-22", "16:30") }),
    row({ meetingId: "today-b", scheduledAt: art("2026-10-22", "11:00") }),
    row({ meetingId: "old", scheduledAt: art("2026-10-21", "10:00") }),
    row({ meetingId: "only-old", bdId: "bd-2", bdEmail: "m@avalith.net", bdName: "Mariel", scheduledAt: art("2026-10-20", "10:00") }),
  ];
  const digests = selectMeetingDigests(rows, NOW);
  assert.deepEqual(digests.map((d) => d.bdId), ["bd-1"]);
  assert.deepEqual(digests[0]!.today.map((m) => m.meetingId), ["today-b", "today-a"], "in time order");
  assert.equal(digests[0]!.olderCount, 1);
});

test("the day boundary is Argentina midnight, not UTC", () => {
  // 23:50 ART on the 21st is already the 22nd in UTC (02:50Z), and 00:10 ART on the 22nd is 03:10Z.
  const rows = [
    row({ meetingId: "late-yesterday", scheduledAt: art("2026-10-21", "23:50") }),
    row({ meetingId: "early-today", scheduledAt: art("2026-10-22", "00:10") }),
  ];
  const [digest] = selectMeetingDigests(rows, NOW);
  assert.deepEqual(digest?.today.map((m) => m.meetingId), ["early-today"]);
  assert.equal(digest?.olderCount, 1);
});

test("a meeting whose time has not come is not unconfirmed yet, whatever the caller passed", () => {
  assert.deepEqual(selectMeetingDigests([row({ scheduledAt: art("2026-10-22", "18:30") })], NOW), []);
});

test("earlier-day pending meetings can arrive as a per-BD count, without their rows", () => {
  const older = new Map([["bd-1", 4], ["bd-2", 9]]);
  const digests = selectMeetingDigests([row()], NOW, older);
  assert.equal(digests.length, 1, "bd-2 has only older ones: no email");
  assert.equal(digests[0]!.olderCount, 4);
});

test("the input is not mutated and the result is repeatable", () => {
  const rows = [row({ meetingId: "b", scheduledAt: art("2026-10-22", "16:30") }), row({ meetingId: "a", scheduledAt: art("2026-10-22", "11:00") })];
  const before = rows.map((r) => r.meetingId);
  assert.deepEqual(selectMeetingDigests(rows, NOW), selectMeetingDigests(rows, NOW));
  assert.deepEqual(rows.map((r) => r.meetingId), before);
});

test("subject, title and body follow the mockup: plural, the list, the button to /reuniones and the older-days line", () => {
  const today = [
    row({ meetingId: "a", scheduledAt: art("2026-10-22", "11:00") }),
    row({ meetingId: "b", firstName: "Martín", lastName: "Gómez", company: "Nube Sur", scheduledAt: art("2026-10-22", "16:30") }),
  ];
  const email = buildMeetingDigestEmail({ name: "Cristian Civita", email: "cristian@avalith.net" }, today, 1, "https://crm.example", L, NOW);
  assert.equal(email.subject, "Tienes 2 reuniones de hoy sin confirmar");
  assert.match(email.text, /Hola Cristian, indica cómo salieron para mantener al día tus contactos y los informes\./);
  assert.match(email.text, /Lucía Fernández · Andes Labs — hoy 11:00/);
  assert.match(email.text, /Martín Gómez · Nube Sur — hoy 16:30/);
  assert.match(email.text, /Confirmar reuniones: https:\/\/crm\.example\/reuniones\?view=pending/);
  assert.match(email.text, /También tienes 1 reunión de días anteriores en la cola\./);
  assert.match(email.text, /Se envía a las 18:00 \(hora de Argentina\)/);
  assert.match(email.html, /href="https:\/\/crm\.example\/reuniones\?view=pending"/);
  assert.match(email.html, /Lucía Fernández/);
  assert.match(email.html, /Confirmar reuniones/);
});

test("one meeting reads in the singular and no older line appears when none is older", () => {
  const email = buildMeetingDigestEmail({ name: "Mariel", email: "m@avalith.net" }, [row()], 0, "https://crm.example", L, NOW);
  assert.equal(email.subject, "Tienes 1 reunión de hoy sin confirmar");
  assert.doesNotMatch(email.text, /días anteriores/);
});

test("older meetings in the plural, and contact data is escaped in the HTML", () => {
  const email = buildMeetingDigestEmail(
    { name: "Mariel", email: "m@avalith.net" },
    [row({ firstName: "<b>X</b>", lastName: "O'Neil", company: "A & B" })],
    3,
    "https://crm.example",
    L,
    NOW,
  );
  assert.match(email.text, /También tienes 3 reuniones de días anteriores en la cola\./);
  assert.doesNotMatch(email.html, /<b>X<\/b>/);
  assert.match(email.html, /&lt;b&gt;X&lt;\/b&gt; O&#39;Neil/);
  assert.match(email.html, /A &amp; B/);
});

test("a long day links to the page instead of listing everything", () => {
  const many = Array.from({ length: 25 }, (_, i) => row({ meetingId: `m${i}`, firstName: `C${i}`, lastName: "Z" }));
  const email = buildMeetingDigestEmail({ name: "Mariel", email: "m@avalith.net" }, many, 0, "https://crm.example", L, NOW);
  assert.match(email.text, /y 5 más en el CRM/);
  assert.doesNotMatch(email.text, /C24 Z/);
});
