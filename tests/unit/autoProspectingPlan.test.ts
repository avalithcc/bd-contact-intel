/**
 * Auto-prospecting gates and planner (pure). Each gate replaces a human's eyes, so each one is a refusal, never a warning.
 * Fixtures come from the real producer of a candidate (`candidateFromRow`), never from a hand-built object.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AUTO_PROSPECTING_COOLDOWN_DAYS,
  DRAFTABLE_EMAIL_STATUSES,
  AUTO_PROSPECTING_DAILY_CAP,
  candidateFromRow,
  companyFactRefusal,
  planProspectRun,
  type CandidateRawRow,
} from "@/lib/prospecting/plan";
import { ENGLISH_LANGUAGE_COUNTRIES, SPANISH_LANGUAGE_COUNTRIES } from "@/lib/prospecting/language";
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";
import { DAILY_SEND_CAP_WARN_ABOVE, validateDailySendCap } from "@/lib/sequences/capValidation";
import { bd } from "@/db/schema";
import type { OutreachMessageCompany } from "@/lib/outreach/messagePrompt";

const NOW = new Date("2026-11-19T15:00:00Z");

function raw(over: Partial<CandidateRawRow> = {}): CandidateRawRow {
  return {
    signal_id: "s1",
    company_key: "acme",
    signal_data: { postingId: "p1", title: "Senior Backend Engineer", url: "https://x.test/1", location: "Remote, US" },
    person_id: "person-1",
    first_name: "Ana",
    last_name: "Lopez",
    job_title: "CTO",
    role_group: "c_level_tech",
    company: "Acme",
    preferred_language: null,
    country: "Argentina",
    email_status: "verified",
    bd_id: "bd-1",
    bd_name: "Bea",
    bd_signature_html: null,
    bd_enabled: true,
    bd_has_mailbox: true,
    in_active_sequence: false,
    open_follow_up: false,
    already_drafted: false,
    last_touch_at: null,
    ...over,
  };
}

const plan = (rows: CandidateRawRow[], drafted: Record<string, number> = {}) =>
  planProspectRun(rows.map(candidateFromRow), new Map(Object.entries(drafted)), NOW);

describe("gate 1 and the planner", () => {
  it("drafts for a verified decision-maker whose BD switched the feature on", () => {
    const [d] = plan([raw()]);
    assert.equal(d!.kind, "draft");
  });

  // Changed deliberately on 2026-11-19, not a regression: this test used to assert that a probable email was
  // refused. The owner opened gate 1 to probable AFTER the draft started landing in a Sequence unapproved, where
  // bulkApprovalGate refuses it until a human opens it. Verified-only existed to stop mail nobody read; the gate
  // does that now. 34 decision-makers with a fresh open role were blocked by the old rule and nothing else.
  it("drafts for a probable email, and still refuses an unknown or missing status", () => {
    const [ok] = plan([raw({ email_status: "probable" })]);
    assert.equal(ok!.kind, "draft");
    for (const status of [undefined, "bounced", "unknown"]) {
      const [d] = plan([raw({ email_status: status })]);
      assert.deepEqual([d!.kind, d!.kind === "refuse" ? d!.reason : null], ["refuse", "email_not_verified"], String(status));
    }
  });

  it("skips a contact with an active sequence", () => {
    const [d] = plan([raw({ in_active_sequence: true })]);
    assert.deepEqual([d!.kind, d!.kind === "refuse" ? d!.reason : null], ["refuse", "in_active_sequence"]);
  });

  it("skips a contact with an open follow-up", () => {
    const [d] = plan([raw({ open_follow_up: true })]);
    assert.deepEqual([d!.kind, d!.kind === "refuse" ? d!.reason : null], ["refuse", "open_follow_up"]);
  });

  it("skips a contact touched inside the cooldown, and lets one touched before it through", () => {
    const day = 86_400_000;
    const inside = new Date(NOW.getTime() - (AUTO_PROSPECTING_COOLDOWN_DAYS - 1) * day).toISOString();
    const before = new Date(NOW.getTime() - (AUTO_PROSPECTING_COOLDOWN_DAYS + 1) * day).toISOString();
    const [a] = plan([raw({ last_touch_at: inside })]);
    const [b] = plan([raw({ last_touch_at: before })]);
    assert.deepEqual([a!.kind, a!.kind === "refuse" ? a!.reason : null], ["refuse", "recent_outreach"]);
    assert.equal(b!.kind, "draft");
  });

  it("waits 90 days before cold-writing the same person again, and is NOT the follow-up queue's 5", () => {
    // The owner chose 90 on 2026-11-19. Pinned as a literal on purpose: this number is the only thing standing
    // between a silent prospect and repeated unanswered mail, because on this path nobody reads the draft first.
    // It must not drift back to FOLLOW_UP_ENTRY_DAYS, which answers a different question about people already in
    // a conversation - so that value is asserted to be different rather than merely unused.
    assert.equal(AUTO_PROSPECTING_COOLDOWN_DAYS, 90);
    assert.notEqual(AUTO_PROSPECTING_COOLDOWN_DAYS, FOLLOW_UP_ENTRY_DAYS);
  });

  it("never drafts twice for the same person", () => {
    const [d] = plan([raw({ already_drafted: true })]);
    assert.deepEqual([d!.kind, d!.kind === "refuse" ? d!.reason : null], ["refuse", "already_drafted"]);
  });

  it("falls to the next contact when the best one is in play", () => {
    const [d] = plan([raw({ in_active_sequence: true }), raw({ person_id: "person-2", first_name: "Bo" })]);
    assert.equal(d!.kind === "draft" ? d!.candidate.personId : null, "person-2");
  });

  it("is OFF by default: nothing is produced for a BD who has not enabled it, and nothing is recorded", () => {
    const decisions = plan([raw({ bd_enabled: false })]);
    assert.deepEqual(decisions.map((d) => d.kind), ["defer"]);
    assert.equal(bd.autoProspectingEnabled.default, false);
    assert.equal(bd.autoProspectingEnabled.notNull, true);
    const migration = readFileSync("drizzle/0070_auto_prospecting.sql", "utf8");
    assert.match(migration, /"auto_prospecting_enabled" boolean DEFAULT false NOT NULL/);
  });

  it("stops at the BD's daily cap and leaves the rest unconsumed", () => {
    const rows = [raw({ signal_id: "s1" }), raw({ signal_id: "s2", person_id: "person-2" })];
    const decisions = plan(rows, { "bd-1": AUTO_PROSPECTING_DAILY_CAP - 1 });
    assert.deepEqual(decisions.map((d) => d.kind), ["draft", "defer"]);
  });

  it("is pure: the same input twice gives the same plan and neither the rows nor the counts change", () => {
    const candidates = [raw(), raw({ signal_id: "s2", person_id: "person-2" })].map(candidateFromRow);
    const drafted = new Map([["bd-1", 1]]);
    const before = JSON.stringify([candidates, [...drafted]]);
    const first = planProspectRun(candidates, drafted, NOW);
    const second = planProspectRun(candidates, drafted, NOW);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify([candidates, [...drafted]]), before);
  });
});

const company = (over: Partial<OutreachMessageCompany> = {}): OutreachMessageCompany => ({
  displayName: "Acme",
  postings: [{ id: "p", title: "Backend", location: "US", market: "us", url: "u", postedAt: null, firstSeen: NOW }],
  totalCount: 1,
  latamCount: 0,
  usCount: 1,
  otherCount: 0,
  miamiCount: 0,
  offshoreCount: 0,
  ...over,
});

describe("gate 4: the language comes from the person's own country, and a guess is a refusal", () => {
  const out = (o: Partial<CandidateRawRow>) => {
    const [d] = plan([raw(o)]);
    return d!.kind === "draft" ? ["draft", d!.candidate.language] : [d!.kind, d!.kind === "refuse" ? d!.reason : null];
  };

  it("writes English to a US person and Spanish to an Argentine one", () => {
    assert.deepEqual(out({ country: "United States" }), ["draft", "en"]);
    assert.deepEqual(out({ country: "Argentina" }), ["draft", "es"]);
  });

  it("refuses a person with no country, and records why", () => {
    assert.deepEqual(out({ country: null }), ["refuse", "language_unknown"]);
    assert.deepEqual(out({ country: "  " }), ["refuse", "language_unknown"]);
  });

  it("refuses a country in neither list instead of falling back to a language", () => {
    for (const country of ["Germany", "India", "Brazil", "Brasil", "Atlantis"]) {
      assert.deepEqual(out({ country }), ["refuse", "language_unknown"], country);
    }
  });

  it("matches case- and accent-insensitively, and by the Spanish spelling too", () => {
    assert.deepEqual(out({ country: "UNITED STATES" }), ["draft", "en"]);
    assert.deepEqual(out({ country: "méxico" }), ["draft", "es"]);
    assert.deepEqual(out({ country: "Estados Unidos" }), ["draft", "en"]);
    assert.deepEqual(out({ country: "Perú" }), ["draft", "es"]);
  });

  it("lets a declared preferred_language win over the country", () => {
    assert.deepEqual(out({ country: "Argentina", preferred_language: "en" }), ["draft", "en"]);
    assert.deepEqual(out({ country: null, preferred_language: "es" }), ["draft", "es"]);
    assert.deepEqual(out({ country: "Germany", preferred_language: "en" }), ["draft", "en"]);
  });

  it("falls to the next leader who has a country when the best one has none", () => {
    const [d] = plan([raw({ country: null }), raw({ person_id: "person-2", country: "Mexico" })]);
    assert.equal(d!.kind === "draft" ? d!.candidate.personId : null, "person-2");
  });

  it("keeps both country lists explicit, disjoint, and Brazil out of Spanish", () => {
    assert.ok(!SPANISH_LANGUAGE_COUNTRIES.has("BR"));
    for (const iso of ENGLISH_LANGUAGE_COUNTRIES) assert.ok(!SPANISH_LANGUAGE_COUNTRIES.has(iso), iso);
  });
});

describe("gate 2: the generator can refuse", () => {
  it("writes from a named company with an open posting", () => {
    assert.equal(companyFactRefusal("Acme", company()), null);
  });

  it("refuses with no company name, including the literal that cost four emails", () => {
    for (const name of [null, "", "   ", "unknown", "Unknown", "n/a"]) {
      assert.equal(companyFactRefusal(name, company()), "no_company_name", String(name));
    }
  });

  it("refuses a recipient company that is the sender", () => {
    assert.equal(companyFactRefusal("Avalith SA", company({ displayName: "Avalith SA" })), "company_is_sender");
  });

  it("refuses with no open posting to point at", () => {
    assert.equal(companyFactRefusal("Acme", null), "no_open_posting");
    assert.equal(companyFactRefusal("Acme", company({ totalCount: 0, postings: [] })), "no_open_posting");
  });
});

describe("this path cannot send", () => {
  const files = [
    ...(readdirSync("src/lib/prospecting", { recursive: true }) as string[]).map((f) => `src/lib/prospecting/${f}`),
    ...(readdirSync("src/app/(app)/admin/auto-prospecting", { recursive: true }) as string[]).map((f) => `src/app/(app)/admin/auto-prospecting/${f}`),
    "scripts/auto-prospecting.ts",
  ].filter((f) => /\.tsx?$/.test(f));

  it("has code to inspect", () => assert.ok(files.length >= 4));

  it("imports nothing from the send, release, Gmail or schedule paths and never touches Sequences' bulk generation", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports) {
        assert.doesNotMatch(spec, /gmail|scheduledEmail|sendSchedule|sequences\/(release|run|compose|send)|email\/send|resend/i, `${file} imports ${spec}`);
      }
      assert.doesNotMatch(text, /generateMissingDrafts|sendMail|sendEmail|sendGmail/, `${file} references a send or bulk-generate path`);
    }
  });
});

describe("the dedicated Sequence needs a mailbox", () => {
  it("defers, without refusing or consuming, a BD with no connected mailbox", () => {
    const [d] = plan([raw({ bd_has_mailbox: false })]);
    assert.deepEqual([d!.kind, d!.kind === "defer" ? d!.reason : null], ["defer", "no_mailbox"]);
  });

  it("planning twice from the same input gives the same answer", () => {
    const candidates = [raw(), raw({ signal_id: "s2", person_id: "person-2", bd_has_mailbox: false })].map(candidateFromRow);
    const before = JSON.stringify(candidates);
    const drafted = new Map([["bd-1", 1]]);
    assert.deepEqual(planProspectRun(candidates, drafted, NOW), planProspectRun(candidates, drafted, NOW));
    assert.equal(JSON.stringify(candidates), before);
    assert.deepEqual([...drafted], [["bd-1", 1]]);
  });
});

describe("probable is enough to draft, never enough to send", () => {
  // Owner's decision, 2026-11-19. Both halves are pinned here on purpose: the first alone would let a future
  // auto-send path inherit the looser rule by reusing the constant, which is exactly the mistake to prevent.
  it("accepts a probable email for DRAFTING, and keeps unknown or missing statuses out", () => {
    assert.deepEqual([...DRAFTABLE_EMAIL_STATUSES], ["verified", "probable"]);
    const draftable = (status: string | null) =>
      (DRAFTABLE_EMAIL_STATUSES as readonly string[]).includes(status ?? "");
    assert.ok(draftable("verified"));
    assert.ok(draftable("probable"));
    for (const s of [null, "", "bounced", "unknown", "invalid"]) assert.ok(!draftable(s), String(s));
  });

  it("the producer's SQL accepts exactly the same statuses as the planner's gate 1", () => {
    // A signal produced for someone the planner then refuses is wasted work; the reverse hides opportunities
    // silently. They are two languages expressing one rule, so drift is only visible if something asserts it.
    const sqlSrc = readFileSync("src/lib/prospecting/producer.ts", "utf8");
    for (const status of DRAFTABLE_EMAIL_STATUSES) {
      assert.ok(sqlSrc.includes(`'${status}'`), `producer SQL must accept ${status}`);
    }
    assert.ok(!/email_status = '/.test(sqlSrc), "producer must not pin a single status any more");
  });

  it("nothing in the prospecting path can send, so review is what makes probable safe", () => {
    // The guarantee behind the owner's decision: the draft reaches a Sequence unapproved and bulkApprovalGate
    // refuses it until a human opens it. If this ever fails, the probable rule above must be reverted with it.
    const SEND = /gmail|resend|scheduledEmail|sendSchedule|sequences\/(release|run|compose|send)|email\/send/i;
    for (const f of readdirSync("src/lib/prospecting")) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(`src/lib/prospecting/${f}`, "utf8");
      for (const line of src.split("\n")) {
        if (line.trimStart().startsWith("import") || line.includes("require(")) {
          assert.ok(!SEND.test(line), `${f} must not import a send path: ${line.trim()}`);
        }
      }
    }
  });
});

describe("the generation cap matches what the Sequence can send", () => {
  it("is 8, the same cap the owner's hand-made Sequences send at", () => {
    // The automatic Sequence was about to be created at 5 while every other one sent 8. Nobody would have noticed
    // except as a week of half-speed output, so both halves are pinned: the number, and the fact that one constant
    // feeds both the draft cap and the Sequence's send cap.
    assert.equal(AUTO_PROSPECTING_DAILY_CAP, 8);
    assert.equal(AUTO_PROSPECTING_DAILY_CAP, DAILY_SEND_CAP_WARN_ABOVE);
    const autoSeqSrc = readFileSync("src/lib/prospecting/autoSequence.ts", "utf8");
    assert.match(autoSeqSrc, /dailySendCap:\s*AUTO_PROSPECTING_DAILY_CAP/);
  });

  it("stays inside what the product accepts, so the Sequence can actually be created with it", () => {
    assert.deepEqual(validateDailySendCap(AUTO_PROSPECTING_DAILY_CAP), { ok: true, value: 8, warn: false });
  });
});
