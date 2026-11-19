/**
 * Auto-prospecting gates and planner (pure). Each gate replaces a human's eyes, so each one is a refusal, never a warning.
 * Fixtures come from the real producer of a candidate (`candidateFromRow`), never from a hand-built object.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AUTO_PROSPECTING_COOLDOWN_DAYS,
  AUTO_PROSPECTING_DAILY_CAP,
  candidateFromRow,
  companyFactRefusal,
  planProspectRun,
  type CandidateRawRow,
} from "@/lib/prospecting/plan";
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";
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
    email_status: "verified",
    bd_id: "bd-1",
    bd_name: "Bea",
    bd_signature_html: null,
    bd_enabled: true,
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

  it("refuses a probable email: never drafts, records why", () => {
    const [d] = plan([raw({ email_status: "probable" })]);
    assert.deepEqual([d!.kind, d!.kind === "refuse" ? d!.reason : null], ["refuse", "email_not_verified"]);
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

  it("uses the cooldown the follow-up queue already uses, not an invented one", () => {
    assert.equal(AUTO_PROSPECTING_COOLDOWN_DAYS, FOLLOW_UP_ENTRY_DAYS);
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
