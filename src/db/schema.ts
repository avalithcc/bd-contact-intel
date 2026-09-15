import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
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
    // powers the cross-BD overlap lookup ("also in María's base")
    byProfileKey: index("contact_profile_key_idx").on(t.profileKey),
  }),
);

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;
