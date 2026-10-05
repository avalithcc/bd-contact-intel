/**
 * An attempt that became a `call` ("Hablé") carries `metadata.callActivityId`.
 * Every timeline that lists activity must skip it, or the conversation shows
 * twice: the dial and the call. The row stays in the table; only reads fold it.
 * ONE fragment, used by the contact timeline and the company Activity tab.
 */
import { sql } from "drizzle-orm";
import { activity } from "@/db/schema";

export function notFoldedAttemptSql() {
  return sql`not (${activity.type} = 'call_attempt' and (${activity.metadata}->>'callActivityId') is not null)`;
}
