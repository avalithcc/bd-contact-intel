# BD Contact Intelligence — Concept (v0)

> Status: framing / not yet scoped for build. Owner: Cristian (COO).
> Started 2026-09-15. Separate initiative from the YPF strategy.

## Problem
Avalith's sales area needs to turn the collective LinkedIn network of its Business Developers into a usable prospecting asset — today that network is scattered across individual accounts and invisible as a whole.

## Idea
An internal system where each BD loads their LinkedIn connections export, and the system lets the team:
- **Filter** contacts (by company, industry, position, seniority, geography).
- **Segment** by target industry.
- **Generate industry-oriented outreach messages** tailored per segment.
- (Future) additional ideas as they emerge.

## What it is, technically
A contact-intelligence pipeline: **ingest CSV → normalize + dedup → segment/enrich → filter/query → message templating by segment.**

## Hard constraints (design must assume these)
1. **Data refresh is periodic, not live.** LinkedIn throttles connection exports (hours between requests). The system is fed by periodic CSV uploads; it is a snapshot store, not a live feed.
2. **Privacy / ToS is a real design input.** Aggregating many BDs' personal contacts into a central company system carries LinkedIn ToS and personal-data-protection implications. This is a COO-level decision to make deliberately, not discover later.
3. **Input schema is fixed by LinkedIn.** `Connections.csv` columns: First Name, Last Name, URL, Email Address (often blank), Company, Position, Connected On. Design around exactly these fields.

## Architecture decision (RESOLVED 2026-09-15)
**Per-BD private bases + a lightweight shared overlap signal.**
- Each BD owns their own contact base. Bases are NOT merged or shared.
- The system flags when a contact already exists in another team member's base — as an **awareness notice that NAMES the teammate who holds it** ("also in María's base"), so BDs can coordinate outreach. It never exposes the other base's contact data beyond that ownership signal.
- Implication: a **minimal shared index** is required — only a contact identifier (LinkedIn profile URL) mapped to which BD holds it. Everything else (name, company, notes) stays private to each BD's base. The only thing cross-referenced is the overlap signal.

## Core capability — AI research-driven messaging (RESOLVED direction 2026-09-15)
Messages are **written by AI, grounded in real research** about the contact or their company: a pain point, a hiring signal, public news — then mapped to a concrete Avalith capability that addresses that real need. This is **signal-based outbound**, and it is the heart of the product's value (not templates).

### Source reality (hard constraint — do not design around walled sources)
- **Automatable (public web):** company website, **careers/jobs page** (hiring = a real need signal), news/press, company blog, publicly indexed posts. Reached via web search + fetch.
- **NOT automatable / off-limits:** scraping the LinkedIn feed or LinkedIn job search — auth-walled, anti-bot, against ToS, legal exposure. The system must NOT depend on scraping LinkedIn.
- **Bridge = human-in-the-loop:** the BD pastes a signal they saw (e.g. a LinkedIn post) into the system; the AI combines it with its own public-web research to draft the message.

### Operating principle
Quality over volume. This is for the ~20 accounts that matter, researched surgically — not mass personalization. Research costs time + LLM spend per contact, so it runs **on-demand per target**, never batch-all.

## Revised phasing
- **v1 (shippable base):** per-BD login, CSV upload to private base, filters (company/industry/position/seniority), named overlap signal.
- **v2 (the differentiator):** on-demand AI research + message drafting per selected contact — public-web research + BD-pasted signals → cited pain point → Avalith-fit message. Human reviews before sending.
- **v3 (optional, risk-accepted):** LinkedIn data via third-party scrapers (e.g. Apify) as an ADDITIONAL signal source.

### Apify / LinkedIn scraping — design rule (decided 2026-09-15)
- Apify solves the *technical* barrier, NOT the risk: still against LinkedIn ToS, still legal gray area (public-data scraping has contested case law), and scraping accounts get banned. This is a COO-level risk decision, taken deliberately.
- **Architectural guardrail:** scraping enters ONLY as an isolated, optional module behind the same "signal" interface as web research and manual paste. The core product must keep working if this source is disabled, breaks, or gets blocked. The core NEVER depends on it.

## Not decided yet
- Stack, deployment, who maintains it.
- LLM provider/integration for v2 (default assumption: Claude).

## Next step
Confirm the phasing and the human-in-the-loop research model, then choose stack for v1.
