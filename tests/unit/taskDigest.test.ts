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

test("buildDigestEmail's summary line is a natural Spanish sentence built from non-empty group counts", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z")],
    overdue: [],
    yesterday: [task("y1", "2026-09-28T00:00:00Z")],
  };
  const email = buildDigestEmail({ name: "Cristian Civita", email: "cristian@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /Tenés 1 tarea para hoy y 1 pendiente de ayer\./);
  assert.match(email!.text, /Tenés 1 tarea para hoy y 1 pendiente de ayer\./);
  assert.match(email!.html, /Buen día, Cristian\./);
});

test("buildDigestEmail's summary line joins three non-empty groups with a final 'y' (Oxford-comma-less Spanish list)", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z"), task("t2", "2026-09-29T12:00:00Z")],
    overdue: [task("o1", "2026-09-20T00:00:00Z")],
    yesterday: [task("y1", "2026-09-28T00:00:00Z")],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /Tenés 2 tareas para hoy, 1 pendiente de ayer y 1 tarea atrasada\./);
});

test("buildDigestEmail orders sections 'Para hoy', 'Pendientes de ayer', 'Atrasadas' regardless of input order", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z", { title: "TODAY_TASK" })],
    overdue: [task("o1", "2026-09-20T00:00:00Z", { title: "OVERDUE_TASK" })],
    yesterday: [task("y1", "2026-09-28T00:00:00Z", { title: "YESTERDAY_TASK" })],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  const todayIdx = email!.html.lastIndexOf("Para hoy");
  const yesterdayIdx = email!.html.lastIndexOf("Pendientes de ayer");
  const overdueIdx = email!.html.lastIndexOf("Atrasadas");
  assert.ok(todayIdx < yesterdayIdx, "Para hoy must render before Pendientes de ayer");
  assert.ok(yesterdayIdx < overdueIdx, "Pendientes de ayer must render before Atrasadas");
});

test("buildDigestEmail renders a task with no resolvable subject as title + due pill only, no dangling link", () => {
  const tasks = {
    today: [task("t1", "2026-09-29T11:00:00Z", { title: "Tarea sin registro asociado" })],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /Tarea sin registro asociado/);
  assert.doesNotMatch(email!.html, /<a href="https:\/\/bd-contact-intel\.vercel\.app\/contacts\/undefined/);
});

test("buildDigestEmail escapes HTML-significant characters in the task title, the subject label and the recipient's first name", () => {
  const tasks = {
    today: [
      task("t1", "2026-09-29T11:00:00Z", {
        title: `<script>alert('x')</script> & "quoted"`,
        personId: "p1",
        subjectPersonFirstName: `<b>Juan</b>`,
        subjectPersonLastName: "Pérez",
      }),
    ],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail(
    { name: `<i>Ana</i> & co`, email: "ana@avalith.net" },
    tasks,
    "https://bd-contact-intel.vercel.app",
  );
  assert.ok(email);
  assert.doesNotMatch(email!.html, /<script>/);
  assert.match(email!.html, /&lt;script&gt;/);
  assert.match(email!.html, /&amp;/);
  assert.doesNotMatch(email!.html, /<b>Juan<\/b>/);
  assert.match(email!.html, /&lt;b&gt;Juan&lt;\/b&gt;/);
  assert.doesNotMatch(email!.html, /Buen día, <i>/);
});

test("buildDigestEmail's font-family declarations never contain a double quote (every declaration sits inside a double-quoted style=\"...\" attribute — a literal \"Segoe UI\" would truncate it early in every HTML parser, verified with a real render)", () => {
  const tasks = { today: [task("t1", "2026-09-29T11:00:00Z")], overdue: [], yesterday: [] };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.doesNotMatch(email!.html, /font-family:[^;]*"/);
});

const SITE = "https://bd-contact-intel.vercel.app";
const ONE_EACH = {
  today: [task("t1", "2026-09-29T11:00:00Z")],
  overdue: [task("o1", "2026-09-20T00:00:00Z")],
  yesterday: [task("y1", "2026-09-28T00:00:00Z")],
};

test("buildDigestEmail uses the approved layout: wordmark, mono eyebrow, headline, red-rule card, 'Ver mis tareas' CTA to /tasks", () => {
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, ONE_EACH, SITE);
  assert.ok(email);
  assert.match(email!.html, />avalith<span/);
  assert.match(email!.html, /\/\/ Resumen diario/);
  assert.match(email!.html, /Tu resumen de tareas/);
  assert.match(email!.html, /border-top:4px solid #d5252f/);
  assert.match(email!.html, /Ver mis tareas/);
  assert.match(email!.html, /href="https:\/\/bd-contact-intel\.vercel\.app\/tasks"/);
  assert.match(email!.html, /<meta name="color-scheme" content="light">/);
  assert.doesNotMatch(email!.html, /ESPACIO DE TRABAJO/);
});

test("the preheader is the summary sentence and the footer states why, who sends and that replies are not read", () => {
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, ONE_EACH, SITE);
  assert.ok(email);
  assert.match(email!.html, /display:none;[^>]*>Tenés 1 tarea para hoy, 1 pendiente de ayer y 1 tarea atrasada\./);
  assert.match(email!.html, /Recibís este resumen cada mañana/);
  assert.match(email!.html, /notificaciones@avalith\.net/);
  assert.match(email!.html, /no recibe respuestas/);
});

test("the counts strip shows one figure per non-empty group and omits empty ones", () => {
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, { today: [task("t1", "2026-09-29T11:00:00Z"), task("t2", "2026-09-29T11:00:00Z")], overdue: [], yesterday: [task("y1", "2026-09-28T00:00:00Z")] }, SITE);
  assert.ok(email);
  assert.ok(email!.html.includes(">Para hoy</div>") && email!.html.includes(">De ayer</div>"));
  assert.ok(!email!.html.includes(">Atrasadas</div>"));
  assert.match(email!.html, /line-height:1\.1;color:#92400e;">2<\/div>/);
});

test("the text twin carries every section, task link and the CTA link", () => {
  const withSubject = { ...ONE_EACH, today: [task("t1", "2026-09-29T11:00:00Z", { title: "Llamar", personId: "p1", subjectPersonFirstName: "Juan", subjectPersonLastName: "Perez" })] };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, withSubject, SITE);
  assert.ok(email);
  for (const part of ["Para hoy (1)", "Pendientes de ayer (1)", "Atrasadas (1)", `${SITE}/contacts/p1`, `Ver mis tareas: ${SITE}/tasks`, "Recibís este resumen"]) {
    assert.ok(email!.text.includes(part), part);
  }
});

test("the base url is escaped inside href attributes", () => {
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, ONE_EACH, `${SITE}"><b>`);
  assert.ok(email);
  assert.doesNotMatch(email!.html, /"><b>\/tasks/);
});

test("the related contact/company link sits flush with the task title's left edge (no extra left padding beyond the row's own inset)", () => {
  const tasks = {
    today: [
      task("t1", "2026-09-29T11:00:00Z", {
        title: "Llamar a Juan",
        personId: "p1",
        subjectPersonFirstName: "Juan",
        subjectPersonLastName: "Perez",
      }),
    ],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /<td colspan="2" style="padding:4px 0 0;/);
  assert.doesNotMatch(email!.html, /padding:4px 16px 0/);
});

test("the due-date pill has a narrow-screen fallback row below the related link, hidden unless the <style> media query activates it — the desktop 2-column row is untouched when <style> is stripped", () => {
  const tasks = {
    today: [
      task("t1", "2026-09-29T11:00:00Z", {
        title: "Llamar a Juan",
        personId: "p1",
        subjectPersonFirstName: "Juan",
        subjectPersonLastName: "Perez",
      }),
    ],
    overdue: [],
    yesterday: [],
  };
  const email = buildDigestEmail({ name: "Ana", email: "ana@avalith.net" }, tasks, "https://bd-contact-intel.vercel.app");
  assert.ok(email);
  assert.match(email!.html, /<td class="due-desktop-cell" align="right"/);
  assert.match(email!.html, /<tr class="due-mobile-row" style="display:none;">/);
  assert.match(email!.html, /\.due-desktop-cell \{ display: none !important; \}/);
  assert.match(email!.html, /\.due-mobile-row \{ display: table-row !important; \}/);
});
