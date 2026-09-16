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
    email: text("email"),
    industry: text("industry"), // derived later (v2 enrichment)
    connectedOn: text("connected_on"),
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
    // powers the cross-BD overlap lookup ("also in María's base")
    byProfileKey: index("contact_profile_key_idx").on(t.profileKey),
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
