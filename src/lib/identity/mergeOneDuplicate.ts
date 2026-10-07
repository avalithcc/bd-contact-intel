/**
 * Pure planner behind scripts/merge-one-duplicate.ts: merges ONE open
 * duplicate_candidate the way /admin/duplicates does. The survivor is whatever
 * chooseDefaultSurvivor recommends (the exact function the UI uses); an
 * explicit --survivor that disagrees is REFUSED, never honoured and never
 * guessed. The guard scripts/merge-duplicates.ts applies (checkSurvivorLoss) is
 * reused: a survivor that would drop synced Gmail messages or a profile key is
 * refused. Never mutates its inputs.
 */
import { checkSurvivorLoss } from "@/lib/identity/duplicateTiering";
import { chooseDefaultSurvivor } from "@/lib/identity/duplicateReviewView";
import { parseConnectedOnDate } from "@/lib/migration/connectedOn";

export interface MergeOneSide {
  id: string;
  profileKey: string | null;
  createdAt: Date;
  mergedIntoId: string | null;
  connections: readonly { connectedOn: string | null; messageCount: number }[];
}

export interface MergeOneInput {
  candidate: { id: string; status: string; reason: string; personAId: string; personBId: string };
  a: MergeOneSide;
  b: MergeOneSide;
  survivorArg: string | null;
}

export type SurvivorWhy = "profile_key" | "earliest_connection" | "earlier_created" | "tie_defaults_to_a";

export type MergeOnePlan =
  | { kind: "merge"; survivorId: string; mergedId: string; reason: string; why: SurvivorWhy }
  | { kind: "refuse"; reason: string };

const refuse = (reason: string): MergeOnePlan => ({ kind: "refuse", reason });

function earliest(side: MergeOneSide): number | null {
  const times = side.connections.map((c) => parseConnectedOnDate(c.connectedOn)?.getTime()).filter((t): t is number => t !== undefined);
  return times.length ? Math.min(...times) : null;
}

/** Explains the recommendation only; the side itself always comes from chooseDefaultSurvivor. */
function explain(a: MergeOneSide, b: MergeOneSide): SurvivorWhy {
  if (!!a.profileKey !== !!b.profileKey) return "profile_key";
  const ea = earliest(a);
  const eb = earliest(b);
  if (ea !== eb && (ea !== null || eb !== null)) return "earliest_connection";
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return "earlier_created";
  return "tie_defaults_to_a";
}

export function planMergeOne(input: MergeOneInput): MergeOnePlan {
  const { candidate, a, b, survivorArg } = input;
  if (candidate.status !== "open") return refuse(`Candidate is '${candidate.status}', not open.`);
  if (a.id !== candidate.personAId || b.id !== candidate.personBId) return refuse("Loaded people do not match the candidate's pair.");
  if (a.mergedIntoId || b.mergedIntoId) return refuse("One of the people is already merged away.");

  const side = chooseDefaultSurvivor(a, a.connections, b, b.connections);
  const survivor = side === "a" ? a : b;
  const merged = side === "a" ? b : a;
  if (survivorArg !== null) {
    if (survivorArg !== a.id && survivorArg !== b.id) return refuse("--survivor is not one of the two people in this candidate.");
    if (survivorArg !== survivor.id) return refuse("--survivor disagrees with the default survivor the /admin/duplicates UI would pick: refusing, not guessing.");
  }
  const loss = checkSurvivorLoss({ survivorProfileKey: survivor.profileKey, survivorConnections: survivor.connections, mergedProfileKey: merged.profileKey, mergedConnections: merged.connections });
  if (loss.losesGmailMessages) return refuse("The survivor would lose synced Gmail messages the other side has.");
  if (loss.losesProfileKey) return refuse("The survivor would lose a LinkedIn profile key the other side has.");
  return { kind: "merge", survivorId: survivor.id, mergedId: merged.id, reason: candidate.reason, why: explain(a, b) };
}
