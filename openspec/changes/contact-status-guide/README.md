# contact-status-guide

## What

A second reference/manual page for the BD team, alongside "Guía de roles"
(openspec/changes/bd-playbook): a static explanation of how `person.status`
and `company.relationship_stage` are derived and why they behave the way
they do. Lives at `/contact-status`, linked from a new "Guías" sidebar
section (grouping it with "Guía de roles", which moves out of
`sidenav-footer` into this new section).

## Why

BDs keep asking why a contact "didn't move" after a call or a LinkedIn
reply, and why the funnel view shows a contact stuck in a stage that
doesn't match what they remember doing. The two answers — "the status is
derived from recorded activity, not chosen" and "the commercial stage lives
on the company, not the contact" — are facts about `src/lib/status/
deriveStatus.ts` and `src/lib/reports/pipeline.ts` today, not proposed
behavior. This page writes them down once instead of re-explaining them in
Slack.

## Scope

- New route `src/app/(app)/contact-status/page.tsx` — static copy, zero DB
  reads (same convention as `/playbook`).
- New "Guías" `nav-section` in `Sidebar.tsx`, visible to every BD (not
  admin-gated), holding "Guía de roles" (moved) and "Estados de contacto"
  (new).
- No behavior change to `deriveStatus`, `buildPipelineRows`, or any status
  computation — this change only documents the existing algorithm.

## Accuracy

Every factual claim in the page copy (the four-stage order, the
activity-to-stage mapping, the call outcome/direction rule, the "status
never regresses" rule, the discard-is-not-sticky rule, and the company
pipeline stage order/labels) was checked line-by-line against
`src/lib/status/deriveStatus.ts` and `src/lib/reports/pipeline.ts` before
writing the copy, and again before shipping the page.
