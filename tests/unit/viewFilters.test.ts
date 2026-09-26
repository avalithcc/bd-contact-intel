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
  parseContactFilters,
  sanitizeContactFilters,
  serializeContactFilters,
  type ContactFilters,
} from "@/lib/contacts/viewFilters";

const CASES: ContactFilters[] = [
  {},
  { owner: "me" },
  { status: ["new"] },
  { status: ["new", "contacted"] },
  { emailVerified: true },
  { hiring: true },
  { owner: "me", status: ["new"], emailVerified: true, hiring: true },
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
