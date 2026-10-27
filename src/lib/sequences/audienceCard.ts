/**
 * What the audience card does with a `MemberAudience`: which "corregir" items it offers and how it quotes the colleagues.
 * Pure and client-safe ON PURPOSE: it imports only the TYPE of `MemberAudience`, because `audienceView.ts` pulls the country
 * resolver and libphonenumber, which must never reach a client bundle (tests/unit/whatsappClientBoundary.test.ts).
 */
import type { MemberAudience } from "./audienceView";

/**
 * "Argentina (4) y México (4)"; with three or more, "Argentina (4), México (4) y Chile (3)". Biggest group first, ties by name.
 * `and` is the dictionary's word, so the formatter holds no language. Never reorders the list it is given.
 */
export function formatColleagueBreakdown(entries: readonly { name: string; n: number }[], and: string): string {
  const parts = [...entries].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((e) => `${e.name} (${e.n})`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

export type FixItem = "person" | "company" | "phone" | "colleagues";

/**
 * The items of the card's "corregir" menu, in order. Approved with the mockup (2026-10-27):
 *   - roster consensus: only the person's country and the colleagues; fixing the company country or loading a phone cannot
 *     change that answer, so they are not offered;
 *   - anywhere the roster split (it set the company country aside), the colleagues are offered on top of the shipped items;
 *   - otherwise the shipped menu: the person's country unless it decided, the company when there is one, a phone unless one
 *     decided or is already on file.
 */
export function fixMenuItems(a: MemberAudience, hasCompany: boolean): FixItem[] {
  if (a.reason === "roster_consensus") return hasCompany ? ["person", "colleagues"] : ["person"];
  const items: FixItem[] = [];
  if (a.reason !== "person_country" || !a.audience) items.push("person");
  if (hasCompany) items.push("company");
  if (a.reason !== "phone" && !a.unusedPhone) items.push("phone");
  if (a.colleaguesDisagree && hasCompany) items.push("colleagues");
  return items;
}
