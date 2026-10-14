/**
 * Header copy of the cohort drill-down dialogs (reports-kpi-drilldown): it
 * must say the population in words and that the list is the cohort's CURRENT
 * status, not what happened in the period. Runs server-side (the dictionary
 * words include formatter functions, which cannot cross to client components);
 * the resulting strings are passed down as props.
 */
import { addDaysToDateString } from "@/lib/tasks/argentinaDate";
import { cohortBase, cohortCount, type CohortPopulation } from "./cohortDrilldown";
import type { FunnelCounts } from "./funnel";
import type { ReportPeriod } from "./period";

export interface CohortHeaderWords {
  numberLocale: string;
  cohortMonthNames: readonly string[];
  cohortMonthAbbr: readonly string[];
  cohortPeriodMonth: (monthName: string, year: number) => string;
  cohortPeriodQuarter: (quarter: number, year: number) => string;
  cohortPeriodWeek: (from: string, to: string) => string;
  cohortHeaderContacted: (count: string, base: string, period: string) => string;
  cohortHeaderReplied: (count: string, base: string, period: string) => string;
  cohortHeaderMeeting: (count: string, base: string, period: string) => string;
  cohortNote: string;
  cohortNoteReplied: (period: string) => string;
}

function ymd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/** "en octubre 2026" / "en el 4.º trimestre 2026" / "del 12 al 18 oct 2026" — the period the cohort was created in. */
export function cohortPeriodPhrase(period: ReportPeriod, fromDate: string, toDateExclusive: string, w: CohortHeaderWords): string {
  const from = ymd(fromDate);
  if (period === "month") return w.cohortPeriodMonth(w.cohortMonthNames[from.m - 1]!, from.y);
  if (period === "quarter") return w.cohortPeriodQuarter(Math.floor((from.m - 1) / 3) + 1, from.y);
  const to = ymd(addDaysToDateString(toDateExclusive, -1));
  const sameMonth = from.m === to.m && from.y === to.y;
  const fromText = sameMonth ? `${from.d}` : `${from.d} ${w.cohortMonthAbbr[from.m - 1]}${from.y === to.y ? "" : ` ${from.y}`}`;
  return w.cohortPeriodWeek(fromText, `${to.d} ${w.cohortMonthAbbr[to.m - 1]} ${to.y}`);
}

export function cohortHeaderLines(
  population: CohortPopulation,
  funnel: FunnelCounts,
  periodPhrase: string,
  w: CohortHeaderWords,
): { summary: string; note: string } {
  const count = cohortCount(funnel, population).toLocaleString(w.numberLocale);
  const base = cohortBase(funnel, population).toLocaleString(w.numberLocale);
  if (population === "contacted") return { summary: w.cohortHeaderContacted(count, base, periodPhrase), note: w.cohortNote };
  if (population === "replied") return { summary: w.cohortHeaderReplied(count, base, periodPhrase), note: w.cohortNoteReplied(periodPhrase) };
  return { summary: w.cohortHeaderMeeting(count, base, periodPhrase), note: w.cohortNote };
}
