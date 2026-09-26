import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
  primaryKey,
  boolean,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

// A Business Developer. In v1 this stands in for the authenticated user;
// it will later map 1:1 to a Supabase auth user id.
export const bd = pgTable("bd", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // 'bd' | 'admin' (design D5, R5). The owner is seeded as the first admin
  // by drizzle/0013_unified_person.sql. Gated via
  // src/lib/auth/requireAdmin.ts, never checked ad hoc.
  role: text("role").notNull().default("bd"),
});

// A contact, private to exactly one BD.
// `profileKey` is the normalized LinkedIn profile URL and is the identity
// used both for per-BD dedup and for cross-BD overlap detection.
export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdId: uuid("bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    profileKey: text("profile_key").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    company: text("company"),
    position: text("position"),
    // Deterministic grouping of `position` into a coarse role bucket (see
    // src/lib/roleGroups.ts), computed at import/backfill time so filtering
    // doesn't require re-classifying on every query.
    roleGroup: text("role_group"),
    // Deterministic mapping of `company` into an industry category, looked
    // up from the `company_category` table at import/backfill time (see
    // src/lib/companyCategories.ts and scripts/backfill-company-categories.ts).
    companyCategory: text("company_category"),
    // Normalized key for `company` (see
    // src/lib/companyCategories.ts#normalizeCompanyKey), computed at
    // import/backfill time (see scripts/backfill-company-keys.ts). Used to
    // match a contact's employer against `target_company.company_key` (or
    // `company_alias.alias_key`) for the hiring-signals crossover — see
    // src/lib/hiring/queries.ts.
    companyKey: text("company_key"),
    email: text("email"),
    industry: text("industry"), // derived later (v2 enrichment)
    connectedOn: text("connected_on"),
    // Denormalized LinkedIn-message signals, recomputed in bulk (one pass,
    // not per row) after every messages.csv import — see
    // src/lib/queries.ts#recomputeMessageSignals and
    // src/lib/messagesCsv.ts. Only populated for 1:1 conversations (a
    // contact matched via `conversation.peer_profile_key`); group threads
    // don't attribute to a single contact.
    messageCount: integer("message_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    receivedCount: integer("received_count").notNull().default(0),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),
    // Email lookup results — persisted from live Hunter.io queries or contact
    // creation/enrichment. Follows lead.email_status naming: 'verified' | 'probable' | 'none'.
    emailStatus: text("email_status").notNull().default("none"),
    // Confidence score from the richest email source (0-100); null when not available.
    emailConfidence: integer("email_confidence"),
    // Which source produced the current email (e.g. "linkedin_export", "hunter_finder").
    emailSource: text("email_source"),
    // Whether the BD sent the first message in the earliest conversation
    // with this contact. Null until at least one message has been imported.
    initiatedByMe: boolean("initiated_by_me"),
    // True once both sides have sent at least one (non-draft) message.
    reciprocal: boolean("reciprocal").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // one row per (owner, profile) — re-uploads upsert instead of duplicating
    bdProfileUnique: unique("contact_bd_profile_unique").on(
      t.bdId,
      t.profileKey,
    ),
    byBd: index("contact_bd_idx").on(t.bdId),
    byBdCompany: index("contact_bd_company_idx").on(t.bdId, t.company),
    byBdPosition: index("contact_bd_position_idx").on(t.bdId, t.position),
    byBdRoleGroup: index("contact_bd_role_group_idx").on(t.bdId, t.roleGroup),
    byBdCompanyCategory: index("contact_bd_company_category_idx").on(
      t.bdId,
      t.companyCategory,
    ),
    byBdCompanyKey: index("contact_bd_company_key_idx").on(
      t.bdId,
      t.companyKey,
    ),
    // powers the cross-BD overlap lookup ("also in María's base")
    byProfileKey: index("contact_profile_key_idx").on(t.profileKey),
    byBdLastMessage: index("contact_bd_last_message_idx").on(
      t.bdId,
      t.lastMessageAt,
    ),
    byBdReciprocal: index("contact_bd_reciprocal_idx").on(
      t.bdId,
      t.reciprocal,
    ),
  }),
);

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;

// Shared company name -> industry category mapping. Contains only company
// names and their category (no BD ownership info), so it is not scoped to a
// single BD. Populated via scripts/seed-company-categories.ts from a
// private, out-of-repo JSON file (see that script for details) — never
// commit the mapping data itself.
export const companyCategory = pgTable("company_category", {
  // Normalized company key (see src/lib/companyCategories.ts#normalizeCompanyKey).
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanyCategoryRow = typeof companyCategory.$inferSelect;
export type NewCompanyCategoryRow = typeof companyCategory.$inferInsert;

// A company whose public job board is polled for hiring signals. Shared
// across BDs (public job data, no BD ownership), same rationale as
// `companyCategory` above — so no bd_id here.
export const targetCompany = pgTable("target_company", {
  // Normalized company key (see
  // src/lib/companyCategories.ts#normalizeCompanyKey), so hiring signals can
  // later be joined against contact.company / contact.companyCategory by
  // the same key.
  companyKey: text("company_key").primaryKey(),
  displayName: text("display_name").notNull(),
  // Applicant tracking system this company's postings are fetched from. See
  // src/lib/hiring/registry.ts for the adapter registered per value.
  ats: text("ats").notNull(),
  // Adapter-specific config, e.g. { slug: "acme" } for Lever.
  config: jsonb("config").notNull(),
  // DEPRECATED: was an optional country-code filter (e.g. "AR") that
  // caused sync.ts to silently DROP every posting whose location didn't
  // match, so a US-market opening at a LATAM-flagged company was lost at
  // import and unrecoverable. sync.ts no longer reads this column — every
  // posting the ATS returns is now stored and classified into
  // `job_posting.market` instead (see src/lib/hiring/markets.ts). Column
  // kept (not dropped) so existing rows aren't destructively migrated;
  // revisit only if a genuinely useful "restrict this company to market X"
  // per-company feature is built on top of the market column.
  countryFilter: text("country_filter"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Startup classification for the /outreach "Startups only" filter — is
  // this a venture-backed or founder-led tech company in growth stage,
  // rather than a large public incumbent, a consultancy/agency, or a
  // traditional non-tech corporation? See
  // src/lib/hiring/startupClassification.ts for the exact prompt and the
  // classifier that populates these three columns. Nullable: NULL means
  // "not classified yet" (a distinct state from "classified as not a
  // startup"), so the /outreach filter can exclude unclassified companies
  // instead of guessing. Classified lazily, in small capped batches, from
  // the hiring-sync cron route (src/app/api/hiring/sync/route.ts) rather
  // than at company-seed time, since it costs an AI Gateway call per
  // company.
  isStartup: boolean("is_startup"),
  startupClassifiedAt: timestamp("startup_classified_at"),
  // Short, human-readable justification from the model — shown as a
  // tooltip on the "Startup" badge (see outreachReasons in
  // src/lib/outreach/queries.ts) so the classification is inspectable
  // rather than an unexplained mark. Null until classified, same as the two
  // columns above.
  startupReason: text("startup_reason"),
});

export type TargetCompany = typeof targetCompany.$inferSelect;
export type NewTargetCompany = typeof targetCompany.$inferInsert;

// Alternate normalized company keys that resolve to a given target company,
// for matching contacts whose `company` free text normalizes to a
// different key than the target company's own (e.g. a legal entity name vs.
// the brand name used on LinkedIn). Seeded via the optional `aliases` field
// in scripts/seed-target-companies.ts. Shared across BDs, same rationale as
// `targetCompany`.
export const companyAlias = pgTable(
  "company_alias",
  {
    // Normalized key as it appears in contact.company_key.
    aliasKey: text("alias_key").primaryKey(),
    companyKey: text("company_key")
      .notNull()
      .references(() => targetCompany.companyKey, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byCompanyKey: index("company_alias_company_key_idx").on(t.companyKey),
  }),
);

export type CompanyAlias = typeof companyAlias.$inferSelect;
export type NewCompanyAlias = typeof companyAlias.$inferInsert;

// One job posting seen on a target company's public job board. Rows persist
// across sync runs — a posting that disappears is marked closed rather than
// deleted, so "postings closed over time" stays queryable.
export const jobPosting = pgTable(
  "job_posting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyKey: text("company_key")
      .notNull()
      .references(() => targetCompany.companyKey, { onDelete: "cascade" }),
    // The ATS's own id for this posting; used with companyKey for dedup.
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull(),
    url: text("url").notNull(),
    department: text("department"),
    postedAt: timestamp("posted_at"),
    // Computed from `title` via classifyPosition (see
    // src/lib/hiring/classify.ts).
    isIt: boolean("is_it").notNull(),
    // Coarse geography bucket ("latam" | "us" | "other") classified from
    // `location` via src/lib/hiring/markets.ts#classifyMarket, computed at
    // sync time (see src/lib/hiring/sync.ts) and backfilled for older rows
    // via scripts/backfill-posting-markets.ts. Nullable only so a freshly
    // added column doesn't require a same-transaction backfill; a null
    // value is functionally "other" (unclassified) until backfilled.
    market: text("market"),
    // Miami-metro sub-filter within the "us" market, per
    // src/lib/hiring/markets.ts#isMiamiArea (Miami/Miami Beach/Fort
    // Lauderdale/Coral Gables/Doral/Hialeah — NOT all of Florida; e.g.
    // Orlando/Tampa are "us" but not `is_miami`). Computed at sync time
    // (see src/lib/hiring/sync.ts) alongside `market`, and backfilled for
    // older rows via scripts/backfill-posting-miami.ts. Not nullable —
    // unlike `market`, false is already the correct "unknown/not Miami"
    // default, so newly added rows don't need a NULL sentinel.
    isMiami: boolean("is_miami").notNull().default(false),
    // Whether this posting is in an offshore delivery hub (India,
    // Philippines, Vietnam, Sri Lanka, Bangladesh, Pakistan — see
    // src/lib/hiring/markets.ts#isOffshoreHub) that competes with LATAM
    // nearshore. Independent of `market`: an offshore-hub posting is
    // usually `market = "other"`, but this is its own dimension rather than
    // a fourth market bucket, since it's a deprioritizing signal on the
    // *company*, not a geography the business sells into. Computed at sync
    // time (see src/lib/hiring/sync.ts) and backfilled for older rows via
    // scripts/backfill-posting-offshore.ts. Not nullable, same rationale as
    // `isMiami` above: false is already the correct default for new rows.
    isOffshoreHub: boolean("is_offshore_hub").notNull().default(false),
    firstSeen: timestamp("first_seen").notNull().defaultNow(),
    lastSeen: timestamp("last_seen").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => ({
    companyExternalUnique: unique("job_posting_company_external_unique").on(
      t.companyKey,
      t.externalId,
    ),
    byCompanyClosed: index("job_posting_company_closed_idx").on(
      t.companyKey,
      t.closedAt,
    ),
    byIsItClosed: index("job_posting_is_it_closed_idx").on(
      t.isIt,
      t.closedAt,
    ),
    byMarketClosed: index("job_posting_market_closed_idx").on(
      t.market,
      t.closedAt,
    ),
    // Serves the /hiring, /outreach and /whats-new "Miami area only"
    // sub-filter (market="us" AND is_miami=true AND closed_at IS NULL)
    // without a redundant scan of job_posting_market_closed_idx above —
    // that one stays for plain market filtering (no is_miami predicate).
    byMarketMiamiClosed: index("job_posting_market_miami_closed_idx").on(
      t.market,
      t.isMiami,
      t.closedAt,
    ),
    // No dedicated index for `is_offshore_hub`, deliberately: the only query
    // that filters on it is the "hide offshore-heavy companies" opt-in (see
    // resolveHiringCompanies in src/lib/hiring/queries.ts), which compares
    // two correlated scalar counts — `count(...WHERE is_offshore_hub = true)`
    // vs. `count(...WHERE market = 'latam')`, each `WHERE company_key = ...
    // AND is_it = true AND closed_at IS NULL` — rather than a plain presence
    // check. Both subqueries are already served well by
    // `job_posting_company_closed_idx` above (company_key, closed_at) — each
    // narrows to one company's open postings (a handful to a few dozen rows
    // even for a heavy offshore hirer) and then filters `is_offshore_hub` or
    // `market` as a cheap residual check over that small row set. Add a
    // composite (company_key, is_offshore_hub, closed_at) index only if
    // these subqueries show up as a real cost in practice.
  }),
);

export type JobPosting = typeof jobPosting.$inferSelect;
export type NewJobPosting = typeof jobPosting.$inferInsert;

// One sync attempt for one target company, for observability/debugging.
export const syncRun = pgTable("sync_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyKey: text("company_key")
    .notNull()
    .references(() => targetCompany.companyKey, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull(), // 'ok' | 'error'
  fetched: integer("fetched").notNull().default(0),
  created: integer("created").notNull().default(0),
  closed: integer("closed").notNull().default(0),
  error: text("error"),
});

export type SyncRun = typeof syncRun.$inferSelect;
export type NewSyncRun = typeof syncRun.$inferInsert;

// One LinkedIn message thread, private to exactly one BD (imported from
// their messages.csv export — see src/lib/messagesCsv.ts). `peerProfileKey`
// is the other party's normalized profile key when the thread is 1:1 with
// someone the BD messaged directly; it's null for group threads and for
// InMail/company senders with no resolvable profile URL, since those can't
// be attributed to a single contact. Counts/timestamps are recomputed in
// bulk after each import rather than incrementally (see
// src/lib/queries.ts#recomputeMessageSignals).
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdId: uuid("bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    // LinkedIn's own "CONVERSATION ID" from the export.
    externalId: text("external_id").notNull(),
    title: text("title"),
    peerProfileKey: text("peer_profile_key"),
    messageCount: integer("message_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    receivedCount: integer("received_count").notNull().default(0),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // one row per (owner, LinkedIn conversation) — re-imports upsert
    bdExternalUnique: unique("conversation_bd_external_unique").on(
      t.bdId,
      t.externalId,
    ),
    byBdPeer: index("conversation_bd_peer_idx").on(t.bdId, t.peerProfileKey),
    byBdLastMessage: index("conversation_bd_last_message_idx").on(
      t.bdId,
      t.lastMessageAt,
    ),
  }),
);

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;

// One message within a conversation, private to exactly one BD. Message
// content is sensitive — every read path MUST scope by bdId (see
// src/lib/queries.ts). `contentHash` (sha256 of conversationId + sentAt +
// sender + content, see src/lib/messagesCsv.ts) makes re-importing the same
// export idempotent via `ON CONFLICT DO NOTHING`.
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdId: uuid("bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    // Null for InMail/company senders with no profile URL in the export.
    senderProfileKey: text("sender_profile_key"),
    senderName: text("sender_name"),
    sentAt: timestamp("sent_at").notNull(),
    subject: text("subject"),
    content: text("content").notNull(),
    folder: text("folder"),
    // Drafts are stored (so re-imports stay idempotent and nothing is
    // silently dropped) but excluded from every count/aggregate — see
    // src/lib/messagesCsv.ts for the rationale.
    isDraft: boolean("is_draft").notNull().default(false),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bdContentHashUnique: unique("message_bd_content_hash_unique").on(
      t.bdId,
      t.contentHash,
    ),
    byBdConversationSent: index("message_bd_conversation_sent_idx").on(
      t.bdId,
      t.conversationId,
      t.sentAt,
    ),
  }),
);

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;

// A candidate ATS job board discovered for a company key seen in some BD's
// contact base but not yet a `target_company` — see src/lib/hiring/discovery.ts.
// Shared across BDs (public company-board data, no BD ownership), same
// rationale as `targetCompany`. `contactCount` is a snapshot aggregate
// (across ALL BDs) taken when the candidate was discovered/last updated —
// it is NOT the viewing BD's own contact count and must never be presented
// as such (see getPendingCandidates in src/lib/hiring/discoveryQueries.ts).
export const boardCandidate = pgTable(
  "board_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized company key (see
    // src/lib/companyCategories.ts#normalizeCompanyKey) this candidate was
    // discovered for. Deliberately NOT a foreign key to target_company: a
    // candidate exists precisely because the company key is *not yet* a
    // target company.
    companyKey: text("company_key").notNull(),
    displayName: text("display_name").notNull(),
    // Applicant tracking system this candidate board was found on. See
    // src/lib/hiring/discovery.ts for the probes registered per value.
    ats: text("ats").notNull(),
    slug: text("slug").notNull(),
    // 'pending' | 'approved' | 'rejected' | 'auto_approved' — see
    // src/lib/hiring/discovery.ts for the auto-approve rule.
    status: text("status").notNull().default("pending"),
    jobCount: integer("job_count").notNull().default(0),
    // Up to 3 sample posting titles captured as evidence for human review.
    sampleTitles: jsonb("sample_titles").notNull().default([]),
    // Whatever else was captured during the probe (locations seen, first
    // job URLs) — see src/lib/hiring/discovery.ts for the exact shape.
    evidence: jsonb("evidence").notNull().default({}),
    // Aggregate across ALL BDs — see table comment above.
    contactCount: integer("contact_count").notNull().default(0),
    discoveredAt: timestamp("discovered_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    // The bd's email, or "system:auto_approve" for the auto-approve rule.
    // Not a foreign key: kept as a plain denormalized string so a bd row
    // being renamed/removed later doesn't retroactively rewrite history.
    decidedBy: text("decided_by"),
  },
  (t) => ({
    atsSlugUnique: unique("board_candidate_ats_slug_unique").on(t.ats, t.slug),
    byStatus: index("board_candidate_status_idx").on(t.status),
  }),
);

export type BoardCandidate = typeof boardCandidate.$inferSelect;
export type NewBoardCandidate = typeof boardCandidate.$inferInsert;

// One discovery run attempt, for observability — mirrors `syncRun` but at
// the run level (one row per whole run, not per company) since a discovery
// run probes many companies that aren't target companies yet and so have no
// natural per-company row to attach a per-company outcome to. A silent
// failure (e.g. the run crashing before probing anything) is visible here
// via `status`/`error` rather than just... not showing up.
export const discoveryRun = pgTable("discovery_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  companiesProbed: integer("companies_probed").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  status: text("status").notNull(), // 'ok' | 'error'
  error: text("error"),
});

export type DiscoveryRun = typeof discoveryRun.$inferSelect;
export type NewDiscoveryRun = typeof discoveryRun.$inferInsert;

// Tracks which normalized company keys have already been probed for a
// board, and when — so a discovery run moves forward through the candidate
// universe instead of re-guessing the same slugs every run. A dedicated
// table (rather than a `probed_at`/`probe_attempts` pair bolted onto
// `board_candidate`) because a probe attempt and a board candidate are
// different things with different cardinality: a company can be probed
// exactly once per run regardless of how many (ats, slug) combinations were
// tried, and a *miss* (the common case — see src/lib/hiring/discovery.ts)
// has no natural board_candidate row to attach "we tried and found
// nothing" to without inventing a fake ats/slug pair that would collide
// with the real `(ats, slug)` unique constraint used for actual hits.
export const companyProbe = pgTable("company_probe", {
  companyKey: text("company_key").primaryKey(),
  lastProbedAt: timestamp("last_probed_at").notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(1),
  // Whether the most recent probe found at least one board_candidate.
  hit: boolean("hit").notNull().default(false),
});

export type CompanyProbe = typeof companyProbe.$inferSelect;
export type NewCompanyProbe = typeof companyProbe.$inferInsert;

// Cached MX-lookup result for one email domain (see
// src/lib/emailDomain.ts#lookupDomain). Rows hold PUBLIC DNS facts about a
// domain (does it receive mail, and via which provider) — not contact data,
// and a domain's MX configuration is not owned by any one BD, so this is
// shared across BDs like `companyCategory`/`targetCompany` above (no bd_id).
// Refreshed on a ~30 day TTL by the caller (see
// src/lib/emailSuggestion.ts) rather than on every read, since MX records
// change rarely and a fresh DNS lookup has real latency.
export const emailDomainCheck = pgTable("email_domain_check", {
  domain: text("domain").primaryKey(),
  hasMx: boolean("has_mx").notNull(),
  // MailProvider from src/lib/emailDomain.ts, stored as plain text (no DB
  // enum) so adding a new provider matcher never needs a migration.
  provider: text("provider").notNull(),
  mxHosts: jsonb("mx_hosts").notNull().default([]),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export type EmailDomainCheck = typeof emailDomainCheck.$inferSelect;
export type NewEmailDomainCheck = typeof emailDomainCheck.$inferInsert;

// One import batch/event that leads are sourced from (e.g. a conference
// attendee list). `lead.sourceKey` references this so the same event can be
// re-imported idempotently and multiple events can coexist without their
// attendee ids colliding. See src/lib/leads/csv.ts for the import/merge
// logic across the several source files that describe one event.
export const leadSource = pgTable("lead_source", {
  key: text("key").primaryKey(),
  displayName: text("display_name").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

export type LeadSource = typeof leadSource.$inferSelect;
export type NewLeadSource = typeof leadSource.$inferInsert;

// A lead sourced from an external list (e.g. conference attendees).
// Deliberately NOT scoped to one BD like `contact` is — explicit product
// decision: every signed-in BD sees every lead, shared across the team,
// with `ownerBdId` naming who is responsible for following up (distinct
// from `updatedByBdId`, who last edited the row). See
// src/lib/leads/csv.ts for the import/merge logic and
// src/lib/leads/queries.ts for filtering, pagination and edits.
export const lead = pgTable(
  "lead",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKey: text("source_key")
      .notNull()
      .references(() => leadSource.key, { onDelete: "cascade" }),
    // The source's own row id (`attendee_id` in the fi-arg-2026 export),
    // used with sourceKey for idempotent re-import — see the unique
    // constraint below.
    attendeeId: text("attendee_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    jobTitle: text("job_title"),
    seniority: text("seniority"),
    companyRaw: text("company_raw"),
    // Cleaned-up company name from the richer source files (`company_display`
    // in fi-arg-2026-decisores-*.csv); falls back to companyRaw when no
    // source row provides it.
    companyDisplay: text("company_display"),
    // Normalized grouping key for the same employer across name variants
    // (`company_group` in the source files) — independent of companyKey
    // below, which this app computes itself the same way contact.company_key
    // is computed.
    companyGroup: text("company_group"),
    // Computed via src/lib/companyCategories.ts#normalizeCompanyKey from
    // companyDisplay (or companyRaw) at import time, for consistent
    // filtering. NOT a foreign key into target_company — leads are a
    // separate universe from the hiring-signals company graph.
    companyKey: text("company_key"),
    industryRaw: text("industry_raw"),
    industryGroup: text("industry_group"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    attendeeType: text("attendee_type"),
    email: text("email"),
    // 'verified' | 'probable' | 'none' — see src/lib/leads/types.ts.
    emailStatus: text("email_status").notNull().default("none"),
    // 0-100 confidence score from the richest source that supplied this
    // email (the hunter file's `score` column); null when not available.
    emailConfidence: integer("email_confidence"),
    // Which source file produced the current email (e.g.
    // "fi-arg-2026-mails-hunter", "correos_final"), for traceability — free
    // text rather than a DB enum, so a new source file never needs a
    // migration.
    emailSource: text("email_source"),
    ownerBdId: uuid("owner_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // 'new' | 'contacted' | 'replied' | 'meeting' | 'discarded' — see
    // src/lib/leads/types.ts.
    status: text("status").notNull().default("new"),
    notes: text("notes"),
    updatedByBdId: uuid("updated_by_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Bumped on every (re-)import pass that touches this row, so "still in
    // the latest export vs. stale" is inspectable without deleting rows.
    lastImportedAt: timestamp("last_imported_at").notNull().defaultNow(),
  },
  (t) => ({
    // one row per (event, attendee) — re-imports upsert instead of duplicating
    sourceAttendeeUnique: unique("lead_source_attendee_unique").on(
      t.sourceKey,
      t.attendeeId,
    ),
    byOwner: index("lead_owner_idx").on(t.ownerBdId),
    byStatus: index("lead_status_idx").on(t.status),
    byCompanyGroup: index("lead_company_group_idx").on(t.companyGroup),
    byIndustryGroup: index("lead_industry_group_idx").on(t.industryGroup),
    byEmailStatus: index("lead_email_status_idx").on(t.emailStatus),
    bySeniority: index("lead_seniority_idx").on(t.seniority),
  }),
);

export type Lead = typeof lead.$inferSelect;
export type NewLead = typeof lead.$inferInsert;

// ---------------------------------------------------------------------------
// Unified Contact model (design.md D1-D8, `openspec/changes/crm-hubspot-ux`).
// `person` is the UI-facing "Contact": one row per real person, additive
// alongside the legacy `contact`/`lead` tables (never mutated in place — see
// design D1, "Additive rollback"). Filled by the identity matcher
// (src/lib/identity/matcher.ts) through the dry-run-gated migration in
// scripts/unify-contacts.ts. `contact`/`lead` stay read-only once this ships.
// ---------------------------------------------------------------------------

export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized LinkedIn profile key (src/lib/csv.ts#normalizeProfileKey).
    // Null for leads with no LinkedIn profile (contact-identity spec).
    profileKey: text("profile_key"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    // Lowercased/trimmed `email`, for exact-match lookups independent of
    // casing (src/lib/identity/matcher.ts).
    emailNormalized: text("email_normalized"),
    // 'verified' | 'probable' | 'none' — same vocabulary as contact/lead.
    emailStatus: text("email_status").notNull().default("none"),
    emailConfidence: integer("email_confidence"),
    emailSource: text("email_source"),
    company: text("company"),
    companyKey: text("company_key"),
    companyCategory: text("company_category"),
    jobTitle: text("job_title"),
    roleGroup: text("role_group"),
    seniority: text("seniority"),
    industry: text("industry"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    ownerBdId: uuid("owner_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // 'new' | 'contacted' | 'replied' | 'meeting' | 'discarded' — a CACHE
    // recomputed by deriveStatus() (design D4), never edited directly.
    status: text("status").notNull().default("new"),
    // The activity row (or a synthetic connection marker) that produced the
    // current `status`, for the record page's "why" hint. No DB FK, since
    // deriveStatus() can point at either kind of event.
    statusActivityId: uuid("status_activity_id"),
    // Free-text provenance ("linkedin_import" | "lead_import" | "csv" | …).
    // Deliberately not an FK — same "don't rewrite history" rationale as
    // board_candidate.decidedBy above.
    sourceKey: text("source_key"),
    // Set when this row lost a merge (design D6); such rows are hidden from
    // every read. No DB FK (would self-reference at create time) — enforced
    // by mergeContacts()/unmergeContact() (Phase 6).
    mergedIntoId: uuid("merged_into_id"),
    // The migration_run that created this row via the collapse/fold-leads
    // migration; null for rows created after the migration.
    migrationRunId: uuid("migration_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedByBdId: uuid("updated_by_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    profileKeyUnique: unique("person_profile_key_unique").on(t.profileKey),
    byOwner: index("person_owner_idx").on(t.ownerBdId),
    byStatus: index("person_status_idx").on(t.status),
    byCompanyKey: index("person_company_key_idx").on(t.companyKey),
    byEmailNormalized: index("person_email_normalized_idx").on(
      t.emailNormalized,
    ),
    // Serves the matcher's name+company review lookup (contact-identity
    // spec, "Name+company match never auto-merges").
    byNameCompany: index("person_name_company_idx").on(
      t.lastName,
      t.firstName,
      t.companyKey,
    ),
    byMergedInto: index("person_merged_into_idx").on(t.mergedIntoId),
    // Serve the `/contacts` list's industryGroup/seniority/emailStatus
    // filters (task 13.3 parity gaps) — same indexed-filter treatment as
    // the legacy `lead` table's lead_industry_group_idx/lead_seniority_idx/
    // lead_email_status_idx.
    byIndustry: index("person_industry_idx").on(t.industry),
    bySeniority: index("person_seniority_idx").on(t.seniority),
    byEmailStatus: index("person_email_status_idx").on(t.emailStatus),
  }),
);

export type Person = typeof person.$inferSelect;
export type NewPerson = typeof person.$inferInsert;

// Per-BD relationship facts for a person (design D2): "connected BDs", each
// with their own `connectedOn` date and message aggregates (moved here from
// the legacy per-BD `contact` row — see contact.message_count/etc. above).
export const personBdConnection = pgTable(
  "person_bd_connection",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    bdId: uuid("bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    connectedOn: text("connected_on"),
    // The legacy contact row this connection was folded from — for
    // migration-review traceability; person_id_map below is the
    // authoritative legacy-id -> person-id mapping.
    legacyContactId: uuid("legacy_contact_id"),
    messageCount: integer("message_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    receivedCount: integer("received_count").notNull().default(0),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),
    initiatedByMe: boolean("initiated_by_me"),
    reciprocal: boolean("reciprocal").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.personId, t.bdId] }),
    byBd: index("person_bd_connection_bd_idx").on(t.bdId),
  }),
);

export type PersonBdConnection = typeof personBdConnection.$inferSelect;
export type NewPersonBdConnection = typeof personBdConnection.$inferInsert;

// Property-level change history, feeding the record page's "last updated by
// X" hint (contact-identity R7).
export const personPropertyHistory = pgTable(
  "person_property_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    property: text("property").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedByBdId: uuid("changed_by_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // 'edit' | 'merge' | 'unmerge' | 'import' | 'migration'
    source: text("source").notNull(),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => ({
    byPerson: index("person_property_history_person_idx").on(t.personId),
  }),
);

export type PersonPropertyHistory = typeof personPropertyHistory.$inferSelect;
export type NewPersonPropertyHistory =
  typeof personPropertyHistory.$inferInsert;

// Authoritative legacy-id -> person-id mapping (contact-identity spec:
// "every legacy id resolves"). Own-company rows map to a null personId, and
// the /leads, /contact redirects (design D8) answer those with a 404.
export const personIdMap = pgTable(
  "person_id_map",
  {
    // 'contact' | 'lead'
    legacyTable: text("legacy_table").notNull(),
    legacyId: uuid("legacy_id").notNull(),
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "cascade",
    }),
    // 'profile_key' | 'verified_email' | 'review' | 'new' | 'skipped_own_company'
    method: text("method").notNull(),
    migrationRunId: uuid("migration_run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.legacyTable, t.legacyId] }),
    byPerson: index("person_id_map_person_idx").on(t.personId),
  }),
);

export type PersonIdMap = typeof personIdMap.$inferSelect;
export type NewPersonIdMap = typeof personIdMap.$inferInsert;

// Merge/unmerge trail (design D6): the data half of the audit story. Holds
// the full pre-merge snapshot (both rows, losing values, re-pointed ids per
// table) that unmergeContact() (Phase 6) replays in reverse. Distinct from
// audit_log below, which is the accountability half ("who did what, when").
export const mergeEvent = pgTable(
  "merge_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    survivorId: uuid("survivor_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    mergedId: uuid("merged_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    // Null = migration-driven merge (no human actor).
    actorBdId: uuid("actor_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    snapshot: jsonb("snapshot").notNull().default({}),
    undoneAt: timestamp("undone_at"),
    undoneBy: uuid("undone_by").references(() => bd.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bySurvivor: index("merge_event_survivor_idx").on(t.survivorId),
    byMerged: index("merge_event_merged_idx").on(t.mergedId),
  }),
);

export type MergeEvent = typeof mergeEvent.$inferSelect;
export type NewMergeEvent = typeof mergeEvent.$inferInsert;

// Possible-duplicate review queue (contact-identity spec: name+company match
// never auto-merges). A `not_duplicate` pair is never proposed again.
export const duplicateCandidate = pgTable(
  "duplicate_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personAId: uuid("person_a_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    personBId: uuid("person_b_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    reason: text("reason").notNull().default("name_company"),
    matchKey: text("match_key").notNull(),
    // 'open' | 'merged' | 'not_duplicate'
    status: text("status").notNull().default("open"),
    decidedByBdId: uuid("decided_by_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // person_a_id < person_b_id is enforced at the application level
    // (src/lib/identity/matcher.ts) — Drizzle has no composite CHECK helper.
    pairUnique: unique("duplicate_candidate_pair_unique").on(
      t.personAId,
      t.personBId,
    ),
    byStatus: index("duplicate_candidate_status_idx").on(t.status),
  }),
);

export type DuplicateCandidate = typeof duplicateCandidate.$inferSelect;
export type NewDuplicateCandidate = typeof duplicateCandidate.$inferInsert;

// Accountability trail (design D6, admin-access-audit spec): who did what,
// and when, for every admin action — conversation views, merges, unmerges,
// not-a-duplicate decisions, migration approvals. Append-only, small rows;
// distinct from merge_event's large mutable snapshot above. A merge/unmerge
// writes one row here linked to its merge_event via metadata.mergeEventId.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorBdId: uuid("actor_bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    // 'view_conversation' | 'merge' | 'unmerge' | 'not_duplicate' |
    // 'migration_approve' | 'migration_execute'
    action: text("action").notNull(),
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "set null",
    }),
    targetBdId: uuid("target_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // e.g. { mergeEventId } linking merge/unmerge rows to merge_event above.
    metadata: jsonb("metadata").notNull().default({}),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => ({
    byActor: index("audit_log_actor_idx").on(t.actorBdId),
    byAction: index("audit_log_action_idx").on(t.action),
    byPerson: index("audit_log_person_idx").on(t.personId),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// One dry-run or execute attempt of the collapse/fold-leads migration
// (design "Migration plan", R10 production-data gate). Holds the report the
// owner reviews in /admin/migration before --execute is allowed to run.
export const migrationRun = pgTable(
  "migration_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'collapse' | 'fold_leads'
    kind: text("kind").notNull(),
    // 'dry_run' | 'execute'
    mode: text("mode").notNull(),
    // Hash of the input row set, so --execute refuses a stale dry run.
    inputHash: text("input_hash").notNull(),
    report: jsonb("report").notNull().default({}),
    approvedByBdId: uuid("approved_by_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    executedAt: timestamp("executed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byKind: index("migration_run_kind_idx").on(t.kind),
  }),
);

export type MigrationRun = typeof migrationRun.$inferSelect;
export type NewMigrationRun = typeof migrationRun.$inferInsert;

// BD-created saved views (design D7); system views are code constants in
// src/lib/contacts/views.ts and never stored here.
export const savedView = pgTable(
  "saved_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerBdId: uuid("owner_bd_id")
      .notNull()
      .references(() => bd.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull().default({}),
    columns: jsonb("columns").notNull().default([]),
    sort: jsonb("sort").notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index("saved_view_owner_idx").on(t.ownerBdId),
  }),
);

export type SavedView = typeof savedView.$inferSelect;
export type NewSavedView = typeof savedView.$inferInsert;

// Company entity — team-shared CRM tracking. Keyed by the same companyKey
// as targetCompany (via normalizeCompanyKey), but separate table so ATS
// config/columns stay isolated.
export const company = pgTable("company", {
  companyKey: text("company_key").primaryKey(),
  displayName: text("display_name").notNull(),
  // Free text, app-validated pipeline: 'prospect' | 'qualified' | 'proposal_sent' | 'won' | 'lost'
  relationshipStage: text("relationship_stage"),
  // Revenue potential in undefined unit; nullable until estimated. Never
  // used for calculations in MVP — display-only for now.
  revenuePotential: integer("revenue_potential"),
  notes: text("notes"),
  // These are denormalized (not FKs) to preserve history if the BD is removed.
  createdByBdId: uuid("created_by_bd_id"),
  updatedByBdId: uuid("updated_by_bd_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Company = typeof company.$inferSelect;
export type NewCompany = typeof company.$inferInsert;

// Activity timeline for leads/companies/contacts. Exactly one of (leadId,
// companyKey, contactId) is set (enforced by CHECK constraint). contactOwnerBdId
// is denormalized (mirrors message.bdId pattern) so contact-activity reads
// stay privacy-scoped without a join.
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => lead.id, { onDelete: "cascade" }),
    companyKey: text("company_key").references(() => company.companyKey, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id"),
    // Denormalized from contact.bd_id for privacy scoping without a join.
    // Null if activity is company/lead-scoped.
    contactOwnerBdId: uuid("contact_owner_bd_id"),
    // Unified-Contact subject FK (design D1). Once the migration re-points
    // rows via person_id_map, this replaces contactId as the primary
    // subject FK for Contact-scoped activity; contactId stays for legacy
    // read paths until the collapse migration executes.
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "cascade",
    }),
    // Who performed/logged this activity (design "activity has no author
    // column today. Derivation and attribution need one."). Null for
    // system-derived rows (e.g. migration-written status_backfill).
    actorBdId: uuid("actor_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // Free text: 'note' | 'email_sent' | 'hunter_lookup' | 'status_change' | etc.
    type: text("type").notNull(),
    // Metadata keyed by type: { gmailMessageId, gmailThreadId } for email_sent,
    // { hunterScore, hunterVerified } for hunter_lookup, etc.
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Exactly one subject FK is set — checked at application level, not DB constraint,
    // since Drizzle doesn't expose PostgreSQL CHECK syntax for composite conditions.
    byLead: index("activity_lead_idx").on(t.leadId),
    byCompany: index("activity_company_idx").on(t.companyKey),
    byContact: index("activity_contact_idx").on(t.contactId),
    byPerson: index("activity_person_idx").on(t.personId),
    byType: index("activity_type_idx").on(t.type),
    byCreated: index("activity_created_idx").on(t.createdAt),
  }),
);

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;

// Task list for leads/companies/contacts. Same subject-FK pattern as activity.
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => lead.id, { onDelete: "cascade" }),
    companyKey: text("company_key").references(() => company.companyKey, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id"),
    // Unified-Contact subject FK (design D1) — see activity.personId comment.
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "cascade",
    }),
    // Who created this task, distinct from assignedToBdId ("who owns it").
    actorBdId: uuid("actor_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    assignedToBdId: uuid("assigned_to_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    // 'open' | 'done' | 'cancelled'
    status: text("status").notNull().default("open"),
    dueAt: timestamp("due_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byLead: index("task_lead_idx").on(t.leadId),
    byCompany: index("task_company_idx").on(t.companyKey),
    byContact: index("task_contact_idx").on(t.contactId),
    byPerson: index("task_person_idx").on(t.personId),
    byAssignee: index("task_assignee_idx").on(t.assignedToBdId),
    byStatus: index("task_status_idx").on(t.status),
    byDue: index("task_due_idx").on(t.dueAt),
  }),
);

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;

// Gmail account connection per BD. Refresh token encrypted at rest
// (AES-256-GCM via GMAIL_TOKEN_ENCRYPTION_KEY env var).
export const emailAccount = pgTable(
  "email_account",
  {
    bdId: uuid("bd_id")
      .primaryKey()
      .references(() => bd.id, { onDelete: "cascade" }),
    emailAddress: text("email_address").notNull(),
    // Encrypted refresh token — never decrypt unless sending; always
    // re-encrypt on update.
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    // 'connected' | 'error' | 'revoked'
    status: text("status").notNull().default("connected"),
    // Last error message from Gmail API, for debugging reconnection issues.
    lastErrorMessage: text("last_error_message"),
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("email_account_status_idx").on(t.status),
  }),
);

export type EmailAccount = typeof emailAccount.$inferSelect;
export type NewEmailAccount = typeof emailAccount.$inferInsert;

// Generic signal/research data for leads/companies/contacts. Discriminated by
// source ('linkedin_apify' | 'manual_paste' | 'web_research' | etc.) and a
// single subject FK (leadId | companyKey | contactId). Same privacy/application-level
// enforcement as activity table.
export const signal = pgTable(
  "signal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => lead.id, { onDelete: "cascade" }),
    companyKey: text("company_key").references(() => company.companyKey, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id"),
    // Unified-Contact subject FK (design D1) — see activity.personId comment.
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "cascade",
    }),
    // Who captured this signal (e.g. who ran manual_paste); null for
    // system-triggered signals (linkedin_apify, web_research).
    actorBdId: uuid("actor_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // 'linkedin_apify' | 'manual_paste' | 'web_research'
    source: text("source").notNull(),
    // Source-specific data: { profile, headline, connections, headline_history }
    // for linkedin_apify; { text, pastedAt } for manual_paste; { title, url, snippet,
    // publishedAt } for web_research.
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byLead: index("signal_lead_idx").on(t.leadId),
    byCompany: index("signal_company_idx").on(t.companyKey),
    byContact: index("signal_contact_idx").on(t.contactId),
    byPerson: index("signal_person_idx").on(t.personId),
    bySource: index("signal_source_idx").on(t.source),
  }),
);

export type Signal = typeof signal.$inferSelect;
export type NewSignal = typeof signal.$inferInsert;

// One LinkedIn scrape run via Apify, for observability — mirrors syncRun pattern.
export const linkedinScrapeJob = pgTable(
  "linkedin_scrape_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null until the run is requested for a specific contact/lead/company;
    // for now, all runs are ad-hoc, so this is primarily for future batch-job
    // tracking if needed.
    contactId: uuid("contact_id"),
    // Unified-Contact subject FK (design D1) — see activity.personId comment.
    personId: uuid("person_id").references(() => person.id, {
      onDelete: "cascade",
    }),
    // Who requested this scrape run.
    actorBdId: uuid("actor_bd_id").references(() => bd.id, {
      onDelete: "set null",
    }),
    // Apify's own run ID; used to poll job status and retrieve dataset.
    apifyRunId: text("apify_run_id").notNull(),
    // 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out'
    status: text("status").notNull().default("queued"),
    // Number of profiles scraped (set when status = 'succeeded').
    profilesScraped: integer("profiles_scraped").default(0),
    // Last error or cause if status = 'failed'.
    errorMessage: text("error_message"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    byContact: index("linkedin_scrape_job_contact_idx").on(t.contactId),
    byPerson: index("linkedin_scrape_job_person_idx").on(t.personId),
    byApifyRunId: index("linkedin_scrape_job_apify_run_idx").on(t.apifyRunId),
    byStatus: index("linkedin_scrape_job_status_idx").on(t.status),
  }),
);

export type LinkedinScrapeJob = typeof linkedinScrapeJob.$inferSelect;
export type NewLinkedinScrapeJob = typeof linkedinScrapeJob.$inferInsert;
