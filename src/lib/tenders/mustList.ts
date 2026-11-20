/**
 * The must-list: every requirement the reading found, one per line, ready to paste into a message to the administrative area.
 * Pure and client-safe. A null is rendered as "not stated" and nothing else: no requirement is ever filled in here.
 */
import { fillTemplate } from "@/lib/i18n/template";
import type { TenderRequirements } from "./analysis";
import type { RequirementKey, RequirementNotes, RequirementStatus, RequirementStatuses } from "./requirementStatus";

/** Order of the block and of the clipboard text: the formal ones first, then what makes a bid inadmissible. */
export const MUST_LIST_ROWS = [
  ["registration", "reqRegistration"],
  ["antecedents", "reqAntecedents"],
  ["guarantee", "reqGuarantee"],
  ["submissionDeadline", "reqDeadline"],
  ["certifications", "reqCertifications"],
  ["financialStanding", "reqFinancial"],
  ["team", "reqTeam"],
  ["affidavits", "reqAffidavits"],
] as const satisfies readonly (readonly [keyof TenderRequirements, string])[];

type LabelKey = (typeof MUST_LIST_ROWS)[number][1];
export type MustListLabels = Record<LabelKey, string> & { reqNotStated: string; mustClipboardHeader: string; reqStatusPending: string; reqStatusHave: string; reqStatusMissing: string };

export interface MustListLine {
  /** The stable key the answer is stored under; the label and the value are display text and may change. */
  key: RequirementKey;
  label: string;
  value: string | null;
  status: RequirementStatus;
  note: string | null;
}

export function mustListLines(requirements: TenderRequirements, labels: MustListLabels, statuses: RequirementStatuses = {}, notes: RequirementNotes = {}): MustListLine[] {
  return MUST_LIST_ROWS.map(([key, labelKey]) => ({ key, label: labels[labelKey], value: requirements[key], status: statuses[key] ?? "pending", note: notes[key] ?? null }));
}

const STATUS_LABEL = { pending: "reqStatusPending", have: "reqStatusHave", missing: "reqStatusMissing" } as const;

/**
 * `mustClipboardHeader` carries {process} and {name} placeholders; every line after it is "- Label: value". When `statuses` is
 * given each line ends with "(status)", pending included, so what is pasted to administration shows what is still unasked.
 * A note follows as ": note", flattened to one line, so administration gets back their own previous answer.
 */
export function mustListText(
  requirements: TenderRequirements,
  labels: MustListLabels,
  tender: { processNumber: string; name: string },
  statuses?: RequirementStatuses,
  notes?: RequirementNotes,
): string {
  const header = fillTemplate(labels.mustClipboardHeader, { process: tender.processNumber, name: tender.name });
  const line = (l: MustListLine) => `- ${l.label}: ${l.value ?? labels.reqNotStated}${statuses ? ` (${labels[STATUS_LABEL[l.status]]})` : ""}${l.note ? `: ${l.note.replace(/\s+/g, " ")}` : ""}`;
  return [header, ...mustListLines(requirements, labels, statuses, notes).map(line)].join("\n");
}
