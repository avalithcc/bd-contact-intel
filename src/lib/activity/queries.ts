import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activity, type Activity, type NewActivity } from "@/db/schema";

export interface ActivityFilters {
  leadId?: string;
  companyKey?: string;
  contactId?: string;
  types?: string[];
}

export interface ActivityRow extends Activity {}

export interface ActivitiesPage {
  rows: ActivityRow[];
  total: number;
}

export async function getActivities(
  filters: ActivityFilters,
  limit: number = 50,
  offset: number = 0,
): Promise<ActivitiesPage> {
  const conditions: SQL[] = [];

  if (filters.leadId) {
    conditions.push(eq(activity.leadId, filters.leadId));
  }

  if (filters.companyKey) {
    conditions.push(eq(activity.companyKey, filters.companyKey));
  }

  if (filters.contactId) {
    conditions.push(eq(activity.contactId, filters.contactId));
  }

  if (filters.types && filters.types.length > 0) {
    const typeConditions = filters.types.map((t) => eq(activity.type, t));
    conditions.push(or(...typeConditions)!);
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activity)
    .where(whereCondition);

  const rows = await db
    .select()
    .from(activity)
    .where(whereCondition)
    .orderBy(desc(activity.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    rows,
    total: total?.count ?? 0,
  };
}

export async function getActivitiesByLead(
  leadId: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(eq(activity.leadId, leadId))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

export async function getActivitiesByCompany(
  companyKey: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(eq(activity.companyKey, companyKey))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

export async function getActivitiesByContact(
  contactId: string,
  limit: number = 50,
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(eq(activity.contactId, contactId))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

export async function createActivity(input: NewActivity): Promise<Activity> {
  const [row] = await db.insert(activity).values(input).returning();
  return row!;
}
