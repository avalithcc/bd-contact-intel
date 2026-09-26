/**
 * Unit tests for src/lib/contacts/viewFilters.ts (task 12.4; contact-list
 * spec "Central list, no per-BD scoping" / "Saved views as tabs"; design.md
 * "Routes": "`?view=`, filters and `?layout=board` all live in the query
 * string"). Pure serialize/parse pair — no DB — so a saved view's `filters`
 * jsonb and the `/contacts` query string never drift from the same shape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAdHocContactFilterOverrides,
  parseContactFilters,
  sanitizeContactFilters,
  serializeContactFilters,
  type ContactFilters,
} from "@/lib/contacts/viewFilters";

const SOME_BD_ID = "8f14e45f-ceea-467e-9a0c-8c6b4c3e3a1a";

const CASES: ContactFilters[] = [
  {},
  { owner: "me" },
  { owner: "unassigned" },
  { owner: SOME_BD_ID },
  { status: ["new"] },
  { status: ["new", "contacted"] },
  { emailVerified: true },
  { hiring: true },
  { industryGroup: "SaaS" },
  { seniority: "Manager" },
  { emailStatus: "probable" },
  {
    owner: SOME_BD_ID,
    status: ["new"],
    emailVerified: true,
    hiring: true,
    industryGroup: "SaaS",
    seniority: "Manager",
    emailStatus: "probable",
  },
];

test("serializeContactFilters -> parseContactFilters round-trips every filter combination", () => {
  for (const filters of CASES) {
    const params = serializeContactFilters(filters);
    const roundTripped = parseContactFilters(params);
    assert.deepEqual(roundTripped, filters);
  }
});

test("serializeContactFilters produces a query string parseable by URLSearchParams", () => {
  const params = serializeContactFilters({ owner: "me", status: ["new", "meeting"] });
  const fromQueryString = new URLSearchParams(params.toString());
  assert.deepEqual(parseContactFilters(fromQueryString), {
    owner: "me",
    status: ["new", "meeting"],
  });
});

test("parseContactFilters ignores an unknown owner value", () => {
  const params = new URLSearchParams("owner=someone-else");
  assert.deepEqual(parseContactFilters(params), {});
});

test("parseContactFilters drops unknown status values but keeps known ones", () => {
  const params = new URLSearchParams("status=new,not-a-status,meeting");
  assert.deepEqual(parseContactFilters(params), { status: ["new", "meeting"] });
});

test("parseContactFilters returns {} for an empty query string", () => {
  assert.deepEqual(parseContactFilters(new URLSearchParams()), {});
});

test("sanitizeContactFilters returns {} for malformed jsonb (not an object)", () => {
  assert.deepEqual(sanitizeContactFilters(null), {});
  assert.deepEqual(sanitizeContactFilters("garbage"), {});
  assert.deepEqual(sanitizeContactFilters(42), {});
  assert.deepEqual(sanitizeContactFilters([1, 2, 3]), {});
});

test("sanitizeContactFilters keeps only recognized keys and drops the rest", () => {
  assert.deepEqual(
    sanitizeContactFilters({ owner: "me", extra: "ignored", status: ["new", "bogus"] }),
    { owner: "me", status: ["new"] },
  );
});

test("sanitizeContactFilters coerces non-boolean emailVerified/hiring to absent", () => {
  assert.deepEqual(sanitizeContactFilters({ emailVerified: "yes", hiring: 1 }), {});
  assert.deepEqual(sanitizeContactFilters({ emailVerified: true, hiring: false }), {
    emailVerified: true,
  });
});

test("owner accepts 'me', 'unassigned', or a specific BD uuid; rejects anything else", () => {
  assert.deepEqual(parseContactFilters(new URLSearchParams("owner=unassigned")), {
    owner: "unassigned",
  });
  assert.deepEqual(parseContactFilters(new URLSearchParams(`owner=${SOME_BD_ID}`)), {
    owner: SOME_BD_ID,
  });
  assert.deepEqual(parseContactFilters(new URLSearchParams("owner=not-a-uuid")), {});
  assert.deepEqual(sanitizeContactFilters({ owner: "unassigned" }), { owner: "unassigned" });
  assert.deepEqual(sanitizeContactFilters({ owner: SOME_BD_ID }), { owner: SOME_BD_ID });
  assert.deepEqual(sanitizeContactFilters({ owner: "not-a-uuid" }), {});
});

test("industryGroup and seniority round-trip as plain strings; blank is absent", () => {
  assert.deepEqual(parseContactFilters(new URLSearchParams("industryGroup=SaaS")), {
    industryGroup: "SaaS",
  });
  assert.deepEqual(parseContactFilters(new URLSearchParams("seniority=Manager")), {
    seniority: "Manager",
  });
  assert.deepEqual(parseContactFilters(new URLSearchParams("industryGroup=")), {});
});

test("emailStatus accepts verified/probable/none only", () => {
  assert.deepEqual(parseContactFilters(new URLSearchParams("emailStatus=probable")), {
    emailStatus: "probable",
  });
  assert.deepEqual(parseContactFilters(new URLSearchParams("emailStatus=bogus")), {});
  assert.deepEqual(sanitizeContactFilters({ emailStatus: "verified" }), {
    emailStatus: "verified",
  });
});

test("applyAdHocContactFilterOverrides overrides an inherited view filter field-by-field, including explicit clear", () => {
  const base: ContactFilters = { owner: "me", status: ["new"] };
  // Explicit empty string clears the inherited owner filter.
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { owner: "" }), { status: ["new"] });
  // A valid explicit value overrides it.
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { owner: "unassigned" }), {
    owner: "unassigned",
    status: ["new"],
  });
  // An invalid value is ignored (base filter kept).
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { owner: "garbage" }), base);
  // A field absent from the raw input is left untouched.
  assert.deepEqual(applyAdHocContactFilterOverrides(base, {}), base);
  // Multiple ad-hoc fields at once.
  assert.deepEqual(
    applyAdHocContactFilterOverrides(base, { industryGroup: "SaaS", emailStatus: "probable" }),
    { owner: "me", status: ["new"], industryGroup: "SaaS", emailStatus: "probable" },
  );
});

test("applyAdHocContactFilterOverrides overrides status as a single ad-hoc pick (task 13.3 parity: ad-hoc status picker, not just system views)", () => {
  const base: ContactFilters = { status: ["new", "contacted"] };
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { status: "meeting" }), {
    status: ["meeting"],
  });
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { status: "" }), {});
  assert.deepEqual(applyAdHocContactFilterOverrides(base, { status: "bogus" }), base);
});
