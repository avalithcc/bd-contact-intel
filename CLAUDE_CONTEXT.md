# CLAUDE_CONTEXT.md

Handoff for the next session: the architecture, the work finished most recently, and the exact next steps.
Snapshot taken **2026-10-27**. `main` = `14ccafa7`.

---

## 1. Architecture

### Stack
| Layer | What |
|---|---|
| App | Next.js App Router (React) on Vercel with Fluid Compute. Desktop only. |
| Data | Supabase Postgres 17.6 through the pooler (session mode, port 5432). Drizzle ORM plus the `postgres` driver. |
| Auth | Supabase Auth via `@supabase/ssr`. |
| Mail | All CRM and Supabase auth mail goes through Resend as `notificaciones@crm.avalith.net`. Outreach is sent from each BD's Gmail account (`src/lib/gmail`). |
| UI | CSS Modules plus `src/app/design-system.css`. One design language: the HubSpot-style mockups in `openspec/changes/crm-hubspot-ux/mockups/styles.css`. Light mode only. The UI is always in Spanish (`src/lib/i18n/dictionaries/es.ts`; `en.ts` mirrors its keys). |
| Tests | `node:test` via tsx: `npm run test:unit`, and `npm run test:db` against the local scratch DB `bd_contact_intel_e2e`. Playwright for e2e. |
| CI | `.github/workflows/ci.yml` runs lint, typecheck and unit tests on Node 22 and 24 for every PR and every push to main. |

### Layout
- `src/app/(app)/`: pages, including contacts, companies, sequences, follow-ups, tasks, outreach, reuniones, hiring, admin and whats-new.
- `src/app/api/`: route handlers and cron endpoints.
- `src/lib/<domain>/`: domain logic, with queries, pure planners and server actions. The domains most relevant to current work:
  - `sequences/`: outreach drafts, compliance audience, approval, release and unsubscribe.
  - `followUp/`: the follow-up queue and its 5/10-day cycle.
  - `identity/`: dedup and merge.
  - `contacts/`: properties and property history.
  - `migration/`: the journal guard.
- `drizzle/`: SQL migrations, `meta/_journal.json` and the snapshots.
- `openspec/`: `BACKLOG.md`, plus one folder per change under `changes/<name>/`, which holds the mockups and a README with the decisions.
- `scripts/measure/`: **read-only** prod measurement scripts. They open one transaction, run `set transaction read only` and print counts only.

### Scheduled jobs
Vercel crons (daily only on the Hobby plan, in `vercel.json`):
- `hiring/sync` and `hiring/discover`
- `tasks/digest`
- `gmail/sync` and `gmail/reminders`
- `owners/recompute`
- `duplicates/rescan` at 06:30 UTC
- `follow-ups/expire` at 05:30 UTC (02:30 ART)
- `sequences/run` at 13:00 and 14:00 UTC

Jobs that run more often than daily use Supabase pg_cron, every 2 minutes.

### Key domain rules
- **Outreach audience** (`complianceAudience.ts`) is resolved in this order:
  1. the person's country;
  2. the colleagues' consensus: a strict majority (>50%) of at least 2 recognized colleagues;
  3. the company country, which is still used when the colleagues disagree, and then the card shows a warning;
  4. job postings;
  5. phone;
  6. HOLD.

  A sanctioned company country is never overridden. Argentina resolves to `mdp/es`; every other country resolves to `miami/<lang>`.
- **Draft language** (#439) is resolved in `resolveDraftLanguage` (`sequences/languageChoice.ts`), the single resolver that every producer uses:
  1. the one-off choice on that draft (`sequence_member.draft_language`);
  2. the contact's preferred language (`person.preferred_language`);
  3. the automatic audience chain.

  The preferred language never changes the legal address, the footer or a HOLD, and it never generates drafts by itself.
- **Follow-ups:**
  - An item enters at 5 days. Days 0–2 show in "Hoy" (capped at 10); days 3–9 show in "Vencidos".
  - On day 10 it is dropped automatically with a `follow_up_expired` activity in the timeline.
  - The count starts from `follow_up_queue_item.cycle_started_on`.
- **Bulk approval gate:** every draft has to be opened before a bulk approve. This is load-bearing, so never weaken it.
- **No bulk draft generation:** drafts are generated one contact at a time.

### Migration gotcha (critical)
The Drizzle migrator runs a journal entry only if its `when` is greater than the ledger's max `created_at`, and it never checks hashes. A stale `when` is **silently skipped** while it still prints "success".

- `src/lib/migration/journalGuard.ts` (`LAST_APPLIED_IDX`, `LEDGER_MAX_WHEN`) together with `tests/unit/migrationJournal*.test.ts` enforce this in CI.
- Bump those two constants **only after** the owner has applied the migration in prod.
- Always verify the result with `npx tsx --env-file=.env scripts/measure/migration-ledger.ts <table.column>`, not with drizzle's own message.

---

## 2. Working rules (owner)
- **Communication:** talk to the owner in Rioplatense Spanish (voseo). Code, comments, commits and docs are in English. Internal CRM copy uses voseo; prospect-facing copy uses neutral Spanish.
- **UX:** HubSpot logic and patterns, not its look. Every UI change needs an HTML **mockup approved by the owner first**. Search the existing mockups before designing anything new.
- **PR budget:** 400 lines of production code (comments, tests, docs and SQL excluded). Code beyond that needs the owner's OK. Never split tests from their code.
- **Before every commit:** lint plus unit tests. The `.claude/hooks/commit-gate.sh` hook enforces it.
- **Production writes** (migrations, `--execute` scripts) are run by the owner: prepare a verified command and a backup, then verify the result read-only yourself.
- **Git chores** (push, PR create, `gh pr merge`, branch and worktree cleanup) are done autonomously, **one command per Bash call** run from the main checkout. Allow rules do not match chained commands.
- **Secrets:** never read `.env` or `.env.local`. **The `DATABASE_URL` in `.env` is PRODUCTION.**
- **Commits:** conventional commits, with no AI attribution.
- **Agent flow:** a builder (ui-builder or data-builder) implements, then a fresh-context reviewer checks it, then a read-only verifier checks it against prod, and only then the merge.

---

## 3. Recently finished (all in prod and verified)
| PR | What |
|---|---|
| #432 | Backlog cleanup with evidence verified on 2026-10-26. |
| #433 | Commit gate proven, CI added, DB-suite flakes fixed, migration journal guard added. The prod ledger was reconciled (it had drifted: 0045–0058 were unrecorded). |
| #434 | Outreach audience decided from the colleagues' consensus before the company country. Wrong-language rate went from 14.8% to 8.3%, with 0 new HOLDs. |
| #438 | Follow-up cadence: entry at 5 days, a "Vencidos" section, and automatic drop on day 10 (migration 0062). |
| #439 | Per-contact **preferred language**: migration 0063, an editable "Idioma preferido" property, the "Guardar como idioma preferido" checkbox in the language dialog, and the reason shown on the audience card. |
| data | "Accenture Argentina" merged into Accenture (audit_log `6bf35fea…`; the backup is in `backups/`). |

---

## 4. In progress: PR #440 "draft written in the wrong language"
Branch `feat/draft-language-mismatch` @ `226df027`, worktree `.claude/worktrees/agent-a3e7b317398867633`.

**What it does.** It flags and blocks an unapproved draft whose language differs from the language the CRM would write in today.
- New column `sequence_draft.language`, written at generate, regenerate and reminder time. NULL means unknown and is never flagged. There is no backfill: inferring from the opt-out sentence produced 2 false flags out of 2.
- One predicate, `languageMismatch`, returns the reason `wrong_language`. It is checked in five places:
  - single approve;
  - bulk approve, all-or-nothing;
  - the pre-send/release re-check, which also holds drafts that were approved but not sent yet;
  - the member card;
  - the review dialog.
- There is no "approve anyway". The two ways out are:
  - "Regenerar en {idioma}", one contact at a time;
  - "Mantener en {idioma}", through the server action `keepDraftLanguage`, which writes the one-off with who and when.
- The step-2 reminder, and its unsubscribe page, are pinned to step 1's language.
- Holds are cleared only when they come from the draft itself (`DRAFT_HOLD_REASONS`: `unmapped_market`, `missing_footer`, `wrong_language`).
- The mockup was approved on 2026-10-27: `openspec/changes/draft-language-mismatch/mockups/`.

**Status:**
- [x] Built. About 285 production lines.
- [x] Reviewed twice: no blockers left, and every should-fix is applied.
- [x] Tests: unit 5681/5681, DB 212/212.
- [x] Migration **0064 applied in prod** and verified: 65 ledger rows, the column is present. `journalGuard` was bumped to idx 64 / `1_795_033_200_000`.
- [x] CI green on Node 22 and 24.
- [x] **Read-only prod verification passed:**
  - 0 drafts flagged.
  - The "Aprobar los N listos" count matches main (7 and 0).
  - 0 differences from main in the unsubscribe-page locale (40 tokens) and in draft signals (15 calls).
  - Detail-read timing is equal to main.
  - The private approval read was checked with a transcribed copy of its select, not by calling it.
- [ ] **Cosmetic gaps against the mockup** (found by the verifier, no functional impact):
  - Dialog alert (B1): the buttons sit to the right of the text instead of in a row below it. "Regenerar" has no icon. The language words and "Regenerar"/"Mantener" are not bold.
  - Card alert: the buttons are not wrapped in `div.row`.
  - A3: the hand-edited warning runs inline instead of after a line break. `reasonReset` and the A2 country-correction history are not implemented, because nothing records a reset.
  - Bulk bar notes: the counts are not bold, and the C2 extra sentence is missing.
  - Unrequested copy the owner has not seen: "Nada listo para aprobar" at 0 ready drafts.

---

## 5. Exact next steps
1. **Finish #440.** The read-only verification passed. The owner decides whether the cosmetic gaps are fixed before or after the merge. Merge from the main checkout, running each command separately:
   - `gh pr merge 440 --squash`
   - `git worktree remove .claude/worktrees/agent-a3e7b317398867633`
   - `git branch -D feat/draft-language-mismatch docs/draft-language-mismatch-mockup`
   - `git push origin --delete feat/draft-language-mismatch`
   - `git pull --ff-only`

   Then wait for the Vercel deploy to report success.
2. **Morning of 2026-10-28.** Check two things:
   - the first follow-up cycle rows appear;
   - the 02:30 ART `follow-ups/expire` cron ran cleanly. Watch the Vercel logs, and the drop count should be 0 on the first days.
3. **Backlog**, in suggested order (details in `openspec/BACKLOG.md`):
   - Market classifier: 182 plainly-US postings are filed as latam. The owner has to decide how to classify `ca` and `tn`.
   - Step 3 of email language: the footer address by sender entity. This is an owner and counsel decision (CAN-SPAM).
   - Duplicates: aliases on the Gorch company key, plus 59 prefix groups.
   - 230 nameless contacts.
   - Legacy threads whose step-1 language is NULL are not pinned. A safe partial inference exists (the Spanish opt-out sentence implies `es`) but it is not built.
   - The 12 live prod drafts stay unflagged until each one is regenerated.
   - Open/click tracking (deferred by the owner).
   - `SUPABASE_SERVICE_ROLE_KEY` for preview deployments.
4. **BD action:** Adrian @ Nubank's draft needs to be regenerated, for an older reason.
