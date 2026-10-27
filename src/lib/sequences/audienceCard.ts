/**
 * What the audience card does with a `MemberAudience`: which "corregir" items it offers and how it quotes the colleagues.
 * Pure and client-safe ON PURPOSE: it imports only the TYPE of `MemberAudience`, because `audienceView.ts` pulls the country
 * resolver and libphonenumber, which must never reach a client bundle (tests/unit/whatsappClientBoundary.test.ts).
 */
import type { MemberAudience } from "./audienceView";
import { formatArgentinaDayMonth } from "@/lib/i18n/format";
import { resolveDraftLanguage, type ResolvedDraftLanguage } from "./languageChoice";

/** Who set the preferred language and when, as the card and the dialog quote it. Null when there is no history row: they then say nothing about it rather than "cargado por ?". */
export function preferredStamp(p: { byName: string | null; at: Date | null }): { by: string; when: string } | null {
  return p.at ? { by: p.byName ?? "?", when: formatArgentinaDayMonth(p.at) } : null;
}

/** The language of a member's draft as the card and the dialog show it: the same resolveDraftLanguage the draft is generated with. */
export function memberLanguage(m: { audience?: MemberAudience; languageChoice?: { language: string } | null; preferredLanguage?: { language: string } | null }): ResolvedDraftLanguage | null {
  return resolveDraftLanguage(m.audience?.audience?.language ?? null, { chosen: m.languageChoice?.language, preferred: m.preferredLanguage?.language });
}

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

export type HoldKind = "noSignal" | "splitRoster" | "sanctioned" | "unrecognised";

/**
 * Which sentence the card's danger alert uses for a HOLD. The split-roster sentence quotes the company by name, so it needs
 * one: without a name it falls back to the generic no-signal copy instead of rendering "colegas en  están".
 */
export function holdKind(a: MemberAudience, company: string | null): HoldKind {
  if (a.reason === null) return a.colleaguesDisagree && company?.trim() ? "splitRoster" : "noSignal";
  return a.iso ? "sanctioned" : "unrecognised";
}
