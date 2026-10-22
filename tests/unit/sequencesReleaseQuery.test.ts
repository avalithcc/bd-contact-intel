import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Importing the module opens the (lazy) pool object, which needs a URL to exist; nothing here ever connects.
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:1/unused";
const render = async () => {
  const { buildCandidateFactsQuery } = await import("@/lib/sequences/releaseQueries");
  const keys = sql`(${"00000000-0000-4000-8000-000000000001"}::uuid, ${1}::int)`;
  const q = new PgDialect().sqlToQuery(buildCandidateFactsQuery(keys, "2026-01-01T00:00:00.000Z", sql``));
  return q.sql.replace(/\s+/g, " ");
};

test("the candidate read carries the sender's signature in the SAME statement: one more join, no new round trip", async () => {
  const text = await render();
  assert.match(text, /b\.signature_html as signature_html/);
  assert.match(text, /left join bd b on b\.id = ea\.bd_id/);
  assert.equal((text.match(/;/g) ?? []).length, 0, "a single statement");
  assert.equal((text.match(/\bfrom bd\b/g) ?? []).length, 0, "no per-row subquery on bd");
});
