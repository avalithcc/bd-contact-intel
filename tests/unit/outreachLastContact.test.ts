import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { person } from "@/db/schema";
import { NON_TOUCH_ACTIVITY_TYPES, effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { lastContactAtSql } from "@/lib/outreach/lastContact";

const dialect = new PgDialect();
const flat = (s: string) => s.replace(/\s+/g, " ");
const render = (s: ReturnType<typeof lastContactAtSql>) => dialect.sqlToQuery(s);

const built = () => render(lastContactAtSql(person.id, sql`max(pbc_agg.pbc_last_message_at)`));

test("last contact is greatest() of the activity touch time and the LinkedIn date", () => {
  const { sql: text } = built();
  assert.match(flat(text), /^greatest\(\(select max\(/);
  assert.ok(flat(text).endsWith(", max(pbc_agg.pbc_last_message_at))"), "LinkedIn date is the second greatest() argument");
});

test("the activity side is the project's own touch rule, not a copy of it", () => {
  const rule = dialect.sqlToQuery(effectiveActivityAtSql());
  const { sql: text, params } = built();
  assert.ok(flat(text).includes(flat(rule.sql)), "effectiveActivityAtSql() output is embedded verbatim");
  for (const t of NON_TOUCH_ACTIVITY_TYPES) assert.ok(params.includes(t), `non-touch type ${t} is excluded by the shared rule`);
});

test("the activity side is a correlated scalar subquery, never a join that could fan out sum(message_count)", () => {
  const { sql: text } = built();
  assert.match(flat(text), /from "activity" where "activity"\."person_id" = "person"\."id"\)/);
  assert.doesNotMatch(text, /\bjoin\b/i);
});

test("building the fragment twice from the same inputs gives the same SQL", () => {
  const a = built();
  const b = built();
  assert.deepEqual(a, b);
});
