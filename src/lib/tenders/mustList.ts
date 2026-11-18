/**
 * The must-list: every requirement the reading found, one per line, ready to paste into a message to the administrative area.
 * Pure and client-safe. A null is rendered as "not stated" and nothing else: no requirement is ever filled in here.
 */
import { fillTemplate } from "@/lib/i18n/template";
import type { TenderRequirements } from "./analysis";

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
export type MustListLabels = Record<LabelKey, string> & { reqNotStated: string; mustClipboardHeader: string };

export interface MustListLine {
  label: string;
  value: string | null;
}

export function mustListLines(requirements: TenderRequirements, labels: MustListLabels): MustListLine[] {
  return MUST_LIST_ROWS.map(([key, labelKey]) => ({ label: labels[labelKey], value: requirements[key] }));
}

/** `mustClipboardHeader` carries {process} and {name} placeholders; every line after it is "- Label: value". */
export function mustListText(requirements: TenderRequirements, labels: MustListLabels, tender: { processNumber: string; name: string }): string {
  const header = fillTemplate(labels.mustClipboardHeader, { process: tender.processNumber, name: tender.name });
  return [header, ...mustListLines(requirements, labels).map((l) => `- ${l.label}: ${l.value ?? labels.reqNotStated}`)].join("\n");
}
