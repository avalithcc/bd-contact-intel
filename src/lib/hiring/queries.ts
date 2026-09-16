import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { jobPosting, targetCompany } from "@/db/schema";

export interface OpenPosting {
  id: string;
  title: string;
  location: string;
  url: string;
  postedAt: Date | null;
  firstSeen: Date;
}

export interface CompanyHiringSummary {
  companyKey: string;
  displayName: string;
  openItCount: number;
  newLast7Days: number;
  postings: OpenPosting[];
}

/**
 * Target companies that currently have at least one open IT posting, along
 * with those postings for the expandable detail list on /hiring. The
 * number of target companies is expected to stay small (tens), so this is
 * a plain two-query fetch (open IT postings, then their owning companies)
 * rather than a single complex join.
 */
export async function getCompanyHiringSummaries(): Promise<CompanyHiringSummary[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const openPostings = await db
    .select({
      id: jobPosting.id,
      companyKey: jobPosting.companyKey,
      title: jobPosting.title,
      location: jobPosting.location,
      url: jobPosting.url,
      postedAt: jobPosting.postedAt,
      firstSeen: jobPosting.firstSeen,
    })
    .from(jobPosting)
    .where(and(eq(jobPosting.isIt, true), isNull(jobPosting.closedAt)))
    .orderBy(desc(jobPosting.postedAt));

  if (!openPostings.length) return [];

  const companyKeys = [...new Set(openPostings.map((p) => p.companyKey))];
  const companies = await db
    .select({ companyKey: targetCompany.companyKey, displayName: targetCompany.displayName })
    .from(targetCompany)
    .where(inArray(targetCompany.companyKey, companyKeys));
  const displayNameByKey = new Map(companies.map((c) => [c.companyKey, c.displayName]));

  const byCompany = new Map<string, CompanyHiringSummary>();
  for (const p of openPostings) {
    const summary = byCompany.get(p.companyKey) ?? {
      companyKey: p.companyKey,
      displayName: displayNameByKey.get(p.companyKey) ?? p.companyKey,
      openItCount: 0,
      newLast7Days: 0,
      postings: [],
    };
    summary.openItCount += 1;
    if (p.firstSeen >= sevenDaysAgo) summary.newLast7Days += 1;
    summary.postings.push({
      id: p.id,
      title: p.title,
      location: p.location,
      url: p.url,
      postedAt: p.postedAt,
      firstSeen: p.firstSeen,
    });
    byCompany.set(p.companyKey, summary);
  }

  return [...byCompany.values()].sort((a, b) => b.openItCount - a.openItCount);
}
