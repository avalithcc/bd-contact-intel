# Contact List Specification

## Purpose

Define the central contact list screen: saved views as tabs (including views that replace former per-BD outreach lists), filters, column selection, bulk actions, and a table/board toggle where board drag triggers the matching log action instead of setting status directly.

## Requirements

### Requirement: Central list, no per-BD scoping

The contact list MUST show Contacts without scoping the underlying query by `bdId`. Former per-BD outreach/hiring lists MUST be reproducible as filters or saved views (e.g. owner = me, status = new, has verified email, company is hiring) rather than separate per-BD data sets.

#### Scenario: "My new contacts" reproduced as a saved view

- GIVEN a BD previously relied on a per-BD outreach list of uncontacted people
- WHEN they open the "My new contacts" saved view (owner = me, status = new)
- THEN the results are Contacts matching that filter, not a separate per-BD table

### Requirement: Saved views as tabs

The list MUST present saved views as tabs. Views MUST support filters and MUST be applicable by any BD.

#### Scenario: Switching between saved views

- GIVEN saved views exist for "My new contacts" and "Hiring companies"
- WHEN a BD switches tabs
- THEN the list re-queries and displays results for the selected view's filters

### Requirement: Column selection

The list MUST let a BD choose which columns are visible.

#### Scenario: Hiding a column

- GIVEN the list shows a "source" column
- WHEN a BD hides that column
- THEN it no longer appears in the table view for that BD

### Requirement: Bulk actions

The list MUST support selecting multiple rows and applying a bulk action to the selection.

#### Scenario: Bulk-selecting contacts

- GIVEN a BD selects 5 Contacts in the table view
- WHEN they apply a bulk action
- THEN the action applies to all 5 selected Contacts

### Requirement: Table/board toggle with activity-driven status changes

The list MUST support toggling between table and board (kanban by status) views. Dragging a card on the board MUST NOT set status directly; it MUST open the matching log action (e.g. drag to `meeting` opens "log meeting"; drag to `discarded` requires a reason), and status changes only as a result of the recorded activity.

#### Scenario: Dragging a card to "meeting" opens the log action

- GIVEN a Contact card is on the `contacted` column
- WHEN a BD drags it to the `meeting` column
- THEN the "log meeting" action opens
- AND status becomes `meeting` only after the meeting activity is confirmed

#### Scenario: Dragging a card to "discarded" requires a reason

- GIVEN a Contact card is dragged to the `discarded` column
- WHEN the BD does not provide a discard reason
- THEN the card does not move and status remains unchanged

#### Scenario: Own-company contacts excluded from board

- GIVEN a Contact belongs to the own company
- WHEN the board renders
- THEN that Contact does not appear on any column
</content>
</invoke>
