import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactById, getConversationThreads, getCurrentBd } from "@/lib/queries";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime, relativeTime } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { ThemeSwitcher } from "@/lib/theme/ThemeSwitcher";
import { getTheme } from "@/lib/theme/server";
import { SignOutButton } from "../../SignOutButton";
import { UserMenu } from "../../UserMenu";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

function Field({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: React.ReactNode;
  emptyLabel: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? "field-value empty" : "field-value"}>
        {empty ? emptyLabel : value}
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
  const locale = await getLocale();
  const theme = await getTheme();
  const dict: Dictionary = t(locale);
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
    <main className="detail-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row row-md">
          <Link className="secondary-btn" href="/">
            {dict.common.back}
          </Link>
          <UserMenu
            label={me.name || dict.common.account}
            changePasswordHref="/account/password"
            changePasswordLabel={dict.common.changePassword}
            localeSwitcher={<LocaleSwitcher locale={locale} />}
            themeSwitcher={<ThemeSwitcher theme={theme} locale={locale} />}
            themeLabel={dict.common.themeLabel}
            signOutButton={<SignOutButton locale={locale} />}
          />
        </div>
      </div>

      <div className="mb-2xl">
        <div className="eyebrow">{dict.contact.eyebrow}</div>
        <h1>
          {fullName || dict.contact.unnamed}
          <span className="dot">.</span>
        </h1>
      </div>

      <section className="panel">
        <Field label={dict.contact.fieldFirstName} value={c.firstName} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldLastName} value={c.lastName} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldCompany} value={c.company} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldPosition} value={c.position} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldIndustry} value={c.industry} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldEmail} value={c.email} emptyLabel={dict.contact.empty} />
        <Field label={dict.contact.fieldConnectedOn} value={c.connectedOn} emptyLabel={dict.contact.empty} />
        <Field
          label={dict.contact.fieldLinkedinProfile}
          emptyLabel={dict.contact.empty}
          value={
            c.profileKey ? (
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                {profileUrl}
              </a>
            ) : null
          }
        />
        <Field
          label={dict.contact.fieldTeamOverlap}
          emptyLabel={dict.contact.empty}
          value={
            c.overlapWith.length ? (
              <span className="badge">{dict.common.alsoIn(c.overlapWith.join(", "))}</span>
            ) : null
          }
        />
        <Field
          label={dict.contact.fieldAddedOn}
          emptyLabel={dict.contact.empty}
          value={formatDate(c.createdAt, locale)}
        />
      </section>

      <section className="panel">
        <h2>{dict.contact.relationshipSignals}</h2>
        {c.messageCount > 0 ? (
          <>
            <Field
              label={dict.contact.fieldMessages}
              emptyLabel={dict.contact.empty}
              value={dict.contact.messagesTotal(c.messageCount)}
            />
            <Field
              label={dict.contact.fieldSentReceived}
              emptyLabel={dict.contact.empty}
              value={dict.contact.sentReceived(c.sentCount, c.receivedCount)}
            />
            <Field
              label={dict.contact.fieldFirstContact}
              emptyLabel={dict.contact.empty}
              value={
                c.firstMessageAt ? (
                  <>
                    {formatDateTime(c.firstMessageAt, locale)}{" "}
                    <span className="soft">
                      ({relativeTime(new Date(c.firstMessageAt), locale)})
                    </span>
                  </>
                ) : null
              }
            />
            <Field
              label={dict.contact.fieldLastContact}
              emptyLabel={dict.contact.empty}
              value={
                c.lastMessageAt ? (
                  <>
                    {formatDateTime(c.lastMessageAt, locale)}{" "}
                    <span className="soft">
                      ({relativeTime(new Date(c.lastMessageAt), locale)})
                    </span>
                  </>
                ) : null
              }
            />
            <Field
              label={dict.contact.fieldStartedBy}
              emptyLabel={dict.contact.empty}
              value={
                c.initiatedByMe === null
                  ? null
                  : c.initiatedByMe
                    ? dict.contact.startedByMe
                    : dict.contact.startedByThem
              }
            />
            <Field
              label={dict.contact.fieldReciprocal}
              emptyLabel={dict.contact.empty}
              value={
                <span className={`badge ${c.reciprocal ? "green" : ""}`}>
                  {c.reciprocal ? dict.common.yes : dict.common.no}
                </span>
              }
            />
            {c.dormant && (
              <Field
                label={dict.contact.fieldStatus}
                emptyLabel={dict.contact.empty}
                value={<span className="badge dormant">{dict.common.dormantBadge}</span>}
              />
            )}
          </>
        ) : (
          <p className="muted">{dict.contact.noMessages}</p>
        )}
      </section>

      {threads.length > 0 && (
        <section className="panel">
          <h2>{dict.contact.conversationHistory}</h2>
          {moreConversations && (
            <p className="thread-notice">
              {dict.contact.moreConversationsNotice(threads.length)}
            </p>
          )}
          {moreMessages && <p className="thread-notice">{dict.contact.moreMessagesNotice}</p>}
          {threads.map((thread) => (
            <div key={thread.id} className="thread">
              <div className="thread-header">
                <span className="thread-title">
                  {thread.title || dict.contact.untitledConversation}
                </span>
                <span className="soft thread-meta">
                  {dict.contact.messageCountLabel(thread.messageCount)}
                  {thread.lastMessageAt && (
                    <> {dict.contact.lastMessageTime(relativeTime(new Date(thread.lastMessageAt), locale))}</>
                  )}
                </span>
              </div>
              <div className="thread-messages">
                {thread.messages.map((m) => (
                  <div key={m.id} className="message">
                    <div className="message-meta">
                      <span className="message-sender">
                        {m.senderName || dict.contact.unknownSender}
                      </span>
                      <span className="soft message-time">
                        {formatDateTime(m.sentAt, locale)}
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
