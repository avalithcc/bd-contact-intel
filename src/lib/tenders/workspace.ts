import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tender, tenderDocument } from "@/db/schema";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { isUuid } from "@/lib/uuid";
import { normalizeNote } from "./note";
import { toTenderAnalysis, type TenderAnalysis } from "./analysis";
import type { TenderDetail, TenderEventKind } from "./detail";
import { tenderTiming } from "./timing";

/** The log shows the most recent movements; a tender worked over months stays well under this. */
export const TENDER_EVENT_LIMIT = 100;
interface RawDocument {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string | null;
  analysis: unknown;
  analyzedAt: string | null;
  analyzedBy: string | null;
}
interface RawEvent {
  id: string;
  kind: string;
  detail: TenderDetail["events"][number]["detail"];
  createdAt: string;
  actor: string | null;
}

// Literal `tender.id`, not an interpolated column: a reused Column inside a nested raw subquery renders unqualified in this
// drizzle version and the correlation silently becomes always-false (PERFORMANCE.md).
const documentsJson = sql`(
  select coalesce(json_agg(x order by x."createdAt" desc), '[]'::json) from (
    select d.id, d.filename, d.size_bytes as "sizeBytes", d.created_at as "createdAt", u.name as "uploadedBy",
           d.analysis, d.analyzed_at as "analyzedAt", a.name as "analyzedBy"
    from tender_document d
    left join bd u on u.id = d.uploaded_by_bd_id
    left join bd a on a.id = d.analyzed_by_bd_id
    where d.tender_id = tender.id
  ) x)`;
const eventsJson = sql`(
  select coalesce(json_agg(y order by y."createdAt" desc), '[]'::json) from (
    select e.id, e.kind, e.detail, e.created_at as "createdAt", b.name as actor
    from tender_event e
    left join bd b on b.id = e.actor_bd_id
    where e.tender_id = tender.id
    order by e.created_at desc
    limit ${TENDER_EVENT_LIMIT}
  ) y)`;

/**
 * Everything the ficha shows in ONE round trip: the tender row with its documents and its log as two json subqueries.
 * Timestamps inside the json arrive as strings and are turned back into Dates here. Null when the id matches nothing or
 * is not a uuid.
 */
export async function getTenderDetail(id: string, now: Date = new Date(), database: Pick<typeof db, "select"> = db): Promise<TenderDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await database
    .select({ t: tender, docs: documentsJson.mapWith((v) => v as RawDocument[]), events: eventsJson.mapWith((v) => v as RawEvent[]) })
    .from(tender)
    .where(eq(tender.id, id))
    .limit(1);
  if (!row) return null;
  return {
    tender: { ...row.t, ...tenderTiming(row.t.openingAt, now) },
    documents: row.docs.map((d) => ({
      ...d,
      createdAt: parseDbTimestamp(d.createdAt),
      analysis: toTenderAnalysis(d.analysis),
      analyzedAt: d.analyzedAt ? parseDbTimestamp(d.analyzedAt) : null,
    })),
    events: row.events.map((e) => ({ ...e, kind: e.kind as TenderEventKind, createdAt: parseDbTimestamp(e.createdAt) })),
  };
}

/** Rows of a raw `db.execute`: postgres-js returns the array itself. */
const rowsOf = <T>(r: unknown) => r as T[];

// `clock_timestamp()`, not `now()`: inside one transaction `now()` is frozen, and two entries written together must still
// sort in the order they happened.
/** Saves (or clears) the note and logs it, in ONE statement; an unchanged note writes nothing and logs nothing. False when the tender does not exist. */
export async function saveTenderNote(id: string, raw: string, actorBdId: string, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  if (!isUuid(id)) return false;
  const note = normalizeNote(raw);
  const rows = rowsOf<{ found: number }>(
    await database.execute(sql`
      with old as (select note from tender where id = ${id}::uuid),
      upd as (update tender set note = ${note}::text, updated_at = now() where id = ${id}::uuid returning id),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select upd.id, ${actorBdId}::uuid, 'note', jsonb_build_object('text', coalesce(${note}::text, '')), clock_timestamp()
        from upd, old where old.note is distinct from ${note}::text
        returning 1
      )
      select (select count(*) from upd)::int as found`),
  );
  return (rows[0]?.found ?? 0) > 0;
}

/** Registers an uploaded pliego as the tender's newest document and logs it, in ONE statement. Null when the tender does not exist. */
export async function addTenderDocument(
  input: { tenderId: string; storagePath: string; filename: string; sizeBytes: number; actorBdId: string },
  database: Pick<typeof db, "execute"> = db,
): Promise<string | null> {
  if (!isUuid(input.tenderId)) return null;
  const rows = rowsOf<{ id: string }>(
    await database.execute(sql`
      with doc as (
        insert into tender_document (tender_id, storage_path, filename, size_bytes, uploaded_by_bd_id, created_at)
        select t.id, ${input.storagePath}, ${input.filename}, ${input.sizeBytes}::int, ${input.actorBdId}::uuid, clock_timestamp()
        from tender t where t.id = ${input.tenderId}::uuid
        returning id, tender_id
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select doc.tender_id, ${input.actorBdId}::uuid, 'document', jsonb_build_object('filename', ${input.filename}::text), clock_timestamp() from doc
        returning 1
      )
      select id from doc`),
  );
  return rows[0]?.id ?? null;
}

/** The document the analysis must read: the newest upload of the tender, or null when there is none. */
export async function getCurrentTenderDocument(tenderId: string, database: Pick<typeof db, "select"> = db) {
  if (!isUuid(tenderId)) return null;
  const [row] = await database.select().from(tenderDocument).where(eq(tenderDocument.tenderId, tenderId)).orderBy(desc(tenderDocument.createdAt)).limit(1);
  return row ?? null;
}

/** Stores the reading ON the document it came from and logs it, in ONE statement. False when the document no longer exists. */
export async function saveTenderAnalysis(documentId: string, analysis: TenderAnalysis, actorBdId: string, database: Pick<typeof db, "execute"> = db): Promise<boolean> {
  if (!isUuid(documentId)) return false;
  const rows = rowsOf<{ id: string }>(
    await database.execute(sql`
      with upd as (
        update tender_document set analysis = ${JSON.stringify(analysis)}::jsonb, analyzed_at = clock_timestamp(), analyzed_by_bd_id = ${actorBdId}::uuid
        where id = ${documentId}::uuid returning id, tender_id, filename
      ),
      ev as (
        insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
        select upd.tender_id, ${actorBdId}::uuid, 'analysis', jsonb_build_object('filename', upd.filename), clock_timestamp() from upd
        returning 1
      )
      select id from upd`),
  );
  return rows.length > 0;
}
