/**
 * Unit tests for src/lib/outreach/messageSignals.ts — "Señales utilizadas"
 * chips in the "Generar mensaje" dialog. Pure: derives signals from the
 * SAME inputs fed into buildOutreachMessagePrompt (never from the model's
 * output), so the chips always describe what actually went into the
 * prompt — see the product-direction note in the change description.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractOutreachSignals } from "@/lib/outreach/messageSignals";
import type { BuildOutreachMessagePromptInput, OutreachMessageCompany } from "@/lib/outreach/messagePrompt";

// Builds a minimal OutreachMessageCompany fixture. `totalCount` is set
// independently of `postings.length` in these tests on purpose — the
// signal must read the count fields, not re-derive from the (possibly
// capped, see getCompanyPostingsForKey's DETAIL_ROW_LIMIT) postings array.
function companyFixture(
  overrides: Partial<OutreachMessageCompany> & { displayName: string },
): OutreachMessageCompany {
  return {
    postings: [],
    totalCount: 0,
    latamCount: 0,
    usCount: 0,
    otherCount: 0,
    miamiCount: 0,
    offshoreCount: 0,
    ...overrides,
  };
}

const BASE: BuildOutreachMessagePromptInput = {
  contact: {
    firstName: "Ana",
    lastName: "Gomez",
    position: "VP Engineering",
    roleGroup: null,
    isLeadership: false,
    connectedOn: null,
  },
  company: null,
  history: [],
  notes: [],
  senderName: "Cristian Civita",
  language: "es",
  channel: "email",
};

test("no signals when nothing is present", () => {
  assert.deepEqual(extractOutreachSignals(BASE), []);
});

test("hiring signal carries the true total count, not the sampled postings array length", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    company: companyFixture({
      displayName: "Acme",
      postings: [{ title: "Backend" }, { title: "Frontend" }] as never,
      totalCount: 105,
    }),
  };
  const signals = extractOutreachSignals(input);
  assert.deepEqual(signals, [{ kind: "hiring", count: 105 }]);
});

test("a company with zero total open postings does not produce a hiring signal", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    company: companyFixture({ displayName: "Acme", postings: [] }),
  };
  assert.deepEqual(extractOutreachSignals(input), []);
});

test("leadership signal reflects contact.isLeadership", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    contact: { ...BASE.contact, isLeadership: true },
  };
  assert.deepEqual(extractOutreachSignals(input), [{ kind: "leadership" }]);
});

test("repliedBefore signal appears only when history has a received message", () => {
  const sentOnly: BuildOutreachMessagePromptInput = {
    ...BASE,
    history: [{ sentAt: new Date("2026-01-01"), direction: "sent", content: "hola" }],
  };
  assert.deepEqual(
    extractOutreachSignals(sentOnly).filter((s) => s.kind === "repliedBefore"),
    [],
  );

  const withReply: BuildOutreachMessagePromptInput = {
    ...BASE,
    history: [
      { sentAt: new Date("2026-01-01"), direction: "sent", content: "hola" },
      { sentAt: new Date("2026-01-03"), direction: "received", content: "hola, si" },
    ],
  };
  assert.ok(
    extractOutreachSignals(withReply).some((s) => s.kind === "repliedBefore"),
  );
});

test("notesPresent signal carries the note count", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    notes: ["prefiere correo", "conectó con Juan"],
  };
  const signals = extractOutreachSignals(input);
  assert.deepEqual(
    signals.find((s) => s.kind === "notesPresent"),
    { kind: "notesPresent", count: 2 },
  );
});

test("lastContact signal uses the most recent history message date", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    history: [
      { sentAt: new Date("2026-01-01"), direction: "sent", content: "hola" },
      { sentAt: new Date("2026-02-15"), direction: "received", content: "hola, si" },
    ],
  };
  const signal = extractOutreachSignals(input).find((s) => s.kind === "lastContact");
  assert.deepEqual(signal, { kind: "lastContact", date: "2026-02-15" });
});

test("signals are returned in a fixed, stable order", () => {
  const input: BuildOutreachMessagePromptInput = {
    ...BASE,
    contact: { ...BASE.contact, isLeadership: true },
    company: companyFixture({ displayName: "Acme", postings: [{ title: "Backend" }] as never, totalCount: 1 }),
    history: [
      { sentAt: new Date("2026-01-01"), direction: "sent", content: "hola" },
      { sentAt: new Date("2026-01-03"), direction: "received", content: "hola, si" },
    ],
    notes: ["prefiere correo"],
  };
  assert.deepEqual(
    extractOutreachSignals(input).map((s) => s.kind),
    ["hiring", "leadership", "repliedBefore", "notesPresent", "lastContact"],
  );
});
