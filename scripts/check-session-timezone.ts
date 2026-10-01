/**
 * Owner-run, strictly READ-ONLY gate for the timestamptz migration
 * (openspec/decisions/2026-10-01-timestamptz-slice-4-runbook.md).
 *
 * The app never sets a session TimeZone (src/db/index.ts passes no
 * `connection: { TimeZone }`, nothing runs `SET TIME ZONE`). Whether a mixed
 * `timestamp` vs `timestamptz` expression resolves in UTC therefore depends on
 * the Supabase database/role default, reached through the pooler. A
 * `show timezone` in an ad-hoc psql session does NOT prove the app's pooled
 * connection sees the same value, so this script goes through the app's own
 * client (`db` from src/db: same URL, same driver, same pool options).
 *
 * Reports `current_setting('TimeZone')`, `show timezone`, and the raw wire
 * string plus parsed `Date` of one `company.updated_at` (the lowest
 * company_key, so before/after runs sample the same row). Exits 1 with a loud
 * message unless the TimeZone is `UTC`.
 *
 * Everything runs in one `accessMode: "read only"` transaction, so Postgres
 * itself rejects any write for its lifetime.
 *
 * Usage (owner-run, requires DATABASE_URL):
 *
 *   npx tsx scripts/check-session-timezone.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { parseDbTimestamp } from "../src/lib/db/timestamp";

async function main(): Promise<number> {
  const out = await db.transaction(
    async (tx) => {
      const [setting] = await tx.execute<{ tz: string }>(sql`select current_setting('TimeZone') as tz`);
      const [shown] = await tx.execute<{ TimeZone: string }>(sql`show timezone`);
      const [sample] = await tx.execute<{ companyKey: string; updatedAt: string | Date }>(sql`
        select company_key as "companyKey", updated_at as "updatedAt"
        from company
        order by company_key
        limit 1
      `);
      return { setting: setting?.tz, shown: shown?.TimeZone, sample };
    },
    { accessMode: "read only" },
  );

  console.log(`current_setting('TimeZone'): ${out.setting}`);
  console.log(`show timezone:               ${out.shown}`);
  if (out.sample) {
    const raw = out.sample.updatedAt;
    console.log(`sample company_key:          ${out.sample.companyKey}`);
    console.log(`raw wire value:              ${JSON.stringify(raw)} (typeof ${typeof raw})`);
    console.log(`parsed Date (ISO):           ${parseDbTimestamp(raw).toISOString()}`);
  } else {
    console.log("sample company row:          (company table is empty)");
  }

  if (out.setting !== "UTC" || out.shown !== "UTC") {
    console.error(
      `\n!!! STOP: the app's pooled connection TimeZone is "${out.setting}" / "${out.shown}", NOT "UTC". !!!\n` +
        "!!! Mixed timestamp/timestamptz expressions will resolve in that zone. Do NOT run the ALTER. !!!",
    );
    return 1;
  }
  console.log("\nOK: the app's pooled connection resolves TimeZone to UTC.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
