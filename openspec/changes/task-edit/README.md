# task-edit — mockup

Design-only proposal. No application code changed. Static HTML at
`mockups/task-edit.html`, built on the approved `crm-hubspot-ux` mockups
(`../crm-hubspot-ux/mockups/styles.css`, same app shell, same dialog
component).

## What the owner is approving

Today nothing edits an existing task — not even its title
(`openspec/BACKLOG.md`, "task-essentials — remaining": `updateTaskAction` is
validated and ready but has no caller). This mockup proposes:

- Two entry points into the same edit dialog: a task row in `/tasks`, and the
  "Tareas" card on a contact/company record — both already exist; only the
  task title becomes clickable.
- One "Editar tarea" dialog, a sibling of the existing "Crear tarea" dialog
  (`contact-record.html#task`), pre-filled with the task's current title,
  due date, assignee, description, and (read-only) association.
- A "Marcar como completada" / "Reabrir tarea" action inside that same
  dialog.
- The saving, empty-title validation error, and completed-task states.

Open `mockups/task-edit.html` in a browser. The list and the "Tareas" card
are real, clickable entry points (`#task-edit`) that open the live,
interactive dialog in its default pre-filled state. The saving / validation
error / completed-task states can't be triggered by clicking (there's no
JS state machine in a static mockup), so they're shown below as a reference
gallery, each using the exact same `.dialog` component.

## Decisions embedded (change any of these — they're the point of this review)

1. **Entry-point affordance: clicking the task title, not a new icon.** Both
   in the `/tasks` row and the "Tareas" card, the task's title text becomes
   the link that opens the edit dialog. This matches HubSpot (click the
   subject to open the task) and avoids adding a column to the tasks table
   or changing the card's shape. Alternative: a dedicated pencil/edit icon
   next to each row/card, at the cost of a new element per row.
2. **Added a "Descripción" field.** The existing "Crear tarea" dialog has no
   description field, but `updateTaskAction` persists `description`, and per
   `openspec/BACKLOG.md` every task-creation path now writes one. Editing
   without exposing it would make existing descriptions invisible and
   unreachable, so the edit dialog adds a `textarea` (same class as
   "Registrar reunión"'s notes field).
3. **"Asociado con" is read-only** (disabled input, same treatment as the
   disabled "Para" field in "Enviar correo"). `updateTaskAction`'s signature
   only accepts title, description, due date and assignee — no
   re-association — and HubSpot itself doesn't let you move a task to a
   different record from its edit view. If reassignment is ever wanted,
   that's a separate feature.
4. **"Marcar como completada" / "Reabrir tarea" is a secondary, left-aligned
   footer button**, not a checkbox next to the title. This mirrors the
   existing "Regenerar" pattern in "Generar mensaje" and keeps the dialog
   header identical to every other dialog (icon + title + close).
5. **A completed task stays fully editable when reopened for editing**: a
   `badge-success` "Completada" chip sits next to the dialog title, plus a
   one-line "Completada el <fecha> · <BD>" caption, but every field
   (including title/due date/assignee/description) is editable and "Guardar
   cambios" remains available without first reopening the task — matching
   HubSpot's behavior.
6. **Validation reuses the existing pattern exactly**: `.input.is-invalid`
   plus `.error-text` below the field, the same combination already used in
   "Registrar llamada" and "Descartar contacto". No new error style.
7. **Saving reuses the existing button pattern exactly**: the
   `.spinner` + "Guardando…" button already defined in the design system
   (`design-system.html`). The two other footer buttons switch to the
   existing `disabled` button treatment. There's no "frozen form" style in
   the design system, so none was invented for the fields.
8. **No fields beyond what the task actually stores** (title, description,
   due date, assignee, status). HubSpot tasks also have a type (call/email/
   to-do) and priority; this app's task model has neither, so they weren't
   added.

## What building it would touch

- A new "edit task" dialog (or an editable variant of the existing
  create-task dialog) wired to `updateTaskAction`
  (`src/app/(app)/tasks/actions.ts`), reachable from `/tasks` rows and from
  the contact/company record's "Tareas" card.
- A "mark complete / reopen" action from inside the dialog — decide whether
  it reuses the row/card's existing inline-checkbox completion action or
  needs its own.
- Whatever query currently backs `/tasks` rows and the record's task card
  needs to select `description` too (title/due date/assignee/status are
  already selected there); check both read paths before wiring the dialog.
