/**
 * Pure glue between the DB read and the planner for
 * scripts/extract-signature-phones.ts: runs the extractor over every
 * attributable row, plans the fills and builds the counts-only report. The
 * report holds numbers of things, never a body, number, name or address.
 */
import { extractSenderPhones, type RejectReason } from "./extract";
import { planSignaturePhones, type ExtractedMessage, type PersonPhoneState, type SignaturePhonePlan } from "./plan";

/** One inbound message joined to the person it was synced against. */
export interface CandidateRow {
  messageId: string;
  personId: string;
  /** True only when the sender address still resolves to this (unmerged) person. */
  attributed: boolean;
  phone: string | null;
  mobilePhone: string | null;
  /** Null when the row is not attributed (the read never ships its body). */
  body: string | null;
}
export interface SignatureReport {
  candidatesRead: number;
  unresolvedSender: number;
  examined: number;
  bodiesNoBoundary: number;
  messagesWithNumber: number;
  extensionsDropped: number;
  rejected: Partial<Record<RejectReason, number>>;
  personsWithNumbers: number;
  personsToFill: number;
  personsAlreadyHaveNumber: number;
  personsConflicting: number;
}

export function analyzeCandidates(rows: readonly CandidateRow[]): { plan: SignaturePhonePlan; report: SignatureReport } {
  const report: SignatureReport = {
    candidatesRead: rows.length, unresolvedSender: 0, examined: 0, bodiesNoBoundary: 0, messagesWithNumber: 0, extensionsDropped: 0,
    rejected: {}, personsWithNumbers: 0, personsToFill: 0, personsAlreadyHaveNumber: 0, personsConflicting: 0,
  };
  const persons = new Map<string, PersonPhoneState>();
  const messages: ExtractedMessage[] = [];
  for (const row of rows) {
    if (!row.attributed || row.body === null) {
      report.unresolvedSender++;
      continue;
    }
    report.examined++;
    persons.set(row.personId, persons.get(row.personId) ?? { phone: row.phone, mobilePhone: row.mobilePhone });
    const result = extractSenderPhones(row.body);
    if (result.boundary === null) report.bodiesNoBoundary++;
    for (const [reason, n] of Object.entries(result.rejected) as [RejectReason, number][]) report.rejected[reason] = (report.rejected[reason] ?? 0) + n;
    if (result.phones.length) report.messagesWithNumber++;
    report.extensionsDropped += result.phones.filter((p) => p.extensionDropped).length;
    messages.push({ messageId: row.messageId, personId: row.personId, phones: result.phones });
  }
  const plan = planSignaturePhones(messages, persons);
  Object.assign(report, {
    personsWithNumbers: plan.personsWithNumbers, personsToFill: plan.fills.length,
    personsAlreadyHaveNumber: plan.skippedHasNumber, personsConflicting: plan.skippedConflict,
  });
  return { plan, report };
}

export function formatSignatureReport(r: SignatureReport): string[] {
  const pct = r.examined ? ((100 * r.bodiesNoBoundary) / r.examined).toFixed(1) : "0.0";
  const rejected = Object.entries(r.rejected).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `  ${k}: ${n}`);
  return [
    `Inbound messages read: ${r.candidatesRead}`,
    `Skipped, sender does not resolve to the person: ${r.unresolvedSender}`,
    `Bodies examined: ${r.examined}`,
    `Bodies with no detectable quote boundary (whole body kept, riskier): ${r.bodiesNoBoundary} (${pct}%)`,
    `Messages with an accepted number: ${r.messagesWithNumber} (extensions dropped: ${r.extensionsDropped})`,
    `Numbers rejected, by reason:`,
    ...(rejected.length ? rejected : ["  (none)"]),
    `Persons with an accepted number: ${r.personsWithNumbers}`,
    `Persons that would be filled: ${r.personsToFill}`,
    `Persons skipped, already have a number: ${r.personsAlreadyHaveNumber}`,
    `Persons skipped, conflicting numbers (left for a human): ${r.personsConflicting}`,
  ];
}
