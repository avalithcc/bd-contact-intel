# bd-playbook mockup parity checklist

Source mockup: `openspec/changes/bd-playbook/mockups/bd-playbook.html`, built on
the approved `crm-hubspot-ux` design system (sidebar/topbar shell,
`details.card` accordion, `details.dropdown` + `.menu` disclosure — no new
CSS; every class used was checked against `styles.css`). Content sourced
from `openspec/changes/bd-playbook/playbook-content.md`, which cites
`avalith/contexto/empresa.md` for every Avalith fact and marks every
inferred/unconfirmed claim `(supuesto)`.

This revision (feat/bd-playbook) is the REAL implementation: evidence below
points at `src/` files, not the mockup. Status is `done` (built and
verified against the mockup), `deviation` (owner decision recorded), or
`todo` (visible in the mockup but not yet real — none remaining).

Columns: element | mockup ref | status | evidence | notes

## Sidebar entry

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Guía de roles" sidebar item, in `sidenav-footer` above "Cuenta" | bd-playbook.html:33 | done | src/app/contacts/Sidebar.tsx:142-149 | Owner decision 2026-09-30: reference/setup group (no live count), grouped with "Cuenta". Route (`/playbook`) kept self-contained so it can move under `/account` later if the group doesn't grow — comment at Sidebar.tsx:134-141. |
| Active state / icon | bd-playbook.html:33 | done | src/app/contacts/Sidebar.tsx:143-148, src/components/icons.tsx (PlaybookIcon) | Path copied 1:1 from the mockup's open-book glyph. |
| Rest of sidebar/topbar chrome | contacts.html:13-59 | done | (unchanged) | Not touched by this change — only the new item was added. |

## Standalone page (`/playbook`) — header and legend

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Eyebrow "Guía" + h1 "guía de roles." + meta paragraph | bd-playbook.html:55-56 | done | src/app/(app)/playbook/page.tsx:46-54 | Copy from `dict.bdPlaybook` (es.ts/en.ts). |
| Priority legend (Alta/Media/Baja/No priorizar/Revisar) | bd-playbook.html:58-64 | done | src/app/(app)/playbook/page.tsx:56-63 | Reuses `.badge-*` classes, no new colors. |
| "Grupos que no vale la pena priorizar" alert | bd-playbook.html:67-73 | done | src/app/(app)/playbook/page.tsx:65-79 | Group lists + anchors generated from `NOT_WORTH_PRIORITIZING` (src/lib/roleGroupPlaybook.ts). |
| `mock-note` scope banner | bd-playbook.html:53 | deviation | — | Not ported: `.mock-note` is a design-review artifact (doesn't exist in design-system.css) and is not real app UI. |

## Standalone page — 13 role-group cards

One row per `RoleGroupKey`, `ROLE_GROUPS` order (src/lib/roleGroups.ts).

| role group | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `c_level_tech` … `no_position` (all 13) | bd-playbook.html:77-159 | done | src/app/(app)/playbook/page.tsx:83-113, src/lib/roleGroupPlaybook.ts | One `<details className="card">` per group; content (subtitle/priority/decides/painSolved/wrongPerson/note) from ROLE_GROUP_PLAYBOOK, copied verbatim from the mockup. Unit-tested (tests/unit/roleGroupPlaybook.test.ts): every RoleGroupKey has an entry. |
| 3 "Alta" cards pre-expanded, rest collapsed | bd-playbook.html (open attr on first 3 cards) | done | src/app/(app)/playbook/page.tsx:86 (`open={entry.priority === "alta"}`) | Verified in screenshoots/bd-playbook-impl-2-cards.png. |
| Priority badge scale (5 values, not free text) | README.md decision 4 | done | src/lib/roleGroupPlaybook.ts (PRIORITY_BADGE_CLASS, priorityLabel per entry) | Owner asked for the mockup's own recommendation — kept the 5-badge scale, no free-text alternative. |
| "Dónde aparece además" preview section | bd-playbook.html:162-208 | deviation | — | Not reproduced on this page: this change builds the two hints for REAL elsewhere (rows below), so a static duplicate preview here would show stale copy next to the live feature. Documented in page.tsx's doc comment. |

## In-context surfaces (task requirement — a standalone page alone is not enough)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Surface 1: "por qué este rol" hint on the contact record's Cargo row | bd-playbook.html:167-186 | done | src/app/(app)/contacts/[id]/page.tsx:150-165 (compute), PropertyList.tsx:365-396 (render), AboutPane.tsx (thread prop) | Uses `classifyPosition(record.person.jobTitle)` (src/lib/roleGroups.ts) — reclassifies from the current Cargo text rather than trusting the separately-editable `roleGroup` property, so the hint always matches what's on screen. Adds NO new query. Verified in screenshoots/bd-playbook-impl-3-contact-record-hint.png. |
| Surface 2: "por qué estos grupos" hint on the Contactos role-group filter chip | bd-playbook.html:187-204 | done | src/app/(app)/contacts/FilterMenu.tsx:265-296, src/app/(app)/contacts/page.tsx (labels wiring) | Renders only next to the active `roleGroup` chip, matching the mockup exactly (shows the 3 "Alta" + 2 "No priorizar" groups, link to full guide). Verified in screenshoots/bd-playbook-impl-4-contacts-filter-hint.png. |
| Surface 3: hint on follow-up-queue cards (task wording: "possibly" in scope) | follow-up-queue.html:64-80 | deviation | — | Not built — same reasoning as the design-only README (decision 3): the follow-up-queue mockup already fought to keep cards ~110px with icon-only actions; a third disclosure trigger per card reopens that fight. Flagged for the owner; NO hint added to the queue cards per this task's explicit "keep those cards compact" instruction. |

## Content sourcing and assumptions

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Every Avalith fact cited to `empresa.md`, every inferred claim marked `(supuesto)` | playbook-content.md | done | src/lib/roleGroupPlaybook.ts (every entry) | Copied verbatim from the approved mockup/content file — no new claims introduced. |
| Content is static, developer-edited (not DB-backed) | README.md "what building it would touch" | done | src/lib/roleGroupPlaybook.ts | Owner decision 2026-09-30: static TS module, not an admin-editable table. Not counted toward this change's code line budget (content, not logic). |
| Mapping RoleGroupKey -> content is unit-tested | task brief | done | tests/unit/roleGroupPlaybook.test.ts | RED->GREEN proven during implementation (temporarily removed one entry, saw the assertion fail, restored it). |

**Counts:** done 15, deviation 3, todo 0.
