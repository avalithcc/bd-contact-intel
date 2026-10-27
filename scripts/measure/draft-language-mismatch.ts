// Read-only: how many Sequence drafts would be flagged "wrong language" on day 1 if the draft's language were INFERRED from its
// opt-out sentence instead of stored. Counts only: no names, emails, subjects or bodies are printed.
// Usage: npx tsx --env-file=.env scripts/measure/draft-language-mismatch.ts
// "Today's language" is computed with the app's own functions (audienceFactsSql -> audienceInputsFromRow -> buildMemberAudience ->
// memberLanguage), the same ones the card uses, and cross-checked against resolveDraftLanguage on the resolveComplianceAudience result.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audienceFactsSql } from "@/lib/sequences/rosterQuery";
import { audienceInputsFromRow } from "@/lib/sequences/audienceInputs";
import { buildMemberAudience } from "@/lib/sequences/audienceView";
import { memberLanguage } from "@/lib/sequences/audienceCard";
import { resolveComplianceAudience, type AudienceLanguage } from "@/lib/sequences/complianceAudience";
import { resolveDraftLanguage } from "@/lib/sequences/languageChoice";
import { splitFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG, OPT_OUT_TEXT } from "@/lib/sequences/config";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
type Lang = AudienceLanguage | "unknown";

const MAX_ROWS = 20_000;

// Opt-out sentence inference: exactly one configured sentence present -> that language; none or both -> unknown.
function bySentence(body: string): Lang {
  const es = body.includes(OPT_OUT_TEXT.es);
  const en = body.includes(OPT_OUT_TEXT.en);
  return es && !en ? "es" : en && !es ? "en" : "unknown";
}

// Independent check on the BODY TEXT (not the footer): stopword scores. Only used to size the false-positive risk, never as a data source.
const ES_WORDS = new Set(["hola", "estimado", "estimada", "que", "para", "con", "los", "las", "una", "por", "nuestro", "nuestra", "equipo", "gracias", "saludos", "como", "sobre", "ayudar", "podemos", "somos", "tu", "te"]);
const EN_WORDS = new Set(["hi", "hello", "dear", "the", "and", "for", "with", "that", "this", "our", "team", "thanks", "regards", "about", "help", "can", "we", "your", "you"]);
function byBody(body: string): Lang {
  const message = splitFooter(body, COMPLIANCE_CONFIG)?.message ?? body;
  const words = message.toLowerCase().match(/[a-záéíóúñü]+/g) ?? [];
  const es = words.filter((w) => ES_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  if (es >= 3 && es >= en * 2) return "es";
  if (en >= 3 && en >= es * 2) return "en";
  return "unknown";
}

type Counter = Map<string, number>;
const bump = (c: Counter, key: string) => c.set(key, (c.get(key) ?? 0) + 1);
const show = (title: string, c: Counter) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...c].sort()) console.log(`  ${k}: ${v}`);
  if (!c.size) console.log("  (none)");
};

async function main() {
  await db.transaction(async (tx) => {
    await measure(tx);
  });
  process.exit(0);
}

async function measure(tx: Tx) {
  await tx.execute(sql`set transaction read only`);
  const guard = await tx.execute(sql`show transaction_read_only`);
  console.log(`transaction_read_only: ${(guard[0] as { transaction_read_only?: string }).transaction_read_only}`);

  const total = (await tx.execute(sql`select count(*)::int as n from sequence_draft`))[0] as { n: number };
  console.log(`sequence_draft rows (all states): ${total.n}`);
  if (total.n > MAX_ROWS) throw new Error(`refusing to read ${total.n} drafts (> ${MAX_ROWS}): paginate this script first`);

  const rows = (await tx.execute(sql`
    select sm.id::text as member_id, sm.state, sm.draft_language, p.preferred_language, ${audienceFactsSql},
           d.step, d.body, d.approved_at is not null as approved, d.edited_at is not null as edited, d.generated_at
    from sequence_draft d
    join sequence_member sm on sm.id = d.sequence_member_id
    join person p on p.id = sm.person_id
    order by sm.id, d.step`)) as unknown as Row[];

  // A draft is "live" when it can still go out: step 1 of a drafted/approved member, step 2 of a sent member.
  const live = rows.filter((r) => (r.step === 1 ? ["drafted", "approved"].includes(r.state as string) : r.state === "sent"));
  console.log(`drafts read: ${rows.length}; live (can still be sent): ${live.length}`);

  const population = new Map<string, Row[]>([
    ["unapproved live drafts", live.filter((r) => !r.approved)],
    ["approved-but-unsent live drafts", live.filter((r) => r.approved)],
  ]);

  let oracleMismatch = 0;
  const todayOf = (r: Row): Lang => {
    const inputs = audienceInputsFromRow(r);
    const card = memberLanguage({
      audience: buildMemberAudience(inputs),
      languageChoice: r.draft_language ? { language: String(r.draft_language) } : null,
      preferredLanguage: r.preferred_language ? { language: String(r.preferred_language) } : null,
    })?.language ?? "unknown";
    const draftPath = resolveDraftLanguage(resolveComplianceAudience(inputs)?.language ?? null, { chosen: r.draft_language, preferred: r.preferred_language })?.language ?? "unknown";
    if (card !== draftPath) oracleMismatch += 1;
    return card;
  };

  for (const [label, set] of population) {
    console.log(`\n=== ${label}: ${set.length} ===`);
    const bySt: Counter = new Map();
    const inferred: Counter = new Map();
    const flagged: Counter = new Map();
    const falsePositive: Counter = new Map();
    for (const r of set) {
      const step = `step ${r.step}`;
      const body = String(r.body);
      const s = bySentence(body);
      const b = byBody(body);
      const today = todayOf(r);
      bump(inferred, `${step} sentence says ${s}`);
      bump(bySt, `${step} member state ${r.state}${r.edited ? " (hand-edited)" : ""}`);
      bump(inferred, `${step} today=${today}`);
      if (s !== "unknown" && today !== "unknown" && s !== today) {
        bump(flagged, `${step} sentence=${s} today=${today}`);
        bump(falsePositive, `${step} sentence=${s} today=${today} body-text looks ${b}`);
      }
    }
    show("by member state", bySt);
    show("sentence inference vs today's language", inferred);
    show("would be flagged on day 1 (sentence disagrees with today)", flagged);
    show("of those flagged, what the BODY TEXT looks like (stopword score, independent of the footer)", falsePositive);
  }

  // Same question over EVERY draft ever generated, to size the legacy English-sentence-on-Spanish-body population.
  const legacy: Counter = new Map();
  for (const r of rows) {
    const s = bySentence(String(r.body));
    const b = byBody(String(r.body));
    bump(legacy, `sentence=${s} body-text=${b}`);
  }
  show("ALL drafts (any state): opt-out sentence vs body text", legacy);

  // Step 2 vs step 1 of the same member, where both exist (all states).
  const byMember = new Map<string, Row[]>();
  for (const r of rows) byMember.set(r.member_id as string, [...(byMember.get(r.member_id as string) ?? []), r]);
  const pairs: Counter = new Map();
  for (const drafts of byMember.values()) {
    const d1 = drafts.find((d) => d.step === 1);
    const d2 = drafts.find((d) => d.step === 2);
    if (!d1 || !d2) continue;
    const l1 = bySentence(String(d1.body));
    const l2 = bySentence(String(d2.body));
    bump(pairs, `step1 sentence=${l1}, step2 sentence=${l2}${l1 !== "unknown" && l2 !== "unknown" && l1 !== l2 ? "  <- differ" : ""}`);
    const t = todayOf(d2);
    if (l1 !== "unknown" && t !== "unknown" && l1 !== t) bump(pairs, `step1 sentence=${l1} but today=${t} (a reminder written now would not follow step 1)`);
  }
  show("members with both steps: step 1 vs step 2 sentence", pairs);

  console.log(`\noracle check (memberLanguage vs resolveDraftLanguage on resolveComplianceAudience) disagreements: ${oracleMismatch}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
