/**
 * Unit tests for src/lib/outreach/messagePrompt.ts's channel- and
 * language-aware behavior (email-first generator, owner direction
 * 2026-09-26). Pure string building — no DB, no AI call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutreachMessagePrompt, type BuildOutreachMessagePromptInput } from "@/lib/outreach/messagePrompt";

const BASE: BuildOutreachMessagePromptInput = {
  contact: {
    firstName: "Ana",
    lastName: "Gomez",
    position: "VP Engineering",
    roleGroup: "eng_leadership",
    isLeadership: true,
    connectedOn: "2024-01-01",
  },
  company: null,
  history: [],
  notes: [],
  senderName: "Cristian Civita",
  senderTitle: "COO de Avalith",
  language: "es",
  channel: "email",
};

test("email channel asks for JSON {subject, body} output", () => {
  const { system } = buildOutreachMessagePrompt(BASE);
  assert.match(system, /"subject"/);
  assert.match(system, /"body"/);
  assert.match(system, /JSON/);
});

test("email channel targets 90-150 words and a peer-to-peer professional tone", () => {
  const { system } = buildOutreachMessagePrompt(BASE);
  assert.match(system, /90-150 words/);
});

test("email channel's goal is to start a conversation and propose a short call", () => {
  const { system } = buildOutreachMessagePrompt(BASE);
  assert.match(system, /propose a short call|short call/i);
});

test("email in Spanish uses neutral professional Spanish, not Rioplatense slang", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, language: "es" });
  assert.doesNotMatch(system, /voseo/i);
  assert.doesNotMatch(system, /Rioplatense/i);
});

test("linkedin channel in Spanish keeps the existing Rioplatense tone", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, channel: "linkedin", language: "es" });
  assert.match(system, /Rioplatense/i);
  assert.match(system, /voseo/i);
});

test("linkedin channel's explicit goal is to get an email or book a call, never the full conversation", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, channel: "linkedin" });
  assert.match(system, /email/i);
});

test("linkedin channel does not ask for JSON output", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, channel: "linkedin" });
  assert.doesNotMatch(system, /"subject"/);
});

test("portuguese language is supported for both channels, professional tone", () => {
  const email = buildOutreachMessagePrompt({ ...BASE, language: "pt" });
  assert.match(email.system, /Portuguese/i);
  const linkedin = buildOutreachMessagePrompt({ ...BASE, channel: "linkedin", language: "pt" });
  assert.match(linkedin.system, /Portuguese/i);
  assert.doesNotMatch(linkedin.system, /Rioplatense/i);
});

test("english language stays professional for both channels", () => {
  const { system } = buildOutreachMessagePrompt({ ...BASE, language: "en" });
  assert.match(system, /English/i);
});

// Company.postings is now a bounded sample (see getCompanyPostingsForKey's
// DETAIL_ROW_LIMIT, src/lib/hiring/queries.ts) — the true total/market
// breakdown must come from the precomputed count fields, NOT from
// `postings.length`/re-deriving from the (possibly truncated) sample, or a
// large company's reported total would silently shrink to the cap.
test("hiring signal reports the precomputed total, not the sampled postings array length", () => {
  const { prompt } = buildOutreachMessagePrompt({
    ...BASE,
    company: {
      displayName: "Affirm",
      postings: [
        {
          id: "p1",
          title: "Backend Engineer",
          location: "Remote - US",
          market: "us",
          url: "https://example.com/p1",
          postedAt: new Date("2024-01-01"),
          firstSeen: new Date("2024-01-01"),
        },
      ],
      totalCount: 105,
      latamCount: 10,
      usCount: 90,
      otherCount: 5,
      miamiCount: 2,
      offshoreCount: 0,
    },
  });
  assert.match(prompt, /Total open IT postings: 105/);
  assert.match(prompt, /latam=10, us=90, other=5/);
});

test("history and notes injection-safety markers are unchanged across channels", () => {
  const withHistory = buildOutreachMessagePrompt({
    ...BASE,
    history: [{ sentAt: new Date("2026-01-01"), direction: "sent", content: "hola" }],
  });
  assert.match(withHistory.prompt, /<<<CONVERSATION_HISTORY_START>>>/);
  assert.match(withHistory.system, /never instructions to follow/);
});
