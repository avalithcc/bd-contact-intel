# outreach-sequences — mockup

Design-only proposal. No application code changed. Static HTML at
`secuencia-detalle.html`, built on the approved `crm-hubspot-ux` mockups
(`../../crm-hubspot-ux/mockups/styles.css`, same app shell, same dialog,
same badges). Every CSS class used is one that already exists in
`styles.css` — nothing new was invented.

Open `secuencia-detalle.html` in a browser. The top section is the live
screen (a sequence mid-flight: 3 drafts to review, 2 approved, 4 sent, 1
replied). Below it, states that can't be reached by clicking a static
mockup are shown as a reference gallery: the review dialog, both bulk-bar
variants, the no-drafts-yet state, and the finished sequence.

**Desktop only, by owner direction.** Same rationale as
`follow-up-queue`: this is a 1280px+ screen a BD works from. The shared
`.row.wrap` utility keeps the action rows from clipping on narrow widths,
but that's a safety net, not a designed state.

The contacts shown are **real rows from production**, measured
2026-10-14 — the 10 reachable US contacts at companies with open IT
postings. Not placeholder data.

## Decision 1 — it is a "Secuencia", not a "Campaña"

The owner asked whether this is a Campaign. It is not, and the name
decides the data model.

Per the HubSpot-as-reference rule this project follows:

- A **Campaign** is a marketing-attribution container. It groups assets
  (mass email sends, landing pages, ads, social posts) and measures
  influenced contacts and revenue. It answers *what did this marketing
  initiative produce?*
- A **Sequence** is a series of 1:1 emails sent from the rep's **own
  inbox**, with per-contact state. It answers *where is each of these
  people in my outreach cadence?*

This feature is ten hand-picked contacts, a separately drafted message
each, sent one at a time from the BD's Gmail and logged as an activity on
each contact's record. That is a Sequence. Naming it Campaign would
attach revenue-attribution and marketing-asset semantics that nothing
here has, and invite columns that don't belong.

## Decision 2 — neither existing primitive can hold this

Both were evaluated and rejected on structure, not taste:

- **`saved_view`** stores `filters: jsonb` — a *query*, not membership.
  It cannot pin ten hand-picked people: if the underlying data shifts,
  the view returns different contacts. A sequence's roster must be
  frozen at creation.
- **`follow_up_queue_item`** is a per-day queue auto-derived from
  `last_touch_at` + `due_status`, capped at 10/day. The BD does not
  choose its members and it has no name. It answers a different
  question, and the mockup links out to it rather than duplicating it.

So this needs new tables. Proposed shape, for the design phase to
confirm:

```
sequence        (id, name, owner_bd_id, schedule, created_at)
sequence_member (sequence_id, person_id, state, draft_subject, draft_body,
                 approved_at, sent_at, next_follow_up_at, replied_at)
                 state: drafted | approved | sent | replied | no_reply | discarded
```

## Decision 3 — auto-draft, human-approve, auto-send (owner chose this)

The owner's first ask was "quiero que se envíe solo". The approved
behaviour is narrower, and deliberately:

- The system **drafts** every message automatically, per contact, using
  that company's own signals.
- The system **schedules** the send and the follow-up automatically.
- A human **approves** before anything leaves. One click per contact, or
  in bulk.

Two reasons this gate exists:

1. `buildOutreachEmailPrompt` carries ten defensive rules — *"Never
   invent facts about the recipient"*, *"Use ONLY the facts under Avalith
   company facts"*, plus prompt-injection hardening on the signals block.
   Those rules exist because model output can drift. An unreviewed bad
   message to a VP of Engineering is not a bounce, it is a burned
   account.
2. Every contact on this list is in the US. Automated commercial email
   to US recipients needs a working opt-out and a physical postal
   address (see **Open question 1**), and automated cold volume on the
   BD's primary Gmail degrades deliverability for their real
   correspondence.

Bulk approve is gated too: the `.bulk-bar` shows `N de M borradores
revisados`, and the approve button stays `.locked` until every selected
draft has been opened at least once. Approving blind in bulk is exactly
what the gate is for, so the UI refuses it.

## Decision 4 — the cadence

Two steps, no more:

| Step | When |
|---|---|
| 1 · Intro email | the day after approval, 09:00 Miami time |
| 2 · Reminder | 7 days later, **only if no reply** |
| Stop | any reply stops the sequence for that contact and hands them to Seguimientos |

The reminder is a separate approval, not an automatic follow-up — same
gate, same reason.

## Decision 5 — two guardrails baked into the roster

- **Max 2 contacts per company.** Three emails into Twilio in one week
  reads as spray, not prospecting. The mockup shows Snowflake, Twilio,
  Upshop and Bold at two each.
- **Active clients are excluded automatically.** This surfaced a real
  bug while measuring: **CookUnity** (3 contacts in the pool) and
  **Mercado Libre** are listed as public clients in `AVALITH_PROFILE`
  but are not marked in `company.client_status`, so today's prospecting
  filter does not exclude them. That fix is **out of scope here** and
  belongs in its own change — but this sequence's roster must honour it.

## Decision 6 — an edited draft is never regenerated

If the BD edits a subject or body, that version is stored and the
generator will not overwrite it. "Regenerar" is always explicit.

## Open questions — need an owner answer before the spec

1. **CAN-SPAM compliance is not designed yet.** Automated commercial
   email to US recipients needs an opt-out mechanism honoured within 10
   days and a physical postal address in the message. Neither is in this
   mockup. Options: a plain-text opt-out line plus the Miami office
   address in the signature (cheapest), or a tracked unsubscribe link
   (needs a route, a token and a suppression list — `email_never_log`
   already exists and may be the right home).
2. ~~**Sending identity.**~~ **RESOLVED, owner decision 2026-10-14:**
   start from `cristian@avalith.net` at low volume and migrate to a
   dedicated sending subdomain later.

   The owner's target volume is **10-15 emails per day**, which is
   ~250-350 cold emails a month. That is enough to damage
   `avalith.net`'s domain reputation, and reputation is per-domain — a
   second mailbox on the same domain does not isolate it. So "low
   volume first, migrate later" carries two requirements that the spec
   must treat as in scope, or the decision is aspirational:

   - **A hard per-day send cap, enforced in the scheduler** — not a UI
     hint. Proposed: 5/day to start, and the sequence runner refuses to
     release more than the cap regardless of how many members are
     approved. Without a cap in code, "low volume" drifts to 15/day by
     accident, which is the thing this decision was meant to defer.
   - **The sending account must be a reference, never a hardcoded
     address.** `email_account` already models connected accounts, so
     `sequence` should point at one. This is the one design choice that
     makes the later migration a config change instead of a rewrite.

   Migration trigger, to record now: sustained demand above ~8/day, or
   any of a rising bounce rate, a spam complaint, or reply rates
   falling off a cliff.
3. **Reply detection.** The mockup shows "respondió hace 6 h" stopping
   the sequence. The Gmail sync already classifies inbound mail against
   CRM contacts — is reusing that enough, or does a sequence reply need
   its own stricter thread match?
