/**
 * Pure read-side checks behind scripts/report-hoteles-data-quality.ts. No DB
 * access and no mutation of inputs.
 *
 * Phone check: the "does the dial code match the country" decision is made by
 * `normalizeHotelPhone` (rows.ts), the same producer the importer used, so
 * this report can never flag a different set of rows than the import did. On
 * top of that it adds what the importer does not say: which country the dial
 * code belongs to, and whether the digit count is even possible for it.
 *
 * Role-group check: which groups are hidden by default comes from
 * NOT_WORTH_PRIORITIZING (the single source of truth the list page reads),
 * never from a copy kept here.
 */
import { NOT_WORTH_PRIORITIZING } from "@/lib/roleGroupPlaybook";
import { DIAL_CODE, normalizeHotelPhone } from "./rows";

export interface QualityPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  roleGroup: string | null;
  country: string | null;
  phone: string | null;
  mobilePhone: string | null;
}

// ITU country calling codes, best effort. Codes are prefix-free, so the first
// digit(s) decide the length. An unlisted prefix yields null (never a guess).
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const ONE_DIGIT = new Set(["1", "7"]);
const TWO_DIGIT = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
  ...range(51, 58), ...range(60, 66), "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
]);
const THREE_DIGIT = new Set([
  "211", "212", "213", "216", "218", ...range(220, 258), ...range(260, 269), "290", "291", "297", "298", "299",
  ...range(350, 359), ...range(370, 378), "380", "381", "382", "383", "385", "386", "387", "389", "420", "421", "423",
  ...range(500, 509), ...range(590, 599), ...range(670, 692), "850", "852", "853", "855", "856", "880", "886",
  ...range(960, 968), ...range(970, 977), ...range(992, 998),
]);

export function extractDialCode(raw: string): { dial: string; national: string } | null {
  const t = raw.trim();
  if (!t.startsWith("+")) return null;
  const digits = t.replace(/\D/g, "");
  const dial = ONE_DIGIT.has(digits.slice(0, 1))
    ? digits.slice(0, 1)
    : TWO_DIGIT.has(digits.slice(0, 2))
      ? digits.slice(0, 2)
      : THREE_DIGIT.has(digits.slice(0, 3))
        ? digits.slice(0, 3)
        : null;
  return dial ? { dial, national: digits.slice(dial.length) } : null;
}

const DIAL_LABEL: Record<string, string> = {
  "1": "EE. UU. / Canadá", "7": "Rusia / Kazajistán", "30": "Grecia", "31": "Países Bajos", "32": "Bélgica", "33": "Francia",
  "34": "España", "39": "Italia", "41": "Suiza", "43": "Austria", "44": "Reino Unido", "49": "Alemania", "52": "México",
  "54": "Argentina", "55": "Brasil", "57": "Colombia", "65": "Singapur", "92": "Pakistán", "351": "Portugal",
  "376": "Andorra", "506": "Costa Rica", "855": "Camboya", "971": "Emiratos Árabes Unidos",
};

export const dialCodeLabel = (dial: string): string => DIAL_LABEL[dial] ?? `+${dial}`;

// Plausible national-number digit counts per code (inclusive). Codes missing
// here are reported as "unknown", never as wrong.
const NATIONAL_LENGTH: Record<string, [number, number]> = {
  "1": [10, 10], "7": [10, 10], "33": [9, 9], "34": [9, 9], "39": [6, 12], "44": [10, 10], "49": [7, 13], "52": [10, 10],
  "54": [10, 11], "55": [10, 11], "57": [10, 10], "65": [8, 8], "92": [10, 10], "376": [6, 6], "506": [8, 8], "855": [8, 9],
};

export type PhoneShape = "ok" | "too_short" | "too_long" | "unknown";

function shapeOf(dial: string, national: string): PhoneShape {
  const span = NATIONAL_LENGTH[dial];
  if (!span) return "unknown";
  return national.length < span[0] ? "too_short" : national.length > span[1] ? "too_long" : "ok";
}

export interface PhoneFinding {
  personId: string;
  field: "phone" | "mobile";
  value: string;
  country: string;
  /** Dial code the number carries; null when the prefix is not a known code. */
  dial: string | null;
  dialLabel: string | null;
  shape: PhoneShape;
}

/** One finding per phone/mobile whose dial code disagrees with the person's country. */
export function assessPhones(p: QualityPerson): PhoneFinding[] {
  const country = p.country?.trim() ?? "";
  if (!DIAL_CODE[country.toLowerCase()]) return [];
  const out: PhoneFinding[] = [];
  for (const [field, raw] of [["phone", p.phone], ["mobile", p.mobilePhone]] as const) {
    if (!raw) continue;
    const norm = normalizeHotelPhone(raw, country);
    if (!norm.dialMismatch || !norm.value) continue;
    const parsed = extractDialCode(norm.value);
    out.push({
      personId: p.id, field, value: norm.value, country,
      dial: parsed?.dial ?? null,
      dialLabel: parsed ? dialCodeLabel(parsed.dial) : null,
      shape: parsed ? shapeOf(parsed.dial, parsed.national) : "unknown",
    });
  }
  return out;
}

/** digits-only number -> ids of the people carrying it, only where 2+ people share it. */
export function findSharedNumbers(people: readonly QualityPerson[]): Map<string, string[]> {
  const seen = new Map<string, Set<string>>();
  for (const p of people) {
    for (const raw of [p.phone, p.mobilePhone]) {
      const digits = raw?.replace(/\D/g, "");
      if (!digits) continue;
      seen.set(digits, (seen.get(digits) ?? new Set()).add(p.id));
    }
  }
  return new Map([...seen].filter(([, ids]) => ids.size > 1).map(([d, ids]) => [d, [...ids]]));
}

export interface RoleGroupSummary {
  total: number;
  byGroup: Record<string, number>;
  /** Groups the default list view hides, read from the playbook. */
  hiddenGroups: string[];
  hiddenByDefault: number;
  otherTitles: string[];
}

export function summariseRoleGroups(people: readonly QualityPerson[]): RoleGroupSummary {
  const hiddenGroups = [...NOT_WORTH_PRIORITIZING.noPriorizar.keys] as string[];
  const byGroup: Record<string, number> = {};
  const otherTitles: string[] = [];
  let hiddenByDefault = 0;
  for (const p of people) {
    const key = p.roleGroup ?? "(sin grupo)";
    byGroup[key] = (byGroup[key] ?? 0) + 1;
    if (p.roleGroup && hiddenGroups.includes(p.roleGroup)) hiddenByDefault++;
    if (p.roleGroup === "other" && p.jobTitle) otherTitles.push(p.jobTitle);
  }
  return { total: people.length, byGroup, hiddenGroups, hiddenByDefault, otherTitles };
}
