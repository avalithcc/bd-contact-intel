// Read side of scripts/cleanup-misattributed-inbound.ts, kept out of the script so a test can run it
// (the script runs main() on import). Imports `@/db`; see the script for the full rationale.
import { sql } from "drizzle-orm";
import type { db } from "@/db";

export interface WrongMatchRow {
  empId: string;
  emailMessageId: string;
  personId: string;
  gmailMessageId: string;
  bdId: string;
  activityId: string | null;
}

/**
 * One query: every wrong `email_message_person` row (inbound message,
 * matched person's email_normalized != the message's from_address) LEFT
 * JOINed to the `reply_received` activity it produced, if any survives
 * (a row can lack a matching activity if it was already cleaned up, or if
 * the platform-sent linking path — irrelevant for inbound — applied).
 */
export async function readWrongMatches(executor: Pick<typeof db, "execute">): Promise<WrongMatchRow[]> {
  const rows = await executor.execute<{
    emp_id: string;
    email_message_id: string;
    person_id: string;
    gmail_message_id: string;
    bd_id: string;
    activity_id: string | null;
  }>(sql`
    with wrong_matches as (
      select
        emp.id as emp_id,
        emp.email_message_id as email_message_id,
        emp.person_id as person_id,
        em.gmail_message_id as gmail_message_id,
        em.bd_id as bd_id
      from email_message_person emp
      join email_message em on em.id = emp.email_message_id
      join person p on p.id = emp.person_id
      where em.direction = 'inbound'
        and p.email_normalized is distinct from lower(trim(em.from_address))
        -- a thread attribution differs from the address on purpose; it is not a To/Cc misattribution
        and emp.match_confidence <> 'thread'
    )
    select
      wm.emp_id,
      wm.email_message_id,
      wm.person_id,
      wm.gmail_message_id,
      wm.bd_id,
      a.id as activity_id
    from wrong_matches wm
    left join activity a
      on a.person_id = wm.person_id
      and a.type = 'reply_received'
      and a.actor_bd_id = wm.bd_id
      and a.metadata->>'gmailMessageId' = wm.gmail_message_id
  `);

  return rows.map((r) => ({
    empId: r.emp_id,
    emailMessageId: r.email_message_id,
    personId: r.person_id,
    gmailMessageId: r.gmail_message_id,
    bdId: r.bd_id,
    activityId: r.activity_id,
  }));
}

