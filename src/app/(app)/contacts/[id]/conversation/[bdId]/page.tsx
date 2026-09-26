import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getContactRecord } from "@/lib/contacts/queries";
import { getConversationForAdmin } from "@/lib/activity/getConversationForAdmin";
import { getDictionary } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface AdminConversationPageProps {
  params: Promise<{ id: string; bdId: string }>;
}

/**
 * The admin-only, audited bypass view (task 11.3; mockups/contact-record-
 * admin.html "Ver conversación"). Admin screens 404 for non-admins (design.md
 * "Routes") — existence is not meant to be discoverable, same convention as
 * /admin/duplicates. Every render writes an audit_log(view_conversation) row
 * via getConversationForAdmin, unless the viewer is looking at their own
 * conversation (no bypass needed in that case, and none is offered in the
 * UI — see the associations pane's `canViewConversation` guard).
 */
export default async function AdminConversationPage({ params }: AdminConversationPageProps) {
  const { id, bdId } = await params;
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const record = await getContactRecord(id);
  if (record.kind === "not_found") notFound();
  if (record.kind === "redirect") notFound();

  const conversationData = await getConversationForAdmin(id, bdId, me.id);
  if (!conversationData.targetBdName) notFound();

  const dict = await getDictionary();
  const l = dict.adminConversation;
  const name = [record.record.person.firstName, record.record.person.lastName].filter(Boolean).join(" ");

  return (
    <main>
      <Link href={`/contacts/${id}`} className={styles.backLink}>
        ← {l.backLink}
      </Link>
      <h1>
        {l.title} {conversationData.targetBdName} · {name}
      </h1>
      <p className={styles.auditNotice} role="status">
        {l.auditNotice}
      </p>

      <section className={styles.section}>
        <h2>{l.emailSectionTitle}</h2>
        {conversationData.emailEntries.length ? (
          conversationData.emailEntries.map((e) => (
            <div key={e.id} className={styles.card}>
              <div className={styles.meta}>{formatDateTime(e.createdAt, "es")}</div>
              <div>{typeof e.metadata?.subject === "string" ? e.metadata.subject : null}</div>
              <div>{typeof e.metadata?.body === "string" ? e.metadata.body : null}</div>
            </div>
          ))
        ) : (
          <p className={styles.empty}>{l.noEmailContent}</p>
        )}
      </section>

      <section className={styles.section}>
        <h2>{l.linkedinSectionTitle}</h2>
        {conversationData.linkedin.length ? (
          conversationData.linkedin.map((thread, i) => (
            <div key={i} className={styles.card}>
              {thread.conversationTitle && <div className={styles.meta}>{thread.conversationTitle}</div>}
              {thread.messages.map((m) => (
                <div key={m.id} className={styles.message}>
                  <div className={styles.meta}>
                    {m.senderName ?? "—"} · {formatDateTime(m.sentAt, "es")}
                  </div>
                  <div>{m.content}</div>
                </div>
              ))}
            </div>
          ))
        ) : (
          <p className={styles.empty}>{l.noLinkedinContent}</p>
        )}
      </section>
    </main>
  );
}
