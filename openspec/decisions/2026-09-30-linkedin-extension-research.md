# Go/no-go — LinkedIn Chrome extension (connection capture)

Prepared 2026-09-30. Independent research and analysis only — no application
code, no extension code. Backlog item: `linkedin-chrome-extension`
(`openspec/BACKLOG.md:212-233`).

## Recommendation: no-go, on the extension as asked

Do not build a Chrome extension that runs a content script on
`linkedin.com/in/*` to read the page's DOM. LinkedIn's User Agreement
prohibits exactly that shape of tool, in explicit language, with no carve-out
for a single manual click. The team's entire prospecting pipeline runs
through three BDs' personal LinkedIn accounts (`openspec/BACKLOG.md:216-219`
— "LinkedIn is where the BDs actually prospect"), so an account restriction
is not a contained bug, it is a hole in the pipeline for whichever BD gets
flagged. Weighed against that downside, the actual capability gap this would
close is smaller than the backlog frames it: the CRM already ingests
LinkedIn connections and conversation history and already keys people by a
normalized profile URL (see part 2). What the extension adds on top of that
is real — immediacy, no manual export step — but it is a convenience
improvement, not a new capability, and a convenience improvement is not
worth gambling a BD's LinkedIn account over.

**Cheapest alternative that gets most of the value:** a "paste LinkedIn URL"
field on the existing "Nuevo contacto" dialog (part 3) — the BD copies the
profile URL from their own browser's address bar (a plain clipboard copy,
not a scrape) and pastes it into a field the CRM already has a home for.
Same identity-matching path, same dedup guarantees, zero content-script DOM
reads, zero extension-store surface, nothing for LinkedIn's anti-automation
systems to ever see. This is detailed at the end of this brief.

## 1. The ToS question, answered properly

Checked directly against `https://www.linkedin.com/legal/user-agreement` on
2026-09-30 (not a third-party summary). The current text, Section 8
("Dos and Don'ts"), Section 8.2 ("Don'ts"):

> **8.2.2** — "Develop, support or use software, devices, scripts, robots or
> any other means or processes (such as crawlers, browser plugins and
> add-ons or any other technology) to scrape or copy the Services, including
> profiles and other data from the Services."
>
> **8.2.13** — "Use bots or other unauthorized automated methods to access
> the Services, add or download contacts, send or redirect messages, create,
> comment on, like, share, or re-share posts, or otherwise drive inauthentic
> engagement."

The backlog's own reference to "§8.2" (`openspec/BACKLOG.md:229`) is correct
and current — it has not moved. This was worth checking anyway: LinkedIn has
renumbered this agreement before, and citing a stale section number in a
decision document that gets acted on later is exactly the kind of small
error that compounds.

**Three categories, and which one this is:**

1. **Automated scraping of profile pages** (a script visiting many profiles
   without a human driving each one) — squarely what 8.2.2 and 8.2.13 target.
   Not what's proposed here.
2. **A user-initiated copy of a page the user is already authorized to
   view** — a human clicks a button on one profile they are already looking
   at, once, and four already-visible fields (name, headline, company,
   profile URL) get read out of the DOM and posted somewhere. This is what's
   proposed. **The literal text of 8.2.2 does not exempt this.** It names
   "browser plugins and add-ons" as an example of a prohibited scraping tool
   in the same sentence as "crawlers," with no threshold for volume,
   automation, or human-in-the-loop intent. A textual reading has to treat
   this extension as inside 8.2.2's scope, not outside it — there is no
   clause to point to that carves out low-volume or single-click use.
3. **LinkedIn's official partner APIs** (e.g. the Talent/Marketing/Sales
   Navigator partner programs) — a contractual, LinkedIn-approved integration
   path, distinct from anything a browser reads off the rendered page.
   Covered in part 3's alternatives.

This is category 2, and category 2 reads as prohibited by the plain text.

**What's genuinely uncertain, marked as such:** how LinkedIn *enforces*
8.2.2 in practice is not the same question as what it *says*, and the
enforcement question is where real uncertainty lives. Search results from
2026 (checked 2026-09-30) point the same direction as each other without
being a single authoritative source:

- LinkedIn's March 2026 action against HeyReach — permanently removing its
  company page and banning the founder's personal profile — was reported as
  triggered by a **cloud-proxy architecture** running automated actions at
  scale, not a single-profile manual read ([northlight.ai, "LinkedIn
  Automation Rules 2026"](https://northlight.ai/blog/is-linkedin-automation-against-the-rules)).
- A practitioner guide on why extensions get blocked draws the same line
  this brief would want to draw: "if an extension performs automated actions
  on LinkedIn ... it carries restriction risk, whereas if it only reads,
  formats, or assists manual actions, it generally does not"
  ([profilespider.com](https://profilespider.com/blog/why-chrome-extensions-get-blocked-on-linkedin)).
- A large, established commercial category of "one-click add to CRM"
  extensions exists and has operated for years — LeadIQ, Lusha, Clearbit
  Connect, Apollo, Surfe and similar tools all do close to this exact thing
  ([cleverly.co, "Best LinkedIn Chrome Extensions for B2B Lead Gen
  (2026)"](https://www.cleverly.co/blog/linkedin-chrome-extensions)). Their
  continued existence is evidence LinkedIn tolerates this shape of tool in
  practice for at least some operators, but it is **not evidence it is
  compliant** — those companies may have their own commercial agreements
  with LinkedIn, operate at a scale and sophistication (device fingerprint
  management, rate shaping) this team has no reason to replicate for three
  people, and could still be curtailed at any time, as the HeyReach case
  shows happens to established players too.
- None of these sources are LinkedIn itself stating an enforcement
  threshold. LinkedIn does not publish one. Every "here's where the real
  line is" claim above is inference from blog commentary and one enforcement
  anecdote, not a documented policy. **This brief will not present "low
  volume is safe" as settled — it is the best available read, not a
  guarantee, and the owner should treat it that way before relying on it.**

**The consequence, made concrete for this team, not abstract:** if
LinkedIn's systems (automated pattern detection, or a human reviewer
following a report) flag the extension, the realistic outcome is a
**restriction or ban on the individual BD's personal LinkedIn account** —
not a lawsuit, not a subpoena, an account-level enforcement action, per every
source above. For a company with three BDs where prospecting itself happens
on those accounts (`openspec/BACKLOG.md:216-219`), losing one account for
days or weeks (a "restricted" LinkedIn account typically loses messaging
and connection ability during review, and worse, permanently, in a ban) is a
one-third hit to the entire pipeline's sourcing capacity, for a feature whose
entire value-add is speed of data entry. That asymmetry — small, real,
convenience-level upside against a low-probability-but-plausible outcome
that takes out a third of the team's prospecting capacity — is why this
brief lands on no-go rather than "proceed with eyes open."

## 2. What the CRM already does here (read before concluding "convenience")

- **`normalizeProfileKey`** (`src/lib/csv.ts:19-30`, read directly) parses a
  LinkedIn profile URL, lowercases the host, strips a leading `www.` and any
  trailing slash, and returns `${hostname}${pathname}` — e.g.
  `https://www.linkedin.com/in/jane-doe-1a2b3c/` becomes
  `linkedin.com/in/jane-doe-1a2b3c`. This is the one shared function behind
  every profile-key-bearing path in the codebase: the CSV connections
  importer (`src/lib/csv.ts:60-73`, parsing the `URL` column of a LinkedIn
  connections export), `src/lib/identity/matcher.ts:120-123`
  (`matchIdentity`'s profile-key precedence rule, read directly), and
  `src/lib/contacts/createContact.ts:57` (the "Nuevo contacto" dialog).
- **`matchIdentity`** (`src/lib/identity/matcher.ts:114-189`, read directly)
  is the single precedence algorithm every ingestion path already goes
  through: own-company skip, then profile key and verified email together
  (auto-match only when they agree; a disagreement is a review case, never
  a silent auto-merge), then a source-scoped exact-email rule, then
  name+company (review-only), then genuinely new. There is exactly one
  matcher in this codebase, not one per ingestion source.
- **Conversation history already links up by profile key, with no
  extension involved.** `getOwnConversationMessages.ts` (confirmed present
  in `src/lib/activity/`) joins `person` to `conversation` on
  `person.profileKey = conversation.peerProfileKey`, per
  `src/lib/identity/mergedProfileKeys.ts`'s own doc comment (read directly,
  lines 1-16), which documents this exact join and a bugfix for it
  (`mergedProfileKeysAnyCondition`, walking the `merged_into_id` chain so a
  merged-away person's profile key is still found). That doc comment exists
  *because* this join was already live in production and already broke once
  in a specific way (a merged person's history going missing) — this is not
  hypothetical machinery, it is a path with its own bugfix history.
- **`scripts/import-messages.ts`** (read directly, 60 lines) is the CLI twin
  of the in-app messages.csv upload (`src/app/actions.ts#uploadMessagesCsv`
  per its own header comment): it parses a LinkedIn data-export CSV
  (`parseMessagesCsv`) and calls the same `importMessages` the app uses,
  idempotent on `(bd_id, content_hash)`. This is a **batch, BD-initiated**
  path: a BD requests a LinkedIn data export (Settings → "Get a copy of your
  data"), waits for LinkedIn to generate it (minutes to hours, LinkedIn's own
  process, not this app's), downloads it, and re-runs this script or the
  upload form. Confirmed via `9f428dd` ("chore(ui): hide LinkedIn CSV import
  entry points", read directly with `git show --stat`) and `6aff9f2`
  ("chore(ui): hide LinkedIn conversation surfaces...") that this path and
  its rendering were deliberately hidden from the UI on 2026-09-28, not
  deleted — the commit message states the underlying server actions,
  parsers and DB writes are untouched and reversible.

**The honest answer to "what would the extension add that today's import
does not":** mostly immediacy. The CRM today can already capture a new
LinkedIn connection's name, company and profile URL, run it through the
exact same identity matcher, and link up conversation history automatically
— via a periodic, BD-initiated export/import cycle that currently sits
hidden but functional. The extension's only real addition is collapsing
that cycle from "export → wait → download → upload, done in batches" to
"click a button on the profile page, done immediately, one contact at a
time." That is a genuine UX improvement — the backlog is right that nobody
does the export/import dance for one new connection — but it is not a new
capability the CRM lacks, it is faster access to one it already has. Framed
against part 1's risk, "the same capability, faster" is not enough to accept
the account-restriction downside.

## 3. Alternatives, and the tradeoff that decides between them

| Option | What it costs | What it's missing / what decides against or for it |
| --- | --- | --- |
| **Existing CSV/conversation import** (re-enable the hidden UI) | Near zero — the code exists and is intentionally reversible (`9f428dd`). | Batch and delayed (a BD has to think to export, then wait, then upload); doesn't solve "capture the moment a connection happens." This is why the backlog calls it insufficient, correctly. |
| **LinkedIn's official partner APIs** | High — LinkedIn's partner programs (Sales Navigator, Talent, Marketing APIs) are typically gated behind formal partnership agreements, minimum scale commitments, and a review/approval process; they are not a self-serve API key a three-person team requests and gets same week. **Not independently verified against current partner-program terms in this session** — flagged here as a real path worth a direct inquiry to LinkedIn, not as something this brief confirms is reachable. | If reachable, this is the only option with zero ToS ambiguity — it's the sanctioned door. The tradeoff is pure access cost: realistically out of reach for a company this size without a dedicated BD-development effort, which is disproportionate to this feature's scope. |
| **Bookmarklet / paste-a-URL flow inside the CRM (recommended)** | Small — a field on the existing "Nuevo contacto" dialog (`src/lib/contacts/createContact.ts`) that accepts a pasted LinkedIn URL, running through the exact same `buildNewContactFields` → `matchIdentity` → create/existing/review flow that dialog already has. No new server auth boundary, no new identity code — literally the same form, one more optional input plus maybe headline/title if the BD types it. | Requires the BD to alt-tab and paste (a few seconds slower than a one-click in-page button) instead of eliminating the step entirely. This is the whole point: it trades a small amount of BD friction for total removal of the ToS surface — no content script, no DOM read of `linkedin.com`, no extension listed anywhere, nothing for LinkedIn's systems to ever observe. Copying a URL out of your own browser's address bar is an ordinary user action; nothing in Section 8.2 addresses it. |
| **The extension as asked** | Content-script + manifest + Chrome Web Store listing + a new per-BD auth mechanism (since a cross-origin content script cannot reuse the app's session cookie — confirmed by how `getCurrentBd()` in `src/lib/queries.ts` gates on a Supabase cookie scoped to this app's own domain, not `linkedin.com`). | Fastest for the BD (one click, no context switch) but carries the account-restriction exposure from part 1 for a gain that part 2 shows is mostly speed, not new capability. |

The tradeoff that actually decides this: **how much BD friction is worth
removing, against how much of a three-person pipeline you're willing to put
at risk to remove it.** The paste-URL flow removes nearly all of the
*process* friction (no export/wait/upload cycle, no batch delay, contact
appears the moment the BD pastes) while adding back a few seconds of *input*
friction (copy, alt-tab, paste) compared to a single in-page click. That few
seconds is a reasonable price for zero ToS exposure, given that the deeper
capability — normalized profile key, identity matching, automatic history
linkage — is identical either way.

## 4. Cheapest alternative, detailed (this is the "go" path, just not for the extension)

- **UI**: add a "Pegar URL de LinkedIn" field to the existing "Nuevo
  contacto" dialog (same component the mockup already specifies per
  `createContact.ts`'s own header comment, "build it as the mockup shows").
  No new dialog, no new page.
- **Server**: zero new logic. `buildNewContactFields` already calls
  `normalizeProfileKey(input.linkedinUrl)` (`createContact.ts:57`) and
  produces the same `NewContactFields` shape that feeds `matchIdentity`
  (`matchableRowFromFields`, `:65-79`) with `source: "manual_create"` — the
  exact auto/review/blocked/new branching this brief's part 2 already
  described. No new auth boundary is needed because the BD is already
  authenticated in the app when they open this dialog — this sidesteps the
  cross-origin-cookie problem the extension would have had to solve with a
  brand-new per-BD token mechanism.
- **Dedup**: identical guarantee to every other manual contact created
  today — same matcher, same four-outcome decision table, same
  `withIdentityLock` transaction precedent (`createContactActions.ts`) that
  closes the double-submit race. No new write path, so no new source of
  duplicate-pair buildup for the merge-review queue this session already
  worked down.
- **What it does not need**: no Chrome Web Store listing, no extension
  review latency, no content-script maintenance against LinkedIn's DOM
  changes (a real, separate risk the sibling extension brief calls out and
  that this alternative avoids entirely since it never reads LinkedIn's
  page), no new token type sitting in browser storage as a standing secret.
- **Optional enrichment, later, safely**: if headline/title/company
  prefill is wanted without typing, that can be fetched **server-side** by
  the CRM's own backend making a single authenticated or public-page fetch
  once the BD pastes a URL — a server making one HTTP request to a URL a
  human explicitly supplied is a different thing from a browser extension
  reading the DOM of a page LinkedIn served to a logged-in user's own
  session, though even that should get its own ToS look before building (a
  plain unauthenticated fetch of a public profile page can implicate the
  same 8.2.2 language depending on how it's done) — flagged here only as a
  future idea, not something to build now.

## Sources checked 2026-09-30

- LinkedIn User Agreement, Section 8.2 — fetched directly from
  `https://www.linkedin.com/legal/user-agreement`.
- [northlight.ai — "LinkedIn Automation Rules 2026: Banned vs. Safe
  Tools"](https://northlight.ai/blog/is-linkedin-automation-against-the-rules)
- [profilespider.com — "Why Chrome Extensions Get Blocked on
  LinkedIn"](https://profilespider.com/blog/why-chrome-extensions-get-blocked-on-linkedin)
- [cleverly.co — "Best LinkedIn Chrome Extensions for B2B Lead Gen
  (2026)"](https://www.cleverly.co/blog/linkedin-chrome-extensions)
- Codebase: `src/lib/csv.ts`, `src/lib/identity/matcher.ts`,
  `src/lib/identity/mergedProfileKeys.ts`, `src/lib/contacts/createContact.ts`,
  `scripts/import-messages.ts`, `src/lib/queries.ts` (`getCurrentBd`), git
  commits `9f428dd`/`6aff9f2` — all read directly in this session, cited by
  path/line above.

## What this brief does not cover

It does not repeat the extension's own build plan (manifest, slices, token
issuance, distribution) in detail — that is already worked through in
`openspec/decisions/2026-09-30-linkedin-extension-brief.md`, prepared in
parallel, which reaches a conditional go. This brief reaches a different
conclusion after weighing the same facts: given the plain text of 8.2.2 and
the concentrated operational exposure of a three-person, LinkedIn-dependent
pipeline, the honest "mostly convenience" gain from part 2 does not clear
the bar for accepting that exposure. The owner should read both before
deciding — the disagreement between them is itself useful signal about how
close a call this is.
