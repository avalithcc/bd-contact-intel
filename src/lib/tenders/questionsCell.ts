import { tenderTiming } from "./timing";

/** Open tenders inside this many Argentina days get the warning colour; the list's first column uses the same threshold. */
export const SOON_DAYS = 3;

export interface QuestionsCellInput {
  /** A tender_portal row exists. Without one we have never asked the portal. */
  hasPortalRow: boolean;
  /** The row's questions_until; null means the portal did not state it. */
  questionsUntil: Date | null;
}

export type QuestionsCell =
  | { state: "not_fetched" }
  | { state: "not_stated" }
  | { state: "deadline"; at: Date; daysLeft: number; tone: "past" | "soon" | "normal" };

/** "Never asked" and "asked, nothing stated" are different facts; a past deadline means nobody can ask any more. */
export function questionsCell(i: QuestionsCellInput, now: Date): QuestionsCell {
  if (!i.hasPortalRow) return { state: "not_fetched" };
  if (!i.questionsUntil) return { state: "not_stated" };
  const { daysLeft, closed } = tenderTiming(i.questionsUntil, now);
  return { state: "deadline", at: i.questionsUntil, daysLeft, tone: closed ? "past" : daysLeft <= SOON_DAYS ? "soon" : "normal" };
}
