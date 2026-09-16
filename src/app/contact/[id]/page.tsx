import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactById, getConversationThreads, getCurrentBd } from "@/lib/queries";

export const dynamic = "force-dynamic";

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString();
}

/** "8mo ago" / "3d ago" — same coarse relative time as the contacts list (see src/app/page.tsx). */
function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? "field-value empty" : "field-value"}>
        {empty ? "empty" : value}
      </div>
    </div>
  );
}

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentBd();
  const c = await getContactById(me.id, id);
  if (!c) notFound();

  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
  const profileUrl = `https://${c.profileKey}`;
  const { threads, moreConversations, moreMessages } =
    c.messageCount > 0
      ? await getConversationThreads(me.id, c.profileKey)
      : { threads: [], moreConversations: false, moreMessages: false };

  return (
    <main style={{ maxWidth: 720 }}>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <Link className="secondary-btn" href="/">
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <div className="eyebrow">// contact</div>
        <h1>
          {fullName || "unnamed"}
          <span className="dot">.</span>
        </h1>
      </div>

      <section className="panel">
        <Field label="First name" value={c.firstName} />
        <Field label="Last name" value={c.lastName} />
        <Field label="Company" value={c.company} />
        <Field label="Position" value={c.position} />
        <Field label="Industry" value={c.industry} />
        <Field label="Email" value={c.email} />
        <Field label="Connected on" value={c.connectedOn} />
        <Field
          label="LinkedIn profile"
          value={
            c.profileKey ? (
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                {profileUrl}
              </a>
            ) : null
          }
        />
        <Field
          label="Team overlap"
          value={
            c.overlapWith.length ? (
              <span className="badge">also in {c.overlapWith.join(", ")}</span>
            ) : null
          }
        />
        <Field
          label="Added on"
          value={new Date(c.createdAt).toLocaleDateString()}
        />
      </section>

      <section className="panel">
        <h2>Relationship signals</h2>
        {c.messageCount > 0 ? (
          <>
            <Field label="Messages" value={`${c.messageCount} total`} />
            <Field
              label="Sent / received"
              value={`${c.sentCount} sent · ${c.receivedCount} received`}
            />
            <Field
              label="First contact"
              value={
                c.firstMessageAt ? (
                  <>
                    {formatDateTime(c.firstMessageAt)}{" "}
                    <span className="soft">
                      ({relativeTime(new Date(c.firstMessageAt))})
                    </span>
                  </>
                ) : null
              }
            />
            <Field
              label="Last contact"
              value={
                c.lastMessageAt ? (
                  <>
                    {formatDateTime(c.lastMessageAt)}{" "}
                    <span className="soft">
                      ({relativeTime(new Date(c.lastMessageAt))})
                    </span>
                  </>
                ) : null
              }
            />
            <Field
              label="Started by"
              value={
                c.initiatedByMe === null
                  ? null
                  : c.initiatedByMe
                    ? "Me"
                    : "Them"
              }
            />
            <Field
              label="Reciprocal"
              value={
                <span className={`badge ${c.reciprocal ? "green" : ""}`}>
                  {c.reciprocal ? "yes" : "no"}
                </span>
              }
            />
            {c.dormant && (
              <Field
                label="Status"
                value={<span className="badge dormant">dormant</span>}
              />
            )}
          </>
        ) : (
          <p className="muted">No messages recorded with this contact yet.</p>
        )}
      </section>

      {threads.length > 0 && (
        <section className="panel">
          <h2>Conversation history</h2>
          {moreConversations && (
            <p className="thread-notice">
              Showing the {threads.length} most recent conversations — older
              conversations with this contact are not shown.
            </p>
          )}
          {moreMessages && (
            <p className="thread-notice">
              Showing the most recent 100 messages across the conversations
              below — older messages are not shown.
            </p>
          )}
          {threads.map((t) => (
            <div key={t.id} className="thread">
              <div className="thread-header">
                <span className="thread-title">{t.title || "Untitled conversation"}</span>
                <span className="soft thread-meta">
                  {t.messageCount} messages
                  {t.lastMessageAt && (
                    <> · last {relativeTime(new Date(t.lastMessageAt))}</>
                  )}
                </span>
              </div>
              <div className="thread-messages">
                {t.messages.map((m) => (
                  <div key={m.id} className="message">
                    <div className="message-meta">
                      <span className="message-sender">
                        {m.senderName || "Unknown sender"}
                      </span>
                      <span className="soft message-time">
                        {formatDateTime(m.sentAt)}
                      </span>
                    </div>
                    <div className="message-content">{m.content}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
