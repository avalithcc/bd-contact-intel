import { generateObject, jsonSchema } from "ai";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobPosting, targetCompany } from "@/db/schema";

// Cheap, fast model — this is a small binary classification task run in
// batches on every hiring-sync cron tick, not a user-facing generation (see
// src/app/outreach/actions.ts for the Sonnet model used for outreach
// messages). Verified against the live AI Gateway catalog
// (https://ai-gateway.vercel.sh/v1/models) at implementation time — re-check
// that endpoint before bumping this if Anthropic ships a newer Haiku.
const STARTUP_CLASSIFICATION_MODEL = "anthropic/claude-haiku-4.5";

// How many companies to classify per cron/manual trigger — small enough to
// fit comfortably inside the /api/hiring/sync route's Vercel Hobby function
// duration limit alongside the ATS sync it already runs, and to keep AI
// Gateway spend predictable on a small budget.
export const STARTUP_CLASSIFICATION_BATCH_SIZE = 20;

// Sample size fed to the model per company — enough to judge company stage
// from job-title/location patterns without inflating the prompt (and the
// per-call token cost) for companies with hundreds of open postings.
const MAX_SAMPLE_POSTINGS = 8;

export interface StartupClassification {
  isStartup: boolean;
  reason: string;
}

// Plain JSON Schema (no zod — not a dependency of this project, see the
// existing generateText-only usage in src/app/outreach/actions.ts) passed to
// generateObject via the `jsonSchema` helper re-exported from `ai`. This
// gives the same strict, validated structured output generateObject
// provides with zod, without adding a new dependency for one small schema.
const startupClassificationSchema = jsonSchema<StartupClassification>({
  type: "object",
  properties: {
    isStartup: {
      type: "boolean",
      description:
        "True only if the company is a venture-backed or founder-led technology company in growth stage.",
    },
    reason: {
      type: "string",
      description: "One short sentence justifying the verdict, grounded only in the evidence given.",
    },
  },
  required: ["isStartup", "reason"],
  additionalProperties: false,
});

const SYSTEM_PROMPT = `
You classify companies as "startup" or not for a B2B sales tool. Definition of "startup" (apply strictly):
- Venture-backed OR founder-led technology company in growth stage.
- Typically less than ~15 years old.
- NOT a large public incumbent (publicly traded, or a well-known enterprise brand).
- NOT a consultancy, agency, or professional-services firm.
- NOT a traditional non-tech corporation (retail, manufacturing, banking, government, etc. without a software product at its core).

You are given only the company's display name, its applicant tracking system (a weak, secondary signal — smaller ATS vendors correlate loosely with earlier-stage companies, nothing more), and a small sample of its currently open job titles and locations. This is often incomplete or ambiguous.

Rules:
- If the evidence clearly matches the "startup" definition, answer true.
- If the evidence clearly does NOT match (e.g. the name is a known large/public company, or the postings read like a consultancy/agency/traditional corporation), answer false.
- If you are unsure — insufficient or ambiguous evidence — answer false. Never guess true without real justification; a false negative is far cheaper than a false positive here.
- The reason must be one short sentence, grounded only in the evidence given. Never invent funding rounds, headcount, or facts not in the input.
`.trim();

function buildPrompt(
  displayName: string,
  ats: string,
  sampleTitles: string[],
  sampleLocations: string[],
): string {
  return `
Company display name: ${displayName}
Applicant tracking system: ${ats}
Sample open job titles (up to ${MAX_SAMPLE_POSTINGS}): ${sampleTitles.length ? sampleTitles.join(" | ") : "none available"}
Sample locations (up to ${MAX_SAMPLE_POSTINGS}): ${sampleLocations.length ? sampleLocations.join(" | ") : "none available"}

Classify this company now.
`.trim();
}

/**
 * Classifies a single company as startup/not, via Claude on the AI Gateway.
 * Returns null (never throws) on any failure — missing/invalid Gateway
 * credentials, a rate limit, a malformed response, etc. — so a single
 * company's failure never aborts the batch in classifyPendingStartups
 * below; the row is simply left NULL for the next run to retry.
 */
export async function classifyCompanyStartup(
  displayName: string,
  ats: string,
  sampleTitles: string[],
  sampleLocations: string[],
): Promise<StartupClassification | null> {
  try {
    const { object } = await generateObject({
      model: STARTUP_CLASSIFICATION_MODEL,
      schema: startupClassificationSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(displayName, ats, sampleTitles, sampleLocations),
      // A one-sentence reason plus a boolean comfortably fits well under
      // this — a hard ceiling against a misbehaving generation, not the
      // expected output size (kept small deliberately: this runs in
      // batches of up to STARTUP_CLASSIFICATION_BATCH_SIZE per cron tick,
      // on a small AI Gateway budget).
      maxOutputTokens: 200,
    });
    return object;
  } catch (error) {
    console.error(`classifyCompanyStartup failed for "${displayName}"`, error);
    return null;
  }
}

export interface ClassifyPendingStartupsResult {
  attempted: number;
  classified: number;
  failed: number;
}

/**
 * Classifies up to `limit` target companies whose startup status hasn't
 * been determined yet (`is_startup IS NULL`), oldest-created first. Called
 * from the hiring-sync cron route (src/app/api/hiring/sync/route.ts) after
 * every sync, so it stays a background, self-catching-up process — a
 * company added today is classified within a handful of cron ticks, never
 * all at once. A per-company failure leaves that row NULL (never throws
 * out of this function) so it's simply retried on the next call; it is
 * logged via classifyCompanyStartup above.
 */
export async function classifyPendingStartups(
  limit = STARTUP_CLASSIFICATION_BATCH_SIZE,
): Promise<ClassifyPendingStartupsResult> {
  const pending = await db
    .select({
      companyKey: targetCompany.companyKey,
      displayName: targetCompany.displayName,
      ats: targetCompany.ats,
    })
    .from(targetCompany)
    .where(isNull(targetCompany.isStartup))
    .orderBy(asc(targetCompany.createdAt))
    .limit(limit);

  let classified = 0;
  let failed = 0;

  for (const company of pending) {
    // Sample of this company's own postings (open preferred, but any —
    // including closed — still carries useful signal about the kind of
    // roles/locations this company hires for, and a company with zero open
    // postings right now shouldn't stay unclassified forever).
    const postings = await db
      .select({ title: jobPosting.title, location: jobPosting.location })
      .from(jobPosting)
      .where(eq(jobPosting.companyKey, company.companyKey))
      // Open postings (closed_at IS NULL) first — `asc(closedAt)` alone
      // would sort them LAST (Postgres's default NULLS LAST for ASC), the
      // opposite of what's useful here — then most recently posted first.
      .orderBy(desc(sql<boolean>`${jobPosting.closedAt} is null`), desc(jobPosting.firstSeen))
      .limit(MAX_SAMPLE_POSTINGS);

    const sampleTitles = postings.map((p) => p.title);
    const sampleLocations = [...new Set(postings.map((p) => p.location))];

    const result = await classifyCompanyStartup(
      company.displayName,
      company.ats,
      sampleTitles,
      sampleLocations,
    );

    if (!result) {
      failed++;
      continue;
    }

    await db
      .update(targetCompany)
      .set({
        isStartup: result.isStartup,
        startupClassifiedAt: new Date(),
        startupReason: result.reason,
      })
      .where(and(eq(targetCompany.companyKey, company.companyKey), isNull(targetCompany.isStartup)));
    classified++;
  }

  return { attempted: pending.length, classified, failed };
}
