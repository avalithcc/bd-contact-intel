# BD Contact Intelligence — Technical Design (v1)

> Status: design, pre-scaffold. Decided 2026-09-15.

## Stack
- **Next.js (App Router) + TypeScript** — single full-stack app, one deploy.
- **Postgres** via **Supabase** (managed DB + Auth) — fast start, auth handled.
- **Drizzle ORM** — lightweight, TS-native, explicit SQL. (Alternative: Prisma; Drizzle chosen for leanness.)
- Rationale: team is comfortable in full JS/TS; performance at this scale is driven by Postgres + indexes, not the framework.

## Data model (the core)

### `bd` (business developer / user)
- `id` (uuid, pk) — maps to Supabase auth user
- `name`, `email`

### `contact` (private to each BD)
- `id` (uuid, pk)
- `bd_id` (fk → bd) — owner; a contact row belongs to exactly one BD
- `profile_key` (text) — **normalized** LinkedIn profile URL (lowercased, stripped of query params / trailing slash). This is the identity used for dedup and overlap.
- `first_name`, `last_name`, `company`, `position`, `connected_on`, `email` (often blank)
- `industry` (text, nullable) — derived later (v2 enrichment)
- indexes: `(bd_id)`, `(bd_id, company)`, `(bd_id, position)`, `(profile_key)`

### Overlap — how "also in María's base" works
- No separate shared table needed for v1. Overlap = a query across `contact` on `profile_key`.
- To show overlap for a BD's contact: `SELECT bd.name FROM contact JOIN bd ON contact.bd_id = bd.id WHERE contact.profile_key = $key AND contact.bd_id <> $me`.
- `profile_key` is indexed → lookup is instant even across the whole team's rows.
- Privacy holds: a BD only ever sees the *owner's name*, never the other base's contact rows.

## Ingestion (CSV upload)
1. BD uploads `Connections.csv`.
2. Parse LinkedIn columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On.
3. Normalize URL → `profile_key`.
4. Upsert into that BD's contacts on `(bd_id, profile_key)` — re-uploads update, don't duplicate.

## Filtering (v1)
- Server-side queries with indexed columns: company, industry (once enriched), position/seniority, geo.
- At tens of thousands of rows, plain indexed Postgres queries are sub-millisecond. No search engine needed.

## Design seams for later (do NOT build now, but leave the door open)
- **Signal source interface** — a common shape `{ source, summary, url, capturedAt }` so v2 web research, manual paste, and v3 Apify all feed the same message-drafting step.
- **Async research jobs** — v2 research is slow + costs money; it must run as a background job (queue), never inline in a request. Leave message-drafting decoupled from the request cycle.

## v1 scope checklist
- [ ] Supabase project (DB + auth)
- [ ] Next.js app scaffold + Drizzle schema
- [ ] BD login
- [ ] CSV upload → parse → upsert
- [ ] Contact list + filters
- [ ] Overlap indicator (names the owner)
