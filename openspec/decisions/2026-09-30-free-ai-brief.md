# Decision brief — free/cheap AI models for simple tasks

Prepared 2026-09-30. Research only — no application code, no production writes, no DB access. Answers the `free-ai-for-simple-tasks` backlog item (`openspec/BACKLOG.md:194-213`). Nothing here is decided; see "Owner decisions" below.

## Summary

| # | Task | Uses a model today? | Recommendation |
| --- | --- | --- | --- |
| 1 | Startup classifier (`startupClassification.ts`) | Yes — `anthropic/claude-haiku-4.5` | **Keep it.** No researched free tier both (a) reachable with a one-line model-string change and (b) confirmed not to train on inputs. |
| 2 | Outreach message generation (`generateMessage.ts`) | Yes — `anthropic/claude-sonnet-5` | **Keep it.** Not a simple task — open-ended, customer-facing copy; a wrong answer is a bad message sent to a real prospect. |
| 3 | Role/seniority grouping (`roleGroups.ts`) | **No** — deterministic regex | **No model needed.** Already free, already private. |
| 4 | Company-name normalization (`companyCategories.ts`, `companyDomain.ts`) | **No** — deterministic string ops | **No model needed.** |
| 5 | Email-pattern inference (`emailPatterns.ts`, `emailSuggestion.ts`) | **No** — deterministic majority-vote over existing emails | **No model needed.** |

The honest finding: this codebase has exactly **two** AI Gateway call sites, not five. The other three "candidates" the owner listed are already rule-based with zero model cost and zero data leaving the process — introducing a model there would be a regression, not a saving.

## Current state (cited)

- `src/lib/outreach/generateMessage.ts:30` — `const OUTREACH_MODEL = "anthropic/claude-sonnet-5"`. Comment at lines 26-29: picked from the live AI Gateway catalog as "highest released Sonnet version available," to be re-checked before bumping. Called from `runGenerateOutreachMessage` (`generateMessage.ts:60-115`) for both the LinkedIn DM and the cold-email JSON `{subject, body}` output. This is free-text generation representing Avalith to a real prospect — quality-sensitive and not "simple" by the owner's own framing.
- `src/lib/hiring/startupClassification.ts:12` — `const STARTUP_CLASSIFICATION_MODEL = "anthropic/claude-haiku-4.5"`. Comment at lines 6-11: chosen because this is "a small binary classification task run in batches on every hiring-sync cron tick, not a user-facing generation," re-checked against the same catalog. Input: company display name + ATS name + up to 8 sample job titles/locations (`MAX_SAMPLE_POSTINGS = 8`, line 23). Output: `{isStartup: boolean, reason: string}` via `generateObject` + a plain JSON Schema (lines 35-50), capped at 200 output tokens (line 109). Batches of up to 20 companies per cron tick (`STARTUP_CLASSIFICATION_BATCH_SIZE = 20`, line 18). A wrong answer just leaves a company mis-tagged for BD targeting — genuinely low-stakes, and the prompt already biases toward `false` on ambiguity (lines 62-65) for exactly that reason.
- No other call site in `src/` imports `generateText`, `generateObject`, `streamText`, or `streamObject` (`rg -n "generateText|generateObject|streamText|streamObject" src` returns only the two files above).
- `src/lib/roleGroups.ts:1-256` — `classifyPosition()` is priority-ordered regex over the free-text LinkedIn position, ported 1:1 from a validated Python prototype (header comment, lines 1-14). No model, no network call, ever.
- `src/lib/companyCategories.ts:89` (`normalizeCompanyKey`) and `src/lib/companyDomain.ts:157-177` — Unicode NFKD strip + ASCII lowercasing + regex tokenization. No model.
- `src/lib/emailPatterns.ts:1-6` and `src/lib/emailSuggestion.ts` — corporate email convention detected purely by majority vote over a company's own known `(first, last, email)` triples (header comment, `emailPatterns.ts:1-6`). No model.
- `package.json:21,29` — `"@ai-sdk/gateway": "^4.0.87"`, `"ai": "^7.0.107"`. Confirmed live against `https://ai-gateway.vercel.sh/v1/models` (395 models, fetched 2026-09-30, no auth required): `anthropic/claude-haiku-4.5` and `anthropic/claude-sonnet-5` are both present and current.

## Options researched

For each: free-tier existence, rate limits, **data retention/training** (decisive — this data is company names, job titles, locations; no researched free tier that trains gets a pass regardless of how sensitive the specific field looks), gateway reachability, and task fit. Dates below are "as researched 2026-09-30"; the underlying pages are dated where shown.

### Google Gemini (free tier) — disqualified
- **Training**: confirmed via `ai.google.dev/gemini-api/terms` (fetched 2026-09-30), "Unpaid Services" section: *"Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services."* The paid-tier section states the opposite: *"Google doesn't use your prompts...or responses to improve our products."* **This is a hard disqualifier for the free tier** under the brief's own rule.
- Rate limits (secondary sources, not independently verified against Google's own quota console): roughly 10 RPM / 250k TPM / up to ~1,500 RPD for Gemini 2.5 Flash; Gemini 2.5 Pro is much tighter (5 RPM, 25 RPD).
- Gateway: **already reachable**, no code change beyond the model string — `google/gemini-2.5-flash-lite` and siblings are live in the gateway catalog today.
- Paid Gemini (pay-as-you-go, same models, through the gateway) does not train and is very cheap — see recommendation.

### Groq — not reachable without new integration
- **Training**: per Groq's own docs (`console.groq.com/docs/your-data`, fetched 2026-09-30): *"By default, Groq does not retain customer data for inference requests."* System/abuse-monitoring logs, when they exist, are kept ≤30 days; Zero Data Retention (ZDR) is available to remove that too. Search results also point to Groq's Services Agreement stating Groq is not permitted to train on customer inputs/outputs. This is the cleanest privacy posture of everything researched.
- Rate limits (secondary sources): free tier commonly cited as ~14,400 requests/day, 30 RPM, with per-model token caps (varies 3k-15k TPM depending on model).
- **Gateway: not present.** `rg` against the live `/v1/models` catalog (395 models) found zero `groq/*` entries. Using Groq means adding a new provider/SDK, not a model-string change — this fails the "no new SDK" framing in the backlog item, even though its privacy terms are the best of the group.

### Cerebras — not reachable, and no longer a standing free tier
- Multiple secondary sources (July 2026 onward) report Cerebras replaced its previous always-free tier with a **30-day, $5 one-time trial credit that requires a verified payment method**; unsuitable for an indefinite recurring cron job regardless of anything else.
- **Gateway: not present** either (same catalog check, zero `cerebras/*` entries).
- Not investigated further — fails both the "free" and "gateway-reachable" tests before training policy even matters.

### Mistral — free API tier disqualified, but paid Mistral via the gateway is a real cheap option
- **Training**: per secondary sources summarizing Mistral's legal center (I could not load the exact clause directly — `legal.mistral.ai/terms` is an index page, not the policy text, and `legal.mistral.ai/privacy-policy` 404'd for this fetch; flagged as **not independently verified against primary text**, only via secondary summaries that agree): the API's free "Experiment" tier trains on inputs by default, with a manual opt-out required in the Mistral admin console; the standard **paid** API tier does not train by default.
- **Gateway: already reachable** — `mistral/ministral-3b`, `mistral/ministral-8b`, `mistral/mistral-small`, etc. are live in the catalog today. Calls made through the AI Gateway are billed, pass-through-priced API calls, not the free Experiment tier — so, per the (unverified-primary but consistent) sources above, they should fall under the paid no-training default. **This is an assumption (?)**: confirm directly with Mistral's admin console/ToS text before relying on it for real data, since the primary-source fetch failed.
- Cost: `ministral-3b`/`ministral-8b` are priced as small/cheap models — not free, but cheaper than Haiku for a task this small (exact $/token not restated here; check the live `/v1/models` pricing field before committing to a number).

### OpenRouter free models (`:free` suffix) — disqualified as a class, not reachable via the gateway either
- **Training**: OpenRouter's own privacy docs (fetched 2026-09-30) confirm free and paid models have **separate** training-opt-out toggles, and that "each provider on OpenRouter has its own data handling policies" — i.e. whether a given `:free` model trains depends on which upstream provider is serving it that day, and OpenRouter's routing can change. There is no single blanket guarantee for the `:free` class; it would need to be re-verified per model, per session.
- Rate limits (secondary sources): ~20 RPM, 50 requests/day (or 1,000/day after a one-time $10 credit purchase, which stops it being "free").
- **Gateway: not present** in the live catalog (zero `openrouter/*` entries) — would need a new provider/SDK.
- Given the per-provider variability on the exact axis this brief treats as decisive, **do not use any OpenRouter `:free` model for real contact/company data without re-checking that specific model's provider policy at call time.**

### Vercel AI Gateway's own free allowance and in-gateway "free" models
- Every Vercel team gets **$5/month of AI Gateway credit**, refreshing every 30 days, but this stops permanently after the team's first paid credit purchase (per Vercel's own docs, secondary-summarized; not independently re-verified against a primary billing page in this session).
- Vercel's own layer does **not** retain or train on gateway traffic on any tier (`vercel.com/docs/ai-gateway/security-and-compliance/zdr` and `.../disallow-prompt-training`, summarized from search, not fetched directly this session) — but this only covers Vercel's own hop; **the upstream model provider's policy still applies**, and Gateway gives per-request ZDR/no-training routing controls precisely because the guarantee doesn't automatically extend upstream.
- The gateway currently lists a handful of genuinely **$0-priced** models directly (confirmed live in the catalog fetched 2026-09-30): `inclusionai/ling-3.0-flash-sante-free`, `inclusionai/ling-3.1-flash-free`, `liquid/d1`, `poolside/laguna-s-2.1-free`, `stealth/pixel-canary`.
  - `stealth/pixel-canary` is **explicitly disqualified**: Vercel's own announcement states prompts/responses "may be used for model improvement" and that Zero Data Retention is *not* available for it.
  - The other four's data policies were **not found** in this research pass — treat as **unverified, not as safe**. Do not route real contact/company data to them without getting an explicit data-use answer first.

## Recommendation, per task

1. **Startup classifier — keep `anthropic/claude-haiku-4.5`.** It already sits on the AI Gateway's paid tier (confirmed: Anthropic's Commercial Terms of Service — which cover the API — state Anthropic does not train on commercial/API inputs by default, verified via `support.anthropic.com/en/articles/7996868`), it's already cheap (Haiku-class, 200 output tokens, batches of 20), and no researched alternative clears both bars this brief requires — reachable with a one-line model-string change *and* confirmed not to train. If the owner wants to cut cost further rather than go to $0, the one credible, low-risk next step is swapping to `mistral/ministral-3b` or `mistral/ministral-8b` through the *same gateway, paid tier* — but only after independently confirming Mistral's primary ToS text (this session's fetch of it failed), since the "doesn't train on paid tier" claim here rests on secondary sources, not the primary document.
2. **Outreach message generation — keep `anthropic/claude-sonnet-5`.** This is not a simple/low-stakes task by the owner's own definition (free-form copy sent to a real prospect); nothing in this research changes that, and nothing was researched as a replacement for it.
3. **Role grouping, company-name normalization, email-pattern inference — no model, now or later.** These already run for free, in-process, with no data leaving the machine. The right move here is doing nothing.
4. **Do not adopt any free tier researched here for real contact/company data as a blanket policy.** Gemini free tier and OpenRouter's `:free` class are class-disqualified (train by default / provider-dependent training with no blanket guarantee). Pixel Canary is explicitly disqualified. Groq is the best privacy story of everything researched but is not on the gateway today — if the owner ever wants an actually-free, actually-private option, evaluating a Groq integration on its own merits (new SDK, separate decision) is the next research item, not a drop-in swap.

## Owner decisions

| # | Decision | Status |
| --- | --- | --- |
| 1 | Keep the startup classifier on `anthropic/claude-haiku-4.5`, or move it to `mistral/ministral-3b`/`8b` via the gateway (pending primary-source ToS confirmation)? | **Open** |
| 2 | Confirm: no change to the outreach message model. | **Open** |
| 3 | Is a future Groq integration (new SDK, not a model-string change) worth a dedicated research/design pass, given it's the only researched option with an unambiguous no-training, no-retention-by-default policy? | **Open** |
| 4 | Confirm: the three rule-based "candidates" (role grouping, company-name normalization, email-pattern inference) are closed — no model, no further work. | **Open** |

## Risks

- **Secondary-source dependency.** Several claims above (Mistral's exact ToS clause, Vercel's exact ZDR/training-disallowance wording, most rate-limit numbers) come from aggregator sites that summarize primary terms, not the primary documents themselves — two direct fetches (`legal.mistral.ai/terms`, `legal.mistral.ai/privacy-policy`) failed or returned only an index page in this session. Anything marked "(?)" or "not independently verified" above should be re-confirmed against the provider's own legal text before any model change ships, not just at decision time.
- **Provider/model catalogs change.** The AI Gateway catalog (395 models, fetched 2026-09-30) and each provider's free-tier terms can change without notice — both existing model constants already carry a "re-check the live catalog before bumping" comment; any new model choice should carry the same discipline.
- **"Simple" is doing a lot of work.** The owner's request assumed more AI call sites existed than actually do. If new AI features get added later assuming a permissive "it's simple, just use free tier" default, this brief's disqualifications (training-by-default free tiers) need to be re-applied to each new call site individually — they don't only apply to the two sites audited here.
