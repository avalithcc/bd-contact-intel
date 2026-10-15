// Pure planner for the historical damage of "an out-of-office was written as reply_received":
// which Contacts are `replied` ONLY because of such mail. Read-only by construction (no I/O, inputs
// never mutated); scripts/backfill-autoreply-status.ts feeds it and prints counts.
//
// Why the subject: migration 0044 defaulted every existing email_message.is_automatic to false and
// the sync only classifies NEW mail, so the flag cannot find old damage. The stored subject can,
// through the same prefix rule the live detector uses. That rule is deliberately narrow (the START
// of the subject), so this UNDER-counts: a vacation responder that keeps the original "Re: ..."
// subject is invisible to it. A number from here is a floor, never a ceiling.
//
// "Rests only on" is decided by the real derivation, not by a second rule: reclassify the
// out-of-office rows to the neutral type and re-run buildPersonStatusUpdates. If anything else still
// evidences `replied` (a genuine reply, a connected call, a LinkedIn reply, a manual stage), the
// Contact keeps it and is reported separately as `alsoHasOtherEvidence`.
import { automaticSubjectPrefix } from "./automatedMessage";
import {
  buildPersonStatusUpdates,
  type ActivityRowForStatus,
  type ConnectionRowForStatus,
  type PersonStatus,
} from "@/lib/status/deriveStatus";

type ActivityRow = ActivityRowForStatus & { personId: string };
type ConnectionRow = ConnectionRowForStatus & { personId: string };

export interface DamagedContact {
  personId: string;
  /** The stage the Contact falls back to once the out-of-office rows stop counting as a reply. */
  wouldBecome: PersonStatus;
  /**
   * The matched PREFIX of each out-of-office row ("out of office"), never the subject. The rest of a
   * subject is free text that can carry a person's name, so it does not leave this planner.
   */
  prefixes: string[];
}

export interface AutoReplyDamagePlan {
  affected: DamagedContact[];
  /** Currently `replied`, has an out-of-office-looking reply, but other evidence keeps it `replied`. */
  alsoHasOtherEvidence: number;
}

const subjectOf = (metadata: unknown): string | null => {
  const s = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).subject : null;
  return typeof s === "string" ? s : null;
};

const prefixOf = (row: ActivityRow): string | null => (row.type === "reply_received" ? automaticSubjectPrefix(subjectOf(row.metadata)) : null);
const looksLikeAutoReply = (row: ActivityRow): boolean => prefixOf(row) !== null;

export function planAutoReplyDamage(
  persons: readonly { personId: string; status: string }[],
  activityRows: readonly ActivityRow[],
  connectionRows: readonly ConnectionRow[],
): AutoReplyDamagePlan {
  // Copies, never the caller's rows: the planner must give the same answer on a second call.
  const reclassified = activityRows.map((r) => (looksLikeAutoReply(r) ? { ...r, type: "auto_reply_received" } : r));
  const prefixesByPerson = new Map<string, string[]>();
  for (const r of activityRows) {
    const prefix = prefixOf(r);
    if (prefix) prefixesByPerson.set(r.personId, [...(prefixesByPerson.get(r.personId) ?? []), prefix]);
  }

  const replied = persons.filter((p) => p.status === "replied" && prefixesByPerson.has(p.personId)).map((p) => p.personId);
  const after = new Map(buildPersonStatusUpdates(replied, reclassified, connectionRows).map((u) => [u.personId, u.status]));

  const affected: DamagedContact[] = [];
  let alsoHasOtherEvidence = 0;
  for (const personId of replied) {
    const wouldBecome = after.get(personId)!;
    if (wouldBecome === "replied") alsoHasOtherEvidence += 1;
    else affected.push({ personId, wouldBecome, prefixes: prefixesByPerson.get(personId)! });
  }
  return { affected, alsoHasOtherEvidence };
}
