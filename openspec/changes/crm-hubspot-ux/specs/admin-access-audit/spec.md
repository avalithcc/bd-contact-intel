# Admin Access Audit Specification

## Purpose

Define the admin role, conversation visibility rules (message content stays BD-scoped by default, admins read it inline), and audit logging for merges. Admin reads of other BDs' conversations are deliberately NOT audit-logged (owner decision 2026-10-15).

## Requirements

### Requirement: Admin role

The system MUST support an admin role on BDs. The owner MUST be the first admin.

#### Scenario: Owner is admin by default

- GIVEN the system is initialized
- WHEN roles are checked
- THEN the owner has the admin role

### Requirement: Non-admins cannot read other BDs' conversation content

A non-admin BD MUST NOT be able to read the message content of a conversation belonging to another BD. Non-admins MAY see which BDs have history with a Contact, never the content.

#### Scenario: Non-admin blocked from another BD's message content

- GIVEN BD A is not an admin
- WHEN BD A requests message content from a conversation owned by BD B
- THEN the request is rejected
- AND BD A can only see that BD B has history with the Contact, not the messages

### Requirement: Admins can always read any BD's conversations

An admin MUST be able to read any BD's conversation content at any time. The content MUST be shown inline in the Contact's timeline when the record loads, with no confirmation step and no button to press. The read MUST be bounded (a row cap and a per-message length cap) so a Contact with a large history cannot make the record page unbounded.

#### Scenario: Admin reads another BD's conversation

- GIVEN an admin opens a Contact record
- WHEN the timeline renders BD B's conversation history
- THEN the message content is visible to the admin without any further action

#### Scenario: Non-admin never receives the content

- GIVEN a non-admin BD opens a Contact record that has BD B's conversation
- WHEN the record is rendered
- THEN the timeline shows the locked marker for BD B's entries
- AND the message content is absent from the data the server returns, not merely hidden in the view

### Requirement: Admin conversation reads are not audit-logged

Reading a conversation inline renders it on every record view, so an audit row per read would bury the audit log in noise. The system MUST NOT write an audit log entry when an admin reads another BD's conversation content (owner decision 2026-10-15, superseding the earlier "every admin view is audit-logged" requirement). Audit entries of this kind written before that date MUST remain readable in the audit log screen.

#### Scenario: No audit entry on admin read

- GIVEN an admin opens a Contact record that has BD B's conversation
- WHEN the conversation content is rendered inline
- THEN no audit log entry is created

#### Scenario: Past entries stay readable

- GIVEN `view_conversation` audit entries written before 2026-10-15
- WHEN an admin opens the audit log screen
- THEN those entries are listed, and each links to the Contact record where the conversation now appears inline

### Requirement: Merges are audit-logged

Every merge and unmerge action MUST be recorded in an audit log distinct from or alongside the merge trail, capturing who performed the action and when.

#### Scenario: Merge produces an audit entry

- GIVEN an admin merges two queue entries
- WHEN the merge completes
- THEN an audit log entry records the admin and the timestamp
</content>
</invoke>
