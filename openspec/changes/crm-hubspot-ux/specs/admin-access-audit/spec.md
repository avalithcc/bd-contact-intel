# Admin Access Audit Specification

## Purpose

Define the admin role, conversation visibility rules (message content stays BD-scoped by default), and audit logging for merges and admin views of other BDs' conversations.

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

An admin MUST be able to read any BD's conversation content at any time.

#### Scenario: Admin reads another BD's conversation

- GIVEN an admin opens a Contact record
- WHEN they view BD B's conversation history
- THEN the message content is visible to the admin

### Requirement: Admin conversation views are audit-logged

Every time an admin reads another BD's conversation content, the system MUST write an audit log entry recording the admin, the BD whose conversation was viewed, the Contact, and the timestamp.

#### Scenario: Audit entry created on admin view

- GIVEN an admin views BD B's conversation with a Contact
- WHEN the view occurs
- THEN an audit log entry is created recording the admin, BD B, the Contact, and the timestamp

#### Scenario: No audit entry for own conversations

- GIVEN a BD views their own conversation with a Contact
- WHEN the view occurs
- THEN no audit entry is created

### Requirement: Merges are audit-logged

Every merge and unmerge action MUST be recorded in an audit log distinct from or alongside the merge trail, capturing who performed the action and when.

#### Scenario: Merge produces an audit entry

- GIVEN an admin merges two queue entries
- WHEN the merge completes
- THEN an audit log entry records the admin and the timestamp
</content>
</invoke>
