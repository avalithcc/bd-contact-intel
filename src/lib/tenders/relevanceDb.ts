import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isUuid } from "@/lib/uuid";
import { isRelevanceChoice, overrideFromChoice, type TenderRelevanceChoice } from "./relevance";

/**
 * A BD's call on one tender: "relevant", "irrelevant", or "auto" (take the call back, the model decides again). Writes ONLY
 * `relevance_override`, which no import ever touches, and logs the move in the same statement; choosing what is already set
 * logs nothing. False when the id matches nothing; throws on an invalid choice or id.
 */
export async function setTenderRelevance(
  id: string,
  choice: TenderRelevanceChoice,
  database: Pick<typeof db, "execute"> = db,
  actorBdId: string | null = null,
): Promise<boolean> {
  if (!isUuid(id)) throw new Error("setTenderRelevance: id must be a uuid");
  if (!isRelevanceChoice(choice)) throw new Error(`setTenderRelevance: unknown choice ${String(choice)}`);
  const override = overrideFromChoice(choice);
  const rows = (await database.execute(sql`
    with old as (select relevance_override from tender where id = ${id}::uuid),
    upd as (update tender set relevance_override = ${override}::boolean, updated_at = now() where id = ${id}::uuid returning id),
    ev as (
      insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
      select upd.id, ${actorBdId}::uuid, 'relevance', jsonb_build_object('to', ${choice}::text), clock_timestamp()
      from upd, old where old.relevance_override is distinct from ${override}::boolean
      returning 1
    )
    select (select count(*) from upd)::int as found`)) as unknown as { found: number }[];
  return (rows[0]?.found ?? 0) > 0;
}
