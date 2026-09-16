import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
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
  // Optional country-code filter (e.g. "AR"); when set, only postings whose
  // location matches (see src/lib/hiring/countryFilter.ts) are stored.
  countryFilter: text("country_filter"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
