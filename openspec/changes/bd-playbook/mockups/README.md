# bd-playbook — mockup

Design-only proposal, plus content. No application code changed. Static HTML
at `bd-playbook.html`, built on the approved `crm-hubspot-ux` mockups
(`../../crm-hubspot-ux/mockups/styles.css`, same app shell, same accordion
and disclosure components). The content per role group, with sources and
assumptions, lives in `../playbook-content.md` next to this folder.

## What the owner is approving

An in-app manual telling BDs which roles to contact and why, organised by
the role groups the system already classifies (`src/lib/roleGroups.ts`):
what each role decides, what pain Avalith solves for them, when they are
the wrong person, and which role groups are explicitly not worth
prioritising (`developers`, `sales_bd`; `project_delivery`,
`tech_lead_architect`, `operations` at lower priority).

Every claim about Avalith is cited to `avalith/contexto/empresa.md`
(services, positioning, named clients). Everything not confirmed there —
which is most of the role-to-priority reasoning, since `empresa.md` itself
flags the real ICP as unconfirmed — is marked **(supuesto)** in both the
content file and the mockup itself, visible to the BD reading it, not
buried in a footnote only the owner sees.

Open `bd-playbook.html` in a browser. The standalone page is the main
`guía de roles.` view: a priority legend, a "not worth prioritising"
callout, then 13 accordion cards (one per `RoleGroupKey`, three cards
pre-expanded). Below that, a "Dónde aparece además" section shows two static
snippets of where the reasoning surfaces outside the standalone page, per
the task brief's requirement that a standalone page alone is not enough.

**Desktop only, by owner direction** — no mobile state was built or
screenshotted.

## Decisions embedded (change any of these — they're the point of this review)

1. **Placement: new sidebar entry "Guía de roles", in the `sidenav-footer`
   group, above "Cuenta".** Rejected alternatives:
   - **A tab inside Contacts' saved views.** A playbook isn't a filtered
     list of contacts — it has no rows, no counts, nothing to save as a
     view. Forcing it into that pattern would misrepresent what it is.
   - **Top-level item under "Espacio de trabajo" (with Contactos, Empresas,
     Tareas, Seguimientos).** That section is reserved for objects a BD
     works through with counts/pills (16,642 contacts, 4 tasks, 10 due
     follow-ups). A reference manual has no "count" — putting it there
     would either show a fake number or an empty pill, both worse than
     grouping it with "Cuenta" and "Importar contactos", the other two
     "reference/setup" items with no live count.
   - A help icon (`?`) in the topbar was also considered and rejected: the
     task explicitly asks for a page BDs can navigate to and deep-link
     into from the record and the filter, not a modal/tooltip-only surface.
2. **Standalone page is not enough — two in-context surfaces were built**
   (task requirement, not optional):
   - **On the contact record**, a "por qué este rol" info-icon disclosure
     next to the Cargo/Position field, showing that contact's role-group
     rationale in one paragraph plus a deep link into the full card.
   - **On the Contacts role-group filter**, an info-icon disclosure next to
     the filter chip listing role groups by priority, so a BD building a
     filter doesn't have to leave Contactos to decide which groups to
     include.
   Both reuse the exact `details.dropdown` + `.menu` pattern already
   approved for the "Posponer" control in `follow-up-queue.html` — no new
   disclosure component was invented.
3. **A third surface — on the follow-up-queue cards — was NOT built.**
   The follow-up-queue mockup already fought hard (see its own README,
   decision 11) to compress each card to ~110px by using icon-only quick
   actions instead of labeled ones. A `details.dropdown` per card adds
   another interactive control candidates already competed for; the
   headline line (`Position en Company`) has no obvious anchor for an
   extra icon without wrapping. The task called this surface "possibly"
   in scope, not required — flagging it here so the owner can decide
   between: (a) leave it out, (b) add it anyway at the cost of a taller
   card, or (c) show it only as plain text next to the headline (no
   disclosure, no extra click target) — e.g. "· Liderazgo de Ingeniería".
4. **Priority is a 5-value badge scale (Alta/Media/Baja/No priorizar/
   Revisar-No evaluable), not a free-text field.** This mirrors how the
   mockups already communicate confidence with badges (`badge-probable` →
   "Probable" on suggested emails, `contacts.html:126`) rather than
   paragraphs. Alternative: drop the badge
   and let the accordion order alone imply priority (top-to-bottom).
   Rejected because a BD scanning quickly benefits from a color/word cue,
   not just position in a list, and the "No priorizar" cases needed to be
   visually distinct from "just ranked lower".
5. **Cards use the existing accordion (`details.card`), pre-expanding only
   the three "Alta" groups.** Alternative: expand all 13 by default (as
   `whats-new.html` does for its 3 companies) or none. Rejected both:
   expanding all 13 makes the page a very long scroll before a BD sees
   anything actionable; collapsing all 13 hides the highest-value content
   behind a click. Pre-expanding exactly the "Alta" tier surfaces what
   matters most while keeping the rest one click away.
6. **The "not worth prioritising" summary is a single alert box near the
   top, not a separate page or tab.** It repeats information also visible
   per-card (the priority badge) but in one scannable place, matching the
   task's explicit ask to surface "which role groups are not worth
   prioritising" without making a BD open all 13 cards to find out.

## What building it would touch

- No new database read for the standalone page itself — role group content
  is static copy, not per-contact data.
- The contact-record hint needs the contact's already-computed
  `classifyPosition(contact.position)` result (existing function in
  `src/lib/roleGroups.ts`) to pick which of the 13 static blurbs to show —
  no new query, just a lookup already available wherever the record page
  renders the Cargo field.
- The Contactos filter hint is entirely static copy; no data dependency.
- Content itself (the 13 blurbs, sources, "no priorizar" list) would need
  to live somewhere editable — decision needed from the owner on **who can
  edit this later**: hardcoded in `src/lib/i18n/dictionaries` next to the
  existing `roleGroups` labels (versioned in git, requires a PR to change),
  or a simple admin-editable table (more flexible, more to build). This
  mockup assumes the former (static, developer-edited) since the task
  scope is "mockup + content only" and did not ask for an editing UI.

## Assumption list (owner to confirm — mirrors `../playbook-content.md`)

1. Who actually holds budget authority for each service, per role group —
   inferred from typical B2B software-staffing buying patterns, not from
   an Avalith-specific source.
2. Whether `c_level_business` or `eng_leadership` is the primary decision
   maker varies by company size — assumed, not measured.
3. Whether `hr_recruiting` has real influence over US Placements decisions,
   or if that's always owned by `eng_leadership`/`c_level_tech`.
4. Whether `project_delivery` and `tech_lead_architect` are worth any BD
   time at all, or should also move to "No priorizar".
5. The real ICP and deal size — `empresa.md`'s own open question — would
   likely change which role groups are "Alta" vs. "Media"; this playbook
   only structures the reasoning so the owner can correct it per group.
