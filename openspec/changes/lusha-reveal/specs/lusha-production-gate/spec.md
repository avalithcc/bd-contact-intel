# Lusha Production Gate Specification

## Purpose

Lusha spends real money, so it must be reachable only from production with a server-side API key. Local development, preview deploys and scripts never call Lusha. A single resolver decides, fails closed, and lets the UI explain why a control is disabled.

## Requirements

### Requirement: Lusha is enabled only in production with the key present

The system MUST resolve Lusha availability in one place. It MUST be enabled only when `VERCEL_ENV === 'production'` AND `LUSHA_API_KEY` is present. `NODE_ENV` MUST NOT be used as the discriminator, because Vercel preview deploys also run with `NODE_ENV=production`.

#### Scenario: Production with key

- GIVEN `VERCEL_ENV` is `production` and the key is set
- WHEN availability is resolved
- THEN Lusha is enabled

#### Scenario: Preview deploy

- GIVEN `VERCEL_ENV` is `preview`, `NODE_ENV` is `production`, and the key is set
- WHEN availability is resolved
- THEN Lusha is disabled with reason not-production

#### Scenario: Local development

- GIVEN a local environment
- WHEN a reveal is attempted
- THEN no Lusha request is constructed and no network call is made

#### Scenario: Key missing in production

- GIVEN `VERCEL_ENV` is `production` and the key is absent
- WHEN availability is resolved
- THEN Lusha is disabled and the missing variable name is reported, never a value

### Requirement: The gate fails closed and never throws into the UI

When disabled, resolution MUST return a typed disabled result instead of throwing, and no request MUST ever be built with an undefined key. The server action MUST re-check the gate itself; a disabled UI is not the only barrier.

#### Scenario: Server rejects when disabled

- GIVEN Lusha is disabled
- WHEN a reveal server action is invoked directly
- THEN it returns a typed failure without a ledger claim or network call

### Requirement: Disabled controls explain why

When Lusha is disabled the reveal controls MUST render disabled with copy stating the reason (not available in this environment, or not configured), rather than being hidden or failing at click time.

#### Scenario: Explained disabled state

- GIVEN a local or preview environment
- WHEN the About pane renders
- THEN the Lusha controls are disabled with an explanation

### Requirement: The key is server-side REST only and never exposed

The application MUST authenticate with the server-side REST key only, MUST NOT call the Lusha MCP, and MUST NOT send the key or its value to the client or logs. `LUSHA_API_KEY` MUST be documented as production-only.

#### Scenario: Key not in client payload

- GIVEN Lusha is enabled
- WHEN the Contact page is rendered
- THEN no client payload contains the key value

### Requirement: Removing the key is the kill switch

Removing `LUSHA_API_KEY` from production MUST disable all reveal controls with no deploy and no other behavior change. Already-revealed values MUST remain on their Contacts.

#### Scenario: Key removed

- GIVEN reveals were made and the key is then removed
- WHEN a Contact page renders
- THEN controls are disabled and revealed values and badges remain
