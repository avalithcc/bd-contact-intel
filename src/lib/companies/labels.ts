import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

/**
 * `/companies/[key]`'s About pane + quick actions (CompanyAboutPane.tsx,
 * CompanyQuickActions.tsx) are client components — same ClientStrings
 * convention as src/lib/contacts/labels.ts. `dict.companyRecord` is
 * already string-only, but the stage vocabulary (Prospecto/Calificada/...)
 * is only defined once, on `dict.companyList` (shared with the `/companies`
 * list's stage filter — same "reused as-is" pattern as `leadStatuses` in
 * src/lib/contacts/labels.ts). The page previously spread the ENTIRE
 * `dict.companyList` object in to get those five stage keys, which also
 * dragged in `dict.companyList`'s formatter functions
 * (`showingRange`/`pageOf`) and crashed RSC serialization in production
 * ("Functions cannot be passed directly to Client Components"). This
 * picker keeps only the plain-string keys those components actually read.
 */
const STAGE_LABEL_KEYS = [
  "stageProspect",
  "stageQualified",
  "stageProposalSent",
  "stageWon",
  "stageLost",
] as const;

export type CompanyRecordLabels = ClientStrings<
  Dictionary["companyRecord"] & Pick<Dictionary["companyList"], (typeof STAGE_LABEL_KEYS)[number]>
>;

export function pickCompanyRecordLabels(dict: Dictionary): CompanyRecordLabels {
  return {
    ...dict.companyRecord,
    stageProspect: dict.companyList.stageProspect,
    stageQualified: dict.companyList.stageQualified,
    stageProposalSent: dict.companyList.stageProposalSent,
    stageWon: dict.companyList.stageWon,
    stageLost: dict.companyList.stageLost,
  };
}

/** `/companies` bulk bar (CompanyBulkBar.tsx) is a client component: the whole `companyBulk` block is strings only. */
export type CompanyBulkLabels = ClientStrings<Dictionary["companyBulk"]>;
