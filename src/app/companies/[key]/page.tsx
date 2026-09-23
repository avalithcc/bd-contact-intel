import { getCompanyByKey } from "@/lib/companies/queries";
import { getActivitiesByCompany } from "@/lib/activity/queries";
import { ActivityTimeline } from "@/app/ActivityTimeline";
import { AddActivityButton } from "@/app/companies/AddActivityButton";
import { EditCompanyButton } from "@/app/companies/EditCompanyButton";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface CompanyDetailPageProps {
  params: Promise<{ key: string }>;
}

export default async function CompanyDetailPage({ params }: CompanyDetailPageProps) {
  const { key } = await params;

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

  const stageColor = {
    prospect: "#9ca3af",
    qualified: "#3b82f6",
    proposal_sent: "#f59e0b",
    won: "#22c55e",
    lost: "#ef4444",
  } as Record<string, string>;

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
                backgroundColor: `${stageColor[company.relationshipStage as keyof typeof stageColor] || "#9ca3af"}20`,
                color: stageColor[company.relationshipStage as keyof typeof stageColor] || "#9ca3af",
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
