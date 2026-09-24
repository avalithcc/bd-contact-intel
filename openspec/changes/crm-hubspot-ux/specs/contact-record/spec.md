# Contact Record Specification

## Purpose

Define the three-pane Contact record page at `/contacts/[id]`: About (editable properties, quick actions), filtered timeline, and associations. Legacy `/leads/[id]` and `/contact/[id]` redirect here.

## Requirements

### Requirement: Three-pane layout

The record page MUST present three panes: left About (editable properties and quick actions), middle activity timeline, right associations (company, connected BDs).

#### Scenario: Record page renders all three panes

- GIVEN a Contact record is opened at `/contacts/[id]`
- WHEN the page loads
- THEN About, timeline, and associations panes are all visible

### Requirement: Quick actions

The About pane MUST offer quick actions to add a note, send an email, create a task, log a meeting, and discard the Contact.

#### Scenario: Logging a meeting from the record page

- GIVEN a BD is on a Contact's record page
- WHEN they use the "log meeting" quick action and submit it
- THEN a meeting activity is recorded and the Contact's derived status updates to `meeting`

#### Scenario: Discard requires a reason

- GIVEN a BD uses the "discard" quick action
- WHEN they submit without providing a reason
- THEN the discard is not recorded and status does not change

### Requirement: Status is read-only, derived

The About pane MUST display status as read-only. The system MUST NOT provide any control to set status directly; status changes only as a result of quick actions recording activity.

#### Scenario: No manual status field

- GIVEN a BD is on a Contact's record page
- WHEN they look for a way to change status directly
- THEN no such control exists

### Requirement: Filtered activity timeline

The timeline MUST be filterable by activity type and MUST be designed to render email threads in the future without a structural change.

#### Scenario: Filtering the timeline by type

- GIVEN a Contact has notes, emails, and meeting activities
- WHEN a BD filters the timeline to "meetings"
- THEN only meeting activities are shown

### Requirement: Associations

The right pane MUST show the Contact's associated company and connected BDs (with per-BD `connectedOn`).

#### Scenario: Multiple connected BDs shown

- GIVEN a Contact has 3 connected BDs
- WHEN the associations pane renders
- THEN all 3 BDs are listed with their own `connectedOn` dates

### Requirement: Legacy route redirects

`/leads/[id]` and `/contact/[id]` MUST redirect to the corresponding `/contacts/[id]` record via the id mapping.

#### Scenario: Old lead link redirects

- GIVEN a bookmarked link to `/leads/42`
- WHEN it is opened
- THEN the browser is redirected to the unified `/contacts/[id]` page for that person

### Requirement: Conversation visibility on the record

The record page MUST show conversation history scoped by `bdId` by default, per admin-access-audit rules; only an admin bypass reveals another BD's content, and that view is audited.

#### Scenario: Non-admin sees history marker only

- GIVEN a non-admin BD views a Contact with conversation history from another BD
- WHEN the timeline renders
- THEN it indicates another BD has history but does not show that content
</content>
</invoke>
