# Tasks page mockup-port checklist

Mockup: `openspec/changes/crm-hubspot-ux/mockups/tasks.html` + `styles.css`.
Current impl: `src/app/(app)/tasks/page.tsx`.

Columns: `element | mockup ref | status | evidence file:line | notes`.

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Page header (eyebrow/title/subtitle) | tasks.html page-header | done | src/app/(app)/tasks/page.tsx:51-57 | pre-existing |
| "Nueva tarea" primary button | tasks.html `.page-header .actions .btn-primary` | done | src/app/(app)/tasks/NewTaskButton.tsx | opens the create-task dialog (t04) |
| View tabs: "Mis tareas abiertas" | tasks.html `.view-tabs` | done | src/lib/tasks/viewTabs.ts, src/app/(app)/tasks/page.tsx:120-130 | filters to tasks assigned to the current BD, default view |
| View tabs: "Todas abiertas" | tasks.html `.view-tabs` | done | src/lib/tasks/queries.ts:119-129 (getAllOpenTasks), src/app/(app)/tasks/page.tsx | all open tasks, any assignee |
| View tabs: "Completadas" | tasks.html `.view-tabs` | done | src/lib/tasks/queries.ts:131-143 (getCompletedTasks), src/app/(app)/tasks/page.tsx | status=done, bounded limit/offset |
| Vencidas group + count badge | tasks.html `h3 Vencidas` | done | src/app/(app)/tasks/page.tsx:65-74 | pre-existing |
| Hoy group + count badge | tasks.html `h3 Hoy` | done | src/app/(app)/tasks/page.tsx:75-84 | pre-existing |
| Próximas group | tasks.html `h3 Próximas` | done | src/app/(app)/tasks/page.tsx:85-94 | pre-existing |
| Table: check column (complete task) | tasks.html `.col-check` | done | src/app/(app)/tasks/CompleteTaskButton.tsx | keep as-is, tests cover it |
| Table: Tarea column (title + description) | tasks.html `<span class="strong">` | done | src/app/(app)/tasks/page.tsx:164-167 | pre-existing |
| Table: Asociado con column — real contact/company name, linked | tasks.html `<a href="contact-record.html">Name · Company</a>` | done | src/lib/tasks/subject.ts, src/lib/tasks/queries.ts:29-58, src/app/(app)/tasks/page.tsx:157,168-170 | bounded leftJoin on person/company PKs, no per-row queries; see t02 |
| Table: Responsable column (owner chip) | tasks.html `.owner-chip` | done | src/app/(app)/tasks/page.tsx:173-178 | pre-existing |
| Table: Vencimiento column (badges) | tasks.html `.badge` | done | src/app/(app)/tasks/page.tsx:179-193 | pre-existing |
| Empty state | tasks.html (n/a, not shown in mockup but existing app behavior kept) | done | src/app/(app)/tasks/page.tsx:59-62 | pre-existing, kept |
| "Nueva tarea" dialog: title field | tasks.html (dialog not in mockup; behavior requested by owner) | done | src/app/(app)/tasks/NewTaskButton.tsx | |
| "Nueva tarea" dialog: subject picker (contact or company, searches contacts by name) | owner instruction | done | src/lib/tasks/subjectSearch.ts, src/lib/tasks/subjectSearchDb.ts, src/app/(app)/tasks/NewTaskButton.tsx | reuses createTaskAction; bounded ilike search (8 contacts, 5 companies) |
| "Nueva tarea" dialog: due date field | owner instruction, same shape as record-page TaskForm | done | src/app/(app)/tasks/NewTaskButton.tsx | |
| "Nueva tarea" dialog: submit reuses createTaskAction | owner instruction — no new write path | done | src/app/(app)/tasks/NewTaskButton.tsx | calls createTaskAction directly, same action as QuickActions "Tarea" and bulkCreateTaskAction |
