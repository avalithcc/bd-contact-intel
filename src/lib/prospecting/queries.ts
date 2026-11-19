/**
 * The read behind the admin screen: generated drafts and refusals, with the signal that caused each. One statement; the totals ride on
 * the same rows. LIMIT even though the table is small today.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseDbTimestamp } from "@/lib/db/timestamp";

export const PROSPECT_LIST_LIMIT = 100;

export interface ProspectListRow {
  id: string;
  outcome: "drafted" | "refused";
  reason: string | null;
  subject: string | null;
  body: string | null;
  language: string | null;
  createdAt: Date;
  personName: string;
  jobTitle: string | null;
  companyName: string | null;
  bdName: string | null;
  signalTitle: string | null;
  signalLocation: string | null;
  signalUrl: string | null;
}

type RawRow = {
  id: string;
  outcome: string;
  reason: string | null;
  subject: string | null;
  body: string | null;
  language: string | null;
  created_at: Date | string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  bd_name: string | null;
  signal_data: { title?: string; location?: string; url?: string } | null;
  drafted_total: number | string;
  refused_total: number | string;
}

export async function listProspectDrafts(limit = PROSPECT_LIST_LIMIT): Promise<{ rows: ProspectListRow[]; drafted: number; refused: number }> {
  const result = await db.execute<RawRow>(sql`
    select pd.id::text as id, pd.outcome, pd.reason, pd.subject, pd.body, pd.language, pd.created_at,
      p.first_name, p.last_name, p.job_title, coalesce(co.display_name, p.company) as company_name, b.name as bd_name, s.data as signal_data,
      (count(*) filter (where pd.outcome = 'drafted') over ())::int as drafted_total,
      (count(*) filter (where pd.outcome = 'refused') over ())::int as refused_total
    from prospect_draft pd
    join signal s on s.id = pd.signal_id
    left join person p on p.id = pd.person_id
    left join company co on co.company_key = s.company_key
    left join bd b on b.id = pd.bd_id
    order by pd.created_at desc, pd.id
    limit ${limit}
  `);
  const raw = Array.from(result);
  return {
    drafted: Number(raw[0]?.drafted_total ?? 0),
    refused: Number(raw[0]?.refused_total ?? 0),
    rows: raw.map((r) => ({
      id: r.id,
      outcome: r.outcome === "drafted" ? "drafted" : "refused",
      reason: r.reason,
      subject: r.subject,
      body: r.body,
      language: r.language,
      createdAt: parseDbTimestamp(r.created_at),
      personName: [r.first_name, r.last_name].filter(Boolean).join(" "),
      jobTitle: r.job_title,
      companyName: r.company_name,
      bdName: r.bd_name,
      signalTitle: r.signal_data?.title ?? null,
      signalLocation: r.signal_data?.location ?? null,
      signalUrl: r.signal_data?.url ?? null,
    })),
  };
}
