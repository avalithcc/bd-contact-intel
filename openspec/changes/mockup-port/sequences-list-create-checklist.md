# Sequences list and create form checklist (outreach-sequences 12.3)

Mockups: `openspec/changes/outreach-sequences/mockups/secuencias-lista.html` (L) and `secuencia-nueva.html` (N).
Both are unrouted until PR 13. Columns: element | mockup ref | status | evidence | notes. Evidence paths are relative to
`src/app/(app)/sequences/_components/` (C) or `src/lib/sequences/` (S).

## List (SequenceListView)

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Sidebar, topbar, "Secuencias 2" pill | L:14-51 | deviation | none | App chrome; the sidebar entry and its count are task 13.6. |
| mock-note, scope tag, "Sin secuencias" demo heading | L:53,102-103 | deviation | none | Mockup commentary, not page content. |
| Header: eyebrow, h1, intro with bold "Sólo ves las tuyas" | L:55-56 | done | C/SequenceListView.tsx:20-22 | |
| "Nueva secuencia" primary button | L:57 | done | C/SequenceListView.tsx:9,23 | Links to /sequences/new (PR 13). |
| Four stat cards (Secuencias / Borradores por revisar / Aprobados, en cola / Respondieron) with feet | L:59-64 | done | C/SequenceListView.tsx:40-47, S/listView.ts:35-42 | Queue foot reuses `queuedFoot` (exported from StatCards). |
| Table columns, "Secuencia" and "Creada ↓" marked sorted | L:67 | done | C/SequenceListView.tsx:50-53 | Order is fixed (newest first) in `listView`, not a clickable sort. |
| Name link + companies line ("A, B y N empresas más") | L:70 | done | C/SequenceListView.tsx:58, S/listView.ts:46 | |
| Contactos cell | L:71 | done | C/SequenceListView.tsx:60 | |
| Progress bar + state badges | L:72 | done | C/SequenceListView.tsx:63-74, S/listView.ts:25-33 | Badges are a partition of the members and are hidden at zero. |
| "Sin borrador" badge | not drawn | deviation | C/SequenceListView.tsx:68 | Added so the badges add up to the contact count. Owner decision. |
| "enviados" excludes replied and removed | L:72,92 | deviation | S/listView.ts:29 | The detail screen's "Enviados" includes replies. Owner decision. |
| Tope diario with "Sobre 8" badge | L:73,83 | done | C/SequenceListView.tsx:76 | Threshold is DAILY_SEND_CAP_WARN_ABOVE. |
| Cadencia text from the sequence's own schedule | L:74 | done | C/SequenceListView.tsx:77 | |
| Creada: date and "hace 3 días / ayer / hace 3 semanas" | L:75 | done | S/listView.ts:56-74, C/SequenceListView.tsx:78 | Miami calendar days. Months bucket added ("hace 3 meses"). |
| Row menu: Abrir secuencia / Editar secuencia | L:76-77 | done | C/SequenceListView.tsx:80-83 | Shared DropdownMenu instead of `<details>`; both items go to the detail page, as in the mockup. |
| Table footer (count, ordering) | L:100 | done | C/SequenceListView.tsx:90 | |
| Empty state: icon, title, body, button | L:104-106 | done | C/SequenceListView.tsx:27-36 | Header drops the intro paragraph, as drawn. |

## Create form (SequenceCreateForm, RosterPicker)

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Header: eyebrow, h1, intro | N:55-56 | done | C/SequenceCreateForm.tsx:39 | |
| Ajustes card, Nombre field with help and required error | N:59-62,233 | done | C/SequenceCreateForm.tsx:49-53 | Error shows after the first submit attempt. |
| Cuenta field, read-only, "Conectada", help with link | N:63 | done | C/SequenceCreateForm.tsx:54-59 | |
| No connected account | not drawn | deviation | C/SequenceCreateForm.tsx:57-58 | "Sin conectar" badge, explanation, submit disabled. A fake address is never shown. Owner decision. |
| Tope diario field, help, error for >15 and non-integers | N:66,232 | done | C/SequenceCreateForm.tsx:62-67, S/createForm.ts | Uses `validateDailySendCap`. Message for 0/negative/decimal is new wording. |
| Warning above 8 (alert-warn) | N:231 | done | C/SequenceCreateForm.tsx:74-76 | Live, `role="status"`. |
| Cadencia select with exactly ONE option, help | N:67 | done | C/SequenceCreateForm.tsx:68-72 | Text filled from DEFAULT_SCHEDULE. The second option is not added back. |
| Contactos card header "Elegiste N contactos de M empresas" | N:71 | done | C/SequenceCreateForm.tsx:79-80 | Counts from `selectionSummary`. |
| Neutral alert with reachability rules and "Máximo 2 contactos por empresa" | N:73 | done | C/SequenceCreateForm.tsx:82 | |
| Toolbar: search, segmented Todo EE. UU. / Florida, "Mostrar los que no se pueden agregar (N)" | N:75-80 | done | C/RosterPicker.tsx:83-91 | Search is client-side over the loaded list. |
| Selection bar: "N elegidos", companies, quota, "Quitar selección" | N:82 | done | C/RosterPicker.tsx:92-96 | Always shown; clear disabled at zero. |
| Table header with "Elegir todos los disponibles" | N:85 | done | C/RosterPicker.tsx:98-101, S/pickerView.ts toggleAllVisible | Stops at the company limit; the contact it stops reads as blocked. |
| Contact cell: avatar, name link, status badge, job title | N:89 | done | C/RosterPicker.tsx:55-61 | |
| Company cell: logo, link, Florida badge, open postings | N:90 | done | C/RosterPicker.tsx:15-31 | |
| Correo cell: badge + address | N:91,112 | done | C/RosterPicker.tsx:62 | |
| Email badge on blocked rows | N:155,162 | deviation | C/RosterPicker.tsx:62 | Mockup omits it on some blocked rows; always shown here when there is an email. |
| Disponibilidad: Elegido / Disponible + "N de 2 en la empresa" | N:92,120 | done | C/RosterPicker.tsx:33-41 | |
| Separator "No se pueden agregar · N" | N:150 | done | C/RosterPicker.tsx:105,115 | |
| Blocked rows last, dimmed, disabled checkbox, reason | N:151-220 | deviation | S/pickerView.ts:73-83 | Approved reading of "not offered". Owner-approved. |
| Ten reasons worded | N:156-219 | done | S/pickerView.ts:44-52, es.ts blockLabels/blockWhy | Uses the seed admission; company limit derived from the selection. |
| "Ya es miembro" names another sequence | N:184 | deviation | S/pickerView.ts `blockDetail` | No spec rule blocks a Contact from a second sequence. The read decides whether to supply it. Owner decision. |
| Merged row links to the current record | N:191 | done | C/RosterPicker.tsx:41 | |
| Table footer with counts and quota | N:222 | done | C/RosterPicker.tsx:111-114 | Counts the rows shown. |
| Cancelar link and "Crear secuencia con N contactos" | N:225 | done | C/SequenceCreateForm.tsx:86-90 | Disabled with "Elegí al menos un contacto para crear" at zero. |
| Name / cap error states cards | N:228-234 | done | C/SequenceCreateForm.tsx:50-53,66 | The three demo cards are states of the real fields. |
| Submit reports intent only | n/a | done | C/actions.ts (CreateSequenceIntent) | |

## Owner decision needed: "enviados" means two different things, one click apart

The two approved mockups disagree, and the code follows each one faithfully:

- **List** (`listView.ts:53`): `sent` counts `sent` + `no_reply`, so a member who replied is NOT in it. The list mockup needs this — its row badges only add up to the row total as a partition.
- **Detail** (`stats.ts:56`): `SENT_STATES` includes `replied`. The detail mockup needs this too ("Enviados 4" covering 3 awaiting a reminder and 1 replied).

So a Sequence reading "5 enviados · 1 respondió" in the list reads "Enviados 6" on the detail. **The list is the one a BD will misread**: "5 enviados" sounds like five emails left the mailbox, and six did. The detail number is the true count of mail sent.

This cannot be fixed in code alone — it is a disagreement between two approved mockups. The cheaper fix is to relabel the LIST badge ("esperan respuesta" / "sin respuesta aún"), because changing the arithmetic instead would break the detail screen's stats contract. Not changed here: both wordings are the owner's, approved today.

## PR 13 obligations for these two screens

1. **The list read must not truncate.** `listView` derives every count from the rows it is handed — same shape as the member cap in `detailQueries.ts`, which reads one row past its bound and throws rather than count a truncated roster.
2. **The picker read must KEEP non-addable candidates.** `buildRosterCandidatesQuery` removes them in SQL, so it cannot feed this picker. The read needs `emailStatus`, `emailSource`, open IT count, lead status, merged-into id and client status, and each Contact's reason then comes from `staticBlock(candidate, guards)`.
3. **Pass an EMPTY guards map when creating a new Sequence.** `staticBlock` can only return `company_limit` if handed an `activeCountByCompany` of 2 or more; for a brand-new Sequence there are no existing members, and a static `company_limit` would render its copy with an empty name list ("…()"). The picker derives that reason from the live selection instead.
4. **The picker read should always supply a company.** `pickerView.ts:65` gives a Contact with a null `companyKey` its own group key, so three company-less Contacts read as "3 contactos de 3 empresas".

## Known, accepted difference

The progress bar segment widths do not match the mockup's literal pixel widths (the mockup draws row 2 as 100% green with two removed members; the code gives 80/20). The code follows the `stats.ts` rule, where the rest segment holds the discarded. The mockup's own arithmetic is loose here; the rule wins.
