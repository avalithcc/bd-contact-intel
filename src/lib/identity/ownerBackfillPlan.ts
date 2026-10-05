/** Pure planner behind scripts/backfill-owner-last-worked.ts. Never mutates its input. */
import { decideOwner, type OwnerBasis, type OwnerConnection } from "@/lib/identity/ownerRule";

export interface OwnerBackfillInput {
  persons: readonly { id: string; ownerBdId: string | null }[];
  connections: readonly (OwnerConnection & { personId: string })[];
  touches: readonly { personId: string; bdId: string; at: Date }[];
  /** Persons whose owner was set by hand (see hasManualOwner). */
  manualPersonIds: ReadonlySet<string>;
}

export interface OwnerChange {
  personId: string;
  fromBdId: string | null;
  toBdId: string;
  basis: OwnerBasis;
}

export interface OwnerBackfillPlan {
  changes: OwnerChange[];
  unchanged: number;
  skippedManual: number;
}

function groupBy<T extends { personId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.personId);
    if (list) list.push(row);
    else map.set(row.personId, [row]);
  }
  return map;
}

export function planOwnerBackfill(input: OwnerBackfillInput): OwnerBackfillPlan {
  const connectionsByPerson = groupBy(input.connections);
  const touchesByPerson = groupBy(input.touches);
  const changes: OwnerChange[] = [];
  let unchanged = 0;
  let skippedManual = 0;
  for (const p of input.persons) {
    if (input.manualPersonIds.has(p.id)) {
      skippedManual++;
      continue;
    }
    const decision = decideOwner(connectionsByPerson.get(p.id) ?? [], touchesByPerson.get(p.id) ?? []);
    if (!decision || decision.bdId === p.ownerBdId) {
      unchanged++;
      continue;
    }
    changes.push({ personId: p.id, fromBdId: p.ownerBdId, toBdId: decision.bdId, basis: decision.basis });
  }
  return { changes, unchanged, skippedManual };
}
