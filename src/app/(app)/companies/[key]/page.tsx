import { getCompanyByKey } from "@/lib/companies/queries";
import { getActivitiesByCompany } from "@/lib/activity/queries";
import { getDictionary } from "@/lib/i18n/server";
import { ActivityTimeline } from "@/app/ActivityTimeline";
import { AddActivityButton } from "@/app/(app)/companies/AddActivityButton";
import { EditCompanyButton } from "@/app/(app)/companies/EditCompanyButton";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface CompanyDetailPageProps {
  params: Promise<{ key: string }>;
}

// Presentation-only restyle (mockup-parity 6.2). mockups/company-record.html
// documents a full three-panel RecordShell redesign (About / Timeline /
// Associations, owner chips, hiring signals, contact associations) but its
// own mock-note flags that redesign as "Solo rediseño (cambio posterior)" —
// deferred to a later change, not this pass. `getCompanyByKey` doesn't join
// owner/location/startup-classification/associations data either. This page
// keeps its current single-column structure, reskinned with shared tokens,
// Spanish copy, a company-logo `Avatar`, and the shared `Dialog`/`Toast` for
// its two modals.
export default async function CompanyDetailPage({ params }: CompanyDetailPageProps) {
  const { key: rawKey } = await params;
  // Next hands back the raw URL segment, so a key like "mercado libre" arrives
  // percent-encoded and matches nothing. Most company keys contain a space.
  const key = decodeURIComponent(rawKey);
  const dict = await getDictionary();
  const l = dict.companyRecord;
  const stageLabels: Record<string, string> = {
    prospect: dict.companiesPage.stageProspect,
    qualified: dict.companiesPage.stageQualified,
    proposal_sent: dict.companiesPage.stageProposalSent,
    won: dict.companiesPage.stageWon,
    lost: dict.companiesPage.stageLost,
  };

  const [company, activities] = await Promise.all([
    getCompanyByKey(key),
    getActivitiesByCompany(key),
  ]);

  if (!company) {
    return (
      <main>
        <div className={styles.notFound}>
          <h1>{l.notFoundTitle}</h1>
          <p>{l.notFoundBody}</p>
          <Link href="/companies" className={styles.backLink}>
            {l.backLink}
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
        {l.backLink}
      </Link>

      <div className={styles.header}>
        <div className={styles.headerTop}>
          <Avatar
            id={company.companyKey}
            initials={initialsFromName(company.displayName)}
            variant="bd"
            size="lg"
          />
          <h1>{company.displayName}</h1>
          {company.relationshipStage && (
            <span
              className={styles.stageBadge}
              style={{
                backgroundColor: (stageColor[company.relationshipStage] ?? defaultStageColor).bg,
                color: (stageColor[company.relationshipStage] ?? defaultStageColor).text,
              }}
            >
              {stageLabels[company.relationshipStage] ?? company.relationshipStage}
            </span>
          )}
        </div>

        {company.revenuePotential && (
          <div className={styles.revenue}>
            <span className={styles.revenueLabel}>{l.revenuePotential}</span>
            <span className={styles.revenueValue}>
              ${company.revenuePotential.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {company.notes && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{l.notesTitle}</h2>
          <div className={styles.notesBox}>{company.notes}</div>
        </div>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {l.activityTitle} ({activities.length})
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
          labels={l}
          stageLabels={stageLabels}
        />
        <AddActivityButton companyKey={key} labels={l} />
      </div>
    </main>
  );
}
