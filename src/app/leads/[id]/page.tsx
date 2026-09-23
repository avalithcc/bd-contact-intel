import { getLeadById } from "@/lib/leads/queries";
import { getActivitiesByLead } from "@/lib/activity/queries";
import { ActivityTimeline } from "@/app/ActivityTimeline";
import { TaskQuickAdd } from "@/app/TaskQuickAdd";
import { ManualSignal } from "@/app/ManualSignal";
import { EmailComposer } from "./EmailComposer";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params;

  const [lead, activities] = await Promise.all([
    getLeadById(id),
    getActivitiesByLead(id),
  ]);

  if (!lead) {
    return (
      <main>
        <div className={styles.notFound}>
          <h1>Lead not found</h1>
          <p>The lead you're looking for doesn't exist.</p>
          <Link href="/leads" className={styles.backLink}>
            ← Back to leads
          </Link>
        </div>
      </main>
    );
  }

  const statusColor = {
    new: "#9ca3af",
    contacted: "#60a5fa",
    replied: "#3b82f6",
    meeting: "#1d4ed8",
    discarded: "#ef4444",
  } as Record<string, string>;

  return (
    <main>
      <Link href="/leads" className={styles.backLink}>
        ← Back to leads
      </Link>

      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h1>
            {lead.firstName} {lead.lastName}
          </h1>
          {lead.status && (
            <span
              className={styles.statusBadge}
              style={{
                backgroundColor: `${statusColor[lead.status as keyof typeof statusColor] || "#9ca3af"}20`,
                color: statusColor[lead.status as keyof typeof statusColor] || "#9ca3af",
              }}
            >
              {lead.status}
            </span>
          )}
        </div>

        <div className={styles.info}>
          {lead.email && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Email</span>
              <a href={`mailto:${lead.email}`} className={styles.infoValue}>
                {lead.email}
              </a>
            </div>
          )}
          {lead.companyDisplay && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Company</span>
              <span className={styles.infoValue}>{lead.companyDisplay}</span>
            </div>
          )}
          {lead.jobTitle && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Title</span>
              <span className={styles.infoValue}>{lead.jobTitle}</span>
            </div>
          )}
          {lead.seniority && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Seniority</span>
              <span className={styles.seniorityBadge}>{lead.seniority}</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Activity ({activities.length})
        </h2>
        <ActivityTimeline activities={activities} />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Email</h2>
        <EmailComposer leadId={id} leadEmail={lead.email} />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick Add</h2>
        <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <TaskQuickAdd leadId={id} />
          </div>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <ManualSignal leadId={id} />
          </div>
        </div>
      </div>
    </main>
  );
}
