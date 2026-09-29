/**
 * Unit tests for src/lib/tasks/digest.ts — the pure grouping and email
 * content builder behind the 08:30 ART daily task-reminder digest (owner
 * decisions: three groups, each omitted when empty; no email when all three
 * are empty; subject like "Tus tareas de hoy — 3 para hoy, 2 atrasadas").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigestEmail, groupDigestTasks, type DigestTask } from "@/lib/tasks/digest";
import { argentinaDayBoundaries } from "@/lib/tasks/argentinaDate";

const BOUNDARIES = { today: "2026-09-29", yesterday: "2026-09-28" };

function task(id: string, dueAt: string, overrides: Partial<DigestTask> = {}): DigestTask {
  return {
    id,
    title: `Task ${id}`,
    dueAt: new Date(dueAt),
    personId: null,
    companyKey: null,
    subjectPersonFirstName: null,
    subjectPersonLastName: null,
    subjectPersonCompany: null,
    subjectCompanyName: null,
    ...overrides,
  };
}

test("groupDigestTasks splits into yesterday/overdue/today by due_at's stored calendar date (00:00 UTC)", () => {
  // `dueAt` always holds a calendar date at 00:00 UTC (never a real ART
  // instant — every task-creation path stores it that way), so these
  // fixtures use the same shape production due_at rows do.
  const tasks: DigestTask[] = [
    task("today1", "2026-09-29T00:00:00Z"), // due today
    task("yesterday1", "2026-09-28T00:00:00Z"), // due yesterday
    task("overdue1", "2026-09-25T00:00:00Z"), // before yesterday -> overdue
    task("overdue2", "2026-09-27T00:00:00Z"), // before yesterday -> overdue
  ];

  const groups = groupDigestTasks(tasks, BOUNDARIES);

  assert.deepEqual(
    groups.today.map((t) => t.id),
    ["today1"],
  );
  assert.deepEqual(
    groups.yesterday.map((t) => t.id),
    ["yesterday1"],
  );
  assert.deepEqual(
    groups.overdue.map((t) => t.id).sort(),
    ["overdue1", "overdue2"],
  );
});

test("groupDigestTasks never mutates its input array (pure planner)", () => {
  const tasks: DigestTask[] = [task("t1", "2026-09-29T11:00:00Z")];
  const before = [...tasks];
  const result1 = groupDigestTasks(tasks, BOUNDARIES);
  const result2 = groupDigestTasks(tasks, BOUNDARIES);
  assert.deepEqual(tasks, before);
  assert.deepEqual(result1, result2);
  assert.notEqual(result1.today, tasks);
});

test("buildDigestEmail returns null when all three groups are empty (no email rule)", () => {
  const email = buildDigestEmail(
    { name: "Ana", email: "ana@avalith.net" },
    { today: [], yesterday: [], overdue: [] },
    "https://bd-contact-intel.vercel.app",
  );
  assert.equal(email, null);
});

test("buildDigestEmail builds a subject counting only non-empty groups, today/atrasadas/ayer order", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z"), task("t2", "2026-09-29T12:00:00Z"), task("t3", "2026-09-29T13:00:00Z")],
    overdue: [task("o1", "2026-09-20T00:00:00Z"), task("o2", "2026-09-21T00:00:00Z")],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.equal(email!.subject, "Tus tareas de hoy — 3 para hoy, 2 atrasadas");
});

test("buildDigestEmail includes yesterday's count in the subject when present", () => {
  const tasks = {
    today: [],
    overdue: [],
    yesterday: [task("y1", "2026-09-29T02:00:00Z")],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.equal(email!.subject, "Tus tareas de hoy — 1 de ayer");
});

test("buildDigestEmail's html includes each task's title, subject link and due date, omits empty groups", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z", { title: "Llamar a Juan", personId: "p1", subjectPersonFirstName: "Juan", subjectPersonLastName: "Perez", subjectPersonCompany: "Acme" })],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /Llamar a Juan/);
  assert.match(email!.html, /Juan Perez/);
  assert.match(email!.html, /https:\/\/bd-contact-intel\.vercel\.app\/contacts\/p1/);
  assert.doesNotMatch(email!.html, /Atrasadas/);
  assert.doesNotMatch(email!.html, /Pendientes de ayer/);
  assert.match(email!.text, /Llamar a Juan/);
});

/**
 * Reproduces the exact production bug (2026-09-29 digest dry run): a task
 * due today (`due_at = 2026-09-29T00:00:00Z`, stored as a calendar date at
 * 00:00 UTC — never a real ART instant) was grouped as "de ayer", and a task
 * due yesterday (`2026-09-28T00:00:00Z`) as "atrasada". The old code read
 * `due_at` through `argentinaCalendarDate` (an ART-instant shift), which
 * pushes a UTC-midnight calendar date back one day.
 */
test("groupDigestTasks classifies production due_at values (00:00 UTC calendar dates) correctly across the ART day boundary", () => {
  const dueToday = task("due-today", "2026-09-29T00:00:00Z");
  const dueYesterday = task("due-yesterday", "2026-09-28T00:00:00Z");
  const dueTomorrow = task("due-tomorrow", "2026-09-30T00:00:00Z");

  for (const now of [
    new Date("2026-09-29T11:30:00Z"), // 08:30 ART
    new Date("2026-09-30T02:30:00Z"), // 23:30 ART, still the 29th
  ]) {
    const boundaries = argentinaDayBoundaries(now);
    const groups = groupDigestTasks([dueToday, dueYesterday, dueTomorrow], boundaries);

    assert.deepEqual(
      groups.today.map((t) => t.id),
      ["due-today"],
      `today group at now=${now.toISOString()}`,
    );
    assert.deepEqual(
      groups.yesterday.map((t) => t.id),
      ["due-yesterday"],
      `yesterday group at now=${now.toISOString()}`,
    );
    assert.deepEqual(groups.overdue, [], `overdue group at now=${now.toISOString()}`);
  }
});

test("buildDigestEmail's subject uses singular 'atrasada' for exactly one overdue task", () => {
  const tasks = {
    today: [],
    overdue: [task("o1", "2026-09-20T00:00:00Z")],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.equal(email!.subject, "Tus tareas de hoy — 1 atrasada");
});

test("formatDueDate (via the html output) shows the stored UTC calendar date, not an ART-shifted one", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T00:00:00Z", { title: "Due today" })],
    overdue: [],
    yesterday: [task("y1", "2026-09-28T00:00:00Z", { title: "Due yesterday" })],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /Due today.*vence 29\/09/s);
  assert.match(email!.html, /Due yesterday.*vence 28\/09/s);
});

test("buildDigestEmail never leaks images or tracking pixels", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z")],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.doesNotMatch(email!.html, /<img/i);
});
