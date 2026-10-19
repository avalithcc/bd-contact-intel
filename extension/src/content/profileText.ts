/**
 * Cleaning of text read from the profile. Pure (no DOM) so it is unit-tested; the DOM side lives in
 * profileReader.ts. It only normalizes what LinkedIn rendered; it never fills in or guesses a value.
 */
import { COMPANY_PREFIX } from "./selectors";

const ZERO_WIDTH = /[​-‏‪-‮⁠﻿]/g;

/** Whitespace-collapsed text, `""` for nothing. Undoes text doubled by a visually hidden accessible copy. */
export function cleanText(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
  if (text.length >= 8) {
    // "AnaAna" style: the visible text immediately followed by an identical hidden copy.
    const half = text.length / 2;
    if (Number.isInteger(half) && text.slice(0, half) === text.slice(half)) return text.slice(0, half).trim();
    // "Despegar Despegar": the same with a separating space.
    const spaced = (text.length - 1) / 2;
    if (Number.isInteger(spaced) && text[spaced] === " " && text.slice(0, spaced) === text.slice(spaced + 1)) {
      return text.slice(0, spaced).trim();
    }
  }
  return text;
}

/** The profile name without the connection degree ("· 2º") or a pronoun note ("(ella/she)"). */
export function cleanName(raw: string | null | undefined): string {
  return cleanText(raw)
    .replace(/\s*[·•]\s*(?:1st|2nd|3rd|[123]\s*(?:º|°|er|ro|do|ero)\+?|[123]\+?)\s*$/i, "")
    .replace(/\s*\((?:[^)]*\/[^)]*|he|she|they|él|ella|elle)\)\s*$/i, "")
    .trim();
}

const COMPANY_LABEL = /^(?:Current company|Empresa actual|Empresa atual)\s*[:：]\s*(.+?)(?:\.\s|\.$|$)/i;

/** "Empresa actual: Despegar. Haz clic para…" gives "Despegar". Other labels (education, etc.) give null. */
export function companyFromLabel(label: string | null | undefined): string | null {
  const match = COMPANY_LABEL.exec(cleanText(label));
  return match?.[1] ? cleanText(match[1]) || null : null;
}

/** Drops a "Ver empresa:" / "Current company:" style prefix a control may put before the company name. */
export function stripCompanyPrefix(raw: string | null | undefined): string {
  return cleanText(raw).replace(COMPANY_PREFIX, "").trim();
}
