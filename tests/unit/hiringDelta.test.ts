import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POSTING_DELTA_WINDOW_DAYS,
  countedBeforeDeltaWindowSql,
} from "@/lib/hiring/openPosting";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  companyContactsHref,
  compareByVacancies,
  formatDeltaAmount,
  hiringDelta,
  marketLine,
} from "@/lib/hiring/delta";

const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(q).sql.replace(/\s+/g, " ");

test("the delta is today's counted total minus the total counted 7 days ago", () => {
  assert.deepEqual(hiringDelta({ total: 38, previous: 26 }), { kind: "up", amount: 12 });
  assert.deepEqual(hiringDelta({ total: 15, previous: 17 }), { kind: "down", amount: 2 });
  assert.deepEqual(hiringDelta({ total: 20, previous: 20 }), { kind: "none" });
  // Postings aging out of the 30-day window are a drop even though nothing closed: 20 -> 12 must show.
  assert.deepEqual(hiringDelta({ total: 12, previous: 20 }), { kind: "down", amount: 8 });
});

test("a company with nothing counted a week ago is new on the radar", () => {
  assert.deepEqual(hiringDelta({ total: 9, previous: 0 }), { kind: "new" });
  // It had counted postings last week (all since closed), so it was on the radar all along.
  assert.deepEqual(hiringDelta({ total: 3, previous: 2 }), { kind: "up", amount: 1 });
});

test("under a market filter new-on-radar is suppressed: the view cannot speak for the whole company", () => {
  assert.deepEqual(hiringDelta({ total: 3, previous: 0, filtered: true }), { kind: "up", amount: 3 });
  assert.deepEqual(hiringDelta({ total: 5, previous: 2, filtered: true }), { kind: "up", amount: 3 });
  assert.deepEqual(hiringDelta({ total: 0, previous: 0, filtered: true }), { kind: "none" });
});

test("the contacts link carries the company key, never the display name", () => {
  assert.equal(companyContactsHref("meta"), "/?companyKey=meta");
  assert.equal(companyContactsHref("a&b c"), "/?companyKey=a%26b%20c");
});

test("the amount is signed with the real minus sign", () => {
  assert.equal(formatDeltaAmount({ kind: "up", amount: 12 }), "+12");
  assert.equal(formatDeltaAmount({ kind: "down", amount: 2 }), "−2");
  assert.equal(formatDeltaAmount({ kind: "none" }), "");
  assert.equal(formatDeltaAmount({ kind: "new" }), "");
});

const labels = { latam: "LATAM", us: "US", miami: "Miami" };

test("the market line omits zero markets and works for one, two and three markets", () => {
  assert.equal(marketLine({ latam: 31, us: 7, miami: 2 }, labels), "31 LATAM · 7 US · 2 Miami");
  assert.equal(marketLine({ latam: 18, us: 3, miami: 0 }, labels), "18 LATAM · 3 US");
  assert.equal(marketLine({ latam: 15, us: 0, miami: 0 }, labels), "15 LATAM");
  assert.equal(marketLine({ latam: 0, us: 0, miami: 4 }, labels), "4 Miami");
  assert.equal(marketLine({ latam: 0, us: 0, miami: 0 }, labels), "");
});

test("companies sort by vacancies descending, ties by name", () => {
  const rows = [
    { displayName: "Kavak", openItCount: 7 },
    { displayName: "Mercado Libre", openItCount: 38 },
    { displayName: "Aaa", openItCount: 7 },
    { displayName: "TOTVS", openItCount: 15 },
  ];
  assert.deepEqual(
    [...rows].sort(compareByVacancies).map((r) => r.displayName),
    ["Mercado Libre", "TOTVS", "Aaa", "Kavak"],
  );
});

test("the delta SQL evaluates the same freshness rule as of 7 days ago", () => {
  assert.equal(POSTING_DELTA_WINDOW_DAYS, 7);
  assert.equal(
    render(countedBeforeDeltaWindowSql("jp")),
    "((jp.closed_at is null or jp.closed_at > now() - interval '7 days') and jp.first_seen <= now() - interval '7 days' and least(jp.posted_at, jp.first_seen) >= now() - interval '37 days')",
  );
});
