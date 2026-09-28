/**
 * Curated, owner-approved list of the 12 partner-account contacts that
 * currently exist only as free text inside `company.notes`. These are the
 * human contacts at accounts Avalith already works with.
 *
 * Owner decision (task): "This list is already curated and owner-approved.
 * Use it verbatim — do NOT re-parse the CSV or the notes." The prose
 * parsing was fragile (4 of 16 rows had no name at all, roles came out
 * empty, trailing punctuation), which is why these 12 were hand-checked
 * instead of scripted.
 *
 * `companyDisplay` is kept as free text (matching `person.company`'s own
 * convention) — the lookup/create key is always re-derived via
 * `normalizeCompanyKey`, never trusted from a column, per the task's
 * instruction to "resolve the key with normalizeCompanyKey rather than
 * trusting my column."
 *
 * Pure module only — no DB access, so this and its planner
 * (`planPartnerAccountContactRows`) are unit-testable without a database,
 * same convention as src/lib/contacts/createContact.ts.
 */
import { normalizeCompanyKey } from "@/lib/companyCategories";

export interface PartnerAccountContactRow {
  displayName: string;
  email: string;
  companyDisplay: string;
}

export const PARTNER_ACCOUNT_CONTACT_ROWS: PartnerAccountContactRow[] = [
  { displayName: "Angela Leon", email: "angela.leon@ackstorm.com", companyDisplay: "ACK Storm" },
  { displayName: "Alicia Arenas", email: "aarenas@consisagroup.com", companyDisplay: "Grupo Consisa" },
  { displayName: "Nathalie Denise Szlafsztein", email: "nszlafsztein@litebox.ai", companyDisplay: "LiteBox" },
  { displayName: "Javier Jimenez", email: "jjimenez@opentech.com.py", companyDisplay: "OpenTech" },
  { displayName: "Aleksandra Makowska", email: "alm@spyro-soft.com", companyDisplay: "Spyro" },
  { displayName: "Javier Minsky", email: "jminsky@virtualmind.com", companyDisplay: "Virtual Mind" },
  { displayName: "Eliseo Cohen Imach", email: "eliseo.cohenimach@agnos.io", companyDisplay: "Agnos" },
  { displayName: "Samuel Levy", email: "samuel.levy@agnos.io", companyDisplay: "Agnos" },
  {
    displayName: "Mónica Rubio",
    email: "monica.rubio@armadilloamarillo.com",
    companyDisplay: "Armadillo Amarillo",
  },
  { displayName: "Anton Strakatov", email: "anton.strakatov@innowise-group.com", companyDisplay: "InnoWise" },
  { displayName: "Matias Mazzucchelli", email: "mmazzucchelli@kopiustech.com", companyDisplay: "Kopious" },
  { displayName: "Malena Garilli", email: "mgarilli@kopiustech.com", companyDisplay: "Kopious" },
];

/** Provenance tag for these rows — follows the same single-token vocabulary
 * `person.source_key` already uses ("manual", "csv", "linkedin_import",
 * "hubspot_import", "lead_import"): free text, not an enum (see
 * src/db/schema.ts's comment on `person.sourceKey`), so this new value
 * doesn't need a migration, but it must still say plainly where these rows
 * came from for future traceability. */
export const PARTNER_ACCOUNT_CONTACT_SOURCE_KEY = "partner_account_notes";

export interface SplitDisplayName {
  firstName: string;
  lastName: string;
}

/**
 * Splits a free-text display name into `firstName`/`lastName`. There is no
 * existing splitter to reuse — every other ingestion path in this app
 * (HubSpot export, LinkedIn CSV) already carries separate first/last
 * columns, so a "split one string" rule has never existed here before.
 *
 * Rule chosen for this script: the LAST whitespace-separated token is the
 * last name; everything before it is the first name. This is unambiguous
 * for a two-token name but a real assumption for a three-token one
 * ("Nathalie Denise Szlafsztein" -> first "Nathalie Denise", last
 * "Szlafsztein"; "Eliseo Cohen Imach" -> first "Eliseo Cohen", last
 * "Imach") — a compound Spanish surname ("Cohen Imach") would split
 * differently. Flagged in the report for the owner to correct before
 * --execute; not guessed at here.
 */
export function splitDisplayName(displayName: string): SplitDisplayName {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export interface PlannedPartnerAccountContactRow {
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  emailNormalized: string;
  company: string;
  companyKey: string;
  sourceKey: string;
}

export interface PartnerAccountContactExistingEmailMatch {
  displayName: string;
  email: string;
  existingPersonId: string;
}

export interface PartnerAccountContactMissingCompanyKey {
  displayName: string;
  companyKey: string;
}

export interface PartnerAccountContactPlan {
  toCreate: PlannedPartnerAccountContactRow[];
  existingEmailMatches: PartnerAccountContactExistingEmailMatch[];
  missingCompanyKeys: PartnerAccountContactMissingCompanyKey[];
}

/**
 * Pure planner: never mutates `rows` (or the caller's maps/sets) — reads
 * only. For each curated row, in order:
 *
 *   1. Re-derive companyKey via normalizeCompanyKey (never trust a raw
 *      column) and normalize the email the same way
 *      createContactActions.ts does (trim + lowercase).
 *   2. If a live person already has this exact normalized email, report it
 *      in `existingEmailMatches` instead of creating a duplicate.
 *   3. If the resolved companyKey has no matching `company` row, report it
 *      in `missingCompanyKeys` instead of silently creating one.
 *   4. Otherwise the row is safe to feed into the real create-contact path
 *      (`toCreate`) — the full identity-resolver duplicate check (profile
 *      key / name+company / own-company guard) still runs downstream via
 *      `runCreateContactFlow`; this planner only handles the two checks the
 *      task calls out as pre-conditions to even attempting a create.
 */
export function planPartnerAccountContactRows(
  rows: readonly PartnerAccountContactRow[],
  existingPersonIdByEmail: ReadonlyMap<string, string>,
  existingCompanyKeys: ReadonlySet<string>,
): PartnerAccountContactPlan {
  const toCreate: PlannedPartnerAccountContactRow[] = [];
  const existingEmailMatches: PartnerAccountContactExistingEmailMatch[] = [];
  const missingCompanyKeys: PartnerAccountContactMissingCompanyKey[] = [];

  for (const row of rows) {
    const emailNormalized = row.email.trim().toLowerCase();
    const companyKey = normalizeCompanyKey(row.companyDisplay);

    const existingPersonId = existingPersonIdByEmail.get(emailNormalized);
    if (existingPersonId) {
      existingEmailMatches.push({ displayName: row.displayName, email: row.email, existingPersonId });
      continue;
    }

    if (!existingCompanyKeys.has(companyKey)) {
      missingCompanyKeys.push({ displayName: row.displayName, companyKey });
      continue;
    }

    const { firstName, lastName } = splitDisplayName(row.displayName);
    toCreate.push({
      displayName: row.displayName,
      firstName,
      lastName,
      email: row.email,
      emailNormalized,
      company: row.companyDisplay,
      companyKey,
      sourceKey: PARTNER_ACCOUNT_CONTACT_SOURCE_KEY,
    });
  }

  return { toCreate, existingEmailMatches, missingCompanyKeys };
}
