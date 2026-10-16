/**
 * What the Sequences list shows per row and in the four summary cards. Pure. Every number is derived from the FULL member
 * list handed in (the read must not truncate it: a count taken from a cut list is a number nobody can tell is wrong), and
 * the badges are a partition of the members by current state, so they add up to the contact count the row states.
 */
import { DAILY_SEND_CAP_WARN_ABOVE } from "./capValidation";
import { miamiCalendarDate } from "./miamiTime";
import type { Schedule } from "./schedule";
import { sequenceStats, type StatMember } from "./stats";
import { fill, type SequenceLabels } from "./viewText";

export type SequenceListRow = {
  id: string;
  name: string;
  createdAt: Date;
  dailySendCap: number;
  schedule: Schedule;
  /** Every distinct company on the roster, in roster order. */
  companies: readonly string[];
  members: readonly StatMember[];
  /** Set only by the all-owners read (admin); a BD's own list carries none. */
  owner?: { id: string; name: string };
};

export function listView(rows: readonly SequenceListRow[]) {
  const views = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => {
    const n = (pred: (s: StatMember) => boolean) => r.members.filter(pred).length;
    const stats = sequenceStats(r.members);
    const counts = {
      review: stats.toReview, noDraft: n((s) => s.state === "drafted" && !s.hasDraft), queued: stats.queued,
      sent: n((s) => s.state === "sent" || s.state === "no_reply"), replied: stats.replied, removed: n((s) => s.state === "discarded"),
    };
    return { id: r.id, name: r.name, createdAt: r.createdAt, total: stats.total, counts, segments: stats.segments, companies: r.companies, cap: r.dailySendCap, capHigh: r.dailySendCap > DAILY_SEND_CAP_WARN_ABOVE, afterDays: r.schedule.step2.afterDays, nextReleaseAt: stats.nextReleaseAt, owner: r.owner };
  });
  const releases = views.flatMap((v) => (v.nextReleaseAt ? [v.nextReleaseAt.getTime()] : []));
  const sum = (pick: (v: (typeof views)[number]) => number) => views.reduce((acc, v) => acc + pick(v), 0);
  return {
    rows: views,
    summary: {
      sequences: views.length, contacts: sum((v) => v.total), review: sum((v) => v.counts.review), reviewIn: views.filter((v) => v.counts.review > 0).length,
      queued: sum((v) => v.counts.queued), nextReleaseAt: releases.length ? new Date(Math.min(...releases)) : null, replied: sum((v) => v.counts.replied),
    },
  };
}

/** "Alfa", "Alfa y Beta", "Alfa, Beta y 3 empresas más". */
export function companiesLine(names: readonly string[], l: Pick<SequenceLabels, "listCompaniesAnd" | "listCompaniesMore" | "listCompaniesMoreOne">): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return fill(l.listCompaniesAnd, { a: names[0], b: names[1] });
  const more = names.length - 2;
  return fill(more === 1 ? l.listCompaniesMoreOne : l.listCompaniesMore, { names: names.slice(0, 2).join(", "), n: more });
}

/** The creation day as Miami reads it, the clock the schedule and the runner use. */
export function createdOn(date: Date, l: Pick<SequenceLabels, "dateLocale">): string {
  return new Intl.DateTimeFormat(l.dateLocale, { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric" }).format(date).replace(/\./g, "");
}

const dayNumber = (instant: Date) => Date.parse(`${miamiCalendarDate(instant)}T00:00:00Z`) / 86_400_000;

export function createdAgo(date: Date, now: Date, l: Pick<SequenceLabels, "createdToday" | "createdYesterday" | "createdDays" | "createdWeekOne" | "createdWeeks" | "createdMonthOne" | "createdMonths">): string {
  const days = Math.max(0, dayNumber(now) - dayNumber(date));
  if (days === 0) return l.createdToday;
  if (days === 1) return l.createdYesterday;
  if (days < 7) return fill(l.createdDays, { n: days });
  if (days < 30) return Math.floor(days / 7) === 1 ? l.createdWeekOne : fill(l.createdWeeks, { n: Math.floor(days / 7) });
  return Math.floor(days / 30) === 1 ? l.createdMonthOne : fill(l.createdMonths, { n: Math.floor(days / 30) });
}
