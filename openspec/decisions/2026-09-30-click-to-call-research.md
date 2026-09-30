# Decision brief — click-to-call from the CRM

Prepared 2026-09-30. Research only — no application code, no extension code,
no production writes, no database connection. Backlog item: `click-to-call —
research first` (`openspec/BACKLOG.md:171-211`).

## Recommendation, up front

**Ship the `tel:` link path and stop there for now — but fix the one thing
that actually makes it useless today: it doesn't connect to the "Registrar
llamada" flow.** Do not buy a phone system yet. The valuable part of this
request was never "can a BD dial" (they already can, from their own phone) —
it's "can a call get logged without a BD remembering to do it by hand," and
none of the three options solve that on their own. A paid provider only
solves it if someone builds a webhook receiver that turns the provider's
"call ended" event into an `activity` row with `type = 'call'` — that is a
real integration project, not a subscription checkbox, and it is the same
size of work regardless of which vendor is chosen. Spend a day wiring the
`tel:` click to open the existing call-logging form instead; revisit a paid
dialer only after the team is actually logging the calls it makes today
(currently: zero, ever).

| | |
| --- | --- |
| What already works | `toTelHref` (`src/lib/phone.ts:45-51`) already turns any `phone`/`mobile_phone` value that passes `isValidPhoneFormat` into a `tel:` link. Confirmed in code; not confirmed whether the contact-record UI currently renders it as a clickable `<a>` or plain text (see "What I could not determine" below). |
| The real gap | Clicking a `tel:` link and logging the call via `CallForm` (`src/app/(app)/contacts/[id]/QuickActions.tsx:256-270`, `logCallAction` → `planCall`, `src/lib/contacts/call.ts`) are two unrelated actions today. Nothing opens one from the other. |
| First slice (~1 day) | Make the phone `tel:` link also open the existing `CallForm` quick action, pre-filled with today's date/time. Zero new infrastructure, zero new vendor, zero schema change. |
| Paid provider (if ever) | Between the two a 3-person team would actually compare — JustCall over Aircall, because Aircall enforces a 3-seat minimum (effectively ~$90/month floor for a 3-person team before add-ons) while JustCall allows per-seat purchase from 1 user. Twilio Voice raw API is not a fit here: it buys call-routing primitives, not a phone app, and would mean building the dialer UI ourselves — strictly more engineering than the webhook integration above, for the same automatic-logging payoff. |
| Blocking dependency | Any dialer-grade product needs E.164 (`+54 9 11 ...`). The ~998 imported numbers are stored as raw digits with no country code, and — per the import code's own reasoning — **a 10-digit Argentine number cannot be classified mobile vs. landline by digit count alone.** This has to be solved before any provider integration, not as part of it. |
| Argentine consent/recording | Ley 25.326 requires informed consent to *process* personal data, but Argentina has no specific call-recording statute analogous to a US two-party-consent wiretap law — recording a call you are a participant in is not itself prohibited. The open question is disclosure: telling the other party a call may be recorded before storing or transcribing it. This is not Argentina-specific case law I could verify; flagged as inferred, not guaranteed. |

---

## 1. What the data actually supports today

### Verified from code

- **Two phone columns on `person`**, both free text: `phone` (landline/office,
  "Teléfono") and `mobilePhone` ("Móvil") — `src/db/schema.ts:650-658`. Both
  are indexed only by a digits-only expression index
  (`person_phone_digits_idx`, `person_mobile_phone_digits_idx`,
  `src/db/schema.ts:723-734`), explicitly chosen **instead of** a stored
  normalized column "so an edit here can never drift out of sync with a
  duplicate digits column" (schema comment). There is no `phone_e164` column,
  no country column tied to phone, and no stored line-type (mobile/landline)
  flag anywhere in the schema.
- **Values are stored raw, by explicit owner decision, and are not E.164.**
  The Digital Finance Forum importer's own header comment is unambiguous:
  "Stored RAW (trimmed/control-stripped only) in `mobile_phone` — never
  reformatted, never prefixed with +54" (`scripts/import-dff-2026.ts:14-18`).
  `src/lib/dff2026/planImport.ts:132-146` (`resolvePhone`) confirms this in
  code: it validates with `isValidPhoneFormat` and writes
  `formatPhoneForDisplay(raw)` — a trim, nothing else — never a rewrite. The
  same file documents *why* no normalization was attempted at import time:
  "a mobile can't be told apart from a landline by digit count alone and the
  rewrite would not be reversible" (`planImport.ts:133-135`).
- **Validation is deliberately format-only, not shape-specific.**
  `isValidPhoneFormat` (`src/lib/phone.ts:26-33`) accepts digits, spaces,
  dashes, parens, an optional leading `+`, and requires only ≥6 digits total.
  It intentionally does not enforce a fixed digit count "so international
  formats are allowed" (file header comment) — which means it cannot reject
  or flag an Argentine number missing its country code; a bare 10-digit
  local number and a full `+54 9 11 ...` E.164 number both pass identically.
- **A `tel:` link, once a value passes validation, needs no country code to
  dial** — `toTelHref` just strips non-digits and prepends whatever `+` (if
  any) was already there (`src/lib/phone.ts:45-51`). This is why the `tel:`
  option works today on raw data: the phone app on the BD's own device (or a
  desktop softphone registered to an Argentine SIP trunk) resolves a bare
  local number using its own default calling context, the same way dialing
  a number out of a phone's native contacts app would. **A hosted dialer
  product cannot do the same** — it has no ambient "local calling context"
  and needs a fully qualified E.164 number to route the call at all.
- **~998 phone numbers came in with the DFF-2026 import** (PR #244,
  `openspec/BACKLOG.md:175-176`) — this count is the importer's own
  `phonesWritten` figure (`scripts/import-dff-2026.ts:92`,
  `src/lib/dff2026/planImport.ts:105,144`), i.e. rows that already passed
  `isValidPhoneFormat`. Rejected rows and their reasons
  (`invalid_chars`/`misplaced_plus`/`too_few_digits`) are logged per-row by
  the same script but not persisted anywhere queryable — they only ever
  printed to the console of whoever ran the import.
- **Manual call logging already exists and is richer than a bare log
  entry.** `CallForm` (wired in `QuickActions.tsx:256-270`) captures outcome,
  direction, date, time, duration in minutes, and notes, then
  `logCallAction` → `planCall` (`src/lib/contacts/call.ts`) writes an
  `activity` row with `type = 'call'`. This is the manual step that is
  failing in production today — zero `call` activity rows exist despite
  `call` being a first-class activity type since the app's start
  (`src/lib/activity/queries.ts:33`, `src/lib/status/deriveStatus.ts:120,253`,
  `OCCURRED_AT_ACTIVITY_TYPES` at `:226`).

### Inferred, not verified

- **Whether the contact record currently renders phone values as clickable
  `<a href="tel:...">` links or as plain text.** `toTelHref` exists and is
  used somewhere per the backlog's claim ("a click already dials"), but I did
  not find and read the exact JSX call site in this pass — I traced the
  helper and its three call-time citations (`propertyEdit.ts`, the record
  page's property list, and the backlog note itself) without opening the
  render file directly. Treat "it's already a link today" as **backlog-
  sourced, not personally re-verified against the current render**.
- **General Argentine numbering conventions** (mobile numbers historically
  carry a `15` trunk prefix when dialed domestically within the same area
  code, which is dropped and replaced with a `9` after the country code in
  E.164; landline area codes vary from 2 digits — Buenos Aires `11` — to 4
  digits for smaller towns). This is general telecom knowledge, not something
  I verified against Argentina's numbering plan authority (ENACOM) or against
  the actual raw values in this database.

### What I could not determine without a query

I have zero database access in this task (by design — no `.env.local`, no
`DATABASE_URL` in the shell, and the task explicitly forbids connecting).
Everything below needs a read-only query before the normalization work (or
any vendor conversation) can be sized correctly:

1. **How many contacts have a phone at all**, beyond the ~998 from one
   import — total `person` rows with non-null `phone` or `mobile_phone`,
   and how that splits between the DFF-2026 cohort and everyone else.
2. **The actual shape of the raw values** — digit-length distribution across
   the whole table (the importer logged this only for its own run, to a
   console, not to a table), and a sample of real values to see by eye
   whether they already carry a leading `0`, a `15` mobile marker, a `+54`,
   or nothing at all.
3. **How many already look like E.164** (start with `+54` or `54` and have
   the right total length) vs. how many are bare local numbers.
4. **A rough mobile/landline split**, to the extent it's inferable at all —
   e.g. numbers starting with area code `11` (Buenos Aires) followed by an
   `15` marker are almost certainly mobile by convention; anything with a
   3–4 digit area code and no `15` is more likely landline. This is a
   heuristic, not a reliable classifier, and should be validated against a
   real phone-number library (e.g. `libphonenumber-js`, which ships
   Argentina-specific metadata for exactly this `0`/`15` trunk-prefix
   rewrite) rather than hand-rolled regex.

### Exact read-only queries to run

```sql
-- Q1. Phone coverage overall and by source
select
  count(*) filter (where phone is not null or mobile_phone is not null) as any_phone,
  count(*) filter (where phone is not null) as has_phone,
  count(*) filter (where mobile_phone is not null) as has_mobile,
  count(*) as total_persons
from person
where merged_into_id is null;

select
  source_key,
  count(*) filter (where phone is not null or mobile_phone is not null) as any_phone,
  count(*) as total
from person
where merged_into_id is null
group by source_key
order by any_phone desc;

-- Q2. Digit-length histogram, phone and mobile_phone separately
select
  length(regexp_replace(mobile_phone, '\D', '', 'g')) as digit_length,
  count(*) as n
from person
where merged_into_id is null and mobile_phone is not null
group by digit_length
order by digit_length;

select
  length(regexp_replace(phone, '\D', '', 'g')) as digit_length,
  count(*) as n
from person
where merged_into_id is null and phone is not null
group by digit_length
order by digit_length;

-- Q3. Already-E.164-shaped vs. bare local numbers (mobile_phone)
select
  count(*) filter (where mobile_phone ~ '^\+?54') as looks_like_has_country_code,
  count(*) filter (where mobile_phone !~ '^\+?54') as bare_local,
  count(*) as total_with_mobile
from person
where merged_into_id is null and mobile_phone is not null;

-- Q4. A small redacted sample to eyeball the raw shapes by digit length
-- (run interactively; do not paste real numbers into a shared doc)
select
  length(regexp_replace(mobile_phone, '\D', '', 'g')) as digit_length,
  mobile_phone
from person
where merged_into_id is null and mobile_phone is not null
order by random()
limit 20;
```

Run each inside `BEGIN READ ONLY`, `SELECT` only, `TZ=UTC`, per this
project's standing convention for prod queries in a decision brief.

---

## 2. The realistic options

Three tiers, per the backlog's own framing (`openspec/BACKLOG.md:187-193`).
Only two are worth a 3-person team's actual attention; the third is included
to explain why it's ruled out.

### Option A — `tel:` link (today, free)

Hands the call off to whatever the BD already uses — their own mobile via
the OS's tel: handler, or a desktop softphone if one is registered. No
purchased number, no per-minute cost, no vendor. Covered in depth in
section 3.

### Option B — hosted click-to-call / phone-system provider

A SaaS phone app that gives the BD a work number, a browser or desktop
dialer, and (with integration work) call logging. **JustCall** and
**Aircall** are the two a 3-person team would realistically compare — both
are built for exactly this size of sales team, both include click-to-call
and call recording in their base tier, and neither requires building a
softphone UI.

| | JustCall | Aircall |
| --- | --- | --- |
| Entry price (checked 2026-09-29/30, prices change) | Team plan from **$29/user/month**, 2-seat minimum | Essentials from **$30/user/month** (annual), **3-seat minimum** |
| Realistic floor for 3 people | ~$29–87/mo depending on tier, no forced extra seat | Effectively ~$90/mo minimum even with a 2-person need, before add-ons |
| Fully-loaded cost (with AI features, extra numbers, etc.) | add-ons priced separately | reported $61–119/seat/month once add-ons are included ([justcall.io](https://justcall.io/blog/aircall-pricing.html), checked 2026-09-30) |
| Argentina number | Both sell/port local numbers in supported countries; needs confirming per-account whether Argentina is provisionable directly or only via a partner — **not verified in this pass**, guess only |
| Call quality to AR mobiles | Depends on the underlying carrier route each provider uses into Argentina — **not verified**; this is exactly the kind of thing to pilot with a handful of real test calls before committing to a paid plan |
| Gets you automatic call logging into **our** `activity` table | **No, not out of the box.** Both products log calls in *their own* system and expose a webhook/API on call completion. Someone still has to build a `/api/.../call-webhook` route that receives that event and writes an `activity` row with `type = 'call'`, mapping their call ID to our `person.id`. This is real, scoped engineering work — comparable in size to the "Registrar llamada" flow that already exists — not a config checkbox. |

**Recommendation if this tier is ever chosen: JustCall**, purely on the
seat-minimum math — Aircall's 3-seat floor means paying for a phantom seat
on a 3-person team (or paying per-seat rates that assume a bigger team),
while JustCall's 1-seat minimum matches the team size exactly. This is not
an endorsement of either on call quality or Argentina coverage, both of
which need a real trial call before any purchase.

### Option C — WebRTC in-browser softphone (Twilio Voice, Vonage)

Twilio Voice sells a local Argentine number for **$8/month** and charges
**$0.0604/min** to call out, **$0.0107/min** to receive (Twilio pricing
page for Argentina, checked 2026-09-30,
[twilio.com/en-us/voice/pricing/ar](https://www.twilio.com/en-us/voice/pricing/ar)).
That per-minute cost is genuinely cheap. The catch is everything *around*
the API: Twilio Voice is a routing primitive, not a phone app — there is no
dialer UI, no click-to-call button, no call log screen. Building all of
that (browser WebRTC client, in-app dialer component, call-state handling)
is a real engineering project on top of the per-minute cost, strictly more
work than Option B's webhook integration for the same end result (a call
happened, and we want it logged). **Ruled out for a 3-person team**: it
only makes sense once call volume or a need for deep custom call-flow logic
(IVR, routing rules, compliance recording pipeline) justifies owning the
full stack instead of renting Option B's app layer.

### The recording/consent question (Argentina)

Ley 25.326 (Protección de los Datos Personales) requires "free, express and
informed consent" before processing personal data, and sensitive-category
data requires written consent — but I found no Argentina-specific statute
that prohibits recording a phone call you are a party to, the way some
jurisdictions have an explicit two-party-consent wiretap law. The
GDPR-style guidance I could find on "announce the recording, get explicit
consent, explain the purpose" is European practice (Spain), useful as the
safer pattern to imitate but **not confirmed as an Argentine legal
requirement specifically** — this is inferred by analogy to Ley 25.326's
general informed-consent principle, not verified case law. Practical
takeaway either way: if a provider's call recording is ever turned on, say
so at the start of the call ("esta llamada puede ser grabada...") before
relying on it for anything beyond the BD's own notes — cheap insurance
regardless of which reading of the law turns out to be correct.

---

## 3. The `tel:` link — is it 80% of the value for 2% of the work?

**Mostly yes, with one real gap.** The dialing half is already built and
costs nothing further. The honest accounting:

**What it already gets you:**
- Zero infrastructure, zero vendor, zero per-minute cost, zero purchased
  number.
- Works on any raw phone value that passes `isValidPhoneFormat` — no E.164
  normalization required, because the OS/softphone resolves the local
  number using its own calling context (see section 1).
- The BD keeps using whatever they already use — personal mobile, desktop
  softphone, whatever's registered as the system's default tel: handler.
  No new habit to learn for the dialing step itself.

**What it does NOT get you, and where the "logs nothing automatically"
line in the backlog is exactly right:**
- Clicking a `tel:` link does not create an `activity` row. The BD still
  has to separately open "Registrar llamada" (`CallForm`) and fill in
  outcome/direction/duration/notes by hand — and that manual step is
  precisely the one the team has never once completed in production (zero
  `call` activity rows, ever, per `openspec/BACKLOG.md`).
- Today those are **two disconnected actions** on the same page — nothing
  currently opens the log form when the phone link is clicked, or vice
  versa. A BD has to remember to do both, and the evidence says they don't.

So the honest framing: the `tel:` link is not "80% of the value" by itself
— it's 80% of the *dialing* problem, which per the backlog's own framing
was never the actual bottleneck ("The valuable part is probably NOT the
dialing — it is automatic call logging"). The cheap, high-leverage move is
connecting the two existing pieces, not buying a third one.

---

## 4. Why the E.164 dependency actually blocks a dialer (not just a formality)

A hosted dialer (Option B or C) has to answer, programmatically, "what
number do I actually call?" It has no ambient context the way a phone's own
dialer app does — it needs a single canonical, fully-qualified number:
country code, then either a mobile marker or an area code, then the
subscriber number, with no ambiguity. A raw 10-digit string is ambiguous in
at least three independent ways for Argentina specifically:

1. **Mobile vs. landline is not decidable from digit count alone** — this is
   the exact reasoning the import code already used to justify *not*
   normalizing at import time (`planImport.ts:133-135`). A 10-digit string
   could be a Buenos Aires landline (2-digit area code `11` + 8-digit
   subscriber number) or a Buenos Aires mobile with its domestic `15` marker
   already stripped, or a smaller city's landline with a 3–4 digit area
   code and a correspondingly shorter subscriber number — the total digit
   count overlaps across all of these.
2. **The domestic `15` mobile prefix is a dialing convention, not part of
   the subscriber's real number.** When calling a mobile from within
   Argentina, the caller dials `0<area code>15<number>`; in E.164 that same
   number is `+54 9 <area code><number>` — the `15` disappears and a `9` is
   inserted right after the country code instead. Whether a given raw value
   in this database still has that `15` embedded, has already had it
   stripped, or never had one because it's a landline, cannot be told from
   the digits alone — it requires either knowing the source convention the
   CSV exporter used, or a phone-number library with Argentina-specific
   parsing rules (e.g. `libphonenumber-js`, which encodes exactly this
   `0`/`15` trunk-prefix rewrite in its Argentina metadata).
3. **Area codes are variable-length** (2 digits for Buenos Aires, 3–4 for
   other cities/provinces), so splitting "area code" from "subscriber
   number" inside a bare digit string needs a lookup table, not a fixed
   slice.

None of this is solved by a regex. Normalizing the ~998 imported numbers (or
whatever the real total turns out to be, per the queries above) realistically
means: pull the raw values, run them through a real Argentina-aware phone
library, keep the library's confidence/line-type output alongside the
existing raw value (never overwrite it, matching the import script's own
"not reversible" concern), and manually review whatever the library can't
classify — a data-cleanup task, not a migration script that can be trusted
to run unattended.

---

## 5. Recommendation and a one-day first slice

**Recommendation: build the tel:-to-logging bridge now; do not buy a
phone-system subscription yet.**

### First slice (sized to ship in a day)

- When a BD clicks a phone value on the contact record, open the existing
  `CallForm` quick action (`QuickActions.tsx:256-270`) in the same motion —
  pre-filled with today's date and time, direction defaulted to "saliente"
  — instead of two unrelated clicks.
- If the phone-record render currently isn't a clickable `tel:` link at all
  (unverified per section 1), make it one using the existing `toTelHref`
  helper — no new validation logic needed, it's already there.
- No new column, no new activity type, no new vendor, no new environment
  variable.

### Explicitly NOT in this slice

- No normalization of the ~998 (or however many, pending the queries above)
  raw numbers to E.164.
- No automatic call detection, duration capture, or outcome inference —
  the BD still fills in `CallForm` by hand, same as today; this slice only
  removes the friction of getting to that form.
- No purchased Argentine phone number, no vendor account, no recording, no
  consent flow.
- No change to `isValidPhoneFormat` or the phone schema.

### Why this is the right size

It targets the actual measured failure (zero logged calls, not "can't
dial") with the cheapest possible change, and it produces real signal
before any money is spent: once logging friction is removed, does call
volume and habit actually pick up? That answer should drive whether Option
B is ever worth its subscription and integration cost — buying a dialer
before the team reliably logs the calls it already makes today would mean
paying to accelerate a step nobody is completing.

---

## 6. When this would be a bad idea — and when it wouldn't be

**Bad idea right now, plainly:** building or buying anything beyond the
one-day slice above. The team has made one real recorded touch in this
CRM's entire history (a self-test email) and zero logged calls, while
already having a fully-built manual logging form. Spending money on a
dialer before that habit exists risks paying for infrastructure that
automates a behavior the team hasn't adopted manually yet — the same
"dumped on day one" failure mode the follow-up-cadence brief found for a
different feature (`2026-09-30-decision-brief.md`).

**Worth revisiting a paid option once all of these are true:**
- The tel:-to-logging bridge has shipped and BDs are actually using it —
  i.e., `call` activity rows exist in meaningful numbers.
- Call volume is high enough, or the team has grown past 3 BDs, that manual
  logging is itself the bottleneck (not adoption, but throughput).
- The E.164 normalization work (section 4) is done, so a provider integration
  has real numbers to dial instead of guessing.
- Someone is committed to the webhook-integration engineering work
  (Option B) — otherwise a subscription buys a nicer dialer but the exact
  same zero automatic logging the team has today.
- Argentina call quality and number provisioning have been piloted with
  real test calls, not just read off a pricing page.

Guess, explicitly flagged as a guess: given the team's current size (3 BDs)
and the state of adoption, that point is probably 6+ months out, contingent
entirely on whether the free slice above actually gets used.

---

## Sources

- [JustCall pricing breakdown](https://www.cloudtalk.io/blog/justcall-pricing/) — checked 2026-09-30
- [Aircall pricing 2026, seat minimums and add-on cost](https://justcall.io/blog/aircall-pricing.html) — checked 2026-09-30
- [Twilio Voice pricing, Argentina](https://www.twilio.com/en-us/voice/pricing/ar) — checked 2026-09-30
- [Ley 25.326, Protección de los Datos Personales (Infoleg)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/64790/texact.htm) — checked 2026-09-30
- [Ley 25.326 explainer, informed-consent requirement](https://xmslatam.com/ar/ley-25326-proteccion-datos-personales/) — checked 2026-09-30
- GDPR/Spain call-recording consent practice (used by analogy, not as Argentine law): [voipstudio.com RGPD grabación de llamadas](https://voipstudio.com/es/blog/como-cumplir-el-rgpd-en-grabacion-llamadas/) — checked 2026-09-30
