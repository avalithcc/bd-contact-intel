# /admin/gmail ("Estado de Gmail") mockup parity checklist

Source mockup: `openspec/changes/gmail-sync-fleet/mockups/estado-gmail-equipo.html` (approved 2026-10-18).
The mockup draws five demonstration states of one screen (healthy fleet, one BD that must reconnect, one that never
connected, sync failures, loading and empty). The real page is ONE screen that renders each state from data, so a row below
covers every state it appears in. Mockup-only annotations (the `.mock-note` box, the "1 · ...", "2 · ..." section headings and
their explanatory paragraphs, the `NUEVO` tags, the "(existente)" remark) are not UI and are not built.

Columns: element | mockup ref | status | evidence | notes

Paths: `P` = `src/app/(app)/admin/gmail/page.tsx`, `T` = `src/app/(app)/admin/gmail/FleetTable.tsx`,
`S` = `src/app/contacts/Sidebar.tsx`, `X` = `src/lib/gmail/fleetText.ts`, `V` = `src/lib/gmail/fleetView.ts`.

## Shell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Sidebar entry "Estado de Gmail" under Administración, below "Lusha por BD", mail icon | sidenav, `a.nav-item.active` | done | S:309-318 | Admin-only (the section is `isAdmin`-gated). Active state via `isActive`. |
| Sidebar counter (BDs needing attention), `.pill-count` like "Duplicados" | `span.pill-count` "3" | done | S:317, `src/lib/shell/appShellBadgeCountsQuery.ts` (`gmail_fleet_accounts`), `src/lib/gmail/fleetAttention.ts` | Same single badge statement as every page, admin-only, light json (bd + email_account); classified by the same `countAttention` as the screen. Hidden at 0. |
| Breadcrumb "Administración / Estado de Gmail" | `nav.breadcrumbs` | deviation | `src/lib/shell/breadcrumbLabel.ts:31` | The shell's TopBar renders a one-level breadcrumb for every admin page ("Estado de Gmail"). Owner decision: extend the shell to two levels for all admin pages, or accept. |
| Topbar search box and account menu | `header.topbar` | deviation | (shell) | The TopBar shows search only on contacts and companies routes, as on every admin page today. Not changed here. |
| Route `/admin/gmail`, admin only, 404 for a BD | notes box, "Dónde vive" | done | `src/app/(app)/admin/gmail/layout.tsx`, P:30 | The check sits in a layout so the 404 status is set before `loading.tsx` streams (e2e: "cannot open the admin screen"). |

## Header and stats

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Eyebrow "Administración", h1 "Estado de Gmail." with dot, subtitle | `.page-header .titles` | done | P:43-51 | Copy verbatim, from the `gmailFleet` dictionary. |
| "Actualizado hoy HH:MM" | `.actions span.meta` | done | P:53 | Argentina clock, `formatInstant`. |
| "Actualizar" button | `.actions a.btn.btn-sm` | done | P:54-56, `FleetLink.tsx` | A link to the same dynamic URL (re-runs the read), with `useLinkStatus` pending dot. Keeps the active filter. |
| Stat "Sincronizando bien" `N de M`, foot | `.stat.success` | done | P:61-68 | `summarizeFleet`. |
| Stat "Necesitan reconectar" | `.stat.warn` | done | P:69-73 | |
| Stat "Con fallas de sincronización" | `.stat.warn` | done | P:74-78 | Counts config failures, failing and stale. |
| Stat "Nunca conectaron" | `.stat.neutral` | done | P:79-83 | |
| Per-BD alert above the table: danger "Nombre · Reconectar" with days, reminders sent, owner notice | `.alert.alert-danger` | done | P:86-95, X `fleetAlerts` | One per BD that must reconnect. The mockup's "(existente)" remark is dropped. |
| Per-BD alert: warn "Nombre · Falla al sincronizar" | `.alert.alert-warn` | done | P:86-95, X `fleetAlerts` | One per BD with a failing sync. Config failures and never-connected BDs get none, as in the mockup. |
| Alert for a stale sync (no error, over 60 min): "Nombre · Sin éxito reciente" | not drawn | deviation | X `fleetAlerts`, dictionary `alertStale*` | The mockup draws no stale case; copy is new. Owner to approve wording. |

## Toolbar

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Segmented filter "Todos / Necesitan atención / Sanos" | `.segmented` | done | P:96-104 | `?filter=` URL param, links with pending dot, `aria-current`. |
| Row count "N BD" | `.toolbar span.meta` | done | P:105 | Counts the filtered rows. |

## Table columns

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Header "BD ↑" (sorted, by name) | `th.sorted` | done | T:25-27 | Sorted by name in `getGmailFleetHealth`. Static sort, as in the mockup. |
| Header "Conexión" + "?" tooltip | `th .tip-hdr` | done | T:28 | Copy verbatim. |
| Header "Sincronización" + tooltip | | done | T:29 | |
| Header "Último email" + tooltip | | done | T:30 | |
| Header "Recordatorio de conexión" + tooltip | | done | T:31 | |
| Header "Rebotes (30 días)" + tooltip, right-aligned bubble | `.tip-end` | done | T:32 | |
| Header "Envíos programados fallidos" + tooltip, right-aligned bubble | `.tip-end` | done | T:33 | |
| Header "Acciones" (sr-only) | `span.sr-only` | done | T:34-36 | |

## BD cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Avatar + name + email | `.owner-chip` | done | T:62-64,70 | |
| Name tooltip "Último ingreso al CRM: hoy 09:12 / ayer 17:45 / 11 oct 2026" | `.tip` on name | done | T:56,64-66 | From `bd.last_seen_at`. No record shows "sin registro" (new copy). |
| "Administrador" badge | `.badge-outline.no-dot` | done | T:67 | |
| "Nueva" badge | `.badge-info` | done | T:68 | A BD created in the last 14 days (same window as Lusha por BD). |

## Conexión cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Chip "Conectado" (success) with tooltip | `.badge-success` | done | T:73-75 | |
| Chip "Reconectar" (danger) with tooltip | `.badge-danger` | done | T:73-75 | Reasons: disconnected, missing scope, expired/revoked, auth sync error (`decideConnectionBanner`). |
| Chip "Nunca conectó" (neutral) with tooltip | `.badge-neutral` | done | T:73-75 | No `email_account` row. |
| Chip "Falla de configuración" (danger) with tooltip | `.badge-danger` | done | T:73-75 | Server OAuth misconfigured. |
| "Autorización vigente" under "Conectado" when the sync is failing or stale | `.meta.mt-md` | done | T:76 | |

## Sincronización cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Last success date + "hace 2 minutos" (healthy) or "hace N · último éxito" | `span.soft` + `.meta` | done | T:80-84, X `syncCell` | `formatInstant` / `formatSince` / `formatAgo`. |
| "Cursor al día" / "Importación inicial en curso" | `.meta` | done | X `syncCell` | `history_id` and `backfill_page_token`. "Sin cursor todavía" (connected, no cursor yet) is new copy. |
| Warn chip "Falla al sincronizar" with tooltip | `.badge-warn` | done | T:85-91 | |
| Warn chip for a stale sync "Sin éxito reciente" | not drawn | deviation | T:85-91 | New copy, reuses the failing tooltip. Owner to approve. |
| Error line "Error de Gmail (otro): «...»", truncated to one line | `.meta` | done | X `errorLine` | 60 characters then "…". Authorization errors read "Error de autorización: «...»" (new copy). Config errors show the raw text, as in the mockup. |
| "Reconectar no lo arregla" | `.meta` | done | X `syncCell` | Only for a failing sync that reconnecting does not fix. |
| "Falta el permiso de lectura (gmail.readonly)" with mono scope | `.meta` + `.mono` | done | T:93-102 | "El permiso venció o fue revocado" and "Desconectado" for the other reconnect reasons are new copy. |
| "Lo corrige un administrador, no el BD" (config) | `.meta` | done | X `syncCell` | |
| Never connected: "Nunca" + "Sin cuenta de Gmail asociada" | `span.soft` + `.meta` | done | T:103-108 | |

## Último email cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Date + "hace 13 min · recibido / enviado" | `span.soft` + `.meta` | done | T:112-120, X `lastEmailCell` | `max(email_message.sent_at)` per BD with its direction, one lateral top-1 per BD. |
| "Sin emails sincronizados" | `.meta` | done | T:121 | |

## Recordatorio cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| "N de 3 enviado(s)" + "Último: 16 oct" + "Próximo: 21 oct (3 días hábiles)" | `.stack-sm` | done | T:128-137, X `reminderCell` | Series and dates from `reminderPlan` rules (`reminderDueOn`). |
| "Alta el 15 oct" + "Primero: 20 oct (2 días hábiles)" (nothing sent) | `.stack-sm` | deviation | X `reminderCell` | The mockup always says "Alta el". The date shown is the one the schedule runs from: the last visit ("Último ingreso: ...") when there is one, the sign-up otherwise. |
| "No aplica · administrador" | `.meta` | done | X `reminderCell` | |
| "No hace falta · Gmail sano" | `.meta` | done | X `reminderCell` | |
| "No hace falta · la autorización está bien" | `.meta` | done | X `reminderCell` | |
| "No corresponde: reconectar no ayuda" | `.meta` | done | X `reminderCell` | |
| "Próximo: en la próxima corrida", "Serie completa", "No aplica · recordatorios desactivados" | not drawn | deviation | X `reminderCell` | New copy for due, complete and disabled states. Owner to approve wording. |

## Rebotes and Envíos fallidos cells

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Total + "2 blandos · 1 duro" breakdown with dotted underline and tooltip | `.num` + `.tip-end` | done | T:141-166, X `bounceCell` | `activity` type `email_bounced`, last 30 days by `created_at`, severity from metadata. A single one reads "blando" / "duro". |
| "Sin datos" | `.meta` | done | X `bounceCell` | When nothing is recorded and the BD never connected or must reconnect. Recorded bounces always show. |
| Failed sends "2 fallidos" + "último error: gmail_send_failed" (mono) | `.num.strong` + `.mono` | done | T:170-184 | `scheduled_email.status = 'failed'`, latest code. |
| "0" and "Sin datos" | `.num` / `.meta` | done | X `failedCell` | "Sin datos" only for a BD that never connected. |

## Actions cell

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| "Enviar recordatorio" button (non-admin BD that must reconnect or never connected) | `button.btn.btn-sm` | done | T:186-201, `SendReminderButton.tsx`, `actions.ts`, `src/lib/gmail/manualReminder.ts` | Hidden for admins, BDs with reminders off, healthy and config rows, and a finished series. Pending state, toast on success and on each error. Reuses the cron runner; counts in the series; audited with the admin as actor in the same transaction that marks it sent. |
| Button style | `btn btn-sm` | deviation | `SendReminderButton.tsx` | Rendered `btn btn-secondary btn-sm`: the bare `btn btn-sm` has no border or fill and a consequential action needs an affordance. Owner decision. |
| Row menu "⋮" with "Ver cuenta de correo del BD" | `details.dropdown` | deviation | — | The mockup links it to `#`. No page shows another BD's mail account, so the menu would be empty. Omitted; owner to decide whether such a page is wanted. |

## Tooltips (shared component)

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Shared `Tooltip`: focusable trigger, `aria-describedby`, `role="tooltip"`, Esc closes, not clipped by `.table-wrap` | `.tip`, `.tip-bubble` | done | `src/components/Tooltip.tsx`, `src/lib/ui/tooltipPosition.ts`, `src/app/design-system.css` (`.tip*`) | Portaled to body, fixed position, follows the trigger on scroll. e2e: opens on keyboard focus, stays inside the viewport, extends past the table, Esc closes. |
| Tooltips on the six headers, the five connection chips, the bounce breakdown and the BD name | notes box item 4 | done | T:28-33,56,73,87,148-162 | Copy verbatim. The failing chip's tooltip is also used for the stale chip. |

## States

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Loading skeleton: header with tooltips over skeleton rows, `aria-busy`, label | section 5 table | done | `src/app/(app)/admin/gmail/loading.tsx` | |
| Empty card "Ningún BD necesita atención" + "Ver todos los BD" | `.card .empty` | done | P:110-123 | Shown for an empty attention filter. "No hay BD para mostrar" for other empty filters is new copy. |

## Data and scope decisions to confirm

- A non-admin BD with reminders switched off and no Gmail account (test accounts, people who left) is not listed and not counted (`fleetQueries.ts`). The mockup shows every BD.
- Bounces are counted by when the CRM recorded them (`activity.created_at`), not the bounce notification's own time.
- The audit row is written only when the send succeeds. If the mail goes out but the final transaction fails, the runner logs it and the row stays `pending` (the mail is sent, the audit row is missing). Same window the cron already accepts.

Counts: done 55, deviation 8, todo 0.
