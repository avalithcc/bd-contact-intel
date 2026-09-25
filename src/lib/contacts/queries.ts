/**
 * Read side of the unified Contact record page (`/contacts/[id]`, design D1;
 * contact-record spec). Not `bdId`-scoped (contact-record spec "Visibility:
 * shared team-wide record" — this change's proposal explicitly drops
 * per-BD scoping on Contact reads).
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bd, person, personBdConnection, personPropertyHistory, type Person } from "@/db/schema";
import { EDITABLE_PERSON_PROPERTIES, type EditablePersonProperty } from "@/lib/contacts/propertyEdit";

export interface ContactPropertyRow {
  key: EditablePersonProperty;
  value: string | null;
  // Raw evidence for the "last updated by X" hint (contact-identity R7) —
  // the page formats this into a display string with the current locale's
  // date formatter, since queries.ts stays presentation-agnostic.
  lastEdit: { bdName: string | null; at: Date } | null;
}

export interface ContactConnectionRow {
  bdId: string;
  bdName: string | null;
  connectedOn: string | null;
}

export interface ContactRecord {
  person: Person;
  ownerName: string | null;
  properties: ContactPropertyRow[];
  connections: ContactConnectionRow[];
}

export type ContactRecordResult =
  | { kind: "not_found" }
  // A merged-away row (design D6): the caller must redirect to the
  // survivor, following the chain in case of a re-merge.
  | { kind: "redirect"; personId: string }
  | { kind: "found"; record: ContactRecord };

// Guards against a corrupt merge chain looping forever; a real chain is at
// most a handful of hops even after several re-merges.
const MAX_MERGE_HOPS = 10;

async function findPersonById(id: string): Promise<Person | undefined> {
  const [row] = await db.select().from(person).where(eq(person.id, id));
  return row;
}

/** Follows `merged_into_id` to the live survivor row, or `undefined` if the chain is broken/too long. */
async function resolveSurvivor(startId: string): Promise<Person | undefined> {
  let current = await findPersonById(startId);
  for (let hop = 0; current?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++) {
    current = await findPersonById(current.mergedIntoId);
  }
  return current?.mergedIntoId ? undefined : current;
}

export async function getContactRecord(id: string): Promise<ContactRecordResult> {
  const row = await findPersonById(id);
  if (!row) return { kind: "not_found" };

  if (row.mergedIntoId) {
    const survivor = await resolveSurvivor(row.mergedIntoId);
    return survivor ? { kind: "redirect", personId: survivor.id } : { kind: "not_found" };
  }

  const [ownerRow, connectionRows, historyRows] = await Promise.all([
    row.ownerBdId
      ? db.select({ name: bd.name }).from(bd).where(eq(bd.id, row.ownerBdId))
      : Promise.resolve([]),
    db
      .select({ bdId: personBdConnection.bdId, bdName: bd.name, connectedOn: personBdConnection.connectedOn })
      .from(personBdConnection)
      .leftJoin(bd, eq(bd.id, personBdConnection.bdId))
      .where(eq(personBdConnection.personId, row.id))
      .orderBy(asc(personBdConnection.connectedOn)),
    db
      .select({ property: personPropertyHistory.property, bdName: bd.name, at: personPropertyHistory.at })
      .from(personPropertyHistory)
      .leftJoin(bd, eq(bd.id, personPropertyHistory.changedByBdId))
      .where(and(eq(personPropertyHistory.personId, row.id)))
      .orderBy(desc(personPropertyHistory.at)),
  ]);

  // First row per property wins (rows are ordered newest-first).
  const latestEditByProperty = new Map<string, { bdName: string | null; at: Date }>();
  for (const h of historyRows) {
    if (!latestEditByProperty.has(h.property)) {
      latestEditByProperty.set(h.property, { bdName: h.bdName, at: h.at });
    }
  }

  const properties: ContactPropertyRow[] = EDITABLE_PERSON_PROPERTIES.map((key) => ({
    key,
    value: row[key] ?? null,
    lastEdit: latestEditByProperty.get(key) ?? null,
  }));

  return {
    kind: "found",
    record: {
      person: row,
      ownerName: ownerRow[0]?.name ?? null,
      properties,
      connections: connectionRows,
    },
  };
}
