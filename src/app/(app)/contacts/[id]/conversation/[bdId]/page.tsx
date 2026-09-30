import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getContactRecord } from "@/lib/contacts/queries";
import { getConversationForAdmin } from "@/lib/activity/getConversationForAdmin";
import { groupSyncedEmailThreads } from "@/lib/gmail/groupSyncedEmailThreads";
import { getDictionary } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import { isUuid } from "@/lib/uuid";
import { EmailThreadMessage } from "@/components/EmailThreadMessage";
import { LinkedInIcon, MailIcon, WarningIcon } from "@/components/icons";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface AdminConversationPageProps {
  params: Promise<{ id: string; bdId: string }>;
}

function addressListText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const addresses = value.filter((v): v is string => typeof v === "string");
  return addresses.length ? addresses.join(", ") : null;
}

/**
 * The admin-only, audited bypass view (task 11.3; admin-conversation-access
 * mockup, screen 2: admin-conversation.html:180-301). Admin screens 404 for
 * non-admins (design.md "Routes") — existence is not meant to be
 * discoverable, same convention as /admin/duplicates. Every render writes an
 * audit_log(view_conversation) row via getConversationForAdmin, unless the
 * viewer is looking at their own conversation.
 *
 * Renders THREE sections, matching the mockup: `syncedEmails` (Gmail-synced
 * mail, grouped into threads — this closes the gap the mockup's README
 * flagged: `getConversationForAdmin` always returned this, the page never
 * read it), the legacy `emailEntries` (manual `email_sent` activity, not in
 * the mockup's sample data but still real content this page must not drop),
 * and `linkedin` (unchanged, restyled onto the mockup's `.thread`/
 * `.thread-msg`/`.empty` classes instead of the old ad hoc CSS-module cards).
 *
 * `id`/`bdId` are validated as UUIDs FIRST (fresh-review BLOCKER fix) —
 * both eventually reach a `where(eq(uuidColumn, value))` query
 * (getContactRecord / getConversationForAdmin), and a malformed param
 * throws an uncaught driver error (no error.tsx here) instead of a
 * handled 404. A merged-away `id` follows the survivor chain via
 * getContactRecord's own `redirect` kind, same as `/contacts/[id]`,
 * instead of 404ing a still-valid contact.
 */
export default async function AdminConversationPage({ params }: AdminConversationPageProps) {
  const { id, bdId } = await params;
  if (!isUuid(id) || !isUuid(bdId)) notFound();

  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const record = await getContactRecord(id);
  if (record.kind === "not_found") notFound();
  if (record.kind === "redirect") redirect(`/contacts/${record.personId}/conversation/${bdId}`);

  // Audit write happens INSIDE this call, before any content is read (see
  // getConversationForAdmin's own doc comment) — `auditedAt` below is this
  // render's own timestamp, not a re-read of the row it just wrote, but the
  // two are for-practical-purposes the same instant (same request).
  const conversationData = await getConversationForAdmin(id, bdId, me.id);
  if (conversationData.kind === "not_found") notFound();
  const auditedAt = new Date();

  const dict = await getDictionary();
  const l = dict.adminConversation;
  const cl = dict.contactRecord;
  const name = [record.record.person.firstName, record.record.person.lastName].filter(Boolean).join(" ");
  const syncedThreads = groupSyncedEmailThreads(conversationData.syncedEmails);
  const hasLinkedinContent = conversationData.linkedin.some((t) => t.messages.length > 0);

  return (
    <main>
      <Link href={`/contacts/${id}`} className={styles.backLink}>
        ← {l.backLink}
      </Link>

      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">
            {l.title} {conversationData.targetBdName}
          </div>
          <h1>
            {name.toLowerCase()}
            <span className="dot">.</span>
          </h1>
        </div>
      </div>

      <div className="alert alert-audit">
        <WarningIcon className="icon" />
        <div>
          <div className="title">{l.auditBannerTitle(conversationData.targetBdName)}</div>
          {l.auditBannerBody(me.name, conversationData.targetBdName, name, formatDateTime(auditedAt, "es"))}
        </div>
      </div>

      <h2 className="section-title mt-xl">{l.syncedEmailSectionTitle}</h2>
      {syncedThreads.length > 0 ? (
        <div className="tl">
          {syncedThreads.map((thread) => (
            <div key={thread.threadId} className="tl-item">
              <div className="tl-icon email">
                <MailIcon className="icon" />
              </div>
              <div className="tl-card">
                <div className="tl-head">
                  <span className="what">
                    {cl.timelineThreadWhatPrefix} · {thread.subject ?? cl.timelineThreadNoSubject}
                  </span>
                  <span className="badge badge-info no-dot">
                    {thread.messages.length} {cl.timelineFilterEmail.toLowerCase()}
                  </span>
                  <span className="when">{formatDateTime(thread.latestAt, "es")}</span>
                </div>
                <div className="thread">
                  {thread.messages.map((m) => {
                    const isSent = m.direction === "outbound";
                    return (
                      <EmailThreadMessage
                        key={m.id}
                        avatarId={isSent ? bdId : id}
                        senderName={isSent ? conversationData.targetBdName : name}
                        isSent={isSent}
                        sentLabel={cl.timelineSentBadge}
                        receivedLabel={cl.timelineReceivedBadge}
                        when={formatDateTime(m.sentAt, "es")}
                        recipientPrefix={cl.timelineRecipientPrefix}
                        recipientText={isSent ? addressListText(m.toAddresses) : null}
                        bodyText={m.bodyText ?? ""}
                        bodyTruncated={m.bodyTruncated}
                        bodyTruncatedNote={cl.timelineBodyTruncatedNote}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <MailIcon className="icon icon-lg" />
          </div>
          <h3>{l.noSyncedEmailContent}</h3>
        </div>
      )}

      {conversationData.emailEntries.length > 0 && (
        <section className={styles.section}>
          <h2 className="section-title mt-xl">{l.legacyEmailSectionTitle}</h2>
          {conversationData.emailEntries.map((e) => (
            <div key={e.id} className={styles.card}>
              <div className={styles.meta}>{formatDateTime(e.createdAt, "es")}</div>
              <div>{typeof e.metadata?.subject === "string" ? e.metadata.subject : null}</div>
              <div>{typeof e.metadata?.body === "string" ? e.metadata.body : null}</div>
            </div>
          ))}
        </section>
      )}

      <h2 className="section-title mt-xl">{l.linkedinSectionTitle}</h2>
      {hasLinkedinContent ? (
        <div className="tl">
          {conversationData.linkedin
            .filter((thread) => thread.messages.length > 0)
            .map((thread, i) => (
              <div key={i} className="tl-item">
                <div className="tl-icon">
                  <LinkedInIcon className="icon" />
                </div>
                <div className="tl-card">
                  <div className="tl-head">
                    <span className="what">{thread.conversationTitle ?? l.linkedinSectionTitle}</span>
                  </div>
                  <div className="thread">
                    {thread.messages.map((m) => {
                      const isTargetBd = m.senderName === conversationData.targetBdName;
                      return (
                        <div key={m.id} className="thread-msg">
                          <span className={`avatar avatar-sm ${isTargetBd ? "avatar-bd a6" : "a1"}`}>
                            {(m.senderName ?? "—").slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <span className="from">{m.senderName ?? cl.timelineSystemActor}</span>
                            <div className="snippet">{m.content}</div>
                          </div>
                          <span className="meta">{formatDateTime(m.sentAt, "es")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <LinkedInIcon className="icon icon-lg" />
          </div>
          <h3>{l.noLinkedinContent}</h3>
        </div>
      )}
    </main>
  );
}
