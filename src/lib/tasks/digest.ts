/**
 * Pure grouping + email-content builder behind the 08:30 ART daily task
 * reminder digest (owner decisions, task-reminders backlog item). Touches no
 * I/O and never sends anything — `src/app/api/tasks/digest/route.ts` is the
 * only caller that reads the DB and calls the mailer, using the output of
 * `buildDigestEmail` verbatim.
 *
 * Reuses `resolveTaskSubject` (src/lib/tasks/subject.ts) for the
 * contact/company link on each line — same "Asociado con" resolution the
 * /tasks board already uses, so a task without a resolvable subject renders
 * with no link instead of a broken one, exactly like the board.
 */
import { resolveTaskSubject, type TaskSubjectInput } from "@/lib/tasks/subject";
import { argentinaCalendarDate, type ArgentinaDayBoundaries } from "@/lib/tasks/argentinaDate";

export interface DigestTask extends TaskSubjectInput {
  id: string;
  title: string;
  dueAt: Date;
}

export interface DigestGroups<T> {
  /** Due yesterday (ART calendar date) — "Pendientes de ayer". */
  yesterday: T[];
  /** Due before yesterday — "Atrasadas". */
  overdue: T[];
  /** Due today (ART calendar date) — "Para hoy". */
  today: T[];
}

/**
 * Splits `tasks` (already filtered to `due_at < tomorrowStartUtc` by the
 * caller's SQL) into the three digest buckets by ART calendar date. Pure —
 * clones into new arrays, never mutates `tasks` (planner rule: calling this
 * twice with the same input must yield the same result).
 */
export function groupDigestTasks<T extends { dueAt: Date }>(
  tasks: readonly T[],
  boundaries: Pick<ArgentinaDayBoundaries, "today" | "yesterday">,
): DigestGroups<T> {
  const today: T[] = [];
  const yesterday: T[] = [];
  const overdue: T[] = [];
  for (const t of tasks) {
    const day = argentinaCalendarDate(t.dueAt);
    if (day === boundaries.today) today.push(t);
    else if (day === boundaries.yesterday) yesterday.push(t);
    else if (day < boundaries.yesterday) overdue.push(t);
    // day > today (a future due date slipping through an over-wide caller
    // filter) is intentionally dropped — the digest never shows future tasks.
  }
  return { today, yesterday, overdue };
}

export interface DigestRecipient {
  name: string;
  email: string;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

function formatDueDate(dueAt: Date): string {
  // dd/mm in ART — same shift trick as argentinaCalendarDate, formatted for
  // display rather than comparison.
  const shifted = new Date(dueAt.getTime() - 3 * 60 * 60 * 1000);
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubject(groups: DigestGroups<DigestTask>): string {
  const parts: string[] = [];
  if (groups.today.length > 0) parts.push(`${groups.today.length} para hoy`);
  if (groups.overdue.length > 0) parts.push(`${groups.overdue.length} atrasadas`);
  if (groups.yesterday.length > 0) parts.push(`${groups.yesterday.length} de ayer`);
  return `Tus tareas de hoy — ${parts.join(", ")}`;
}

function taskLineText(task: DigestTask, siteBaseUrl: string): { text: string; html: string } {
  const subject = resolveTaskSubject(task);
  const due = formatDueDate(task.dueAt);
  const subjectText = subject ? ` — ${subject.label}` : "";
  const url = subject ? `${siteBaseUrl}${subject.href}` : null;
  const text = `- ${task.title}${subjectText} (vence ${due})${url ? ` ${url}` : ""}`;
  const html = `<li><strong>${escapeHtml(task.title)}</strong>${
    subject
      ? ` — ${url ? `<a href="${escapeHtml(url)}">${escapeHtml(subject.label)}</a>` : escapeHtml(subject.label)}`
      : ""
  } <span style="color:#8b8894">(vence ${due})</span></li>`;
  return { text, html };
}

function renderGroup(title: string, tasks: DigestTask[], siteBaseUrl: string): { text: string; html: string } {
  if (tasks.length === 0) return { text: "", html: "" };
  const lines = tasks.map((t) => taskLineText(t, siteBaseUrl));
  const text = `${title}\n${lines.map((l) => l.text).join("\n")}\n`;
  const html = `<h2 style="font-size:1rem;color:#17151c;margin:1.25rem 0 0.5rem">${escapeHtml(title)}</h2><ul style="margin:0;padding-left:1.2rem">${lines
    .map((l) => l.html)
    .join("")}</ul>`;
  return { text, html };
}

/**
 * Builds the digest's subject/html/text, or `null` when every group is empty
 * (owner decision: "No email when all three groups are empty"). Plain,
 * readable HTML with a text alternative — no images, no tracking pixels.
 */
export function buildDigestEmail(
  recipient: DigestRecipient,
  groups: DigestGroups<DigestTask>,
  siteBaseUrl: string,
): DigestEmail | null {
  const totalCount = groups.today.length + groups.overdue.length + groups.yesterday.length;
  if (totalCount === 0) return null;

  const subject = buildSubject(groups);
  const sections = [
    renderGroup("Pendientes de ayer", groups.yesterday, siteBaseUrl),
    renderGroup("Atrasadas", groups.overdue, siteBaseUrl),
    renderGroup("Para hoy", groups.today, siteBaseUrl),
  ].filter((s) => s.text !== "");

  const firstName = recipient.name.split(" ")[0] || recipient.name;
  const text = `Hola ${firstName},\n\nActualizá tus tareas en Avalith BD:\n\n${sections
    .map((s) => s.text)
    .join("\n")}\n${siteBaseUrl}/tasks\n`;
  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#17151c;background:#f5f4f7;padding:1.5rem"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:1.5rem"><p>Hola ${escapeHtml(
    firstName,
  )},</p><p>Actualizá tus tareas en Avalith BD:</p>${sections
    .map((s) => s.html)
    .join("")}<p style="margin-top:1.5rem"><a href="${escapeHtml(siteBaseUrl)}/tasks">Ver todas tus tareas</a></p></div></body></html>`;

  return { subject, html, text };
}
