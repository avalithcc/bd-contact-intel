/**
 * The follow-up expiry warning inside the daily digest: a BD with expiring follow-ups gets the email even with zero tasks,
 * the window matches the card badges (<= 3 days left), and the email names the count in subject and body.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPIRY_WARNING_DAYS,
  buildDigestEmail,
  selectExpiringFollowUps,
  type DigestFollowUpRow,
  type DigestGroups,
  type DigestTask,
} from "@/lib/tasks/digest";
import { addDaysToDateString } from "@/lib/tasks/argentinaDate";
import { FOLLOW_UP_EXPIRY_DAYS } from "@/lib/followUp/cycle";

const TODAY = "2026-11-18";
const SITE = "https://crm.example.test";
const RECIPIENT = { name: "Ana Perez", email: "ana@example.test" };
const NO_TASKS: DigestGroups<DigestTask> = { today: [], yesterday: [], overdue: [] };

/** A cycle that entered the queue so that `daysLeft` days remain before the day-10 drop. */
function row(personId: string, daysLeft: number, overrides: Partial<DigestFollowUpRow> = {}): DigestFollowUpRow {
  return {
    personId,
    firstName: `First${personId}`,
    lastName: `Last${personId}`,
    company: null,
    cycleStartedOn: addDaysToDateString(TODAY, daysLeft - FOLLOW_UP_EXPIRY_DAYS),
    ...overrides,
  };
}

function task(id: string): DigestTask {
  return {
    id,
    title: `Task ${id}`,
    dueAt: new Date("2026-11-18T00:00:00Z"),
    personId: null,
    companyKey: null,
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: null,
  };
}

test("the warning window is the one the card badges use: 3 days or fewer", () => {
  assert.equal(EXPIRY_WARNING_DAYS, 3);
});

test("a BD with zero tasks and expiring follow-ups DOES get an email", () => {
  const expiring = selectExpiringFollowUps([row("a", 2)], TODAY);
  const email = buildDigestEmail(RECIPIENT, NO_TASKS, SITE, expiring);
  assert.ok(email, "expected an email for a BD with only expiring follow-ups");
});

test("a BD with zero tasks and zero follow-ups gets null", () => {
  assert.equal(buildDigestEmail(RECIPIENT, NO_TASKS, SITE, []), null);
  assert.equal(buildDigestEmail(RECIPIENT, NO_TASKS, SITE), null);
});

test("an item with 4+ days left is not listed; 3, 1 and 0 days are", () => {
  const selected = selectExpiringFollowUps([row("d5", 5), row("d4", 4), row("d3", 3), row("d1", 1), row("d0", 0)], TODAY);
  assert.deepEqual(selected.map((s) => s.personId).sort(), ["d0", "d1", "d3"]);
});

test("an item past its deadline (negative days left) is not listed", () => {
  assert.deepEqual(selectExpiringFollowUps([row("late", -1)], TODAY), []);
});

test("ordering is soonest-first, and a person with two rows appears once at the soonest deadline", () => {
  const input = [row("c", 3), row("a", 0), row("b", 1), row("c", 2)];
  const selected = selectExpiringFollowUps(input, TODAY);
  assert.deepEqual(
    selected.map((s) => [s.personId, s.daysLeft]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ],
  );
});

test("selectExpiringFollowUps never mutates its input: twice with the same input gives the same result", () => {
  const input = [row("c", 3), row("a", 0)];
  const snapshot = JSON.stringify(input);
  const first = selectExpiringFollowUps(input, TODAY);
  const second = selectExpiringFollowUps(input, TODAY);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), snapshot);
});

test("subject and body both name the count, with and without tasks", () => {
  const expiring = selectExpiringFollowUps([row("a", 3), row("b", 1), row("c", 0)], TODAY);
  const only = buildDigestEmail(RECIPIENT, NO_TASKS, SITE, expiring)!;
  assert.match(only.subject, /3 seguimientos/);
  assert.match(only.text, /3 seguimientos/);
  assert.match(only.html, /3 seguimientos/);

  const mixed = buildDigestEmail(RECIPIENT, { ...NO_TASKS, today: [task("t1")] }, SITE, expiring)!;
  assert.match(mixed.subject, /1 para hoy/);
  assert.match(mixed.subject, /3 seguimientos/);
});

test("each line names the contact, the company when known, the days left in words, and links to /follow-ups", () => {
  const expiring = selectExpiringFollowUps(
    [row("a", 0, { company: "Acme" }), row("b", 1), row("c", 3)],
    TODAY,
  );
  const { text, html } = buildDigestEmail(RECIPIENT, NO_TASKS, SITE, expiring)!;
  assert.match(text, /Firsta Lasta · Acme — vence hoy/);
  assert.match(text, /Firstb Lastb — vence mañana/);
  assert.match(text, /Firstc Lastc — vence en 3 días/);
  assert.ok(text.includes(`${SITE}/follow-ups`));
  assert.ok(html.includes(`${SITE}/follow-ups`));
  assert.ok(text.indexOf("Firsta") < text.indexOf("Firstb") && text.indexOf("Firstb") < text.indexOf("Firstc"));
});

test("a task-only digest is unchanged: no follow-up section appears", () => {
  const email = buildDigestEmail(RECIPIENT, { ...NO_TASKS, today: [task("t1")] }, SITE)!;
  assert.doesNotMatch(email.text, /por vencer/);
  assert.doesNotMatch(email.html, /follow-ups/);
  assert.match(email.subject, /^Tus tareas de hoy — 1 para hoy$/);
});
