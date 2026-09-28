import { test } from "node:test";
import assert from "node:assert/strict";
import { toOpenPosting, resolveCanonicalCompanyKey } from "@/lib/hiring/postingRow";

// toOpenPosting: the row-shape mapper shared by resolveHiringCompanies (the
// whole-map path) and getCompanyPostingsForKey (the single-company scoped
// path added for the /companies/[key] perf fix), so both stay consistent
// with the "null market -> other" rule (see markets.ts backfill note).
test("toOpenPosting defaults a null market to 'other'", () => {
  const posting = toOpenPosting({
    id: "p1",
    title: "Backend Engineer",
    location: "Buenos Aires",
    market: null,
    url: "https://example.com/p1",
    postedAt: null,
    firstSeen: new Date("2024-01-01T00:00:00Z"),
  });
  assert.equal(posting.market, "other");
});

test("toOpenPosting passes through a classified market untouched", () => {
  const posting = toOpenPosting({
    id: "p2",
    title: "SRE",
    location: "Miami",
    market: "us",
    url: "https://example.com/p2",
    postedAt: new Date("2024-02-01T00:00:00Z"),
    firstSeen: new Date("2024-01-15T00:00:00Z"),
  });
  assert.equal(posting.market, "us");
  assert.equal(posting.id, "p2");
  assert.equal(posting.location, "Miami");
});

// resolveCanonicalCompanyKey: the pure reducer over the
// "target_company UNION company_alias" lookup used by
// getCompanyPostingsForKey's scoped path, so a company key that is itself
// canonical, one that only exists as an alias, and one that resolves to
// nothing are all covered without hitting the database.
test("resolveCanonicalCompanyKey returns the row's key when the union query found one", () => {
  assert.equal(resolveCanonicalCompanyKey([{ company_key: "acme" }]), "acme");
});

test("resolveCanonicalCompanyKey returns null when the company key resolves to nothing", () => {
  assert.equal(resolveCanonicalCompanyKey([]), null);
});
