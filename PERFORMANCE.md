# Performance standard

How this app is kept fast, written from what was actually measured against production in September 2026 — not from general advice. `DESIGN.md` governs how the app looks; this governs what it costs.

Read the first section before optimizing anything here. It inverts the instinct most people bring.

## The one thing that changes your instincts

**`Promise.all` does not parallelize database work in this app.**

Production runs a connection pool of `max: 3` (`src/db/index.ts`). Three connections process three queries at a time; past that, the promises interleave and the queries queue. Development runs `max: 5`, so **dev is faster than prod and hides this**.

Measured against production with the real `/contacts` query set:

| Pool | Wall time |
| --- | --- |
| `max: 1` (production until 2026-09-28) | 2482ms |
| `max: 3` (production now) | 1642ms |

**Do not raise `max` by reasoning from Postgres.** The budget is Supavisor's session-mode `pool_size`, not Postgres's 60 `max_connections`: every warm instance — production, previews, crons — holds up to `max` pooler slots. Reasoning from the 60 is exactly what caused the 2026-09-28 `EMAXCONNSESSION` incident. And **do not move to the transaction-mode pooler (port 6543)** to get around it: with postgres.js it hangs the app. Both are documented, with measurements, in `src/db/index.ts`.

Each round trip is latency, not work. Postgres executes most of this app's queries in 0.1–10ms; the rest of the wall time is the network. A query with bound parameters costs **two** round trips through the pooler, not one — `select 1` measured 222ms from a laptop, the same `select 1` with a 25-id `IN` list 445ms, while executing in 0.093ms.

So the lever is **the number of round trips**, not how you arrange them. Combining five small reads into one statement shortens the work. Wrapping five awaits in `Promise.all` reorders the same round trips and spends connections doing it.

Before adding a `Promise.all`, ask: *does this remove round trips, or just reorder them?*

## Quick path

Before you ship a page, a query, or a control:

1. **Count the round trips** one render costs, and one interaction costs. Read the data path; do not guess.
2. **Ask what actually changed.** If an interaction changes one region, it must not re-run the whole page's fan-out.
3. **Measure against production, read-only, before and after.** `node --env-file=.env.local --input-type=module -e '...'` from the repo root.
4. **After deploying, read the runtime logs.** Build and tests cannot see a whole class of failures.

## The rules

Each one exists because it was violated here and cost something real.

### Round trips are the budget

A one-entity question gets a scoped SQL filter — never load the dataset and scan it in JavaScript. `getCompanyPostingsForKey` fetched every posting across all ~88 target companies plus every alias row to answer about one company: **2.3s, the most expensive call on the contact record**.

A per-bucket loop is an N+1 in disguise even when each query is well formed. The board ran 5 statuses × (count + rows + two lookups) — **up to 20 serialized round trips for one screen**. Collapse with `GROUP BY` or a `ROW_NUMBER() OVER (PARTITION BY ...)` window, not with more promises.

### An interaction pays only for what it changes

A control that filters, sorts or toggles a region whose data the client already holds must be local state or a narrowly scoped server action — never a `<Link>` or `router.refresh()` that re-runs the page's whole `Promise.all`.

The contact record's timeline pills were links in a server component: each click re-rendered the record page — record, timeline, tasks, company, owner options — to filter a list already on screen. The owner's words were *"tarda mucho... como que carga de nuevo la página"*. It was.

**But navigation is often right.** When the list *is* the page — `/companies`, `/hiring`, `/whats-new`, `/tasks` — a server round trip keeps the URL shareable and the data fresh. The mistake is never "it navigates"; it is *re-running unrelated expensive work* to change one region.

### Do not recompute what a cache already covers

`resolveHiringCompanies()` has a `cache()`-wrapped entry point, `getHiringMatchIndex`, that exists to prevent double work. `getCompanyPostingsForKey` called the raw primitive underneath it, so the same computation ran twice per company-record render — **450ms to 2.3s wasted, every view**. The repo hit this same class of bug before with `getCurrentBd`.

Before adding a call site, check whether the function has a cached sibling.

### Counts are not free

`/contacts` recomputed six full-table counts over 26,606 persons on **every** interaction — including a pagination click that touches no view's filters. **~3.0s.** Badge counts derived from the same table as the main query should be computed once, cached, or invalidated from the write paths. A stale badge is acceptable; a wrong list is not.

### `LIMIT` even when it is small today

An admin screen with no visible pagination pressure is one growth cycle from an unbounded read. Add the `LIMIT` at the SQL level now.

### `force-dynamic` must be earned

It disables caching entirely. Justify it with an actual identity or session dependency in the query layer — a `bdId` the query really reads. If a page's queries ignore the caller (watch for `void bdId` and unused params), that is a caching decision, not a personalization one, and `revalidate` may be the right tool.

## Deploying is not finishing

The company record page crashed on **every** visit for a full day — React Server Components cannot serialize the formatter functions it passed to a client component. The response still returned **200**. Typecheck passed. 905 tests passed. The build was green.

It was found by reading Vercel's runtime logs.

Serialization errors, hydration mismatches and non-serializable props are invisible to the build by construction. **After every release, read the runtime logs.**

## What good already looks like here

| Example | Why |
| --- | --- |
| `RecordTabs.tsx` | Tab switching is pure client state; all tab content is fetched once, server-side. |
| `CompleteTaskButton.tsx` | One server action, client-controlled checkbox, no navigation. |
| `timelinePills.ts` + `requestGeneration.ts` | Three tiers — instant from cache, local filter when the loaded pool provably covers the request, scoped fetch only when it does not — with a generation guard so a superseded fetch no-ops. |
| The list reads in `listQueries.ts` | Counts and last-activity are batched into exactly two extra queries per page, never per row. |

## Checklist

- [ ] I counted the round trips this render and this interaction cost.
- [ ] Nothing re-runs that is unrelated to what changed.
- [ ] No single-entity question loads a whole dataset.
- [ ] No per-bucket loop where one grouped query would do.
- [ ] No raw primitive called where a `cache()` wrapper exists.
- [ ] Every read has a `LIMIT`.
- [ ] `force-dynamic`, if present, is justified by a real session dependency.
- [ ] I measured against production, read-only, before and after — and wrote both numbers in the PR.
- [ ] After the deploy, I read the runtime logs.

## Next step

Measurements belong in the PR description. "Faster" is not a measurement; "2.3s to 180ms, `getCompanyPostingsForKey`, measured against production" is.
