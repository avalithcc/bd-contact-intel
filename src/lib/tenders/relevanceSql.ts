import { sql } from "drizzle-orm";
import { tender } from "@/db/schema";

/**
 * "Not decided no", the SQL side of `tenderRelevance` (relevance.ts): a human's call beats the model's, and a tender with no
 * verdict at all counts as shown. The list and the digest both filter with THIS fragment so they cannot drift apart; a db
 * test holds it to the TypeScript definition.
 */
export const tenderNotDecidedNoSql = sql`coalesce(${tender.relevanceOverride}, ${tender.aiRelevant}) is distinct from false`;
