# scripts/measure — read-only production measurements

Everything in this directory **only reads**. No script here takes an `--execute`
flag, performs an `insert`, `update` or `delete`, or calls a function that writes.

## Why the directory exists

`.claude/settings.local.json` allowlists `npx tsx --env-file=.env scripts/measure/*`
so measurements can run without a permission prompt. The scripts that DO write to
production stay outside this directory on purpose and still require a human to run
them:

- `scripts/suppress-calendar-notification.ts`
- `scripts/merge-one-duplicate.ts`
- `scripts/merge-duplicates.ts`

## Rules for a script in here

1. Open with `set session characteristics as transaction read only` and print the
   result of `show transaction_read_only` so the guard is visible in the output,
   not assumed. Note that `set transaction read only` OUTSIDE a transaction is a
   no-op WARNING (25P01) — it must be the session form, or be inside a
   `db.transaction()`.
2. Call the application's own queries instead of transcribing their SQL. A
   re-derived query measures a different population than the screen does; that
   mistake has produced four wrong numbers in this project.
3. Never `select *` on a table holding credentials (`email_account` holds encrypted
   refresh tokens).
4. Print aggregates. Contact names and company names must not reach a PR body or
   any other shared artifact.
