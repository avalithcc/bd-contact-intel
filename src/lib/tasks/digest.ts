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
 * HTML presentation (this file's second half) mirrors the product's own
 * shell — the "avalith." wordmark, the mono eyebrow, the card/panel look and
 * the due-date pill treatment from `openspec/changes/crm-hubspot-ux/mockups/
 * tasks.html` + `styles.css` — but is built with table-based layout and
 * inline styles only, because email clients strip <link>/external
 * stylesheets and mis-render modern CSS (flexbox/grid, CSS vars, box-shadow).
 * Every color below is a literal copy of the matching `globals.css` `:root`
 * token's hex/rgba value — see DESIGN.md's "Color Palette & Roles" table.
 */
import { resolveTaskSubject, type TaskSubjectInput } from "@/lib/tasks/subject";
import { taskDueDate, type ArgentinaDayBoundaries } from "@/lib/tasks/argentinaDate";
import { DIGEST_FROM_ADDRESS } from "@/lib/mailer/smtpMailer";

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

export interface DigestRecipient {
  name: string;
  email: string;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Design tokens, inlined (src/app/globals.css `:root` — see DESIGN.md).
// Email clients ignore <style>-only rules for layout-critical properties, so
// every value used for structure/color is a literal here, not a CSS var.
// ---------------------------------------------------------------------------
// Single-quoted font names: every use below sits inside a double-quoted
// HTML `style="..."` attribute — a literal `"Segoe UI"` would terminate that
// attribute early and silently drop every style after it (verified with a
// Playwright render; this bit real, not just cosmetic).
const FONT_STACK = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO_STACK = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace";

const COLOR_CANVAS = "#f5f4f7"; // --color-canvas
const COLOR_SURFACE_2 = "#ffffff"; // --color-surface-2
const COLOR_BORDER = "rgba(0,0,0,0.08)"; // --color-border
const COLOR_INK = "#17151c"; // --color-ink
const COLOR_INK_SOFT = "#5b5865"; // --color-ink-soft
const COLOR_INK_SUBTLE = "#6e6b78"; // --color-ink-subtle (mockups/styles.css .nav-title)
const COLOR_INK_MUTED = "#8b8894"; // --color-ink-muted
const COLOR_ACCENT = "#d5252f"; // --color-accent
const COLOR_ACCENT_STRONG = "#b81f27"; // --color-accent-hover / -focus / -strong
const COLOR_ACCENT_FG = "#ffffff"; // --color-accent-fg
const COLOR_WARN_BG = "#f6eae1"; // --color-warn-bg
const COLOR_WARN_TEXT = "#92400e"; // --color-warn-text
const COLOR_DANGER_BG = "#fbe5e5"; // --color-danger-bg
const COLOR_DANGER_TEXT = "#b91c1c"; // --color-danger-text

type DueTone = "warn" | "danger";

function formatDueDate(dueAt: Date): string {
  // dd/mm of the stored calendar date — `dueAt` is never a real ART instant
  // (see `taskDueDate`'s doc comment), so no ART shift here.
  const [, month, day] = taskDueDate(dueAt).split("-");
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
  if (groups.overdue.length > 0) {
    const word = groups.overdue.length === 1 ? "atrasada" : "atrasadas";
    parts.push(`${groups.overdue.length} ${word}`);
  }
  if (groups.yesterday.length > 0) parts.push(`${groups.yesterday.length} de ayer`);
  return `Tus tareas de hoy — ${parts.join(", ")}`;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** "Tenés 1 tarea para hoy y 1 pendiente de ayer." — the header's one-line summary. */
function buildSummary(groups: DigestGroups<DigestTask>): string {
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
  return `Tenés ${joinNatural(parts)}.`;
}

/** Bulletproof due-date pill (table-safe, no border-radius reliance on unsupported clients — it degrades to a plain colored box). */
function duePill(dueAt: Date, tone: DueTone): string {
  const due = formatDueDate(dueAt);
  const bg = tone === "warn" ? COLOR_WARN_BG : COLOR_DANGER_BG;
  const text = tone === "warn" ? COLOR_WARN_TEXT : COLOR_DANGER_TEXT;
  return `<span style="display:inline-block;white-space:nowrap;padding:3px 10px;border-radius:999px;font-family:${FONT_MONO_STACK};font-size:11px;font-weight:700;background-color:${bg};color:${text};">vence ${due}</span>`;
}

/** Section count pill next to a section heading (same color language as the due-date pill for that section). */
function countPill(count: number, tone: DueTone): string {
  const bg = tone === "warn" ? COLOR_WARN_BG : COLOR_DANGER_BG;
  const text = tone === "warn" ? COLOR_WARN_TEXT : COLOR_DANGER_TEXT;
  return `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font-family:${FONT_MONO_STACK};font-size:11px;font-weight:700;background-color:${bg};color:${text};">${count}</span>`;
}

function taskRow(task: DigestTask, siteBaseUrl: string, tone: DueTone, isLast: boolean): { text: string; html: string } {
  const subject = resolveTaskSubject(task);
  const due = formatDueDate(task.dueAt);
  const subjectText = subject ? ` — ${subject.label}` : "";
  const url = subject ? `${siteBaseUrl}${subject.href}` : null;
  const text = `- ${task.title}${subjectText} (vence ${due})${url ? ` ${url}` : ""}`;

  const borderStyle = isLast ? "" : `border-bottom:1px solid ${COLOR_BORDER};`;
  // Flush with the title's left edge: no extra left/right padding here — the
  // outer <td> below already insets the whole row by 16px, and this cell
  // shares that same nested table, so any horizontal padding of its own
  // would double up and push the link further right than the title.
  const subjectRow = subject
    ? `<tr><td colspan="2" style="padding:4px 0 0;font-family:${FONT_STACK};font-size:13px;">${
        url
          ? `<a href="${escapeHtml(url)}" style="color:${COLOR_ACCENT_STRONG};text-decoration:none;">${escapeHtml(subject.label)}</a>`
          : `<span style="color:${COLOR_INK_SOFT};">${escapeHtml(subject.label)}</span>`
      }</td></tr>`
    : "";

  // Narrow-screen fallback: the pill also renders in its own row below the
  // subject link, hidden by default (inline `display:none`, so clients that
  // strip <style> never show it — the desktop 2-column row stays the only
  // visible pill) and revealed only by the <style> media query at <=480px,
  // which simultaneously hides the desktop column's pill (`due-desktop-cell`).
  const mobilePillRow = `<tr class="due-mobile-row" style="display:none;"><td colspan="2" style="padding:6px 0 0;">${duePill(
    task.dueAt,
    tone,
  )}</td></tr>`;

  const html =
    `<tr><td style="padding:14px 16px ${subject ? "10px" : "14px"} 16px;${borderStyle}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${COLOR_INK};word-break:break-word;">${escapeHtml(task.title)}</td>` +
    `<td class="due-desktop-cell" align="right" style="padding-left:12px;white-space:nowrap;">${duePill(task.dueAt, tone)}</td>` +
    `</tr>${subjectRow}${mobilePillRow}</table></td></tr>`;

  return { text, html };
}

function renderSection(
  heading: string,
  tasks: DigestTask[],
  siteBaseUrl: string,
  tone: DueTone,
): { text: string; html: string } {
  if (tasks.length === 0) return { text: "", html: "" };

  const rows = tasks.map((t, i) => taskRow(t, siteBaseUrl, tone, i === tasks.length - 1));
  const text = `${heading} (${tasks.length})\n${rows.map((r) => r.text).join("\n")}\n`;
  const html =
    `<tr><td class="digest-pad" style="padding:20px 32px 0;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${FONT_STACK};font-size:15px;font-weight:800;color:${COLOR_INK};padding-bottom:12px;">` +
    `${escapeHtml(heading)}${countPill(tasks.length, tone)}` +
    `</td></tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLOR_BORDER};border-radius:8px;">${rows
      .map((r) => r.html)
      .join("")}</table>` +
    `</td></tr>`;

  return { text, html };
}

/**
 * Builds the digest's subject/html/text, or `null` when every group is empty
 * (owner decision: "No email when all three groups are empty"). The HTML is
 * a table-based, fully-inline-styled card meant to read as "a card lifted
 * out of /tasks" in every mail client (see this file's top doc comment for
 * the design-parity sources) — with a plain-text alternative alongside it.
 */
export function buildDigestEmail(
  recipient: DigestRecipient,
  groups: DigestGroups<DigestTask>,
  siteBaseUrl: string,
): DigestEmail | null {
  const totalCount = groups.today.length + groups.overdue.length + groups.yesterday.length;
  if (totalCount === 0) return null;

  const subject = buildSubject(groups);
  const summary = buildSummary(groups);
  const firstName = recipient.name.split(" ")[0] || recipient.name;
  const ctaUrl = `${siteBaseUrl}/tasks`;

  // Owner-approved order: "Para hoy", "Pendientes de ayer", "Atrasadas".
  const sections = [
    renderSection("Para hoy", groups.today, siteBaseUrl, "warn"),
    renderSection("Pendientes de ayer", groups.yesterday, siteBaseUrl, "danger"),
    renderSection("Atrasadas", groups.overdue, siteBaseUrl, "danger"),
  ].filter((s) => s.text !== "");

  const text = `Buen día, ${firstName}.\n\n${summary}\n\n${sections
    .map((s) => s.text)
    .join("\n")}\nVer tus tareas: ${ctaUrl}\n`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  /* Progressive enhancement only — nothing below is required for a correct
     render; clients that strip <style> fall back to the inline styles above. */
  @media only screen and (max-width: 480px) {
    .digest-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .due-desktop-cell { display: none !important; }
    .due-mobile-row { display: table-row !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLOR_CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR_CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${COLOR_SURFACE_2};border:1px solid ${COLOR_BORDER};border-radius:12px;">

<tr><td class="digest-pad" style="padding:28px 32px 20px;border-bottom:1px solid ${COLOR_BORDER};">
<div style="font-family:${FONT_STACK};font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${COLOR_INK};">avalith<span style="color:${COLOR_ACCENT};">.</span></div>
<div style="font-family:${FONT_MONO_STACK};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${COLOR_INK_SUBTLE};margin-top:4px;">ESPACIO DE TRABAJO</div>
</td></tr>

<tr><td class="digest-pad" style="padding:24px 32px 4px;">
<p style="margin:0;font-family:${FONT_STACK};font-size:17px;font-weight:700;color:${COLOR_INK};">Buen día, ${escapeHtml(firstName)}.</p>
<p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:14px;color:${COLOR_INK_SOFT};">${escapeHtml(summary)}</p>
</td></tr>

${sections.map((s) => s.html).join("")}

<tr><td align="center" class="digest-pad" style="padding:28px 32px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:6px;background-color:${COLOR_ACCENT};">
<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${COLOR_ACCENT_FG};text-decoration:none;border-radius:6px;">Ver mis tareas</a>
</td></tr></table>
</td></tr>

<tr><td class="digest-pad" style="padding:20px 32px 28px;">
<p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${COLOR_INK_MUTED};">Resumen diario de tus tareas en Avalith BD, enviado desde ${escapeHtml(
    DIGEST_FROM_ADDRESS,
  )}.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
