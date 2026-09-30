# Decision brief — LinkedIn Chrome extension (connection capture)

Prepared 2026-09-30. Analysis and research only — no application code, no
extension code. Backlog item: `linkedin-chrome-extension`
(`openspec/BACKLOG.md:171-192`).

## Summary

| | |
| --- | --- |
| Problem | LinkedIn CSV import was deliberately turned off (`9f428dd`, `6aff9f2`), but the imported history is still shown on the contact record (PR #235, `d8cfb60`). Since then a new LinkedIn connection only reaches the CRM by hand — there is no capture path at all. |
| Recommendation | A Manifest V3 extension with one content-script button on `linkedin.com/in/*` ("Agregar al CRM") that sends **name, headline, company, profile URL** to a new `/api/linkedin/capture` route. Auth: **a per-BD long-lived bearer token**, generated in-app and pasted once into the extension's options page — not a Supabase session, not `chrome.identity` OAuth (see "Central technical question" below). |
| Identity | The route reuses the exact same pure flow the "Nuevo contacto" dialog already uses (`buildNewContactFields` → `matchIdentity` → `runCreateContactFlow`, `src/lib/contacts/createContact.ts`, `src/app/(app)/contacts/createContactActions.ts`) — never a blind insert. |
| Linking history | Setting `person.profileKey` in the exact `normalizeProfileKey` shape (`src/lib/csv.ts:19-30`) makes the LinkedIn conversation history join automatically — `src/lib/activity/getOwnConversationMessages.ts:49` is a direct equality join (`person.profileKey = conversation.peerProfileKey`), no backfill job needed. |
| LinkedIn ToS | Section 8.2 names "browser plugins and add-ons" among the tools it prohibits for scraping (checked 2026-09-30). It does not carve out user-initiated, single-profile actions — see the ToS section below for the honest risk read. |
| Distribution | Chrome Web Store, **Private** listing (restricted to named testers / the Workspace domain), for 3 users. |
| Effort | 4 slices, each ≤ 400 lines of code (extension code is out of scope for this brief but counted for planning). |

## Current state (with citations)

- **CSV import is off, not gone.** `9f428dd` ("chore(ui): hide LinkedIn CSV import entry points") removed the upload forms from the home page and `/contacts/import`; `6aff9f2` ("chore(ui): hide LinkedIn conversation surfaces...") removed the timeline cards and the right-panel "Historial de conversaciones" card. Both commit messages say the underlying server actions, parsers and DB writes are untouched and reversible. PR #235 (`d8cfb60`, commits `8cc3252`/`4ee7580`/`da535fd`) then **restored** the conversation-history rendering on the contact record. Net effect: the owner wants the history visible but does not want the bulk CSV path running — this extension is explicitly the replacement capture path, not a parallel one.
- **`profile_key` shape.** `normalizeProfileKey(rawUrl)` (`src/lib/csv.ts:19-30`) parses the URL, lowercases the host, strips a leading `www.` and a trailing slash, and returns `${hostname}${pathname}` — e.g. `https://www.linkedin.com/in/jane-doe-1a2b3c/` → `linkedin.com/in/jane-doe-1a2b3c`. No protocol, no trailing slash, lowercase. This exact function is reused everywhere a profile key is derived (`src/lib/contacts/createContact.ts:29`, `src/lib/identity/matcher.ts:121`). The unified `person` table enforces it with a real constraint: `person_profile_key_unique` (`src/db/schema.ts:701`, `drizzle/0013_unified_person.sql:77`).
- **The join that makes history "just work".** `conversation.peerProfileKey` (`src/db/schema.ts:345`) and `message.senderProfileKey` (`:386`) are free text captured from the LinkedIn CSV export. `getOwnConversationMessages.ts:49` joins `person` to `conversation` with `eq(person.profileKey, conversation.peerProfileKey)` — a plain equality join. There is no fuzzy matching step. So: if the extension writes `person.profileKey` in the same normalized shape, any conversation rows already imported for that peer link up the next time the record page renders. If it writes something else (raw URL, different casing, trailing slash), they silently never will — the join just returns zero rows, no error.
- **Identity resolution already exists and must be reused, not re-implemented.** `src/lib/identity/matcher.ts` is the single precedence algorithm (`profile_key` → `verified_email` → name+company) used by every ingestion path. `src/lib/contacts/createContact.ts` + `createContactActions.ts` is the **closest possible precedent** for this feature: it is a manually-triggered, single-row creation path (not a bulk migration) that already does exactly what the extension needs — build fields, classify the match via `matchIdentity`, and branch into one of four outcomes:
  - `{ action: "existing_match", existingPersonId }` — profile_key or verified email hit. No new row.
  - `{ action: "needs_confirmation", existingPersonId, reason }` — weak match (name+company or conflicting keys). The web dialog shows "Abrir el existente" or "Crear de todas formas"; the latter writes a `duplicateCandidate` row for the admin queue (`/admin/duplicates`, `src/lib/identity/duplicateReviewQueries.ts`) instead of merging blind.
  - `{ action: "blocked_own_company" }` — matches Avalith's own company, refused.
  - `{ action: "create" }` — genuinely new person.

  `createContactActions.ts` wraps prefetch+match+insert in `withIdentityLock` inside one `db.transaction`, specifically to close a race where two concurrent submissions for the same profile key/email both see "no match" and both insert (documented in the file's own header comment). A LinkedIn-capture endpoint has the identical race (a BD could click the button twice, or two BDs could connect with the same person around the same time) and must use the same lock, not a bespoke check.
- **Company resolution — a correction to the backlog's own wording.** `openspec/BACKLOG.md:183-184` says the server "resolves or creates the Company." That is **not what the precedent path does**. `createContact.ts:56-64` and `createContactActions.ts` only set `person.company` (free text) and `person.companyKey` (`normalizeCompanyKey`, `src/lib/companyCategories.ts:89`) — there is no insert into the `company` table anywhere in that flow. A tracked `company` row (`src/db/schema.ts:993-1042`, `relationshipStage` defaulting to `'prospect'` per migration 0022) is only created explicitly through "Nueva empresa" (`src/app/(app)/companies/new/page.tsx`). So today, a manually-created contact's employer is just a string on the person row until a BD deliberately promotes it to a tracked company. **Recommendation: match this precedent exactly in v1** — do not auto-create a `company` row from the extension. Auto-creating one per captured contact would flood `/companies` with one-off `prospect` rows for every company a BD's LinkedIn connections happen to work at, most of which are not sales targets. This is owner decision #4 below.
- **Auth is the central blocker, confirmed in code.** `getCurrentBd()` (`src/lib/queries.ts:54-84`) calls `supabase.auth.getUser()` against cookies read by `src/middleware.ts` → `updateSession` (`src/lib/supabase/middleware.ts`), and gates on `isAllowedWorkEmail` + `email_confirmed_at`. This cookie is scoped to our Vercel domain. A content script or service worker running in the `linkedin.com` origin is a **different origin** — the browser's same-origin cookie jar will never attach that cookie to a `fetch()` from the extension, regardless of CORS headers on our side. CORS controls whether the *response* is readable, not whether the *cookie* is sent cross-site; a `SameSite`-scoped, domain-scoped cookie from a different top-level site is simply not in scope for the request at all. This is not a configuration problem to work around — it means session-cookie auth cannot be reused as-is, full stop.
- **A bearer-token pattern already exists and is the right shape to copy.** `src/app/api/leads/ingest/route.ts` accepts a single shared `LEADS_INGEST_TOKEN` via `Authorization: Bearer`, checked with constant-time compare in `src/lib/cronAuth.ts:isValidBearer` (`createHash` + `timingSafeEqual`, avoiding length-timing leaks). That route is fine with one shared secret because it doesn't need to know *which* BD is pushing data — a one-directional feed from an external system. The extension is different: we need to know which BD captured the contact (for `ownerBdId`), so the token must be **per-BD**, not shared.

## Central technical question — how does the extension authenticate?

| Option | How it works | Pros | Cons | Revocation on lost laptop |
| --- | --- | --- | --- | --- |
| **Per-BD long-lived token (recommended)** | App generates a random opaque token per BD (shown once in an account/settings page — new, small server surface), stored hashed server-side. BD pastes it into the extension's options page (`chrome.storage.local`). Every capture POST sends `Authorization: Bearer <token>`; the server looks up the BD by token hash. | Smallest possible build — same shape as `isValidBearer`/`LEADS_INGEST_TOKEN`, just keyed per-BD instead of a single secret. Zero new OAuth flow. Works immediately in a background service worker at any time, no live tab or session required. | A long-lived secret at rest in browser storage; scope it narrowly (POST-only, capture-only, no read access) to cap the blast radius. Manual copy-paste UX (fine for 3 people). | Instant — delete/rotate the one DB row for that BD. No dependency on Supabase's own session semantics. |
| `chrome.identity` + OAuth | `chrome.identity.getAuthToken` is Google-only (fine, since BDs are `@avalith.net` Google Workspace accounts) or `launchWebAuthFlow` against a custom provider (checked 2026-09-30, [Chrome identity API docs](https://developer.chrome.com/docs/extensions/reference/api/identity)). Either way you still end up minting and storing *your own* app-level session/token after the OAuth round-trip — Chrome's OAuth token is not itself accepted by Supabase or by our app. | Reuses Google's identity, no secret to hand-type. | Real implementation cost (OAuth consent flow, code exchange, refresh) to arrive at the same place: a stored token in extension storage. Disproportionate for 3 users who already have Google accounts and could just paste a string. | Same as above once built — still ends in a token to revoke. |
| Open our own domain in a tab, relay the Supabase session | A content script on **our own origin** (not linkedin.com) reads the already-authenticated session and passes it to the extension via `chrome.runtime` messaging. | Reuses existing Supabase auth exactly, no new token type, no new UI. | Fragile for this trigger: the BD clicks "Agregar al CRM" on `linkedin.com`, a tab of *our* app is not necessarily open or logged in at that moment, and Supabase access tokens expire in about an hour — the service worker would need a live relay tab or a cached refresh token, which is architecturally heavier than a static bearer token for no real security gain (a captured refresh token is just as strong a secret as a captured bearer token). | Revoking a Supabase session for that user (already possible today, independent of this feature). |

**Recommendation: the per-BD long-lived token.** It is the smallest correct answer for a 3-person internal tool, mirrors a pattern the codebase already has and trusts (`isValidBearer`), needs no OAuth infrastructure, and gives a clean, instant, single-row revocation story that doesn't lean on browser session lifetimes. Harden it by scoping the token to this one endpoint only (not a general API key) and logging the token id on every capture for audit.

## What the extension reads and sends — the minimum

Per the backlog's own framing and the "Nuevo contacto" field set, the payload should carry only:

- `firstName`, `lastName` (or a single `name` the endpoint splits — LinkedIn's own profile DOM exposes these separately)
- `headline` or current title (maps to `person.jobTitle`, not currently part of `NewContactFormInput` — the extension's server endpoint is new code, not a literal reuse of `createContactAction`, so it can carry one more field than the web dialog does)
- `company` (free text, exactly as `createContact.ts` already handles it)
- `profileUrl` (normalized server-side with the existing `normalizeProfileKey`, never trust a pre-normalized value from the client)

No message content, no connection list, no bulk anything — one profile, one click, one POST. This is also the ToS-relevant boundary (see below): reading four fields off a page the user is already looking at is a categorically smaller ask than exporting the page's HTML or crawling a list.

## The endpoint's shape

`POST /api/linkedin/capture`, mirroring `src/app/api/leads/ingest/route.ts`'s structure:

1. **Auth**: `Authorization: Bearer <per-BD token>` → constant-time lookup → resolves to a `bd` row (reusing `isValidBearer`'s hashing approach, extended to check against a per-BD token table instead of one shared secret). 401 if missing/invalid.
2. **Body limit**: a capture payload is a few hundred bytes; cap well below the leads route's 4MB (e.g. 8KB) and reject oversized bodies before parsing, same defensive order as the leads route.
3. **Validate**: required `profileUrl`; everything else optional-but-typed. Reject if `normalizeProfileKey(profileUrl)` returns null (not a real LinkedIn profile path).
4. **Identity**: run the existing `buildNewContactFields`-equivalent mapping → `matchIdentity` → the same four-outcome decision table as `createContactFlow`, inside `withIdentityLock` + one transaction — literally the same server-side logic `createContactActions.ts` already has, called from a new authentication boundary instead of `getCurrentBd()`.
5. **Rate limit**: no rate limiter exists anywhere in this codebase today (checked — no hits for `rateLimit`/`RateLimit` in `src/`). For 3 users hitting one lightweight endpoint, a full limiter is disproportionate. Two options that need **no application code**, consistent with this brief's scope: a Vercel Firewall rate-limit rule on this one path (infra config, not code — see `vercel:vercel-firewall`), or simply rely on the per-BD token's narrow scope. If real abuse protection is wanted later, a cheap in-app check (count rows inserted for that `bd_id` in the last N minutes) is a small addition to slice 3, not a prerequisite.
6. **Response**: `{ action: "existing_match", personId, url }` | `{ action: "needs_confirmation", personId, url }` | `{ action: "blocked_own_company" }` | `{ action: "created", personId, url }` — the extension's popup renders the corresponding message.

## What happens when the person already exists

This is not new UX to invent — it is the existing four-outcome contract from `createContactFlow`, surfaced through the extension's popup instead of a web dialog:

- **`existing_match`** (profile_key or verified-email hit): never create a duplicate. Show **"Ya está en el CRM"** with a link that opens `/contacts/<id>` in a new tab.
- **`needs_confirmation`** (weak match — name+company or conflicting keys): the web dialog lets the BD choose "Abrir el existente" vs. "Crear de todas formas" synchronously. A one-click browser-extension flow has no room for that choice mid-click. **Recommendation for v1: do not offer a force-create from the extension.** Show "Posible contacto similar — revisar en el CRM" with a link to the candidate match, and let the BD resolve it inside the app (where the existing confirm dialog already exists) if they really mean to create a second row. This keeps the extension's server logic identical to `createContactFlow` minus one branch, and avoids writing `duplicateCandidate` rows from an unattended click. Revisit only if this case turns out to be common in practice.
- **`blocked_own_company`**: show a plain message, write nothing.
- **`create`**: insert the `person` row and a `personBdConnection` row (`connectedOn = today`) exactly like `createContactActions.ts` does — doubly appropriate here since the real-world trigger *is* a LinkedIn connection.

## Who owns the new contact, and its initial status

- **Owner**: `person.ownerBdId` is set to the BD identified by the bearer token that made the request — the capturing BD, same field `createContactActions.ts:100` sets to `me.id` today.
- **Status**: `person.status` defaults to `'new'` (`src/db/schema.ts` default), untouched by this flow — same as every other single-contact creation path. `deriveStatus()` remains the only writer of anything past `'new'`.
- **Source**: set `sourceKey` to a distinct value (e.g. `'linkedin_extension'`) rather than reusing `'manual'`, so this capture path is distinguishable later in reporting from a hand-typed "Nuevo contacto" — a one-line addition to the insert, no new column.

## Does the imported conversation history link up automatically?

**Yes, immediately, with no backfill**, provided `profileKey` is written in the exact normalized shape — confirmed by reading the join directly: `src/lib/activity/getOwnConversationMessages.ts:49`, `.innerJoin(person, eq(person.profileKey, conversation.peerProfileKey))`. There is no separate "link the history" step to build; it is a side effect of getting the one column right. The only risk is normalization drift (e.g. the extension sending a URL with a different casing, a query string, or a trailing slash) — mitigated entirely by **always deriving `profileKey` server-side with the existing `normalizeProfileKey`**, never trusting a client-sent key.

## LinkedIn's terms — read precisely, not hand-waved

Checked 2026-09-30 against LinkedIn's User Agreement, Section 8 ("Dos and Don'ts"):

- **8.2.2**: prohibits developing, supporting or using "software, devices, scripts, robots or any other means or processes (such as **crawlers, browser plugins and add-ons** or any other technology) to scrape or copy the Services."
- **8.2.13**: prohibits "bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages... or otherwise drive inauthentic engagement."

**The honest read**: the User Agreement's text names "browser plugins and add-ons" explicitly as an example of a prohibited scraping tool, and it does **not** carve out a "user-initiated, single-profile, no-automation" exception anywhere in that section. The distinction this brief's brief-writer would like to draw — a user manually clicking a button to copy four fields off a page they are already looking at, once, versus a background crawler harvesting thousands of profiles — is a reasonable *practical* distinction (one BD, ~10s of captures a week, no bulk list traversal, no automated connection requests, no messaging), but it is **not a distinction LinkedIn's own terms draw explicitly**, and the plain text of 8.2.2 is broad enough to cover this extension literally. This brief will not claim the extension is clearly compliant — it isn't, on a strict textual reading. The realistic risk is account-level: LinkedIn's anti-automation detection is aimed at bot-like patterns (burst timing, headless browsers, IP/device fingerprint anomalies), not the isolated DOM read of a real signed-in user's own browser session. Low-volume, human-paced, single-profile use by 3 named accounts is a materially lower risk profile than list scraping, but "materially lower risk" is not "zero risk," and this could plausibly be grounds for an account warning or restriction if LinkedIn's systems (or a human reviewer) flag it. **This is owner decision #1: accept this account-restriction risk knowingly, or don't build this at all.**

## Distribution for 3 users

| Option | Fit |
| --- | --- |
| **Chrome Web Store, Private listing (recommended)** | One-time $5 developer registration fee (checked 2026-09-30); still goes through Google's review (typically a few business days, up to a few weeks per Google's own guidance), but a Private listing restricts installation to named testers or the Google Workspace domain — right-sized for 3 `@avalith.net` accounts, and gives normal auto-update behavior. |
| Unlisted | Also reviewed, just not searchable — no real advantage over Private for an internal-only tool; Private is strictly more restrictive and equally easy to set up. |
| Unpacked (`chrome://extensions` developer mode, load from disk) | Zero review wait, fastest to iterate — reasonable for early internal testing — but no auto-update mechanism (each BD must manually reload after every change) and Chrome nags on every browser restart that "developer mode extensions" are running. Fine for a throwaway spike, not for ongoing use by 3 people who are not going to babysit updates. |
| Enterprise policy (force-install via Google Workspace admin) | Real auto-update and zero per-user install friction, but requires Workspace admin console access and is disproportionate machinery for 3 people and one extension — more relevant if the team ever grows past a handful of internal tools. |

**Recommendation: Chrome Web Store, Private.** It is the only option that gives painless auto-updates without needing Workspace admin-console work, and the review latency (days, not weeks, once the developer account has any history) is a one-time cost, not a per-release one after the first submission.

## Owner decisions needed

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Accept the LinkedIn ToS/account-restriction risk described above? | Proceed, with eyes open — low-volume human-paced use by 3 named accounts, not bulk scraping, but not contractually "safe" either. |
| 2 | Auth model | Per-BD long-lived bearer token, pasted into the extension's options page. |
| 3 | Distribution | Chrome Web Store, Private listing. |
| 4 | Company auto-creation | **Do not** auto-create a `company` row from the extension — match the existing "Nuevo contacto" precedent exactly (free-text `person.company`/`companyKey` only); a BD promotes to a tracked company explicitly via "Nueva empresa," same as today. |
| 5 | `needs_confirmation` (ambiguous match) handling | v1 shows "possible match, resolve in the CRM" and writes nothing; no in-extension "create anyway." Revisit only if this proves common. |
| 6 | Source attribution | Tag captured contacts with `sourceKey = 'linkedin_extension'` (new value, not reusing `'manual'`) so this path is reportable separately. |

## Slice plan (each ≤ 400 lines of code)

1. **Per-BD token issuance** — a small `extension_token` table (bd_id, token hash, created_at, last_used_at), a settings-page route to generate/show-once/revoke a token, and the `isValidBearer`-style per-token lookup helper. No extension code yet.
2. **`/api/linkedin/capture` route** — request validation, the reused identity-match decision table wired to the new auth boundary (steps 1-4 above), inside `withIdentityLock`. Unit tests mirror `createContactFlow`'s existing test shape.
3. **Response contract + source tagging + optional in-app rate check** — the four response shapes, `sourceKey` tagging, and (only if slice 2's review flags it as needed) the cheap per-BD insert-count check.
4. **Extension itself** — manifest, content script, options page, popup messaging — explicitly **out of scope for this brief and for application-code rules here**, but sized here for planning: a minimal MV3 extension (one content script, one button, one fetch call routed through the background service worker per the MV3 CORS change, one options page for the token) is realistically also ≤ 400 lines, separate from and after the three server-side slices above.

## Risks

- **Account restriction risk is real, not hypothetical** — see the ToS section. This is the risk most worth the owner's explicit sign-off before any code is written.
- **Token at rest in browser storage.** A per-BD token sitting in `chrome.storage.local` is a real secret on a real laptop. Scope it to POST-only on one endpoint, and make revocation a one-click admin action so a lost laptop is a two-minute fix, not a fire drill.
- **Normalization drift breaks history linkage silently.** If `profileKey` is ever written client-side or in a slightly different shape, the join to `conversation.peerProfileKey` just returns nothing — no error, no log, a BD simply never sees history that should be there. Always derive it server-side from the one shared `normalizeProfileKey`.
- **LinkedIn can change its DOM at any time.** A content script reading `headline`/`company` off the page is inherently brittle to LinkedIn's own front-end changes; expect occasional silent breakage of field extraction, not of the CRM side.
- **Chrome Web Store review is a hard external dependency** for every update after the first, including bug fixes — budget for review latency when planning any fix, not just the initial ship.
