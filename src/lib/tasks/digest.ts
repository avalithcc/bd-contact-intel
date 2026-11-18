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
 *
 * HTML presentation lives in `src/lib/mailer/emailLayout.ts` (shared by every
 * Avalith CRM email, approved mockups in openspec/changes/email-templates).
 */
import { resolveTaskSubject, type TaskSubjectInput } from "@/lib/tasks/subject";
import { taskDueDate, type ArgentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { daysUntilExpiry } from "@/lib/followUp/cycle";
import {
  COLORS as C,
  FONT_STACK,
  MONO_STACK,
  emailButton,
  emailPill,
  escapeHtml,
  renderEmail,
  renderEmailText,
  type Tone,
} from "@/lib/mailer/emailLayout";

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
    // `dueAt` is a stored calendar date (00:00 UTC), never a real ART
    // instant — read it directly with `taskDueDate`, not the ART-instant
    // shift `argentinaCalendarDate` applies to things like "now".
    const day = taskDueDate(t.dueAt);
    if (day === boundaries.today) today.push(t);
    else if (day === boundaries.yesterday) yesterday.push(t);
    else if (day < boundaries.yesterday) overdue.push(t);
    // day > today (a future due date slipping through an over-wide caller
    // filter) is intentionally dropped — the digest never shows future tasks.
  }
  return { today, yesterday, overdue };
}

/**
 * A follow-up item is warned about when this many days or fewer remain before the day-10 drop. Same threshold as the card
 * badges on /follow-ups (`deadlineBadgeClass`: warn at <= 3, danger at <= 1), so the email and the screen agree.
 */
export const EXPIRY_WARNING_DAYS = 3;

/** One still-open queue item as the route reads it (the SQL decides "open" with `openCycleRowSql`, the expiry job's own rule). */
export interface DigestFollowUpRow {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  /** ART `YYYY-MM-DD` the cycle entered the queue; the expiry clock counts from it. */
  cycleStartedOn: string;
}

export interface ExpiringFollowUp {
  personId: string;
  name: string;
  company: string | null;
  daysLeft: number;
}

/**
 * Keeps the items with `EXPIRY_WARNING_DAYS` or fewer days left (today = 0), one per person at the soonest deadline, soonest
 * first. Days left is `daysUntilExpiry`, the number the cards show. Pure: never mutates `rows`.
 */
export function selectExpiringFollowUps(rows: readonly DigestFollowUpRow[], today: string): ExpiringFollowUp[] {
  const byPerson = new Map<string, ExpiringFollowUp>();
  for (const r of rows) {
    const daysLeft = daysUntilExpiry(r.cycleStartedOn, today);
    if (daysLeft < 0 || daysLeft > EXPIRY_WARNING_DAYS) continue;
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
    const existing = byPerson.get(r.personId);
    if (!existing || daysLeft < existing.daysLeft) byPerson.set(r.personId, { personId: r.personId, name, company: r.company, daysLeft });
  }
  return [...byPerson.values()].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
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


type DueTone = Extract<Tone, "warn" | "danger">;

function formatDueDate(dueAt: Date): string {
  // dd/mm of the stored calendar date — `dueAt` is never a real ART instant
  // (see `taskDueDate`'s doc comment), so no ART shift here.
  const [, month, day] = taskDueDate(dueAt).split("-");
  return `${day}/${month}`;
}

function followUpsLabel(n: number): string {
  return `${n} ${n === 1 ? "seguimiento" : "seguimientos"} por vencer`;
}

function daysLeftWords(daysLeft: number): string {
  if (daysLeft <= 0) return "vence hoy";
  if (daysLeft === 1) return "vence mañana";
  return `vence en ${daysLeft} días`;
}

function buildSubject(groups: DigestGroups<DigestTask>, expiring: readonly ExpiringFollowUp[]): string {
  const parts: string[] = [];
  if (groups.today.length > 0) parts.push(`${groups.today.length} para hoy`);
  if (groups.overdue.length > 0) {
    const word = groups.overdue.length === 1 ? "atrasada" : "atrasadas";
    parts.push(`${groups.overdue.length} ${word}`);
  }
  if (groups.yesterday.length > 0) parts.push(`${groups.yesterday.length} de ayer`);
  if (expiring.length > 0) parts.push(followUpsLabel(expiring.length));
  // Only follow-ups: there are no tasks for the "Tus tareas de hoy" lead to be about.
  if (groups.today.length + groups.overdue.length + groups.yesterday.length === 0) return `${parts.join(", ")} en Avalith CRM`;
  return `Tus tareas de hoy — ${parts.join(", ")}`;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** "Tenés 1 tarea para hoy y 1 pendiente de ayer." — the one-line summary (also the inbox preheader). */
function buildSummary(groups: DigestGroups<DigestTask>, expiring: readonly ExpiringFollowUp[]): string {
  const parts: string[] = [];
  if (groups.today.length > 0) {
    const noun = groups.today.length === 1 ? "tarea" : "tareas";
    parts.push(`${groups.today.length} ${noun} para hoy`);
  }
  if (groups.yesterday.length > 0) {
    const noun = groups.yesterday.length === 1 ? "pendiente" : "pendientes";
    parts.push(`${groups.yesterday.length} ${noun} de ayer`);
  }
  if (groups.overdue.length > 0) {
    const noun = groups.overdue.length === 1 ? "tarea atrasada" : "tareas atrasadas";
    parts.push(`${groups.overdue.length} ${noun}`);
  }
  if (expiring.length > 0) parts.push(followUpsLabel(expiring.length));
  return `Tenés ${joinNatural(parts)}.`;
}

function taskRow(task: DigestTask, siteBaseUrl: string, tone: DueTone, isLast: boolean): { text: string; html: string } {
  const subject = resolveTaskSubject(task);
  const due = formatDueDate(task.dueAt);
  const url = subject ? `${siteBaseUrl}${subject.href}` : null;
  const text = `- ${task.title}${subject ? ` — ${subject.label}` : ""} (vence ${due})${url ? ` ${url}` : ""}`;
  const pill = emailPill(`vence ${due}`, tone);

  // Flush with the title's left edge: the outer <td> already insets the row by 16px.
  const subjectRow = subject
    ? `<tr><td colspan="2" style="padding:4px 0 0;font-family:${FONT_STACK};font-size:13px;">${
        url
          ? `<a href="${escapeHtml(url)}" style="color:${C.accentStrong};text-decoration:none;">${escapeHtml(subject.label)}</a>`
          : `<span style="color:${C.soft};">${escapeHtml(subject.label)}</span>`
      }</td></tr>`
    : "";
  // Narrow-screen fallback: the pill is repeated in a row below the subject,
  // hidden inline (so clients that strip <style> never show it) and revealed by
  // the media query, which hides the desktop column's pill at the same time.
  const mobilePillRow = `<tr class="due-mobile-row" style="display:none;"><td colspan="2" style="padding:6px 0 0;">${pill}</td></tr>`;

  const html =
    `<tr><td style="padding:14px 16px ${subject ? "12px" : "14px"} 16px;${isLast ? "" : `border-bottom:1px solid ${C.line};`}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${C.ink};word-break:break-word;">${escapeHtml(task.title)}</td>` +
    `<td class="due-desktop-cell" align="right" style="padding-left:12px;white-space:nowrap;">${pill}</td>` +
    `</tr>${subjectRow}${mobilePillRow}</table></td></tr>`;
  return { text, html };
}

/** Rows rendered per group; Gmail clips a message at ~102KB, so a long backlog links to the board instead. */
export const DIGEST_MAX_ROWS_PER_GROUP = 20;

function renderSection(heading: string, all: DigestTask[], siteBaseUrl: string, tone: DueTone): { text: string; html: string } {
  if (all.length === 0) return { text: "", html: "" };
  const tasks = all.slice(0, DIGEST_MAX_ROWS_PER_GROUP);
  const hidden = all.length - tasks.length;
  const moreText = `y ${hidden} más en el CRM`;
  const rows = tasks.map((t, i) => taskRow(t, siteBaseUrl, tone, i === tasks.length - 1 && hidden === 0));
  const moreRow = hidden
    ? `<tr><td style="padding:12px 16px;font-family:${FONT_STACK};font-size:13px;"><a href="${escapeHtml(`${siteBaseUrl}/tasks`)}" style="color:${C.accentStrong};text-decoration:none;font-weight:700;">${moreText}</a></td></tr>`
    : "";
  const text = `${heading} (${all.length})\n${rows.map((r) => r.text).join("\n")}\n${hidden ? `${moreText}: ${siteBaseUrl}/tasks\n` : ""}`;
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">` +
    `<tr><td style="padding:0 0 10px;font-family:${FONT_STACK};font-size:15px;font-weight:800;color:${C.ink};">${escapeHtml(heading)} ${emailPill(String(all.length), tone, "margin-left:4px;padding:2px 8px;")}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${rows.map((r) => r.html).join("")}${moreRow}</table></td></tr></table>`;
  return { text, html };
}

/** The "Seguimientos por vencer" block: one line per contact, soonest first, linking to /follow-ups. */
function renderFollowUpSection(all: readonly ExpiringFollowUp[], siteBaseUrl: string): { text: string; html: string } {
  if (all.length === 0) return { text: "", html: "" };
  const url = `${siteBaseUrl}/follow-ups`;
  const shown = all.slice(0, DIGEST_MAX_ROWS_PER_GROUP);
  const hidden = all.length - shown.length;
  const label = (f: ExpiringFollowUp) => (f.company ? `${f.name} · ${f.company}` : f.name);
  const tone = (f: ExpiringFollowUp): DueTone => (f.daysLeft <= 1 ? "danger" : "warn");
  const rows = shown.map((f, i) => {
    const words = daysLeftWords(f.daysLeft);
    const last = i === shown.length - 1 && hidden === 0;
    return {
      text: `- ${label(f)} — ${words}`,
      html:
        `<tr><td style="padding:12px 16px;${last ? "" : `border-bottom:1px solid ${C.line};`}">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${C.ink};word-break:break-word;">${escapeHtml(label(f))}</td>` +
        `<td align="right" style="padding-left:12px;white-space:nowrap;">${emailPill(words, tone(f))}</td>` +
        `</tr></table></td></tr>`,
    };
  });
  const moreText = `y ${hidden} más en el CRM`;
  const moreRow = hidden
    ? `<tr><td style="padding:12px 16px;font-family:${FONT_STACK};font-size:13px;"><a href="${escapeHtml(url)}" style="color:${C.accentStrong};text-decoration:none;font-weight:700;">${moreText}</a></td></tr>`
    : "";
  const text = `Seguimientos por vencer (${all.length})\n${rows.map((r) => r.text).join("\n")}\n${hidden ? `${moreText}: ${url}\n` : ""}Ver seguimientos: ${url}\n`;
  const html =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">` +
    `<tr><td style="padding:0 0 10px;font-family:${FONT_STACK};font-size:15px;font-weight:800;color:${C.ink};">Seguimientos por vencer ${emailPill(String(all.length), "danger", "margin-left:4px;padding:2px 8px;")}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${rows.map((r) => r.html).join("")}${moreRow}</table></td></tr>` +
    `</table>${emailButton("Ver seguimientos", url)}`;
  return { text, html };
}

/** At-a-glance counts strip: one cell per non-empty group (empty groups stay omitted), in section order. */
function countsStrip(groups: DigestGroups<DigestTask>, expiring: readonly ExpiringFollowUp[]): string {
  const shown = (
    [
      [groups.today.length, "Para hoy", "warn"],
      [groups.yesterday.length, "De ayer", "danger"],
      [groups.overdue.length, "Atrasadas", "danger"],
      [expiring.length, "Por vencer", "danger"],
    ] as const
  ).filter(([n]) => n > 0);
  const cells = shown.map(
    ([n, label, tone], i) =>
      `<td align="center" width="${Math.floor(100 / shown.length)}%" style="padding:14px 8px;${i ? `border-left:1px solid ${C.line};` : ""}"><div style="font-family:${FONT_STACK};font-size:26px;font-weight:800;line-height:1.1;color:${tone === "warn" ? C.warnText : C.dangerText};">${n}</div><div style="margin-top:4px;font-family:${MONO_STACK};font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.subtle};">${label}</div></td>`,
  );
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface1}" style="margin:0 0 24px;background-color:${C.surface1};border:1px solid ${C.line};border-radius:8px;border-collapse:separate;"><tr>${cells.join("")}</tr></table>`;
}

const DIGEST_REASON =
  "Recibís este resumen cada mañana porque tenés tareas o seguimientos pendientes en Avalith CRM. Si no hay nada por atender, no enviamos nada.";

/**
 * Builds the digest's subject/html/text, or `null` when every group AND the expiring follow-ups are empty
 * (owner decision: "No email when all three groups are empty"; a BD with only expiring follow-ups, the one most likely to be
 * ignoring the CRM, still gets the warning). HTML comes from
 * the shared email layout; the text twin carries the same sections and links.
 */
export function buildDigestEmail(
  recipient: DigestRecipient,
  groups: DigestGroups<DigestTask>,
  siteBaseUrl: string,
  expiring: readonly ExpiringFollowUp[] = [],
): DigestEmail | null {
  if (groups.today.length + groups.overdue.length + groups.yesterday.length + expiring.length === 0) return null;

  const subject = buildSubject(groups, expiring);
  const summary = buildSummary(groups, expiring);
  const firstName = recipient.name.split(" ")[0] || recipient.name;
  const hasTasks = groups.today.length + groups.overdue.length + groups.yesterday.length > 0;
  const ctaUrl = `${siteBaseUrl}/tasks`;
  const greeting = `Buen día, ${firstName}.`;

  // Owner-approved order: "Para hoy", "Pendientes de ayer", "Atrasadas".
  const sections = [
    renderSection("Para hoy", groups.today, siteBaseUrl, "warn"),
    renderSection("Pendientes de ayer", groups.yesterday, siteBaseUrl, "danger"),
    renderSection("Atrasadas", groups.overdue, siteBaseUrl, "danger"),
  ].filter((s) => s.text !== "");
  const followUps = renderFollowUpSection(expiring, siteBaseUrl);

  const bodyHtml =
    `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${C.ink};">${escapeHtml(greeting)} ${escapeHtml(summary)}</p>` +
    countsStrip(groups, expiring) +
    (hasTasks ? emailButton("Ver mis tareas", ctaUrl) : "") +
    sections.map((s) => s.html).join("") +
    (hasTasks ? emailButton("Ver mis tareas", ctaUrl) : "") +
    followUps.html;

  const html = renderEmail({
    subject,
    preheader: summary,
    eyebrow: "Resumen diario",
    title: hasTasks ? "Tu resumen de tareas" : "Tus seguimientos por vencer",
    bodyHtml,
    reason: DIGEST_REASON,
    replies: false,
    mobileCss: `
    .due-desktop-cell { display: none !important; }
    .due-mobile-row { display: table-row !important; }`,
  });
  const text = renderEmailText({
    body:
      `${greeting}\n\n${summary}\n\n${sections.map((s) => s.text).join("\n")}` +
      (hasTasks ? `\nVer mis tareas: ${ctaUrl}\n` : "") +
      (followUps.text ? `\n${followUps.text}` : ""),
    reason: DIGEST_REASON,
    replies: false,
  });
  return { subject, html, text };
}
