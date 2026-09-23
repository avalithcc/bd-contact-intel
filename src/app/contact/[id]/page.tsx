import { getCurrentBd } from "@/lib/queries";
import { getContactById } from "@/lib/queries";
import { getActivitiesByContact } from "@/lib/activity/queries";
import { ActivityTimeline } from "@/app/ActivityTimeline";
import { TaskQuickAdd } from "@/app/TaskQuickAdd";
import { ManualSignal } from "@/app/ManualSignal";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactDetailPage({ params }: ContactDetailPageProps) {
  const { id } = await params;
  const me = await getCurrentBd();

  const [contact, activities] = await Promise.all([
    getContactById(me.id, id),
    getActivitiesByContact(id),
  ]);

  if (!contact) {
    return (
      <main>
        <div className={styles.notFound}>
          <h1>Contact not found</h1>
          <p>The contact you're looking for doesn't exist.</p>
          <Link href="/leads" className={styles.backLink}>
            ← Back to leads
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Link href="/leads" className={styles.backLink}>
        ← Back to leads
      </Link>

      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h1>
            {contact.firstName} {contact.lastName}
          </h1>
        </div>

        <div className={styles.info}>
          {contact.email && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Email</span>
              <a href={`mailto:${contact.email}`} className={styles.infoValue}>
                {contact.email}
              </a>
            </div>
          )}
          {contact.company && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Company</span>
              <span className={styles.infoValue}>{contact.company}</span>
            </div>
          )}
          {contact.position && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Position</span>
              <span className={styles.infoValue}>{contact.position}</span>
            </div>
          )}
          {contact.industry && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Industry</span>
              <span className={styles.infoValue}>{contact.industry}</span>
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
        <h2 className={styles.sectionTitle}>Quick Add</h2>
        <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <TaskQuickAdd contactId={id} />
          </div>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <ManualSignal contactId={id} />
          </div>
        </div>
      </div>
    </main>
  );
}
