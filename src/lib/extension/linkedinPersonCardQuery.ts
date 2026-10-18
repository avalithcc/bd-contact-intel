/**
 * The one read behind the extension's "En el CRM" card: the person, their owner and their latest activity in a
 * single statement (PERFORMANCE.md: round trips are the budget). The latest activity is a correlated scalar
 * subquery with LIMIT 1 ordered by the EFFECTIVE time (`status_backfill` uses `metadata.originalAt`, a call its
 * `occurredAt`), the same rule the contact list and timeline use. The correlation is written as literal SQL text
 * because Drizzle re-renders a reused column unqualified inside a nested template.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, person } from "@/db/schema";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { formatLastActivityLabel } from "@/lib/contacts/lastActivity";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { LinkedinPersonCard } from "@/lib/extension/linkedinLookup";
import type { getDictionary } from "@/lib/i18n/server";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

interface LastActivityJson {
  type: string;
  metadata: unknown;
  at: string | null;
}

export async function getLinkedinPersonCard(
  personId: string,
  dict: Dict,
  database: Pick<typeof db, "select"> = db,
): Promise<LinkedinPersonCard | null> {
  const [row] = await database
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      company: person.company,
      ownerName: bd.name,
      lastActivity: sql<LastActivityJson | null>`(
        select json_build_object('type', activity.type, 'metadata', activity.metadata, 'at', ${effectiveActivityAtSql()})
        from activity
        where activity.person_id = person.id
        order by ${effectiveActivityAtSql()} desc nulls last
        limit 1
      )`,
    })
    .from(person)
    .leftJoin(bd, eq(bd.id, person.ownerBdId))
    .where(eq(person.id, personId))
    .limit(1);
  if (!row) return null;

  // A pick whose effective time is NULL (only non-touch activity) reads as "no activity", as in the contact list.
  const last = row.lastActivity && row.lastActivity.at ? row.lastActivity : null;
  return {
    personId: row.id,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ") || "—",
    jobTitle: row.jobTitle,
    company: row.company,
    ownerName: row.ownerName,
    lastActivity: last
      ? { label: formatLastActivityLabel(last, dict), date: parseDbTimestamp(last.at as string).toISOString() }
      : null,
  };
}
