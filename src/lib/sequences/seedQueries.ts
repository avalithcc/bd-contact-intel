/**
 * DB layer for the owner-gated seed of the first real Sequence (scripts/seed-outreach-sequence.ts). Every admission
 * decision lives in seedRoster.ts; this file resolves the hand-picked names to people, loads live row state, and
 * persists. Nothing here is reachable from the app: the script is run by hand, never imported by a route or a cron.
 *
 * The write (Sequence row, members, audit row) is ONE transaction. Draft generation is NOT inside it: it calls the
 * model once per member, and holding a transaction open across ten network calls is the wrong trade. Drafts go
 * through generateMissingDrafts (the real PR 6 path), each in its own transaction. A member is "drafted" the moment it
 * is inserted, with or without a draft, and this file never sets approved_at, sent_at or anything releasable.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, sequence, sequenceMember } from "@/db/schema";
import type { MarketKey } from "@/lib/hiring/markets";
import { draftLanguageForMarket } from "./draftInput";
import { recipientMarket } from "./recipientMarket";
import { clientStatusSql, companyCountrySql } from "./rosterQuery";
import { DEFAULT_SCHEDULE } from "./schedule";
import {
  SEED_DAILY_SEND_CAP,
  SEED_ROSTER,
  SEED_SEQUENCE_NAME,
  resolveSeedRoster,
  type SeedCandidate,
  type SeedResolution,
  type SeedRosterEntry,
} from "./seedRoster";
import { listSuppressionRules } from "./suppressionQueries";
import { openFreshPostingSql, openPostingSql } from "@/lib/hiring/openPosting";

export const SEED_AUDIT_ACTION = "seed_outreach_sequence";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];

export interface SeedOptions {
  /** The owner's bd id. Required to apply; a dry run falls back to the only admin. */
  actorBdId: string | null;
  apply: boolean;
  roster?: readonly SeedRosterEntry[];
  sequenceName?: string;
  /** Test seam for the model. The script never passes it. */
  draftDeps?: Record<string, unknown>;
}

export interface SeedLine {
  candidate: SeedCandidate;
  market: MarketKey;
  /** "en" | "es", or null when the market has no language (the member would be held, not drafted). */
  language: string | null;
}

export interface SeedPlan {
  owner: { id: string; name: string };
  account: { id: string; emailAddress: string };
  existingSequenceId: string | null;
  resolution: SeedResolution;
  lines: SeedLine[];
}

export interface SeedResult {
  plan: SeedPlan;
  applied: boolean;
  sequenceId: string | null;
  createdSequence: boolean;
  addedPersonIds: string[];
  auditLogId: string | null;
  drafts: { generated: number; failed: number; held: number; failures: { memberId: string; reason: string }[] } | null;
}

async function loadOwner(tx: Tx, actor: string | null) {
  const owners = rowsOf<{ id: string; name: string }>(
    await tx.execute(actor ? sql`select id::text, name from bd where id = ${actor}::uuid` : sql`select id::text, name from bd where role = 'admin'`),
  );
  if (owners.length !== 1) {
    throw new Error(actor ? `--actor ${actor} is not a bd.` : `Found ${owners.length} admin bds; pass --actor=<bd id> to say whose Sequence this is.`);
  }
  const [account] = rowsOf<{ id: string; email_address: string }>(
    await tx.execute(sql`select id::text, email_address from email_account where bd_id = ${owners[0].id}::uuid and status = 'connected'`),
  );
  if (!account) throw new Error(`${owners[0].name} has no connected email account, so there is nothing for the Sequence to send from.`);
  return { owner: owners[0], account: { id: account.id, emailAddress: account.email_address } };
}

/** One person per roster entry, or a loud failure naming every entry that matched zero or several people. */
async function loadCandidates(tx: Tx, roster: readonly SeedRosterEntry[]) {
  const problems: string[] = [];
  const found: { entry: SeedRosterEntry; row: Row }[] = [];
  for (const entry of roster) {
    const rows = rowsOf<Row>(
      await tx.execute(sql`
        select p.id::text as person_id, p.email, p.email_status, p.email_source, p.merged_into_id::text as merged_into_id,
               p.company_key, p.country as person_country, p.mobile_phone, p.phone, ${clientStatusSql} as client_status,
               ${companyCountrySql} as company_country,
               exists (select 1 from job_posting jp where jp.is_it = true and ${openFreshPostingSql("jp")} and jp.market = 'us'
                  and (jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))) as has_open_it_posting,
               coalesce((select json_agg(distinct jp.market) from job_posting jp where jp.is_it = true and ${openPostingSql("jp")}
                  and (jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))), '[]'::json) as posting_markets
        from person p
        where lower(btrim(concat_ws(' ', p.first_name, p.last_name))) = lower(${entry.name})
          and exists (select 1 from company c where lower(btrim(c.display_name)) = lower(${entry.company})
            and (c.company_key = p.company_key or c.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key)))`),
    );
    if (rows.length === 1) found.push({ entry, row: rows[0] });
    else problems.push(`${entry.name} @ ${entry.company}: ${rows.length === 0 ? "no person matches" : `${rows.length} people match (${rows.map((r) => r.person_id).join(", ")})`}`);
  }
  if (problems.length) throw new Error(`Cannot resolve the roster, nothing written. Never guessing between matches:\n- ${problems.join("\n- ")}`);
  return found.map(({ entry, row: r }): SeedLine => {
    const market = recipientMarket({ mobilePhone: r.mobile_phone as string | null, phone: r.phone as string | null, personCountry: r.person_country as string | null, companyCountry: r.company_country as string | null, postingMarkets: r.posting_markets as string[] });
    const candidate: SeedCandidate = {
      label: `${entry.name} @ ${entry.company}`,
      personId: r.person_id as string,
      email: r.email as string | null,
      emailStatus: r.email_status as string,
      emailSource: r.email_source as string | null,
      mergedIntoId: r.merged_into_id as string | null,
      companyKey: r.company_key as string | null,
      clientStatus: r.client_status as string | null,
      hasOpenItPosting: r.has_open_it_posting as boolean,
    };
    return { candidate, market, language: draftLanguageForMarket(market) };
  });
}

async function buildPlan(tx: Tx, opts: SeedOptions): Promise<SeedPlan> {
  const name = opts.sequenceName ?? SEED_SEQUENCE_NAME;
  const { owner, account } = await loadOwner(tx, opts.actorBdId);
  // Serializes two concurrent runs of the same name: there is no unique constraint on sequence.name.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`seed:${name}`}))`);
  const [existing] = rowsOf<{ id: string }>(await tx.execute(sql`select id::text from sequence where name = ${name} and owner_bd_id = ${owner.id}::uuid order by created_at limit 1`));
  const members = existing
    ? rowsOf<{ person_id: string; company_key: string | null; state: string }>(
        await tx.execute(sql`select sm.person_id::text, p.company_key, sm.state from sequence_member sm join person p on p.id = sm.person_id where sm.sequence_id = ${existing.id}::uuid`),
      )
    : [];
  const activeCountByCompany = new Map<string, number>();
  for (const m of members) if (m.state !== "discarded" && m.company_key) activeCountByCompany.set(m.company_key, (activeCountByCompany.get(m.company_key) ?? 0) + 1);

  const lines = await loadCandidates(tx, opts.roster ?? SEED_ROSTER);
  const resolution = resolveSeedRoster(lines.map((l) => l.candidate), {
    suppressionRules: await listSuppressionRules(),
    alreadyMemberPersonIds: new Set(members.map((m) => m.person_id)),
    activeCountByCompany,
  });
  return { owner, account, existingSequenceId: existing?.id ?? null, resolution, lines };
}

/** Plans (always) and, with `apply`, writes. Without `apply` the whole thing runs in a READ ONLY transaction. */
export async function seedFirstSequence(opts: SeedOptions): Promise<SeedResult> {
  if (opts.apply && !opts.actorBdId) throw new Error("--apply requires --actor=<bd id> for the audit log.");
  const name = opts.sequenceName ?? SEED_SEQUENCE_NAME;
  const written = await db.transaction(async (tx) => {
    if (!opts.apply) await tx.execute(sql`set transaction read only`);
    const plan = await buildPlan(tx, opts);
    const base = { plan, applied: false, sequenceId: plan.existingSequenceId, createdSequence: false, addedPersonIds: [] as string[], auditLogId: null as string | null, drafts: null };
    // Nothing admitted means nothing to write: no empty Sequence and no audit row for a no-op.
    if (!opts.apply || !plan.resolution.admitted.length) return base;
    let sequenceId = plan.existingSequenceId;
    if (!sequenceId) {
      [{ id: sequenceId }] = await tx
        .insert(sequence)
        .values({ name, ownerBdId: plan.owner.id, emailAccountId: plan.account.id, dailySendCap: SEED_DAILY_SEND_CAP, schedule: DEFAULT_SCHEDULE })
        .returning({ id: sequence.id });
    }
    const addedPersonIds = plan.resolution.admitted.map((c) => c.personId);
    // State 'drafted' and nothing else: no approved_at, no sent_at, no hold. Approval is a human act in a later PR.
    await tx.insert(sequenceMember).values(addedPersonIds.map((personId) => ({ sequenceId: sequenceId!, personId, state: "drafted" })));
    const [audit] = await tx
      .insert(auditLog)
      .values({
        actorBdId: opts.actorBdId!,
        action: SEED_AUDIT_ACTION,
        metadata: {
          sequenceId,
          sequenceName: name,
          createdSequence: !plan.existingSequenceId,
          addedPersonIds,
          rejected: plan.resolution.rejected.map((r) => ({ personId: r.candidate.personId, reason: r.reason })),
        },
      })
      .returning({ id: auditLog.id });
    return { ...base, applied: true, sequenceId, createdSequence: !plan.existingSequenceId, addedPersonIds, auditLogId: audit.id };
  });
  if (!opts.apply || !written.sequenceId) return written;
  // The real PR 6 path. On a re-run it finds nothing to draft and makes no model call.
  const { generateMissingDrafts } = await import("./draftQueries");
  const batch = await generateMissingDrafts(written.plan.owner.id, written.sequenceId, opts.draftDeps ?? {});
  const drafts = batch.ok ? { generated: batch.generated.length, failed: batch.failed.length, held: batch.held.length, failures: Object.entries(batch.reasons).map(([memberId, reason]) => ({ memberId, reason })) } : null;
  return { ...written, drafts };
}
