import { parse } from "csv-parse/sync";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { EMAIL_STATUS_RANK, type EmailStatusKey } from "./types";

/** One merged, ready-to-upsert lead row, before sourceKey is attached. */
export interface LeadDraft {
  attendeeId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  seniority: string | null;
  companyRaw: string | null;
  companyDisplay: string | null;
  companyGroup: string | null;
  companyKey: string | null;
  industryRaw: string | null;
  industryGroup: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  attendeeType: string | null;
  email: string | null;
  emailStatus: EmailStatusKey;
  emailConfidence: number | null;
  emailSource: string | null;
  // Raw `owner` column value from the source file (e.g. "Macarena"),
  // resolved to a bd id by src/lib/leads/queries.ts#matchOwnersToBd — kept
  // here, not resolved during parsing, so parsing has no DB dependency.
  ownerRaw: string | null;
}

/** Every raw CSV/TSV file this import understands, as file contents (not paths). */
export interface LeadCsvBundle {
  attendees?: string;
  decisores?: string;
  hunter?: string;
  probables?: string;
  correosFinal?: string;
  columnaCorreos?: string;
}

function blank(v: string | undefined | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function parseCsvRecords(raw: string): Record<string, string>[] {
  const text = raw.replace(/^﻿/, "");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
}

/**
 * Strips accents and lowercases, for matching names across sources that
 * spell the same person differently (accents, case) — same normalization
 * strategy as src/lib/companyCategories.ts#normalizeCompanyKey, applied to
 * people's names instead of company names. Exported for reuse by
 * src/lib/identity/matcher.ts#buildNameCompanyKey, which needs the same
 * accent-insensitive name fold for its name+company review key.
 */
export function normalizeNameKey(name: string): string {
  return name
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex -- ASCII-only fold, mirrors normalizeCompanyKey
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Base row shape shared by attendees/decisores/hunter/probables. */
interface BaseRow {
  attendeeId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  seniority: string | null;
  companyRaw: string | null;
  industryRaw: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  attendeeType: string | null;
}

function toBaseRow(r: Record<string, string>): BaseRow | null {
  const attendeeId = blank(r["attendee_id"]);
  if (!attendeeId) return null;
  return {
    attendeeId,
    firstName: blank(r["first_name"]),
    lastName: blank(r["last_name"]),
    jobTitle: blank(r["job_title"]),
    seniority: blank(r["seniority"]),
    companyRaw: blank(r["company"]),
    industryRaw: blank(r["industry"]),
    city: blank(r["city"]),
    region: blank(r["region"]),
    country: blank(r["country"]),
    attendeeType: blank(r["attendee_type"]),
  };
}

function emptyDraft(base: BaseRow): LeadDraft {
  return {
    attendeeId: base.attendeeId,
    firstName: base.firstName,
    lastName: base.lastName,
    jobTitle: base.jobTitle,
    seniority: base.seniority,
    companyRaw: base.companyRaw,
    companyDisplay: null,
    companyGroup: null,
    companyKey: null,
    industryRaw: base.industryRaw,
    industryGroup: null,
    city: base.city,
    region: base.region,
    country: base.country,
    attendeeType: base.attendeeType,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ownerRaw: null,
  };
}

/** Overwrites only the fields `base` actually carries a value for. */
function mergeBase(draft: LeadDraft, base: BaseRow): void {
  if (base.firstName) draft.firstName = base.firstName;
  if (base.lastName) draft.lastName = base.lastName;
  if (base.jobTitle) draft.jobTitle = base.jobTitle;
  if (base.seniority) draft.seniority = base.seniority;
  if (base.companyRaw) draft.companyRaw = base.companyRaw;
  if (base.industryRaw) draft.industryRaw = base.industryRaw;
  if (base.city) draft.city = base.city;
  if (base.region) draft.region = base.region;
  if (base.country) draft.country = base.country;
  if (base.attendeeType) draft.attendeeType = base.attendeeType;
}

/**
 * Maps the hunter file's `estado_verif` into our 3-value taxonomy.
 * "invalid" clears the email entirely rather than surfacing a confirmed-bad
 * address; the various inconclusive states ("unknown", "saltado", "sin
 * dominio", "error", blank) are treated as "probable" rather than "none" so
 * long as a guessed address exists — they were not confirmed bad.
 */
function hunterEmailStatus(estadoVerif: string | null): EmailStatusKey | "invalid" {
  const v = estadoVerif?.toLowerCase().trim();
  if (v === "valid") return "verified";
  if (v === "invalid") return "invalid";
  // "accept_all", "unknown", "saltado", "sin dominio", "error", blank
  return "probable";
}

/**
 * Merge every provided source file into one draft per attendee, applying
 * overlays from lowest to highest priority — attendees.csv (base) then
 * decisores, then probables, then hunter (richest) — so a later file's
 * non-empty fields win. See LeadCsvBundle for what each key holds.
 *
 * correos_final.csv and columna_correos.tsv are NOT attendee-id-keyed (they
 * only carry an email + a verification status, correos_final.csv also a
 * free-text name) — they are applied afterwards purely as an email/status
 * enrichment pass: an exact (case-insensitive) email match upgrades
 * emailStatus when the new status ranks higher (see EMAIL_STATUS_RANK), and
 * correos_final.csv additionally fills in a completely missing email by
 * matching its `nombre_apellido` against the lead's normalized full name.
 * Neither file can introduce a *new* lead, since they have no attendee id.
 */
export function buildLeadDrafts(bundle: LeadCsvBundle): LeadDraft[] {
  const byId = new Map<string, LeadDraft>();
  const ownerByAttendeeId = new Map<string, string>();

  function upsertBase(raw: string) {
    for (const r of parseCsvRecords(raw)) {
      const base = toBaseRow(r);
      if (!base) continue;
      const existing = byId.get(base.attendeeId);
      const draft = existing ?? emptyDraft(base);
      if (existing) mergeBase(draft, base);
      byId.set(base.attendeeId, draft);
    }
  }

  function upsertDecisorLike(raw: string, opts: { withEmail: "hunter" | "probables" | "none" }) {
    for (const r of parseCsvRecords(raw)) {
      const base = toBaseRow(r);
      if (!base) continue;
      const draft = byId.get(base.attendeeId) ?? emptyDraft(base);
      mergeBase(draft, base);

      const companyGroup = blank(r["company_group"]);
      const companyDisplay = blank(r["company_display"]);
      const industryGroup = blank(r["industry_group"]);
      const ownerRaw = blank(r["owner"]);
      if (companyGroup) draft.companyGroup = companyGroup;
      if (companyDisplay) draft.companyDisplay = companyDisplay;
      if (industryGroup) draft.industryGroup = industryGroup;
      if (ownerRaw) ownerByAttendeeId.set(base.attendeeId, ownerRaw);

      if (opts.withEmail === "probables") {
        const email = blank(r["mail_probable"]);
        if (email && email.includes("@")) {
          draft.email = email;
          draft.emailStatus = "probable";
          draft.emailConfidence = null;
          draft.emailSource = "fi-arg-2026-mails-probables";
        }
      } else if (opts.withEmail === "hunter") {
        const email = blank(r["mail_probable"]);
        const status = hunterEmailStatus(blank(r["estado_verif"]));
        const scoreRaw = blank(r["score"]);
        const score = scoreRaw ? Number(scoreRaw) : null;
        if (status === "invalid") {
          draft.email = null;
          draft.emailStatus = "none";
          draft.emailConfidence = null;
          draft.emailSource = "fi-arg-2026-mails-hunter";
        } else if (email && email.includes("@")) {
          draft.email = email;
          draft.emailStatus = status;
          draft.emailConfidence = Number.isFinite(score) ? score : null;
          draft.emailSource = "fi-arg-2026-mails-hunter";
        }
      }

      byId.set(base.attendeeId, draft);
    }
  }

  if (bundle.attendees) upsertBase(bundle.attendees);
  if (bundle.decisores) upsertDecisorLike(bundle.decisores, { withEmail: "none" });
  if (bundle.probables) upsertDecisorLike(bundle.probables, { withEmail: "probables" });
  if (bundle.hunter) upsertDecisorLike(bundle.hunter, { withEmail: "hunter" });

  // Resolve owner + companyKey once, after all overlays are applied.
  for (const [attendeeId, draft] of byId) {
    draft.ownerRaw = ownerByAttendeeId.get(attendeeId) ?? null;
    const companyForKey = draft.companyDisplay ?? draft.companyRaw;
    draft.companyKey = companyForKey ? normalizeCompanyKey(companyForKey) : null;
  }

  // --- email/status enrichment from the two name-only side lists ---
  const emailOverride = new Map<string, { status: EmailStatusKey; source: string }>();
  const nameOverride = new Map<string, { email: string; status: EmailStatusKey; source: string }>();

  function correosFinalStatus(estado: string): EmailStatusKey {
    const v = estado.toLowerCase().trim();
    if (v === "verificado") return "verified";
    return "probable"; // "Probable", "Por verificar"
  }

  if (bundle.columnaCorreos) {
    for (const line of bundle.columnaCorreos.split(/\r?\n/)) {
      const [emailRaw, estadoRaw] = line.split("\t");
      const email = blank(emailRaw);
      const estado = blank(estadoRaw);
      if (!email || !estado || !email.includes("@")) continue;
      emailOverride.set(email.toLowerCase(), {
        status: correosFinalStatus(estado),
        source: "columna_correos",
      });
    }
  }

  if (bundle.correosFinal) {
    for (const r of parseCsvRecords(bundle.correosFinal)) {
      const email = blank(r["correo"]);
      const estado = blank(r["estado"]);
      const nombre = blank(r["nombre_apellido"]);
      if (!email || !estado || !email.includes("@")) continue;
      const status = correosFinalStatus(estado);
      emailOverride.set(email.toLowerCase(), { status, source: "correos_final" });
      if (nombre) {
        nameOverride.set(normalizeNameKey(nombre), { email, status, source: "correos_final" });
      }
    }
  }

  for (const draft of byId.values()) {
    if (draft.email && emailOverride.has(draft.email.toLowerCase())) {
      const override = emailOverride.get(draft.email.toLowerCase())!;
      if (EMAIL_STATUS_RANK[override.status] > EMAIL_STATUS_RANK[draft.emailStatus]) {
        draft.emailStatus = override.status;
        draft.emailSource = override.source;
      }
    } else if (!draft.email) {
      const fullName = [draft.firstName, draft.lastName].filter(Boolean).join(" ");
      const match = fullName ? nameOverride.get(normalizeNameKey(fullName)) : undefined;
      if (match) {
        draft.email = match.email;
        draft.emailStatus = match.status;
        draft.emailConfidence = null;
        draft.emailSource = match.source;
      }
    }
  }

  return [...byId.values()];
}
