import { getCompanyByKey } from "@/lib/companies/queries";
import { getActivitiesByCompany } from "@/lib/activity/queries";
import { ActivityTimeline } from "@/app/ActivityTimeline";
import { AddActivityButton } from "@/app/(app)/companies/AddActivityButton";
import { EditCompanyButton } from "@/app/(app)/companies/EditCompanyButton";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface CompanyDetailPageProps {
  params: Promise<{ key: string }>;
}

export default async function CompanyDetailPage({ params }: CompanyDetailPageProps) {
  const { key: rawKey } = await params;
  // Next hands back the raw URL segment, so a key like "mercado libre" arrives
  // percent-encoded and matches nothing. Most company keys contain a space.
  const key = decodeURIComponent(rawKey);

  const [company, activities] = await Promise.all([
    getCompanyByKey(key),
    getActivitiesByCompany(key),
  ]);

  if (!company) {
    return (
      <main>
        <div className={styles.notFound}>
          <h1>Company not found</h1>
          <p>The company you're looking for doesn't exist.</p>
          <Link href="/companies" className={styles.backLink}>
            ← Back to companies
          </Link>
        </div>
      </main>
    );
  }

  // Stage badge colors come from the design tokens (src/app/globals.css),
  // not hardcoded hex — see design.md D9/Phase 8. Deal stage has no
  // dedicated token family, so it maps onto the closest semantic token:
  // prospect -> neutral, qualified -> info, proposal_sent -> warn,
  // won -> success, lost -> danger.
  const stageColor = {
    prospect: { text: "var(--color-ink-soft)", bg: "var(--color-surface-1)" },
    qualified: { text: "var(--color-info-text)", bg: "var(--color-badge-info-bg)" },
    proposal_sent: { text: "var(--color-warn-text)", bg: "var(--color-badge-warn-bg)" },
    won: { text: "var(--color-success-text)", bg: "var(--color-badge-success-bg)" },
    lost: { text: "var(--color-danger-text)", bg: "var(--color-badge-danger-bg)" },
  } as Record<string, { text: string; bg: string }>;
  const defaultStageColor = { text: "var(--color-ink-soft)", bg: "var(--color-surface-1)" };

  return (
    <main>
      <Link href="/companies" className={styles.backLink}>
        ← Back to companies
      </Link>

      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h1>{company.displayName}</h1>
          {company.relationshipStage && (
            <span
              className={styles.stageBadge}
              style={{
                backgroundColor: (stageColor[company.relationshipStage] ?? defaultStageColor).bg,
                color: (stageColor[company.relationshipStage] ?? defaultStageColor).text,
              }}
            >
              {company.relationshipStage.replace("_", " ")}
            </span>
          )}
        </div>

        {company.revenuePotential && (
          <div className={styles.revenue}>
            <span className={styles.revenueLabel}>Revenue Potential</span>
            <span className={styles.revenueValue}>
              ${company.revenuePotential.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {company.notes && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Notes</h2>
          <div className={styles.notesBox}>
            {company.notes}
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Activity ({activities.length})
        </h2>
        <ActivityTimeline activities={activities} />
      </div>

      <div className={styles.actions}>
        <EditCompanyButton
          companyKey={key}
          displayName={company.displayName}
          relationshipStage={company.relationshipStage}
          revenuePotential={company.revenuePotential}
          notes={company.notes}
        />
        <AddActivityButton companyKey={key} />
      </div>
    </main>
  );
}
