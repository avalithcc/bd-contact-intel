/**
 * Unit tests for src/lib/tasks/digest.ts — the pure grouping and email
 * content builder behind the 08:30 ART daily task-reminder digest (owner
 * decisions: three groups, each omitted when empty; no email when all three
 * are empty; subject like "Tus tareas de hoy — 3 para hoy, 2 atrasadas").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigestEmail, groupDigestTasks, type DigestTask } from "@/lib/tasks/digest";

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

test("groupDigestTasks splits into yesterday/overdue/today by ART calendar date", () => {
  const tasks: DigestTask[] = [
    task("today1", "2026-09-29T11:00:00Z"), // 2026-09-29 ART -> today
    task("yesterday1", "2026-09-29T02:30:00Z"), // 2026-09-28 ART -> yesterday
    task("overdue1", "2026-09-25T12:00:00Z"), // 2026-09-25 ART -> overdue (before yesterday)
    task("overdue2", "2026-09-27T23:59:00Z"), // 2026-09-27 ART -> overdue
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
