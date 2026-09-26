# Proposal: HubSpot Contacts Import

## Intent

The team's pre-app lead history (5,975 contacts, mostly Apollo-sourced) lives only in a HubSpot export. BDs cannot see who was already worked, by whom, or how far it went, so they risk re-contacting people or losing history. Import it once into the unified CRM (`person`), deduplicated by the existing identity resolver, with past outreach reflected in derived status, and re-runnable without duplicates.

## Scope

### In Scope
- Import `hubspot/todos-contactos.csv` + companies export (resolves company name/domain for rows carrying only `Associated Company IDs`).
- All rows treated as leads; lifecycle stage ignored.
- Owner map: "Cristian Civita" → BD "Cristian Civita", "Macarena Davila" → BD "Macarena Dávila" (accent-insensitive match); deactivated/blank → unassigned.
- Past outreach → `status_backfill` activities (existing R4 statuses only; see mapping).
- HubSpot record ID kept for idempotent re-import.
- Gated run: new migration kind `hubspot_import` (dry run → `/admin/migration` approval → guarded execute: input hash, `pg_dump` backup, `audit_log`). Report labels in neutral Spanish.

### Out of Scope
- HubSpot activities/notes/emails/deals exports; ongoing sync.
- Phone numbers (no `person` column) — see Q2.
- In-app CSV upload for HubSpot.

## Capabilities

### New Capabilities
- `hubspot-import`: column mapping, owner mapping, status-evidence mapping, own-company skip, idempotency by HubSpot ID, dry-run report.

### Modified Capabilities
- `contact-migration`: new gated run kind; mapping for non-uuid external IDs.
- `contact-identity`: unverified-email exact match routes to review (not new Contact); HubSpot emails stored as unverified.

## Approach

- **CLI, not UI**: new `--phase=hubspot_import` in the existing migration CLI reads the local CSV; PII never uploaded or committed. Approval stays in `/admin/migration`.
- **Identity**: no profile keys (0.6% LinkedIn) and unverified emails ⇒ no auto-merge. Name+company or exact email match → review queue; else new `person` (`source = hubspot_import`).
- **ID mapping (design decision)**: `person_id_map.legacy_id` is uuid. Options: deterministic uuid v5 of the HubSpot ID under `legacy_table = 'hubspot_contact'` (no schema change) vs. a text external-ID column/table.
- **Status mapping (draft)**: `Número de veces contactado` > 0 or `Último contacto` set → `contacted`; `En curso` → `contacted`; `Conectado` → `replied`; `Nuevo` → no activity. `originalAt` = `Último contacto` → `Última actividad` → `Fecha de creación`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/migration/*`, `scripts/unify-contacts.ts` | Modified | New phase, planner, run kind |
| `src/lib/identity/matcher.ts` | Modified | Unverified-email → review |
| `src/lib/hubspot/*` | New | Parser, mappers |
| `/admin/migration` | Modified | Report for new kind |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Review-queue flood from name+company | Med | Dry run reports count by method + 20-row false-positive sample; owner sets threshold before execute |
| Duplicates for rows with no resolvable company | Med | Report "no company" count; companies export required |
| PII leak | Low | Local CLI only; `hubspot/` git-excluded; logs print counts, never values |

## Rollback Plan

Run is additive and no auto-merge: delete persons created by the run (`person_id_map.migration_run_id`, `method='new'`) cascading their activities/map rows, and dismiss its review entries. `pg_dump` backup as last resort.

## Dependencies

- Companies export in `hubspot/`.
- `crm-hubspot-ux` specs are the base for deltas (not yet archived); reads served from `person`.

## Success Criteria

- [ ] Every HubSpot row maps exactly once (new / review / skipped_own_company).
- [ ] Re-running the dry run reports 0 new rows.
- [ ] Imported statuses match the mapping on sampled records.
- [ ] No export file or PII in git history.

## Resolved questions (owner, 2026-09-26)

1. **Q1 — lead status mapping**: `Abierto` → no activity; `Mal momento` → `replied`; `No calificado` → `discarded` (`wrong_profile`). Confirmed as proposed.
2. **Q2 — phone numbers**: deferred; not in v1 (`person` has no phone column).
3. **Q3 — re-import**: HubSpot only fills empty fields; it never overwrites values edited in the app.

## Companies export (received 2026-09-26)

`hubspot/todos-empresas.csv`: 3,230 companies, 209 columns. Fill rates: domain 99.8%, name 99.7%, LinkedIn company page 93%, country 92%, employees 89%, industry ("Sector") 87%, city 84%. Contacts link to companies through "Associated Company IDs (Primary)" (92% of contacts). Company-level "Associated Note" text exists for 10% of companies (e.g. hiring hints) and is worth importing as company notes; "Associated Email" (full email bodies, up to ~180 KB per cell) is out of scope.
