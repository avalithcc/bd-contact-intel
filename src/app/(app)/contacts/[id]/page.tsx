import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getContactRecord } from "@/lib/contacts/queries";
import { getPersonTimeline, isTimelineActivityType } from "@/lib/activity/queries";
import { describeConnectionHistory } from "@/lib/contacts/connectionHistory";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { AboutPane, type AboutPaneProperty } from "./AboutPane";
import { RecordTabs } from "./RecordTabs";
import { Timeline } from "./Timeline";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface ContactRecordPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ activityType?: string }>;
}

/**
 * Three-pane record shell (task 9.2; mockups/contact-record.html). The
 * read-only shell shipped in PR 09b1; PR 09b2 wired inline property edit
 * (task 9.4); PR 09b3 added the Nota/Correo/Tarea quick actions; PR 10a
 * (task 10.1) replaces the "Actividad" placeholder with the filtered
 * timeline pane.
 */
export default async function ContactRecordPage({ params, searchParams }: ContactRecordPageProps) {
  const { id } = await params;
  const { activityType: rawActivityType } = await searchParams;
  const result = await getContactRecord(id);

  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") redirect(`/contacts/${result.personId}`);

  const { record } = result;
  const dict = await getDictionary();
  const l = pickContactRecordLabels(dict);
  const messageLabels = pickGenerateMessageLabels(dict);
  const locale = await getLocale();
  const activityType = rawActivityType && isTimelineActivityType(rawActivityType) ? rawActivityType : undefined;
  const me = await getCurrentBd();
  const isAdmin = me.role === "admin";
  const timeline = await getPersonTimeline(record.person.id, me.id, { type: activityType });

  const name = [record.person.firstName, record.person.lastName].filter(Boolean).join(" ") || dict.contact.unnamed;
  const statusLabel = dict.leadStatuses[record.person.status as keyof typeof dict.leadStatuses] ?? record.person.status;

  const properties: AboutPaneProperty[] = record.properties.map((p) => ({
    key: p.key,
    label: l[`prop${p.key.charAt(0).toUpperCase()}${p.key.slice(1)}` as keyof typeof l] as string,
    value: p.value,
    lastUpdatedLabel: p.lastEdit
      ? `${l.lastUpdatedByPrefix} ${p.lastEdit.bdName ?? "—"} · ${format(p.lastEdit.at, "d MMM", { locale: es })}`
      : null,
  }));

  return (
    <main>
      <div className={styles.record}>
        <AboutPane
          personId={record.person.id}
          labels={l}
          name={name}
          headline={record.person.jobTitle}
          statusLabel={statusLabel}
          ownerLabel={record.ownerName}
          email={record.person.email}
          properties={properties}
          messageLabels={messageLabels}
          locale={locale}
        />

        <div className={styles.main}>
          <RecordTabs
            tabs={[
              {
                id: "activity",
                label: l.tabActivity,
                content: (
                  <Timeline
                    personId={record.person.id}
                    labels={l}
                    entries={timeline.entries}
                    countsByType={timeline.countsByType}
                    activeType={activityType}
                  />
                ),
              },
              {
                id: "overview",
                label: l.tabOverview,
                content: <div className={styles.placeholder}>{l.overviewComingSoon}</div>,
              },
            ]}
          />
        </div>

        <aside className={styles.right}>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{l.companyCardTitle}</h3>
            {record.person.companyKey ? (
              <Link href={`/companies/${record.person.companyKey}`} className={styles.assocLink}>
                {record.person.company ?? l.noCompany}
              </Link>
            ) : (
              <div>{record.person.company ?? l.noCompany}</div>
            )}
          </div>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{l.connectedBdsTitle}</h3>
            {record.connections.length ? (
              record.connections.map((c) => {
                const history = describeConnectionHistory(c);
                const canViewConversation = isAdmin && c.bdId !== me.id && history.kind === "some";
                return (
                  <div key={c.bdId} className={styles.assocRowStack}>
                    <div className={styles.assocRow}>
                      <span>{c.bdName ?? "—"}</span>
                      <span>{c.connectedOn ? `${l.connectedOnPrefix} ${c.connectedOn}` : l.emptyValue}</span>
                    </div>
                    <div className={styles.assocMeta}>
                      {history.kind === "some"
                        ? `${history.count} ${l.connectionHistorySomePrefix} ${
                            history.lastMessageAt ? format(history.lastMessageAt, "d MMM", { locale: es }) : l.emptyValue
                          }`
                        : l.connectionHistoryNone}
                    </div>
                    {canViewConversation && (
                      <Link href={`/contacts/${record.person.id}/conversation/${c.bdId}`} className={styles.assocLink}>
                        {l.viewConversationLink}
                      </Link>
                    )}
                  </div>
                );
              })
            ) : (
              <div className={styles.placeholder}>{l.associationsComingSoon}</div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
