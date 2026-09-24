# Design System Specification

## Purpose

Establish one visual language, defined by `DESIGN.md` tokens and a shared component set, applied to every screen from `/login` onward. Light-only. No per-page hardcoded colors. UI changes require owner-approved mockups before implementation.

## Requirements

### Requirement: Single token source

Every screen MUST source colors, spacing, and typography from `DESIGN.md` tokens (`globals.css`). No screen MAY hardcode a hex color, RGB value, or other literal style value outside the token system.

#### Scenario: New screen uses tokens only

- GIVEN a new screen is built as part of this change
- WHEN its styles are reviewed
- THEN all color and spacing values resolve to `DESIGN.md` tokens, with zero hardcoded literals

#### Scenario: Existing hardcoded literals are replaced when a screen is touched

- GIVEN a screen slated for this change currently has hardcoded status/stage badge colors
- WHEN that screen is rebuilt under this change
- THEN the hardcoded literals are replaced with token-based values

### Requirement: Shared component set

The system MUST provide and reuse shared components for the app shell, page header, buttons, badges, tables, and forms, and MUST provide shared empty/loading/error states. Screens built under this change MUST use these shared components rather than page-local duplicates.

#### Scenario: Shared empty state on the contact list

- GIVEN the contact list has zero results for a filter
- WHEN the empty state renders
- THEN it uses the shared empty-state component, not a page-local implementation

### Requirement: Light-only

The system MUST render every screen in light mode only. The system MUST NOT ship a dark-mode theme or theme switcher.

#### Scenario: No theme switcher present

- GIVEN a user opens any screen from `/login` onward
- WHEN they look for a dark-mode toggle
- THEN none exists

### Requirement: UI language is Spanish only

The system MUST render all user-facing copy in neutral, professional Spanish. The system MUST NOT ship a language switcher or any English-language UI path. All copy MUST come from a single centralized `es` dictionary. Glossary terms (see `mockups/GLOSSARY.md`) MUST be used consistently across every screen. Code identifiers, comments, and other non-user-facing artifacts remain in English.

#### Scenario: No language switcher present

- GIVEN a user opens any screen from `/login` onward
- WHEN they look for a language toggle
- THEN none exists

#### Scenario: All user-facing copy is Spanish

- GIVEN any screen affected by this change
- WHEN its rendered copy is reviewed
- THEN every user-facing string (nav, headings, buttons, labels, table headers, empty/error states, toasts) is neutral, professional Spanish, with no leftover English UI copy

#### Scenario: Copy sourced from a single dictionary

- GIVEN a component renders user-facing text
- WHEN its source is reviewed
- THEN the text resolves from the single `es` dictionary, not a hardcoded literal or a second-language dictionary path

#### Scenario: Glossary terms used consistently

- GIVEN two different screens reference the same domain concept (e.g. Owner, saved views, lead status values)
- WHEN their copy is compared
- THEN both use the same Spanish term as recorded in `mockups/GLOSSARY.md`

### Requirement: Mockup gate before UI code

For every screen affected by this change, the system MUST have an owner-approved clickable mockup on record before any UI code implementing that screen is merged.

#### Scenario: UI work blocked without approval

- GIVEN a mockup for a screen has not yet been approved by the owner
- WHEN implementation of that screen is proposed
- THEN it does not proceed until approval is recorded

#### Scenario: Approved mockup unblocks implementation

- GIVEN the owner has approved the review-queue mockup
- WHEN implementation of the review queue starts
- THEN it proceeds using the approved mockup as the visual reference
</content>
</invoke>
<parameter name="file_path">/Users/cristiancivita/avalith/proyectos/bd-contact-intel/openspec/changes/crm-hubspot-ux/specs/design-system/spec.md