import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { importLeads } from "@/lib/leads/queries";
import type { LeadDraft } from "@/lib/leads/csv";
import { isEmailStatusKey, isLeadStatusKey } from "@/lib/leads/types";

// Token-protected JSON ingest endpoint so an external prospecting repo
// (lead_gen) can push leads without going through the browser upload flow.
// Set LEADS_INGEST_TOKEN in the deployment environment (e.g. Vercel project
// env vars) — this route fails closed if it's unset, same as
// src/app/api/hiring/sync/route.ts does for CRON_SECRET.
//
// To trigger manually:
//   curl -X POST -H "Authorization: Bearer $LEADS_INGEST_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"source":{"key":"fi-arg-2026","displayName":"FI ARG 2026"},"leads":[...]}' \
//     https://<your-deployment>.vercel.app/api/leads/ingest
export const dynamic = "force-dynamic";
// A batch of up to MAX_LEADS leads goes through the same chunked upsert as
// scripts/import-leads.ts (500 rows per DB round trip), plus one
// matchOwnersToBd pass over the whole batch. 120s comfortably covers a
// full 2000-lead batch with margin; well under the 300s the hiring/sync
// route already uses on this plan.
export const maxDuration = 120;

const MAX_LEADS = 2000;
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4MB

interface IngestSource {
  key: string;
  displayName?: string;
}

// Authoritative field list mirrors LeadDraft (src/lib/leads/csv.ts) and the
// `lead` table (src/db/schema.ts) — NOT the generic example names ("name",
// "title", "phone") sometimes used loosely elsewhere. There is no `phone`
// column on `lead` at all, so it is intentionally not accepted here.
interface IngestLead {
  attendeeId?: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  seniority?: string | null;
  companyRaw?: string | null;
  companyDisplay?: string | null;
  companyGroup?: string | null;
  companyKey?: string | null;
  industryRaw?: string | null;
  industryGroup?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  attendeeType?: string | null;
  email?: string | null;
  emailStatus?: string | null;
  emailConfidence?: number | null;
  emailSource?: string | null;
  owner?: string | null;
  // Accepted and validated for forward-compatibility, but deliberately NOT
  // written: `status` is excluded from importLeads's upsert on purpose (see
  // the comment on importLeads) so a BD's status edits in the app survive a
  // re-import untouched. Setting it from an external push would silently
  // reintroduce that bug for this path, so it's ignored the same way a
  // re-import from the CSV path already ignores it.
  status?: string | null;
}

interface IngestBody {
  source?: IngestSource;
  leads?: IngestLead[];
}

interface SkippedLead {
  index: number;
  reason: string;
}

function blank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Deterministic attendeeId for a lead that doesn't provide one: sha256 of
 * `${sourceKey}:${normalizedEmail}`, hex-encoded. Scoped by sourceKey (not
 * just the email) so the same person attending two different events gets
 * two distinct leads, consistent with the (source_key, attendee_id) unique
 * constraint on the `lead` table. Requires an email — with neither an
 * attendeeId nor an email there is no stable identity to key off, so that
 * row is skipped instead (see below).
 */
function deriveAttendeeId(sourceKey: string, email: string): string {
  return createHash("sha256")
    .update(`${sourceKey}:${email.trim().toLowerCase()}`)
    .digest("hex");
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!isValidBearer(authHeader, process.env.LEADS_INGEST_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read the raw body first and check its size before doing anything with
  // it (parsing, validating), so an oversized payload is rejected cheaply.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf-8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Request body exceeds the ${MAX_BODY_BYTES} byte limit` },
      { status: 400 },
    );
  }

  let body: IngestBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const sourceKey = blank(body.source?.key ?? null);
  if (!sourceKey) {
    return NextResponse.json(
      { error: "source.key is required and must be a non-empty string" },
      { status: 400 },
    );
  }
  const displayName = blank(body.source?.displayName ?? null) ?? sourceKey;

  if (!Array.isArray(body.leads) || body.leads.length === 0) {
    return NextResponse.json(
      { error: "leads must be a non-empty array" },
      { status: 400 },
    );
  }
  if (body.leads.length > MAX_LEADS) {
    return NextResponse.json(
      { error: `leads exceeds the ${MAX_LEADS}-item batch limit (got ${body.leads.length})` },
      { status: 400 },
    );
  }

  const drafts: LeadDraft[] = [];
  const skipped: SkippedLead[] = [];

  body.leads.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      skipped.push({ index, reason: "lead is not an object" });
      return;
    }

    const email = blank(raw.email ?? null);

    let emailStatus: LeadDraft["emailStatus"] = "none";
    if (raw.emailStatus !== undefined && raw.emailStatus !== null) {
      if (!isEmailStatusKey(raw.emailStatus)) {
        skipped.push({
          index,
          reason: `invalid emailStatus "${raw.emailStatus}" (expected one of verified, probable, none)`,
        });
        return;
      }
      emailStatus = raw.emailStatus;
    } else if (email) {
      // A caller that supplies an email but no explicit status most likely
      // means "we found this address, unverified" rather than "none" —
      // mirrors the CSV probables/hunter overlays in src/lib/leads/csv.ts,
      // which never write an email without setting some non-"none" status.
      emailStatus = "probable";
    }

    if (raw.status !== undefined && raw.status !== null && !isLeadStatusKey(raw.status)) {
      skipped.push({
        index,
        reason: `invalid status "${raw.status}" (expected one of new, contacted, replied, meeting, discarded)`,
      });
      return;
    }

    let attendeeId = blank(raw.attendeeId ?? null);
    if (!attendeeId) {
      if (!email) {
        skipped.push({
          index,
          reason: "missing attendeeId and email — cannot derive a stable attendeeId",
        });
        return;
      }
      attendeeId = deriveAttendeeId(sourceKey, email);
    }

    const companyDisplay = blank(raw.companyDisplay ?? null);
    const companyRaw = blank(raw.companyRaw ?? null);
    const companyKey =
      blank(raw.companyKey ?? null) ??
      (companyDisplay || companyRaw
        ? normalizeCompanyKey((companyDisplay ?? companyRaw) as string)
        : null);

    const emailConfidence =
      typeof raw.emailConfidence === "number" && Number.isFinite(raw.emailConfidence)
        ? raw.emailConfidence
        : null;

    drafts.push({
      attendeeId,
      firstName: blank(raw.firstName ?? null),
      lastName: blank(raw.lastName ?? null),
      jobTitle: blank(raw.jobTitle ?? null),
      seniority: blank(raw.seniority ?? null),
      companyRaw,
      companyDisplay,
      companyGroup: blank(raw.companyGroup ?? null),
      companyKey,
      industryRaw: blank(raw.industryRaw ?? null),
      industryGroup: blank(raw.industryGroup ?? null),
      city: blank(raw.city ?? null),
      region: blank(raw.region ?? null),
      country: blank(raw.country ?? null),
      attendeeType: blank(raw.attendeeType ?? null),
      email,
      emailStatus,
      emailConfidence,
      emailSource: blank(raw.emailSource ?? null),
      ownerRaw: blank(raw.owner ?? null),
    });
  });

  if (drafts.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Every lead in the batch was skipped", skipped },
      { status: 400 },
    );
  }

  const result = await importLeads(sourceKey, displayName, drafts);

  return NextResponse.json({
    ok: true,
    upserted: result.upserted,
    matchedOwners: result.matchedOwners.length,
    unmatchedOwners: result.unmatchedOwners.length,
    skipped,
  });
}
