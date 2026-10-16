# Sequences go-live checklist (outreach-sequences PR 13, tasks 13.1-13.7)

Mockups: `outreach-sequences/mockups/secuencias-lista.html` (L), `secuencia-nueva.html` (N), `secuencia-detalle.html` (D),
`baja-opciones.html` (B). The components were built and checked in PRs 4, 10-12 (see the two sibling checklists); this one
covers what PR 13 itself adds: the routes, the containers that wire intent to server actions, the reads, the cron,
the middleware, the sidebar and the Contact-record block.

Paths: P = `src/app/(app)/sequences`, L = `src/lib/sequences`, A = `src/app/api`.
Columns: element | mockup ref | status | evidence | notes.

## Routes, cron, middleware (13.1-13.5, 13.7)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `/sequences` page, owner-scoped | L | done | P/page.tsx:12-15, L/pageQueries.ts:33 | An admin sees only their own here too. |
| `/sequences/new` page | N | done | P/new/page.tsx:10-15 | |
| `/sequences/[id]` page, admin read audited, 404 for strangers | D | done | P/[id]/page.tsx:17-25 | Audit lives in `getSequenceDetail` (detailQueries.ts). |
| `loading.tsx` skeletons for the three routes | n/a | done | P/loading.tsx, P/new/loading.tsx, P/[id]/loading.tsx | Design-system `.skeleton` only. |
| `GET /api/unsubscribe` renders, writes nothing | B screen 2 | done | A/unsubscribe/route.ts:35, L/unsubscribeRequest.ts (GET gets `{ findToken }` only) | Tested: tests/unit/sequencesUnsubscribeRequest.test.ts. Smoke-tested against the local e2e DB: zero suppression rows after GET. |
| `POST /api/unsubscribe` suppresses (form and RFC 8058 one-click) | B screens 2-3 | done | A/unsubscribe/route.ts:36, L/unsubscribeRequest.ts | Smoke-tested: one row, member `discarded/opt_out`, a repeat POST changes nothing. |
| Unsubscribe pages: confirm, done, invalid, postal address line | B | deviation | L/unsubscribeHtml.ts | OWNER DECISION 1. |
| `GET /api/sequences/run`, bearer, 401, `force-dynamic`, `maxDuration = 300` | n/a | done | A/sequences/run/route.ts:17-24, L/runHandler.ts:26-30 | 401 for no header, wrong header and unset secret (unit test). Smoke-tested 401 on a real server. |
| 13.3b: the whole `RunSummary`, `capped` and `lost` included, reaches the log | n/a | done | L/runHandler.ts:38, tests/unit/sequencesRunHandler.test.ts | Warn level when either signal is present, info otherwise. |
| 13.4 `vercel.json`: runner cron exactly twice, `0 13 * * *` and `0 14 * * *` | n/a | done | vercel.json:32-39 | Pinned by tests/unit/sequencesInert.test.ts. |
| 13.5 `SESSION_EXEMPT_ROUTES` + both routes, exact-match-or-slash-prefix | n/a | deviation | src/lib/auth/sessionExemptRoutes.ts, src/lib/supabase/middleware.ts:52 | The list moved out of `middleware.ts` into a pure module so the `/api/unsubscribe-admin` test can import it without loading Supabase. Same name, same rule. |
| 13.7 `sequencesInert.test.ts` inverted to positive assertions | n/a | done | tests/unit/sequencesInert.test.ts | Cron twice, pages and routes exist, both routes exempt, nav entry, runner reachable from ONE file under `src/app`. |

## Sidebar and Contact record (13.6)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Sidebar "Secuencias" below "Seguimientos" | D sidenav | done | src/app/contacts/Sidebar.tsx:76, dictionaries `nav.sequences` | Breadcrumb key added (src/lib/shell/breadcrumbLabel.ts). |
| Pill count (`sequence_count`) in the same statement as the other badges | D sidenav | done | src/lib/shell/appShellBadgeCountsQuery.ts, tests/db/sequencePages.test.ts | One new scalar subquery, no new round trip. |
| `SequenceContext` block on the Contact record, with "No contactar" | contact-record rail | done | src/app/(app)/contacts/[id]/ContactSequenceBlock.tsx, page.tsx:142 | Memberships selected by EMAIL ADDRESS. |

## List (L)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Every element of the list mockup | L | done | see sequences-list-create-checklist.md | Composed unchanged in P/page.tsx. |
| Counts are true: the read does not truncate | L | done | L/pageQueries.ts:33-45, tests/db/sequencePages.test.ts ("does not truncate: 250 members") | No `limit`. |
| A Sequence with no members still has a row | L | done | L/pageReads.ts, tests/db/sequencePages.test.ts | |

## Create form (N)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Every element of the create mockup | N | done | see sequences-list-create-checklist.md | Composed in P/new/NewSequenceScreen.tsx. |
| Picker KEEPS non-addable contacts, reason from `staticBlock` | N 150-220 | done | L/pageQueries.ts:66-85, L/pageReads.ts `toPickerContact` | `buildRosterCandidatesQuery` is not used. |
| EMPTY guards map (no static `company_limit`) | N 73 | done | L/pageReads.ts `toPickerContact`, tests/unit/sequencesPageReads.test.ts | The limit is derived from the selection. |
| Always a company | N 90 | done | L/pageQueries.ts (`p.company_key is not null`) | Plus the postings join, which matches on the key. |
| "Ya es miembro" | N 184 | deviation | L/pageReads.ts (`blockDetail: null`) | No rule blocks a Contact from a second Sequence, and a new one has no members. Not supplied. |
| Create, then add members; refused contacts are counted, never dropped | N 225 | done | P/new/NewSequenceScreen.tsx:34-48 | Stays busy once created, so a double click cannot create two. |
| Pool bound of 500, addable first | N | deviation | L/pageQueries.ts `PICKER_POOL_LIMIT` | OWNER DECISION 2. |

## Detail (D)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Every element of the detail mockup | D | done | see sequence-detail-checklist.md | Composed in P/[id]/SequenceDetailScreen.tsx. |
| "Generar borradores faltantes" | D header | done | P/[id]/SequenceDetailScreen.tsx:83 | |
| "Aprobar los N listos" selects the N and shows the gated bar | D 39-43 spec | done | SequenceDetailScreen.tsx:101, L/detailFlow.ts `readyMemberIds` | |
| Selecting rows shows the bulk bar (checkbox on draft cards) | D bulk-bar | done | P/_components/MemberCard.tsx:98, SequenceDetailView.tsx:41 | The mockup draws the bar but no row checkbox. OWNER DECISION 3. |
| Review dialog: Revisar / Ver correo / Ver enviado / Revisar recordatorio | D dialog | done | SequenceDetailScreen.tsx:88-94, 109 | Opened on a click only, so nobody "reviews" a member nobody chose. |
| "Señales usadas" = the generator's own input | D dialog | done | L/draftQueries.ts `memberDraftSignals`, actions.ts `loadReviewSignals`, tests/db/sequencePages.test.ts | Owner only; an admin gets no chip block rather than a false "none". |
| Refresh after `markReviewed` | PR 11 oblig. 1 | done | SequenceDetailScreen.tsx:129-131 | `router.refresh()`, which moves "N de M revisados". |
| Never approve after a failed save | PR 11 oblig. 2 | done | L/detailFlow.ts `runReviewIntent`, tests/unit/sequencesDetailFlow.test.ts | Failed and thrown saves both block. Untouched text skips the save. |
| `empty` (whitespace-only) surfaces in the dialog | PR 11 oblig. 4 | done | L/detailFlow.ts, dictionaries `reviewErrors.empty` | |
| Save and regenerate the REMINDER (step 2) | D dialog | done | L/draftQueries.ts `saveDraftEdit(step)`, `regenerateReminderDraft` | Missing from PR 9: both only handled step 1. Built here, DB-tested. |
| Cancelar envío, Adelantar recordatorio, Reincorporar, Regenerar, Quitar, No contactar | D cards | done | SequenceDetailScreen.tsx:107-119 | Every action in `actions.ts`, each with a toast. |
| Bulk regenerate / remove (one reason) / approve | D bulk-bar | done | SequenceDetailScreen.tsx:155-175 | Server re-asserts the review gate. |
| Advisory opt-out prompt on replied cards | PR 12.4 | done | L/pageQueries.ts `listReplyPhrases`, P/[id]/page.tsx:25 | Owner's own mailbox only. |
| "Editar secuencia" | D header | deviation | P/_components/EditSequenceDialog.tsx | OWNER DECISION 4. |
| "Cambiar" (cadence) | D cadence card | deviation | SequenceDetailScreen.tsx:99 | OWNER DECISION 4. |
| Rosters over 200 members | PR 11 | deviation | L/detailQueries.ts (unchanged) | OWNER DECISION 5. |
| Admin reading another BD's Sequence | spec | deviation | SequenceDetailScreen.tsx | OWNER DECISION 6. |

## Contact-record obligations (PR 12 checklist items 5 and 6)

| element | status | evidence | notes |
|---|---|---|---|
| Memberships selected by EMAIL ADDRESS, not `person_id` | done | L/pageQueries.ts:97-117, tests/db/sequencePages.test.ts ("found by EMAIL ADDRESS") | Same match as `suppressAddressInTx`. Also catches a differently-cased address on a second Contact row. |
| "Already opted out" sees every membership | done | same read | Opted-out and live rows sort first, so a bound could only cut old discarded history. Bound 100. |

## Owner decisions

1. **Unsubscribe pages are an HTML string, not the React components.** Next refuses `react-dom/server` in a route handler, and a route cannot sit inside the root layout. `UnsubscribePages.tsx` (PR 4) was deleted; its three screens are `L/unsubscribeHtml.ts`, with the same classes and copy, and the design-system CSS is inlined into the response (`next.config.mjs` traces the two stylesheet files into the function). The web font is not loaded on this page, so it renders in the system font. The alternative is a real page at `/unsubscribe` plus a redirect from the route, at the cost of a second exempt path and a done-page that cannot prove the write.
   The postal-address line comes from the recipient's market (one extra read, `postalAddressForToken`), as the mockup draws it.
2. **Picker pool.** Contacts at companies with an open US IT posting, 500 maximum, addable first. Searching is client-side, so a larger pool hides people. Not measured against production.
3. **Row checkboxes.** The mockup and the spec both say "selecting rows" but no card had a checkbox. Draft cards now do; "Aprobar los N listos" selects them all.
4. **"Editar secuencia" and "Cambiar" have no mockup.** Edit opens a small dialog (name and daily cap) built from the create form's fields. "Cambiar" only says the cadence is fixed. Say if either should be something else.
5. **More than 200 members.** `getSequenceDetail` throws, so the page shows an error. Nothing caps a roster at creation.
6. **An admin reading another BD's Sequence** sees the page (audited) but every action fails with a generic message: the server actions are owner-scoped. Chips and opt-out phrases are withheld for the same reason.
