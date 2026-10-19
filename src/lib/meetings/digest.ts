/**
 * The 18:00 (Argentina) "meetings still unconfirmed" email (meeting-outcomes mockup s4). Pure: no I/O and nothing is sent here;
 * src/app/api/meetings/digest/route.ts reads the rows, claims the (BD, day) and sends what `buildMeetingDigestEmail` returns.
 *
 * Rules (owner decisions): a BD gets an email only when at least one meeting OF TODAY (Argentina calendar day) is still
 * unconfirmed; the email lists today's, and earlier days are one line; one email per BD per day (the claim in digestQueries.ts);
 * nothing is resent on later days; admins get it for their own meetings only, like everyone.
 */
import { fillTemplate } from "@/lib/i18n/template";
import {
  COLORS as C,
  FONT_STACK,
  emailButton,
  escapeHtml,
  renderEmail,
  renderEmailText,
} from "@/lib/mailer/emailLayout";
import type { MeetingLabels } from "@/lib/meetings/labels";
import { formatMeetingWhen } from "@/lib/meetings/when";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export interface DigestMeetingRow {
  meetingId: string;
  bdId: string;
  bdName: string;
  bdEmail: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  scheduledAt: Date;
}

export interface MeetingDigestPlan {
  bdId: string;
  bdName: string;
  bdEmail: string;
  /** Unconfirmed meetings of today's Argentina day, in time order. */
  today: DigestMeetingRow[];
  /** Unconfirmed meetings of earlier days: only counted. */
  olderCount: number;
}

/**
 * One plan per BD that has at least one unconfirmed meeting today. A meeting whose time has not come yet is not unconfirmed,
 * whatever the caller passed in. Never mutates its inputs.
 *
 * `rows` are the meetings to list (today's). Earlier days only need a number, so the caller may pass them as `olderByBd`
 * (pending meetings of earlier days, per BD) instead of as rows; any earlier-day row in `rows` is counted too.
 */
export function selectMeetingDigests(
  rows: readonly DigestMeetingRow[],
  now: Date,
  olderByBd: ReadonlyMap<string, number> = new Map(),
): MeetingDigestPlan[] {
  const today = argentinaCalendarDate(now);
  const byBd = new Map<string, MeetingDigestPlan>();
  for (const row of rows) {
    if (row.scheduledAt.getTime() > now.getTime()) continue;
    let plan = byBd.get(row.bdId);
    if (!plan) {
      plan = { bdId: row.bdId, bdName: row.bdName, bdEmail: row.bdEmail, today: [], olderCount: 0 };
      byBd.set(row.bdId, plan);
    }
    if (argentinaCalendarDate(row.scheduledAt) === today) plan.today.push(row);
    else plan.olderCount += 1;
  }
  return [...byBd.values()]
    .filter((plan) => plan.today.length > 0)
    .map((plan) => ({ ...plan, olderCount: plan.olderCount + (olderByBd.get(plan.bdId) ?? 0), today: [...plan.today].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()) }));
}

export interface MeetingDigestEmail {
  subject: string;
  html: string;
  text: string;
}

/** Rows listed before the email links to the page instead; Gmail clips a message at ~102KB. */
export const MEETING_DIGEST_MAX_ROWS = 20;

function personName(row: DigestMeetingRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function buildMeetingDigestEmail(
  recipient: { name: string; email: string },
  today: readonly DigestMeetingRow[],
  olderCount: number,
  siteBaseUrl: string,
  l: MeetingLabels,
  now: Date,
): MeetingDigestEmail {
  const subject = today.length === 1 ? l.emailSubjectOne : fillTemplate(l.emailSubjectMany, { n: String(today.length) });
  const firstName = recipient.name.split(" ")[0] || recipient.name;
  const greeting = fillTemplate(l.emailGreeting, { name: firstName });
  const url = `${siteBaseUrl}/reuniones?view=pending`;
  const whenLabels = { today: l.whenToday, yesterday: l.whenYesterday, tomorrow: l.whenTomorrow, agoMinutes: l.whenAgoMinutes, agoHours: l.whenAgoHours };
  const shown = today.slice(0, MEETING_DIGEST_MAX_ROWS);
  const hidden = today.length - shown.length;
  const older = olderCount === 0 ? null : olderCount === 1 ? l.emailOlderOne : fillTemplate(l.emailOlderMany, { n: String(olderCount) });
  const more = hidden > 0 ? fillTemplate(l.emailMore, { n: String(hidden) }) : null;

  const lines = shown.map((row) => {
    const name = personName(row) || l.unknownContact;
    const when = formatMeetingWhen(row.scheduledAt, now, whenLabels).text;
    return { name, company: row.company, when };
  });

  const rowsHtml = lines
    .map(
      (r, i) =>
        `<tr><td width="48" valign="middle" style="padding:12px 0 12px 16px;${i ? `border-top:1px solid ${C.line};` : ""}">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="32" height="32" bgcolor="${C.accentSoft}" style="width:32px;height:32px;background-color:${C.accentSoft};border-radius:16px;font-family:${FONT_STACK};font-size:12px;font-weight:700;color:${C.accentStrong};">${escapeHtml(initials(r.name))}</td></tr></table></td>` +
        `<td style="padding:12px 16px 12px 12px;${i ? `border-top:1px solid ${C.line};` : ""}font-family:${FONT_STACK};font-size:14px;line-height:1.4;color:${C.ink};">` +
        `<strong>${escapeHtml(r.name)}</strong>${r.company ? ` · ${escapeHtml(r.company)}` : ""}<br><span style="font-size:13px;color:${C.subtle};">${escapeHtml(r.when)}</span></td></tr>`,
    )
    .join("");
  const moreHtml = more
    ? `<tr><td colspan="2" style="padding:12px 16px;border-top:1px solid ${C.line};font-family:${FONT_STACK};font-size:13px;"><a href="${escapeHtml(url)}" style="color:${C.accentStrong};text-decoration:none;font-weight:700;">${escapeHtml(more)}</a></td></tr>`
    : "";
  const small = `margin:0 0 12px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${C.subtle};`;

  const bodyHtml =
    `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${C.ink};">${escapeHtml(greeting)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate;">${rowsHtml}${moreHtml}</table>` +
    emailButton(l.emailButton, url) +
    (older ? `<p style="${small}">${escapeHtml(older)}</p>` : "");

  const html = renderEmail({
    subject,
    preheader: greeting,
    eyebrow: l.emailEyebrow,
    title: subject,
    bodyHtml,
    reason: l.emailReason,
    replies: false,
  });
  const text = renderEmailText({
    body: [
      greeting,
      lines.map((r) => `- ${r.name}${r.company ? ` · ${r.company}` : ""} — ${r.when}`).join("\n") + (more ? `\n${more}` : ""),
      `${l.emailButton}: ${url}`,
      older,
    ]
      .filter(Boolean)
      .join("\n\n"),
    reason: l.emailReason,
    replies: false,
  });
  return { subject, html, text };
}
