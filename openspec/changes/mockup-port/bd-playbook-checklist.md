# bd-playbook mockup parity checklist

Source mockup: `openspec/changes/bd-playbook/mockups/bd-playbook.html`, built on
the approved `crm-hubspot-ux` design system (sidebar/topbar shell,
`details.card` accordion, `details.dropdown` + `.menu` disclosure — no new
CSS; every class used was checked against `styles.css`). Content sourced
from `openspec/changes/bd-playbook/playbook-content.md`, which cites
`avalith/contexto/empresa.md` for every Avalith fact and marks every
inferred/unconfirmed claim `(supuesto)`.

This is a design-only deliverable (no application code exists yet), so
"evidence" points at the mockup file itself, not a component under `src/`.
Status is `done` (built in the mockup), `deviation` (owner decision needed,
see README), or `todo` (visible in the mockup but not yet real — not
applicable here since everything specified was built).

Columns: element | mockup ref | status | evidence | notes

## Sidebar entry (new)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Guía de roles" sidebar item, in `sidenav-footer` above "Cuenta" | bd-playbook.html (this file) | deviation | bd-playbook.html:33 | Placement is new, not in any approved mockup yet — decision 1 in README.md. Active state shown; pill/count intentionally omitted (a reference manual has no per-BD count). |
| Rest of sidebar/topbar chrome (Contactos, Empresas, Tareas, Seguimientos, Señales, Administración, cuenta menu) | contacts.html:13-59, follow-up-queue.html:14-49 | done | bd-playbook.html:14-52 | Copied unchanged from the already-approved shell; only the new item was added. |

## Standalone page — header and legend

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| mock-note (scope banner) | crm-hubspot-ux pattern, e.g. contacts.html:63 | done | bd-playbook.html:53 | Cites `playbook-content.md` and the reused components explicitly. |
| Eyebrow "Guía" + h1 "guía de roles." + meta paragraph | page-header pattern, contacts.html:64-66 | done | bd-playbook.html:55-56 | Meta paragraph explains the `(supuesto)` convention inline, not just in the README. |
| Priority legend (Alta/Media/Baja/No priorizar/Revisar) | new content, reuses `.badge-*` from design-system.html:50 | done | bd-playbook.html:58-64 | No new badge colors — `badge-success`/`badge-warn`/`badge-neutral`/`badge-danger`/`badge-outline` all exist in styles.css. |
| "Grupos que no vale la pena priorizar" alert | reuses `.alert.alert-neutral` from outreach.html:67 / design-system | done | bd-playbook.html:67-73 | Directly answers the task's "which role groups are not worth prioritising" requirement, with anchor links into the matching cards. |

## Standalone page — 13 role-group cards

One row per `RoleGroupKey` in `src/lib/roleGroups.ts`'s `ROLE_GROUPS` order.
Each card has 3 fields (Qué decide / Qué dolor resuelve Avalith / Cuándo es
la persona equivocada) except `other`/`no_position`, which have no
per-field content because there is nothing group-specific to say (see
notes). Full sourcing for each line is in `playbook-content.md`.

| role group | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `c_level_tech` — C-Level Tech | accordion pattern, whats-new.html:66 | done | bd-playbook.html:77-83 | Priority Alta; open by default (top 3 are pre-expanded, matching whats-new.html's `open` default on its first cards). |
| `c_level_business` — C-Level / Fundadores | same pattern | done | bd-playbook.html:84-90 | Priority Alta. |
| `eng_leadership` — Liderazgo de Ingeniería | same pattern | done | bd-playbook.html:91-97 | Priority Alta. |
| `engineering_manager` — Gerentes de Ingeniería | same pattern | done | bd-playbook.html:98-104 | Priority Media; collapsed by default. |
| `tech_lead_architect` — Tech Leads y Arquitectos | same pattern | done | bd-playbook.html:105-111 | Priority Baja. |
| `product` — Producto | same pattern | done | bd-playbook.html:112-118 | Priority Media. |
| `project_delivery` — Proyectos y Delivery | same pattern | done | bd-playbook.html:119-125 | Priority Baja. |
| `developers` — Desarrolladores | same pattern | done | bd-playbook.html:126-132 | Priority "No priorizar" (owner's explicit ask). |
| `hr_recruiting` — RRHH y Reclutamiento | same pattern | done | bd-playbook.html:133-139 | Priority Media (US Placements case only). |
| `sales_bd` — Ventas y BD | same pattern | done | bd-playbook.html:140-146 | Priority "No priorizar". |
| `operations` — Operaciones | same pattern | done | bd-playbook.html:147-153 | Priority Baja. |
| `other` — Otro | same pattern | done | bd-playbook.html:154-156 | "Revisar" badge instead of a priority tier; body explains why no generic content is possible (classifier fallback bucket). |
| `no_position` — Sin cargo | same pattern | done | bd-playbook.html:157-159 | "No evaluable" badge; body explains the contact has no position to reason about. |

## In-context surfaces (required by the task — a standalone page alone is not enough)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Section heading "Dónde aparece además" + intro | new content | done | bd-playbook.html:162-163 | States explicitly why a standalone page isn't sufficient, per the task brief. |
| Surface 1: "por qué este rol" hint on the contact record's Cargo row | extends contact-record.html:83 (`.prop` dt/dd for Cargo) | done | bd-playbook.html:167-186 | New info-icon `details.dropdown` next to the existing edit-pencil icon; panel shows the role group's one-line rationale + a deep link (`#eng_leadership`) into the matching card above. No new component — same `.dropdown`/`.menu`/`.menu-item` used by "Posponer" in follow-up-queue.html:78-79. |
| Surface 2: "por qué estos grupos" hint on the Contactos role-group filter chip | extends contacts.html:79-86 (filter chip + "Agregar filtro" menu) | done | bd-playbook.html:187-204 | Same disclosure pattern; panel lists priority-coded role groups (Alta/No priorizar shown, full guide linked) so a BD can decide which groups to filter by without leaving Contactos. |
| Surface 3 (optional per task wording "possibly"): hint on follow-up-queue cards | follow-up-queue.html:64-80 (card headline) | deviation | — | Not built. The follow-up-queue README (`openspec/changes/follow-up-queue/mockups/README.md`, decision 4) already fought to keep each card at ~110px by using icon-only actions; adding a third disclosure trigger per card was judged likely to reopen that fight. Flagged as decision 4 in this change's README for the owner to accept or reject. |

## Content sourcing and assumptions

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Every Avalith fact cited to `empresa.md` | n/a (content file) | done | playbook-content.md:1-30 | `rol-objetivos.md` and `target-companies.json` were read in full and found to have no on-topic facts (documented at the top of the file so the omission isn't silent). |
| Every inferred/unconfirmed claim marked `(supuesto)` | n/a | done | playbook-content.md (every role-group section) | Consistent with `empresa.md` itself flagging the real ICP as unconfirmed. |
| Assumption list for the owner | n/a | done | playbook-content.md (final section, 5 numbered items) | Mirrors the "numbered owner decisions" format used in README.md. |

**Counts:** done 24, deviation 2, todo 0.
